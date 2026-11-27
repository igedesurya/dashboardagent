#!/usr/bin/env node
// Agent HQ orchestrator: one working session plus one optional QA session.
// Listens on 127.0.0.1 only. Browser requests must come from the dashboard origin.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, HOME, DATA, MAX_ACTIVE, ensureDir, loadToken, readJson, writeJson, findBin, clip } from './lib.js';
import { normalize, classify } from './policy.js';
import { isRepo, currentRef } from './git.js';
import { ROLES, TOOLS, PROJECT_KINDS, instructions, hasBrief } from './roles.js';
import { createClaude } from './engines/claude.js';
import { createCursor, listCursorModels } from './engines/cursor.js';
import { createGemini, listGeminiModels } from './engines/gemini.js';
import { createOpencode, onOpencodePermission, replyPermission, stopOpencode, listOpencodeModels } from './engines/opencode.js';

const TOKEN = loadToken({ create: true });
const ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', ...(process.env.AHQ_ORIGINS || '').split(',').filter(Boolean)]);
const PROJECTS_DIR = ensureDir(path.join(DATA, 'projects'));
const QUOTA_PAUSE = 15 * 60 * 1000;
// A working agent with no activity for this long is considered stuck and stopped.
const STALL_MS = 20 * 60 * 1000;
// Idle agents release their processes after this long; the next turn resumes the same session.
const IDLE_MS = +process.env.AHQ_IDLE_MIN * 60000 || 5 * 60 * 1000;
const ENGINES = ['claude', 'opencode', 'cursor', 'gemini'];
const DEFAULT_MODEL = { claude: 'sonnet', opencode: 'opencode/deepseek-v4.1-flash-free', cursor: '', gemini: 'auto' };

// ---------------- state ----------------
const projects = new Map(); // id -> { meta, state, sessions }
const workers = new Map(); // `${pid}:${role}` -> Worker
const pending = new Map(); // permission id -> request
const clients = new Map(); // pid -> Set(res)
const pausedUntil = { claude: 0, opencode: 0, cursor: 0, gemini: 0 };
let active = 0;
let seqPerm = 0;

const pdir = (id) => path.join(PROJECTS_DIR, id);
const loopSlug = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/\.md$/i, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const toolFileName = (name) => {
  const base = path.basename(String(name || ''));
  return /^[\w.-]{1,60}$/.test(base) && !base.startsWith('.') ? base : null;
};
const loopDir = (pid, kind) => path.join(pdir(pid), 'loop', kind === 'toolbox' ? 'toolbox' : 'playbooks');
function loopNames(pid, kind) {
  try {
    return fs.readdirSync(loopDir(pid, kind)).filter((f) => kind === 'toolbox' ? toolFileName(f) : f.endsWith('.md')).map((f) => (kind === 'toolbox' ? f : f.slice(0, -3))).sort();
  } catch {
    return [];
  }
}
function loopList(pid) {
  return { playbooks: loopNames(pid, 'playbook'), toolbox: loopNames(pid, 'toolbox') };
}
function loopIndex(pid) {
  const l = loopList(pid);
  return `[Playbook: ${l.playbooks.join(', ') || 'belum ada'}] [Toolbox: ${l.toolbox.join(', ') || 'kosong'}]`;
}
function readLoopFile(pid, kind, name) {
  const file = path.join(loopDir(pid, kind), kind === 'toolbox' ? name : `${name}.md`);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
function writeLoopFile(pid, kind, name, text) {
  const dir = ensureDir(loopDir(pid, kind));
  fs.writeFileSync(path.join(dir, kind === 'toolbox' ? name : `${name}.md`), text);
}
function loadProjects() {
  for (const id of fs.readdirSync(PROJECTS_DIR)) {
    const meta = readJson(path.join(pdir(id), 'project.json'), null);
    if (!meta) continue;
    const state = readJson(path.join(pdir(id), 'state.json'), {});
    // Permission requests do not survive a restart: the agent that asked is gone.
    for (const m of state.chat || []) if (m.kind === 'permission' && !m.decision) m.decision = 'expired';
    // Old "always" entries were plain strings shared by every role (e.g. any rm -rf, all of /Users/<you>). Drop them.
    if ((state.remembered || []).some((r) => typeof r === 'string')) state.remembered = state.remembered.filter((r) => typeof r === 'object');
    if (!meta.worker) meta.worker = { engine: 'cursor', model: '' };
    if (!meta.qa) meta.qa = { engine: 'gemini', model: '' };
    delete meta.roles;
    delete state.tickets;
    state.chat = (state.chat || []).filter((m) => !m.ticket && !['ticket', 'handoff', 'approval', 'review', 'escalation', 'doc'].includes(m.kind));
    const sessions = readJson(path.join(pdir(id), 'sessions.json'), {});
    projects.set(id, {
      meta,
      state: { chat: [], seq: { q: 0, m: 0 }, remembered: [], ...state },
      sessions: { worker: sessions.worker || null, qa: sessions.qa || null },
    });
  }
}
const saveTimers = {};
function save(id) {
  clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(() => {
    const p = projects.get(id);
    if (!p) return;
    writeJson(path.join(pdir(id), 'project.json'), p.meta);
    writeJson(path.join(pdir(id), 'state.json'), p.state);
    writeJson(path.join(pdir(id), 'sessions.json'), p.sessions);
  }, 200);
}

function addChat(pid, msg) {
  const p = projects.get(pid);
  const m = { id: `m${++p.state.seq.m}`, t: Date.now(), ...msg };
  p.state.chat.push(m);
  if (p.state.chat.length > 500) p.state.chat.splice(0, p.state.chat.length - 500);
  save(pid);
  return m;
}

// ---------------- workspace per role ----------------
// Each session works in ~/.agent-hq/workspaces/<project>/<role>, which holds symlinks to the
// project folders plus the engine configs (MCP, hooks, instructions). Edits go in the user's folders.
function prepareWorkspace(p, role, opts = {}) {
  const dir = ensureDir(path.join(DATA, 'workspaces', p.meta.id, role));
  const node = process.execPath;
  const here = import.meta.dirname;
  // Engines may start hooks and MCP servers with a reduced environment, so pass everything explicitly.
  const env = { AHQ_PROJECT: p.meta.id, AHQ_ROLE: role, AHQ_INST: opts.inst || '', AHQ_HOME: DATA, AHQ_PORT: String(PORT) };
  const used = new Set();
  const links = new Map();
  for (const f of p.meta.folders) {
    let name = path.basename(f);
    for (let i = 2; used.has(name); i++) name = `${path.basename(f)}-${i}`;
    used.add(name);
    links.set(name, f);
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() && !links.has(entry.name)) fs.unlinkSync(path.join(dir, entry.name));
  }
  for (const [name, target] of links) {
    const lp = path.join(dir, name);
    try {
      if (fs.readlinkSync(lp) === target) continue;
      fs.unlinkSync(lp);
    } catch {}
    try {
      fs.symlinkSync(target, lp);
    } catch {}
  }
  const prompt = instructions(role, p.meta, opts);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), prompt + '\n');
  fs.writeFileSync(path.join(dir, 'GEMINI.md'), prompt + '\n');
  writeJson(path.join(dir, '.ahq', 'claude-settings.json'), {
    permissions: { ask: ['Read(**/.env*)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/id_rsa*)', 'Read(**/.npmrc)', 'Read(**/credentials*)', 'Bash(curl:*)', 'Bash(wget:*)', 'WebFetch', 'WebSearch'] },
  });
  writeJson(path.join(dir, '.cursor', 'mcp.json'), { mcpServers: { ahq: { command: node, args: [path.join(here, 'mcp.js')], env: { ...env, AHQ_ENGINE: 'cursor' } } } });
  const hookEnv = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
  writeJson(path.join(dir, '.cursor', 'hooks.json'), { version: 1, hooks: { preToolUse: [{ command: `${hookEnv} ${JSON.stringify(node)} ${JSON.stringify(path.join(here, 'cursor-hook.js'))}`, timeout: 86400 }] } });
  ensureDir(path.join(dir, '.cursor', 'rules'));
  fs.writeFileSync(path.join(dir, '.cursor', 'rules', 'peran.mdc'), `---\ndescription: Peran agent di Agent HQ\nalwaysApply: true\n---\n${prompt}\n`);
  writeJson(path.join(dir, 'opencode.json'), {
    $schema: 'https://opencode.ai/config.json',
    mcp: { ahq: { type: 'local', command: [node, path.join(here, 'mcp.js')], environment: { ...env, AHQ_ENGINE: 'opencode' } } },
  });
  // Gemini CLI: MCP + BeforeTool hook (the only guard, since the adapter runs with --approval-mode yolo). Hook timeout is in ms.
  writeJson(path.join(dir, '.gemini', 'settings.json'), {
    mcpServers: { ahq: { command: node, args: [path.join(here, 'mcp.js')], env: { ...env, AHQ_ENGINE: 'gemini' } } },
    hooks: { BeforeTool: [{ matcher: '.*', hooks: [{ type: 'command', command: `${hookEnv} ${JSON.stringify(node)} ${JSON.stringify(path.join(here, 'gemini-hook.js'))}`, timeout: 86400000 }] }] },
    context: { fileName: ['GEMINI.md'] },
  });
  // Both sessions may read the project folders. The working session may also write there.
  const roots = [dir, safeReal(dir), ...p.meta.folders.flatMap((f) => [f, safeReal(f)])].filter((v, i, a) => v && a.indexOf(v) === i);
  const writeRoots = opts.writeRoots?.length
    ? opts.writeRoots.flatMap((d) => [d, safeReal(d)]).filter(Boolean)
    : [];
  return { dir, prompt, roots, writeRoots };
}
const hashText = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
};

function safeReal(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

// ---------------- workers & scheduler ----------------
class Worker {
  constructor(pid, role, opts = {}) {
    this.pid = pid;
    this.role = role;
    this.opts = opts;
    this.inbox = [];
    this.queuedAt = 0;
    this.busy = false;
    this.activity = null;
    this.error = null;
    this.tokens = null;
    this.started = Date.now();
    this.updated = Date.now();
    this.adapter = null;
    this.key = null;
    this.roots = [];
    this.writeRoots = [];
  }
  get skey() {
    return this.role;
  }
  get label() {
    return this.role === 'qa' ? 'QA' : 'Pengerjaan';
  }
  get p() {
    return projects.get(this.pid);
  }
  get cfg() {
    const m = this.p.meta;
    return this.role === 'qa' ? (m.qa || { engine: 'gemini', model: '' }) : (m.worker || { engine: 'cursor', model: '' });
  }
  get engine() {
    return this.cfg.engine;
  }
  ensureAdapter() {
    const p = this.p;
    const { engine, model } = this.cfg;
    const ws = prepareWorkspace(p, this.role, this.opts);
    this.roots = ws.roots;
    this.writeRoots = ws.writeRoots;
    const key = `${engine}|${model}|${p.meta.folders.join(',')}|${ws.dir}|${hashText(ws.prompt)}`;
    if (this.adapter && this.key === key) return;
    this.adapter?.stop();
    this.key = key;
    const sk = this.skey;
    p.sessions[sk] ||= {};
    const common = {
      project: p.meta,
      role: this.role,
      workspace: ws.dir,
      roots: ws.roots,
      model: model || DEFAULT_MODEL[engine] || '',
      prompt: ws.prompt,
      sessionId: p.sessions[sk][engine] || null,
      inst: '',
      onSession: (id) => {
        p.sessions[sk][engine] = id;
        save(this.pid);
      },
      onEvent: (e) => this.onEvent(e),
    };
    // Test mode: agents do nothing, so the ticket flow can be driven step by step through the MCP routes.
    if (process.env.AHQ_DRY_RUN) this.adapter = { send: async () => ({ ok: true, text: '' }), stop() {} };
    else if (engine === 'claude') this.adapter = createClaude(common);
    else if (engine === 'cursor') this.adapter = createCursor(common);
    else if (engine === 'gemini') this.adapter = createGemini(common);
    else this.adapter = createOpencode({ ...common, agent: ROLES[this.role]?.readOnly ? 'plan' : 'build' });
  }
  onEvent(e) {
    if (e.type === 'usage') this.tokens = e.tokens;
    if (e.type === 'tool') {
      const next = activityFor(e.name, e.input);
      const cur = this.activity;
      // Same tool and file as the previous event: nothing new for the dashboard.
      if (cur && cur.state === next.state && cur.task === next.task && cur.tool === next.tool) {
        this.updated = Date.now();
        return;
      }
      this.activity = next;
    }
    this.updated = Date.now();
    // Activity can fire many times a second. Chat stays on the fast path.
    emit(this.pid, true);
  }
  enqueue(text) {
    if (!this.inbox.length) this.queuedAt = Date.now();
    this.inbox.push(text);
    this.error = null;
    kick();
  }
}

function activityFor(name, input = {}) {
  const n = String(name).toLowerCase();
  if (/toolsearch|todo/.test(n)) return { state: 'thinking', task: 'menyiapkan langkah', tool: name };
  if (/ahq|tanya|tiket|lapor/.test(n) || /^mcp|execute/.test(n)) {
    const t = n.includes('tanya') ? 'menyiapkan pertanyaan' : n.includes('tiket') ? 'mengurus tiket' : n.includes('lapor') ? 'menulis laporan' : 'memakai tool tim';
    return { state: 'thinking', task: t, tool: name };
  }
  const f = input.file_path || input.path || input.filePath || input.pattern || input.query || input.command || '';
  if (/read|grep|glob|ls|list|search|find|fetch/.test(n)) return { state: 'reading', task: clip(`membaca ${path.basename(String(f)) || ''}`, 60), tool: name };
  if (/edit|write|patch|replace|delete/.test(n)) return { state: 'coding', task: clip(`mengedit ${path.basename(String(f))}`, 60), tool: name };
  if (/shell|bash|terminal|command/.test(n)) return { state: 'running', task: clip(input.command || 'menjalankan perintah', 60), tool: name };
  return { state: 'thinking', task: 'berpikir…', tool: name };
}

function workerFor(pid, role, opts = {}) {
  const k = `${pid}:${role}`;
  if (!workers.has(k)) workers.set(k, new Worker(pid, role, opts));
  else if (opts && Object.keys(opts).length) workers.get(k).opts = opts;
  return workers.get(k);
}

function kick() {
  const ready = [...workers.values()].filter((w) => w.inbox.length && !w.busy && Date.now() >= pausedUntil[w.engine]).sort((a, b) => a.queuedAt - b.queuedAt);
  const pids = new Set();
  for (const w of ready) {
    pids.add(w.pid);
    if (active >= MAX_ACTIVE) continue;
    runTurn(w);
  }
  for (const pid of pids) emit(pid);
}
setInterval(kick, 30000);
setInterval(() => {
  for (const w of workers.values()) {
    if (!w.busy || Date.now() - w.updated < STALL_MS || pendingFor(w)) continue;
    addChat(w.pid, { from: 'system', kind: 'error', text: `${w.label} tidak menunjukkan aktivitas selama ${STALL_MS / 60000} menit dan dihentikan.` });
    w.stalled = true;
    w.adapter?.stop();
    w.adapter = null;
    w.key = null;
  }
}, 60000);
// Free memory: stop idle Claude Code processes and, when no opencode role is working, the opencode server.
// Sessions stay saved, so the next message continues the same conversation (--resume / same session id).
let opencodeLastUsed = 0;
setInterval(() => {
  const now = Date.now();
  for (const w of workers.values()) {
    if (w.engine === 'opencode' && (w.busy || w.inbox.length)) opencodeLastUsed = now;
    if (!w.adapter || w.busy || w.inbox.length || pendingFor(w) || now - w.updated < IDLE_MS) continue;
    // opencode roles have no process of their own; stopping would only send an interrupt to the server.
    if (w.engine !== 'opencode') w.adapter.stop();
    w.adapter = null;
    w.key = null;
  }
  const opencodeBusy = [...workers.values()].some((w) => w.engine === 'opencode' && (w.busy || w.inbox.length));
  if (!opencodeBusy && opencodeLastUsed && now - opencodeLastUsed > IDLE_MS) {
    stopOpencode();
    opencodeLastUsed = 0;
  }
}, 60000);

const pendingFor = (w) => [...pending.values()].some((r) => r.pid === w.pid && r.role === w.role);

async function runTurn(w) {
  active++;
  w.busy = true;
  w.error = null;
  const text = w.inbox.splice(0).join('\n\n---\n\n');
  w.activity = { state: 'thinking', task: 'berpikir…', tool: '—' };
  w.updated = Date.now();
  emit(w.pid);
  let r;
  try {
    w.ensureAdapter();
    r = await w.adapter.send(text);
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  active--;
  w.busy = false;
  if (w.engine === 'opencode') opencodeLastUsed = Date.now();
  w.activity = null;
  w.updated = Date.now();
  if (r.text) addChat(w.pid, { from: w.role, who: w.label, kind: 'message', text: r.text });
  if (w.stalled) {
    w.stalled = false;
    emit(w.pid);
    kick();
    return;
  }
  if (!r.ok) {
    if (r.quota) {
      pausedUntil[w.engine] = Date.now() + QUOTA_PAUSE;
      w.inbox.unshift(text);
      w.queuedAt = Date.now();
      addChat(w.pid, { from: 'system', kind: 'info', text: `Kuota ${w.engine} habis atau dibatasi. Semua agent ${w.engine} istirahat dan otomatis lanjut sekitar ${hhmm(pausedUntil[w.engine])}.` });
    } else {
      w.error = clip(r.error, 200);
      addChat(w.pid, { from: 'system', kind: 'error', text: `${w.label} gagal: ${clip(r.error, 400)}` });
    }
  }
  if (r.ok) nudgeIfStuck(w);
  emit(w.pid);
  kick();
}


// QA must finish with lapor_uji. Remind once if the turn ended as plain text.
function nudgeIfStuck(w) {
  if (w.role !== 'qa' || !w.pendingReport) return;
  w.pendingReport = false;
  w.enqueue('[Sistem] Giliranmu berakhir tapi hasil uji belum kamu laporkan. Panggil lapor_uji.');
}

// ---------------- permissions ----------------
function decide({ pid, role, engine, tool, input }) {
  const p = projects.get(pid);
  const w = workers.get(`${pid}:${role}`) || workerFor(pid, role);
  if (!w.roots.length) Object.assign(w, (({ roots, writeRoots }) => ({ roots, writeRoots }))(prepareWorkspace(p, role, w.opts)));
  const req = normalize(engine, tool, input);
  const c = classify(req, {
    roots: w.roots,
    writeRoots: w.writeRoots,
    mirrors: [],
    forbidden: forbiddenFor(p),
    noEdit: !!ROLES[role]?.noEdit,
    readOnly: ROLES[role]?.readOnly ?? true,
    remembered: new Set(p.state.remembered.filter((r) => r.role === role).map((r) => r.key)),
  });
  if (process.env.AHQ_DEBUG) console.log('[izin]', engine, role, tool, JSON.stringify(input).slice(0, 200), '=>', req.kind, c.decision);
  if (c.decision === 'allow') return Promise.resolve({ allow: true });
  if (c.decision === 'deny') return Promise.resolve({ allow: false, message: c.reason });
  return new Promise((resolve) => {
    const id = `P${Date.now().toString(36)}${++seqPerm}`;
    const req2 = { id, pid, role, who: w.label, summary: c.summary, reason: c.reason, key: c.key, rememberable: !!c.key, detail: clip(JSON.stringify(input), 500), created: Date.now(), resolve };
    pending.set(id, req2);
    addChat(pid, { from: role, who: w.label, kind: 'permission', permission: id, text: c.summary, reason: c.reason, rememberable: !!c.key });
    emit(pid);
  });
}
function resolvePermission(id, decision) {
  const r = pending.get(id);
  if (!r) return false;
  pending.delete(id);
  const p = projects.get(r.pid);
  if (decision === 'always' && !r.key) decision = 'once';
  if (decision === 'always' && !p.state.remembered.some((x) => x.role === r.role && x.key === r.key)) {
    p.state.remembered.push({ key: r.key, role: r.role, summary: r.summary, t: Date.now() });
  }
  const msg = p.state.chat.find((m) => m.permission === id);
  if (msg) msg.decision = decision;
  save(r.pid);
  r.resolve(decision === 'deny' ? { allow: false, message: 'Ditolak oleh pengguna.' } : { allow: true });
  emit(r.pid);
  return true;
}

// Areas no role may touch: the orchestrator's data and every other project's folders.
function forbiddenFor(p) {
  const own = new Set(p.meta.folders);
  const others = [...projects.values()].flatMap((x) => (x === p ? [] : x.meta.folders)).filter((f) => !own.has(f));
  return [DATA, safeReal(DATA), ...others, ...others.map(safeReal)].filter(Boolean);
}

onOpencodePermission(async (d) => {
  const w = [...workers.values()].find((x) => x.p?.sessions[x.skey]?.opencode === d.sessionID);
  if (!w) return;
  const r = await decide({ pid: w.pid, role: w.role, engine: 'opencode', tool: d.action, input: { resources: d.resources || [] } });
  replyPermission(d.sessionID, d.id, r.allow, r.message).catch(() => {});
});

// ---------------- tools (called by agents through MCP) ----------------
const roleLabel = (r) => ROLES[r]?.label || r;

function teamTool(pid, role, tool, a = {}) {
  const p = projects.get(pid);
  if (!p) return { error: 'project tidak ditemukan' };
  if (!TOOLS[tool] || !TOOLS[tool].roles.includes(role)) return { error: `Peran ${roleLabel(role)} tidak boleh memakai ${tool}.` };
  try {
    switch (tool) {
      case 'tanya_pengguna': {
        const q = `Q-${++p.state.seq.q}`;
        addChat(pid, { from: role, kind: 'question', question: q, text: String(a.pertanyaan || ''), answered: false });
        return { text: `Pertanyaan ${q} sudah tampil di dashboard pengguna. Akhiri giliranmu sekarang; jawabannya akan datang sebagai pesan berikutnya.` };
      }
      case 'baca_playbook': {
        const nama = loopSlug(a.nama);
        if (!nama) return { text: loopIndex(pid) };
        const text = readLoopFile(pid, 'playbook', nama);
        return text == null ? { error: `Playbook ${nama} tidak ada. Daftar: ${loopIndex(pid)}` } : { text };
      }
      case 'simpan_playbook': {
        const nama = loopSlug(a.nama);
        if (!nama) return { error: 'Nama playbook wajib, huruf dan angka.' };
        const langkah = String(a.langkah || '').trim();
        const proof = String(a.proof || '').trim();
        if (!langkah || !proof) return { error: 'Langkah dan Proof wajib diisi.' };
        const body = `# ${nama}\n\n## Langkah\n${langkah.slice(0, 20000)}\n\n## Proof\n${proof.slice(0, 8000)}\n`;
        writeLoopFile(pid, 'playbook', nama, body);
        addChat(pid, { from: 'system', kind: 'info', text: `Playbook ${nama} diperbarui.` });
        return { text: `Playbook ${nama} tersimpan. Besok ikuti file ini, bukan koreksi di chat.` };
      }
      case 'baca_alat': {
        const nama = toolFileName(a.nama);
        if (!nama) return { text: loopIndex(pid) };
        const text = readLoopFile(pid, 'toolbox', nama);
        return text == null ? { error: `File ${nama} tidak ada di Toolbox.` } : { text };
      }
      case 'simpan_alat': {
        const nama = toolFileName(a.nama);
        if (!nama) return { error: 'Nama file Toolbox tidak valid.' };
        const isi = String(a.isi || '');
        if (!isi.trim()) return { error: 'Isi file kosong.' };
        writeLoopFile(pid, 'toolbox', nama, isi.slice(0, 80000));
        addChat(pid, { from: 'system', kind: 'info', text: `Toolbox menyimpan ${nama}.` });
        return { text: `${nama} tersimpan di Toolbox. Lain kali pakai file ini, jangan buat dari nol.` };
      }
      case 'minta_qa': {
        const summary = String(a.ringkasan || '').trim();
        if (!summary) return { error: 'Isi ringkasan perubahan yang harus diuji.' };
        if (!p.meta.folders.length) return { error: 'Folder project masih kosong.' };
        startIndependentQa(pid, summary, String(a.cara_uji || ''));
        return { text: 'QA dimulai di sesi terpisah. Akhiri giliranmu; hasilnya datang sebagai pesan.' };
      }
      case 'lapor_uji': {
        const q = workers.get(`${pid}:qa`);
        if (q) q.pendingReport = false;
        const pass = !!a.lulus;
        addChat(pid, { from: 'qa', who: 'QA', kind: 'qa', pass, text: pass ? String(a.hasil || '') : `${a.temuan || ''}\n\n${a.hasil || ''}`.trim() });
        workerFor(pid, 'worker', workerSeat(p)).enqueue(`[Dari QA] ${pass ? 'LULUS' : 'GAGAL'}\nHasil: ${a.hasil || ''}\nTemuan: ${a.temuan || '-'}\n\nKalau gagal, perbaiki di folder yang sama lalu uji lagi sendiri. Kalau lulus, lapor ke pengguna.`);
        return { text: 'Hasil uji tercatat dan dikirim ke sesi pengerjaan.' };
      }
      case 'lapor': {
        const bukti = String(a.bukti || '').trim();
        const isi = bukti ? `${a.isi || ''}\n\nProof:\n${bukti}` : String(a.isi || '');
        addChat(pid, { from: role, kind: 'report', text: isi });
        return { text: 'Laporan terkirim ke pengguna.' };
      }
    }
    return { error: `tool ${tool} tidak dikenal` };
  } catch (e) {
    return { error: e.message };
  } finally {
    save(pid);
    emit(pid);
  }
}


// Both sessions may write inside these folders. The working session edits the project; QA is blocked by noEdit.
function workerSeat(p) {
  const dirs = [path.join(DATA, 'workspaces', p.meta.id, 'worker'), ...p.meta.folders];
  return { writeRoots: dirs.flatMap((f) => [f, safeReal(f)].filter(Boolean)) };
}

// Work happens in the folders the user already has open, on whatever branch is checked out there.
function ensureProjectWork(p) {
  const lines = [];
  for (const src of p.meta.folders) {
    if (!isRepo(src)) {
      lines.push(`- ${path.basename(src)}: kerjakan langsung di ${src}.`);
      continue;
    }
    const ref = currentRef(src);
    lines.push(`- ${path.basename(src)}: kerjakan langsung di ${src}, branch yang sedang terbuka (${ref.branch}). Jangan membuat branch baru dan jangan pindah branch.`);
  }
  return { lines };
}

// QA is a second session in the same folders. It only runs when the working session asks, and it cannot edit.
function startIndependentQa(pid, summary, how) {
  const p = projects.get(pid);
  const info = ensureProjectWork(p);
  const qa = workerFor(pid, 'qa', { mode: 'qa' });
  qa.pendingReport = true;
  const steps = how.trim() || p.meta.brief?.uji || '(pakai cara uji di ringkasan project)';
  addChat(pid, { from: 'system', kind: 'work', text: `QA mulai menguji: ${clip(summary, 180)}` });
  qa.enqueue(`[Sistem] Uji perubahan berikut di folder project yang sedang terbuka. Jangan mengubah kode dan jangan pindah branch. Selesai dengan lapor_uji.\n\nYang diubah:\n${summary}\n\nCara uji:\n${steps}\n\nLokasi:\n${info.lines.join('\n')}`);
}


// ---------------- snapshot for the dashboard ----------------
function agentRecord(w) {
  const p = w.p;
  const perm = [...pending.values()].find((r) => r.pid === w.pid && r.role === w.role);
  const question = p.state.chat.find((m) => m.kind === 'question' && !m.answered && m.from === w.role);
  let state = 'idle', task = null, tool = '—';
  if (w.busy && perm) [state, task] = ['waiting', `minta izin: ${perm.summary}`];
  else if (w.busy) ({ state, task, tool } = w.activity || { state: 'thinking', task: 'berpikir…', tool: '—' });
  else if (question) [state, task] = ['waiting', 'menunggu jawabanmu'];
  else if (w.inbox.length && Date.now() < pausedUntil[w.engine]) task = `istirahat: kuota habis, lanjut ${hhmm(pausedUntil[w.engine])}`;
  else if (w.inbox.length) task = 'antre';
  else if (w.error) [state, task] = ['error', w.error];
  return {
    id: `team:${w.pid}:${w.role}`, source: w.engine, name: w.label, state, task, tool: tool || '—',
    model: w.cfg.model || DEFAULT_MODEL[w.engine] || 'bawaan', project: p.meta.name, tokens: w.tokens, started: w.started, updated: w.updated,
  };
}
function snapshot(pid) {
  const p = projects.get(pid);
  const team = [workerFor(pid, 'worker', workerSeat(p))];
  const qa = workers.get(`${pid}:qa`);
  if (qa) team.push(qa);
  return {
    project: p.meta,
    agents: team.map(agentRecord),
    chat: p.state.chat.slice(-200),
    pending: [...pending.values()].filter((r) => r.pid === pid).map(({ resolve, ...r }) => r),
    remembered: p.state.remembered,
    loop: loopList(pid),
    paused: Object.fromEntries(ENGINES.filter((e) => Date.now() < pausedUntil[e]).map((e) => [e, pausedUntil[e]])),
    active,
    maxActive: MAX_ACTIVE,
  };
}
const emitTimers = {};
const lastSent = new Map();
// slow: activity-only updates. A pending chat/ticket emit is not delayed behind them.
function emit(pid, slow = false) {
  if (!clients.get(pid)?.size) return;
  const pendingEmit = emitTimers[pid];
  if (slow && pendingEmit && !pendingEmit.slow) return;
  clearTimeout(pendingEmit?.t);
  const timer = setTimeout(() => {
    delete emitTimers[pid];
    let data;
    try {
      data = `data: ${JSON.stringify(snapshot(pid))}\n\n`;
    } catch {
      return;
    }
    if (lastSent.get(pid) === data) return;
    lastSent.set(pid, data);
    for (const res of clients.get(pid) || []) res.write(data);
  }, slow ? 400 : 50);
  emitTimers[pid] = { t: timer, slow };
}

// ---------------- HTTP ----------------
function slug(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'project';
  let id = base;
  for (let i = 2; projects.has(id); i++) id = `${base}-${i}`;
  return id;
}
function engines() {
  return Object.fromEntries([['claude', findBin('claude')], ['opencode', findBin('opencode')], ['cursor', findBin('cursor-agent')], ['gemini', findBin('gemini')]].map(([k, v]) => [k, { available: !!v, defaultModel: DEFAULT_MODEL[k] }]));
}
const CLAUDE_MODELS = [
  { value: 'sonnet', provider: 'claude', label: 'sonnet — Claude Sonnet terbaru' },
  { value: 'opus', provider: 'claude', label: 'opus — Claude Opus terbaru' },
  { value: 'haiku', provider: 'claude', label: 'haiku — Claude Haiku terbaru (hemat)' },
];
const MODEL_LISTERS = {
  claude: async () => CLAUDE_MODELS,
  cursor: listCursorModels,
  gemini: listGeminiModels,
  opencode: listOpencodeModels,
};
const modelCache = {};
async function modelsFor(engine, refresh) {
  const c = modelCache[engine];
  if (c && !refresh && Date.now() - c.t < 10 * 60 * 1000) return c.models;
  if (engine === 'opencode') opencodeLastUsed = Date.now(); // listing models starts the opencode server
  const models = await MODEL_LISTERS[engine]();
  modelCache[engine] = { t: Date.now(), models };
  return models;
}

function cleanBrief(b) {
  const txt = (v, n) => String(v || '').trim().slice(0, n);
  return {
    jenis: PROJECT_KINDS.includes(b.jenis) ? b.jenis : '',
    tujuan: txt(b.tujuan, 2000),
    jalankan: txt(b.jalankan, 600),
    uji: txt(b.uji, 600),
    aturan: txt(b.aturan, 2000),
  };
}
function cleanFolders(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const abs = path.resolve(String(f).replace(/^~(?=\/|$)/, HOME));
    // Only folders inside the user's home; AHQ_TEST_ROOT allows a scratch folder during tests.
    const testRoot = process.env.AHQ_TEST_ROOT;
    if (!abs.startsWith(HOME + '/') && !(testRoot && abs.startsWith(testRoot + '/'))) continue;
    try {
      if (fs.statSync(abs).isDirectory() && !out.includes(abs)) out.push(abs);
    } catch {}
  }
  return out;
}

function send(res, code, obj, origin) {
  res.writeHead(code, { 'content-type': 'application/json', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(s || '{}'));
      } catch {
        resolve(null);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(res, 403, { error: 'host ditolak' });

  // Internal routes: MCP server and Cursor/Gemini hooks, authenticated with the shared token.
  if (url.pathname.startsWith('/internal/')) {
    const b = await body(req);
    if (!b || b.token !== TOKEN || !projects.has(b.project)) return send(res, 403, { error: 'ditolak' });
    if (url.pathname === '/internal/tool') return send(res, 200, teamTool(b.project, b.role, b.tool, b.args || {}));
    if (url.pathname === '/internal/permission') {
      req.socket.setTimeout(0);
      return send(res, 200, await decide({ pid: b.project, role: b.role, engine: b.engine, tool: b.tool, input: b.input }));
    }
    return send(res, 404, { error: 'tidak ada' });
  }

  // Browser routes: only from the dashboard origin.
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin ditolak' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': origin || '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE', 'access-control-allow-headers': 'content-type', vary: 'Origin' });
    return res.end();
  }
  if (req.method !== 'GET' && req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'pakai application/json' }, origin);
  const parts = url.pathname.split('/').filter(Boolean); // api, projects, :id, action
  const ok = (o) => send(res, 200, o, origin);
  const bad = (code, error) => send(res, code, { error }, origin);

  if (url.pathname === '/api/health') return ok({ ok: true, version: 1 });
  if (url.pathname === '/api/state') return ok({ projects: [...projects.values()].map((p) => p.meta), engines: engines(), roles: ROLES });
  if (url.pathname === '/api/models') {
    const engine = url.searchParams.get('engine');
    if (!ENGINES.includes(engine)) return bad(400, 'engine tidak dikenal');
    try {
      return ok({ engine, models: await modelsFor(engine, url.searchParams.has('refresh')) });
    } catch (e) {
      return bad(502, e.message);
    }
  }
  if (url.pathname === '/api/fs') {
    const p = path.resolve(url.searchParams.get('path') || HOME);
    if (p !== HOME && !p.startsWith(HOME + '/')) return bad(400, 'hanya folder di dalam home');
    try {
      const dirs = fs.readdirSync(p, { withFileTypes: true })
        .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.') && d.name !== 'Library')
        .map((d) => ({ name: d.name, path: path.join(p, d.name), git: fs.existsSync(path.join(p, d.name, '.git')) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return ok({ path: p, parent: p === HOME ? null : path.dirname(p), git: fs.existsSync(path.join(p, '.git')), dirs });
    } catch (e) {
      return bad(400, e.message);
    }
  }
  if (parts[0] === 'api' && parts[1] === 'projects') {
    if (parts.length === 2 && req.method === 'POST') {
      const b = await body(req);
      if (!b?.name) return bad(400, 'nama wajib');
      const id = slug(b.name);
      const eng = engines();
      const engine = ENGINES.find((e) => eng[e].available) || 'claude';
      const qaEngine = eng.gemini?.available ? 'gemini' : engine;
      const meta = { id, name: clip(b.name, 60), folders: cleanFolders(b.folders), brief: cleanBrief(b.brief || {}), worker: { engine, model: '' }, qa: { engine: qaEngine, model: '' }, created: Date.now() };
      projects.set(id, { meta, state: { chat: [], seq: { q: 0, m: 0 }, remembered: [] }, sessions: {} });
      save(id);
      return ok(meta);
    }
    const p = projects.get(parts[2]);
    if (!p) return bad(404, 'project tidak ditemukan');
    const pid = p.meta.id;
    const action = parts[3];
    if (!action && req.method === 'PUT') {
      const b = await body(req);
      if (!b) return bad(400, 'JSON tidak valid');
      if (b.name) p.meta.name = clip(b.name, 60);
      if (b.folders) p.meta.folders = cleanFolders(b.folders);
      if (b.brief) p.meta.brief = cleanBrief(b.brief);
      const seat = (cfg, prev) => (cfg && ENGINES.includes(cfg.engine) ? { engine: cfg.engine, model: clip(cfg.model || '', 80) } : prev);
      if (b.worker) p.meta.worker = seat(b.worker, p.meta.worker);
      if (b.qa) p.meta.qa = seat(b.qa, p.meta.qa);
      save(pid);
      emit(pid);
      return ok(p.meta);
    }
    if (action === 'loop' && req.method === 'GET') {
      const kind = url.searchParams.get('kind') === 'toolbox' ? 'toolbox' : 'playbook';
      const name = kind === 'toolbox' ? toolFileName(url.searchParams.get('name')) : loopSlug(url.searchParams.get('name'));
      if (!name) return ok(loopList(pid));
      const text = readLoopFile(pid, kind, name);
      return text == null ? bad(404, 'tidak ada') : ok({ name, text });
    }
    if (action === 'loop' && req.method === 'PUT') {
      const b = await body(req);
      if (!b) return bad(400, 'JSON tidak valid');
      const kind = b.kind === 'toolbox' ? 'toolbox' : 'playbook';
      const name = kind === 'toolbox' ? toolFileName(b.name) : loopSlug(b.name);
      if (!name) return bad(400, 'nama tidak valid');
      if (b.hapus) {
        try { fs.unlinkSync(path.join(loopDir(pid, kind), kind === 'toolbox' ? name : `${name}.md`)); } catch { return bad(404, 'tidak ada'); }
      } else {
        const text = String(b.text ?? '');
        if (!text.trim()) return bad(400, 'isi kosong');
        writeLoopFile(pid, kind, name, text.slice(0, 80000));
      }
      emit(pid);
      return ok({ ok: true, ...loopList(pid) });
    }
    if (action === 'stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
      res.write(`data: ${JSON.stringify(snapshot(pid))}\n\n`);
      if (!clients.has(pid)) clients.set(pid, new Set());
      clients.get(pid).add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        clients.get(pid)?.delete(res);
      });
      return;
    }
    if (action === 'chat' && req.method === 'POST') {
      const b = await body(req);
      const text = String(b?.text || '').trim();
      if (!text) return bad(400, 'pesan kosong');
      if (!p.meta.folders.length) return bad(400, 'Tambahkan minimal satu folder project dulu.');
      if (!hasBrief(p.meta)) return bad(400, 'Isi ringkasan project dulu (jenis dan tujuan) di ⚙️ Pengaturan project. Tanpa itu agent tidak punya konteks.');
      addChat(pid, { from: 'user', kind: 'message', text });
      let info;
      try {
        info = ensureProjectWork(p);
      } catch (e) {
        return bad(400, clip(e.stderr || e.message, 300));
      }
      const where = info.lines.length ? `\n\n[Lokasi kerja — branch yang sedang terbuka]\n${info.lines.join('\n')}` : '';
      workerFor(pid, 'worker', workerSeat(p)).enqueue(`${text}${where}\n\n${loopIndex(pid)}\nSebelum bekerja, baca playbook yang cocok. Sebelum lapor, centang Proof. Kalau salah, perbaiki playbook-nya.`);
      return ok({ ok: true });
    }
    if (action === 'answer' && req.method === 'POST') {
      const b = await body(req);
      const q = p.state.chat.find((m) => m.kind === 'question' && m.question === b?.question);
      const text = String(b?.text || '').trim();
      if (!q || q.answered || !text) return bad(400, 'pertanyaan tidak valid');
      q.answered = true;
      q.answer = text;
      addChat(pid, { from: 'user', kind: 'answer', question: q.question, text });
      if (q.from === 'worker' || q.from === 'qa') workerFor(pid, q.from).enqueue(`Jawaban pengguna untuk pertanyaanmu ${q.question}:\nPertanyaan: ${q.text}\nJawaban: ${text}`);
      return ok({ ok: true });
    }
    if (action === 'stop' && req.method === 'POST') {
      // Stop every role of this project that is working or queued.
      for (const w of workers.values()) {
        if (w.pid !== pid) continue;
        w.inbox = [];
        w.stalled = true;
        w.adapter?.stop();
        w.adapter = null;
        w.key = null;
      }
      return ok({ ok: true });
    }
    if (action === 'remembered' && req.method === 'POST') {
      const b = await body(req);
      const before = p.state.remembered.length;
      p.state.remembered = b?.all ? [] : p.state.remembered.filter((r) => !(r.role === b?.role && r.key === b?.key));
      save(pid);
      emit(pid);
      return ok({ removed: before - p.state.remembered.length });
    }
  }
  if (parts[0] === 'api' && parts[1] === 'permissions' && parts[2] && req.method === 'POST') {
    const b = await body(req);
    if (!['once', 'always', 'deny'].includes(b?.decision)) return bad(400, 'decision: once | always | deny');
    return resolvePermission(parts[2], b.decision) ? ok({ ok: true }) : bad(404, 'permintaan izin sudah tidak ada');
  }
  bad(404, 'tidak ditemukan');
});

loadProjects();
// Child agents and the opencode server must not outlive the orchestrator.
function shutdown() {
  for (const w of workers.values()) w.adapter?.stop();
  stopOpencode();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(PORT, '127.0.0.1', () => console.log(`Agent HQ orchestrator: http://127.0.0.1:${PORT} · data: ${DATA}`));
