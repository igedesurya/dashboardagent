#!/usr/bin/env node
// Agent HQ orchestrator: runs the project team (PM, later BA/SA/Programmer/QA) on this Mac.
// Listens on 127.0.0.1 only. Browser requests must come from the dashboard origin.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, HOME, DATA, MAX_ACTIVE, ensureDir, loadToken, readJson, writeJson, findBin, clip } from './lib.js';
import { normalize, classify } from './policy.js';
import { isRepo, ensureWorktree, ensureDetached, removeWorktree, commitAll, diffAgainst, mergeInto, currentRef } from './git.js';
import { ROLES, HANDOFF, TOOLS, instructions } from './roles.js';
import { createClaude } from './engines/claude.js';
import { createCursor, listCursorModels } from './engines/cursor.js';
import { createOpencode, onOpencodePermission, replyPermission, stopOpencode, listOpencodeModels } from './engines/opencode.js';

const TOKEN = loadToken({ create: true });
const ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', ...(process.env.AHQ_ORIGINS || '').split(',').filter(Boolean)]);
const PROJECTS_DIR = ensureDir(path.join(DATA, 'projects'));
const QUOTA_PAUSE = 15 * 60 * 1000;
// A working agent with no activity for this long is considered stuck and stopped.
const STALL_MS = 20 * 60 * 1000;
const ENGINES = ['claude', 'opencode', 'cursor'];
const DEFAULT_MODEL = { claude: 'sonnet', opencode: 'opencode/deepseek-v4.1-flash-free', cursor: '' };

// ---------------- state ----------------
const projects = new Map(); // id -> { meta, state, sessions }
const workers = new Map(); // `${pid}:${role}` -> Worker
const pending = new Map(); // permission id -> request
const clients = new Map(); // pid -> Set(res)
const pausedUntil = { claude: 0, opencode: 0, cursor: 0 };
let active = 0;
let seqPerm = 0;

const pdir = (id) => path.join(PROJECTS_DIR, id);
function loadProjects() {
  for (const id of fs.readdirSync(PROJECTS_DIR)) {
    const meta = readJson(path.join(pdir(id), 'project.json'), null);
    if (!meta) continue;
    const state = readJson(path.join(pdir(id), 'state.json'), {});
    // Permission requests do not survive a restart: the agent that asked is gone.
    for (const m of state.chat || []) if (m.kind === 'permission' && !m.decision) m.decision = 'expired';
    projects.set(id, {
      meta,
      state: { chat: [], tickets: [], seq: { t: 0, q: 0, m: 0 }, remembered: [], ...state },
      sessions: readJson(path.join(pdir(id), 'sessions.json'), {}),
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
const ticketOf = (p, id) => p.state.tickets.find((t) => t.id === String(id || '').toUpperCase());
function setTicket(p, t, status, note) {
  if (t.status !== status) t.history.push({ t: Date.now(), from: t.status, to: status, note: note || null });
  t.status = status;
  t.updated = Date.now();
}

// ---------------- workspace per role ----------------
// Agents never write config into the user's repos: each role works in ~/.agent-hq/workspaces/<project>/<role>,
// which holds symlinks to the project folders plus the engine configs (MCP, hooks, instructions).
// Programmers instead work in their ticket's worktree folder (opts.dir), which holds one git worktree per repo.
function prepareWorkspace(p, role, opts = {}) {
  const dir = ensureDir(opts.dir || path.join(DATA, 'workspaces', p.meta.id, role));
  const node = process.execPath;
  const here = import.meta.dirname;
  // Engines may start hooks and MCP servers with a reduced environment, so pass everything explicitly.
  const env = { AHQ_PROJECT: p.meta.id, AHQ_ROLE: role, AHQ_INST: opts.inst || '', AHQ_HOME: DATA, AHQ_PORT: String(PORT) };
  const used = new Set();
  const links = new Map();
  for (const f of opts.dir ? [] : p.meta.folders) {
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
  // Every role may read the project folders and the project's ticket worktrees (SA reviews them).
  const roots = [dir, safeReal(dir), worktreeRoot(p.meta.id), ...p.meta.folders.flatMap((f) => [f, safeReal(f)])].filter((v, i, a) => v && a.indexOf(v) === i);
  return { dir, prompt, roots, writeRoots: opts.dir ? [dir, safeReal(dir)].filter(Boolean) : [] };
}
const worktreeRoot = (pid) => path.join(DATA, 'worktrees', pid);
function safeReal(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

// ---------------- workers & scheduler ----------------
class Worker {
  // inst: Programmer number or "run" for the run step; opts: { dir, ticket, mode } for Programmers.
  constructor(pid, role, inst = '', opts = {}) {
    this.pid = pid;
    this.role = role;
    this.inst = String(inst || '');
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
  // Key for stored engine sessions: one session per role, or per ticket and instance for Programmers.
  get skey() {
    return this.inst ? `${this.role}:${this.opts.ticket}:${this.inst}` : this.role;
  }
  get label() {
    if (this.role === 'qa') return this.inst ? `QA ${this.inst}` : 'QA';
    if (this.role !== 'dev') return ROLES[this.role].label;
    return this.inst === 'run' ? 'Programmer' : `Programmer ${this.inst}`;
  }
  get p() {
    return projects.get(this.pid);
  }
  get cfg() {
    return this.p.meta.roles[this.role] || this.p.meta.roles.pm || { engine: 'claude', model: '' };
  }
  get engine() {
    return this.cfg.engine;
  }
  ensureAdapter() {
    const p = this.p;
    const { engine, model } = this.cfg;
    const ws = prepareWorkspace(p, this.role, { ...this.opts, inst: this.inst });
    this.roots = ws.roots;
    this.writeRoots = ws.writeRoots;
    const key = `${engine}|${model}|${p.meta.folders.join(',')}|${ws.dir}`;
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
      inst: this.inst,
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
    else this.adapter = createOpencode({ ...common, agent: ROLES[this.role].readOnly ? 'plan' : 'build' });
  }
  onEvent(e) {
    if (e.type === 'usage') this.tokens = e.tokens;
    if (e.type === 'tool') this.activity = activityFor(e.name, e.input);
    this.updated = Date.now();
    emit(this.pid);
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

function workerFor(pid, role, inst = '', opts) {
  const k = `${pid}:${role}${inst ? ':' + inst : ''}`;
  if (!workers.has(k)) workers.set(k, new Worker(pid, role, inst, opts));
  else if (opts) workers.get(k).opts = opts;
  return workers.get(k);
}

function kick() {
  const ready = [...workers.values()].filter((w) => w.inbox.length && !w.busy && Date.now() >= pausedUntil[w.engine]).sort((a, b) => a.queuedAt - b.queuedAt);
  for (const w of ready) {
    if (active >= MAX_ACTIVE) break;
    runTurn(w);
  }
  for (const pid of projects.keys()) emit(pid);
}
setInterval(kick, 30000);
setInterval(() => {
  for (const w of workers.values()) {
    if (!w.busy || Date.now() - w.updated < STALL_MS || pendingFor(w)) continue;
    addChat(w.pid, { from: 'system', kind: 'error', text: `${w.label} tidak menunjukkan aktivitas selama ${STALL_MS / 60000} menit dan dihentikan. Kalau tiketnya sedang dikerjakan, tekan "Lanjutkan pengerjaan" di tab Tiket.` });
    w.stalled = true;
    w.adapter?.stop();
    w.adapter = null;
    w.key = null;
  }
}, 60000);
const pendingFor = (w) => [...pending.values()].some((r) => r.pid === w.pid && r.role === w.role && (r.inst || '') === w.inst);

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
  w.activity = null;
  w.updated = Date.now();
  if (r.text) addChat(w.pid, { from: w.role, who: w.inst ? w.label : undefined, kind: 'message', text: r.text });
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

// BA and SA must end their work with a tool call (question, document + hand-off, or plan).
// Weaker models sometimes only write the result as chat text; remind them once per ticket step.
function nudgeIfStuck(w) {
  const p = w.p;
  if (w.role === 'dev') {
    // A Programmer must finish with selesai_kerja / butuh_bantuan (or lapor_run in the run step).
    const t = ticketOf(p, w.opts.ticket);
    if (!t?.work) return;
    const waiting = w.inst === 'run' ? t.status === 'run_aplikasi' : ['dikerjakan', 'perbaikan'].includes(t.status) && t.work.devs[w.inst]?.status !== 'selesai';
    const step = `${t.history.length}`;
    t.nudged ||= {};
    if (!waiting || t.nudged[w.skey] === step) return;
    t.nudged[w.skey] = step;
    w.enqueue(`[Sistem] Giliranmu berakhir tapi ${t.id} belum kamu laporkan. ${w.inst === 'run' ? 'Panggil lapor_run dengan hasil run.' : 'Kalau sudah selesai, panggil selesai_kerja; kalau buntu, butuh_bantuan.'}`);
    return;
  }
  if (w.role === 'qa') {
    const t = ticketOf(p, w.opts.ticket);
    const step = `${t?.history.length}`;
    t && (t.nudged ||= {});
    if (!t || t.status !== 'testing' || t.work?.qa?.[w.inst]?.status !== 'uji' || t.nudged[w.skey] === step) return;
    t.nudged[w.skey] = step;
    w.enqueue(`[Sistem] Giliranmu berakhir tapi hasil uji ${t.id} belum kamu laporkan. Panggil lapor_uji.`);
    return;
  }
  if (w.role !== 'ba' && w.role !== 'sa') return;
  for (const t of p.state.tickets) {
    if (t.holder !== w.role || !['analisa_bisnis', 'analisa_teknis'].includes(t.status)) continue;
    const asked = p.state.chat.some((m) => m.kind === 'question' && !m.answered && m.from === w.role && m.ticket === t.id);
    if (asked) continue;
    const step = t.history.length;
    t.nudged ||= {};
    if (t.nudged[w.role] === step) continue;
    t.nudged[w.role] = step;
    const next = w.role === 'ba'
      ? 'simpan hasilmu dengan simpan_dokumen (analisa_bisnis dan use_case), lalu serahkan ke SA (ada pekerjaan teknis) atau ke PM'
      : 'simpan analisa dengan simpan_dokumen (analisa_teknis), lalu ajukan_rencana; atau serahkan ke BA/PM bila memang bukan pekerjaan teknis';
    w.enqueue(`[Sistem] Tiket ${t.id} masih kamu pegang, tapi giliranmu berakhir tanpa langkah lanjutan. Teks chat saja tidak menggerakkan tiket. Kalau analisamu sudah selesai, ${next}. Kalau ada yang belum jelas, tanya_pengguna.`);
  }
}
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);

// ---------------- permissions ----------------
function decide({ pid, role, inst, engine, tool, input }) {
  const p = projects.get(pid);
  const w = workers.get(`${pid}:${role}${inst ? ':' + inst : ''}`) || workerFor(pid, role);
  if (!w.roots.length) Object.assign(w, (({ roots, writeRoots }) => ({ roots, writeRoots }))(prepareWorkspace(p, role, { ...w.opts, inst: w.inst })));
  const req = normalize(engine, tool, input);
  const c = classify(req, { roots: w.roots, writeRoots: w.writeRoots, mirrors: mirrorsFor(p, w), noEdit: !!ROLES[role]?.noEdit, readOnly: ROLES[role]?.readOnly ?? true, remembered: new Set(p.state.remembered) });
  if (process.env.AHQ_DEBUG) console.log('[izin]', engine, role, tool, JSON.stringify(input).slice(0, 200), '=>', req.kind, c.decision);
  if (c.decision === 'allow') return Promise.resolve({ allow: true });
  if (c.decision === 'deny') return Promise.resolve({ allow: false, message: c.reason });
  return new Promise((resolve) => {
    const id = `P${Date.now().toString(36)}${++seqPerm}`;
    const req2 = { id, pid, role, inst: w.inst, who: w.label, summary: c.summary, reason: c.reason, key: c.key, detail: clip(JSON.stringify(input), 500), created: Date.now(), resolve };
    pending.set(id, req2);
    addChat(pid, { from: role, who: w.label, kind: 'permission', permission: id, text: c.summary, reason: c.reason });
    emit(pid);
  });
}
function resolvePermission(id, decision) {
  const r = pending.get(id);
  if (!r) return false;
  pending.delete(id);
  const p = projects.get(r.pid);
  if (decision === 'always' && r.key && !p.state.remembered.includes(r.key)) p.state.remembered.push(r.key);
  const msg = p.state.chat.find((m) => m.permission === id);
  if (msg) msg.decision = decision;
  save(r.pid);
  r.resolve(decision === 'deny' ? { allow: false, message: 'Ditolak oleh pengguna.' } : { allow: true });
  emit(r.pid);
  return true;
}

onOpencodePermission(async (d) => {
  const w = [...workers.values()].find((x) => x.p?.sessions[x.skey]?.opencode === d.sessionID);
  if (!w) return;
  const r = await decide({ pid: w.pid, role: w.role, inst: w.inst, engine: 'opencode', tool: d.action, input: { resources: d.resources || [] } });
  replyPermission(d.sessionID, d.id, r.allow, r.message).catch(() => {});
});

// ---------------- team tools (called by agents through MCP) ----------------
const STATUS_FOR = { ba: 'analisa_bisnis', sa: 'analisa_teknis', pm: 'baru' };
const DOC_LABEL = { analisa_bisnis: 'analisa bisnis', use_case: 'use case', analisa_teknis: 'analisa teknis' };
const roleLabel = (r) => ROLES[r]?.label || r;

// Full ticket text for agents (baca_tiket and hand-off messages).
function ticketText(p, t) {
  const qa = p.state.chat.filter((m) => m.kind === 'question' && m.ticket === t.id);
  const lines = [
    `${t.id} · ${t.jenis} · status: ${t.status}${t.holder ? ` · dipegang: ${roleLabel(t.holder)}` : ''}`,
    `Judul: ${t.judul}`,
    `Ringkasan: ${t.ringkasan}`,
  ];
  if (t.history.length) lines.push('', 'Riwayat:', ...t.history.slice(-12).map((h) => `- ${new Date(h.t).toISOString().slice(0, 16).replace('T', ' ')} ${h.from} → ${h.to}${h.note ? `: ${clip(h.note, 200)}` : ''}`));
  if (qa.length) lines.push('', 'Tanya-jawab dengan pengguna:', ...qa.map((q) => `- [${roleLabel(q.from)}] ${q.text}\n  Jawaban: ${q.answered ? q.answer : '(belum dijawab)'}`));
  for (const d of t.docs || []) lines.push('', `## Dokumen ${DOC_LABEL[d.jenis] || d.jenis} (${roleLabel(d.role)})`, d.isi);
  if (t.work) {
    const devs = Object.entries(t.work.devs).map(([n, d]) => `- Programmer ${n} [${d.status}]: ${d.summary || d.task || ''}`);
    lines.push('', `## Pengerjaan (branch ahq/${t.id}; repo: ${t.work.repos.map((r) => r.name).join(', ')})`, ...devs);
    if (t.work.run) lines.push(`- Run aplikasi: ${t.work.run.ok ? 'berhasil' : 'gagal'} — ${t.work.run.summary}`);
    for (const [n, q] of Object.entries(t.work.qa || {})) lines.push(`- QA ${n} [${q.status}]: ${q.hasil || ''}${q.temuan ? `\n  Temuan: ${q.temuan}` : ''}`);
  }
  if (t.plan) lines.push('', `## Rencana teknis SA (${t.plan.status}; Programmer: ${t.plan.programmer}, QA: ${t.plan.qa})`, t.plan.text, ...(t.plan.note ? ['', `Catatan revisi dari pengguna: ${t.plan.note}`] : []));
  return lines.join('\n');
}

function teamTool(pid, role, tool, a = {}, inst = '') {
  const p = projects.get(pid);
  if (!p) return { error: 'project tidak ditemukan' };
  // The MCP server only lists a role's own tools, but enforce it here too.
  if (!TOOLS[tool] || !TOOLS[tool].roles.includes(role)) return { error: `Peran ${roleLabel(role)} tidak boleh memakai ${tool}.` };
  const need = (t) => {
    const x = ticketOf(p, t);
    if (!x) throw new Error(`Tiket ${t} tidak ada. Gunakan daftar_tiket.`);
    x.docs ||= [];
    return x;
  };
  try {
    switch (tool) {
      case 'buat_tiket': {
        const id = `T-${String(++p.state.seq.t).padStart(3, '0')}`;
        const t = { id, jenis: a.jenis || 'fitur', judul: clip(a.judul, 120), ringkasan: String(a.ringkasan || ''), status: 'baru', holder: 'pm', docs: [], created: Date.now(), updated: Date.now(), history: [] };
        p.state.tickets.push(t);
        if (a.butuh_persetujuan_klien) setTicket(p, t, 'tunggu_klien', 'menunggu persetujuan klien');
        addChat(pid, { from: 'system', kind: 'ticket', ticket: id, text: `Tiket ${id} dibuat: ${t.judul}` });
        return { text: `Tiket ${id} dibuat dengan status ${t.status}.` };
      }
      case 'tanya_pengguna': {
        const q = `Q-${++p.state.seq.q}`;
        const t = a.tiket ? ticketOf(p, a.tiket) : null;
        if (t && t.status !== 'tanya_pengguna') {
          t.prev = t.status;
          setTicket(p, t, 'tanya_pengguna');
        }
        addChat(pid, { from: role, kind: 'question', question: q, ticket: t?.id || null, text: String(a.pertanyaan || ''), answered: false });
        return { text: `Pertanyaan ${q} sudah tampil di dashboard pengguna. Akhiri giliranmu sekarang; jawabannya akan datang sebagai pesan berikutnya.` };
      }
      case 'serahkan': {
        const t = need(a.tiket);
        const to = String(a.ke || '').toLowerCase();
        if (!HANDOFF[role]?.includes(to)) return { error: `${roleLabel(role)} hanya bisa menyerahkan ke: ${(HANDOFF[role] || []).map(roleLabel).join(', ')}.` };
        if (t.status === 'tunggu_klien' && to !== 'pm') return { error: `Tiket ${t.id} masih menunggu persetujuan klien dan tidak boleh didistribusikan.` };
        if (t.status === 'menunggu_persetujuan') return { error: `Rencana ${t.id} sedang menunggu keputusan pengguna.` };
        // QA later tests from the BA's use cases, so the BA must leave its analysis on the ticket first.
        if (role === 'ba' && !(t.docs || []).some((d) => d.role === 'ba')) return { error: `Simpan dulu hasil analisamu dengan simpan_dokumen (analisa_bisnis, dan use_case bila ada skenario uji) sebelum menyerahkan ${t.id}.` };
        setTicket(p, t, STATUS_FOR[to], `${roleLabel(role)} → ${roleLabel(to)}: ${clip(a.tugas, 200)}`);
        t.holder = to;
        addChat(pid, { from: 'system', kind: 'handoff', ticket: t.id, by: role, to, text: `${roleLabel(role)} → ${roleLabel(to)} · ${t.id}: ${clip(a.tugas, 220)}` });
        workerFor(pid, to).enqueue(`[Dari ${roleLabel(role)}] Tiket ${t.id} diserahkan kepadamu.\n\nTugas:\n${a.tugas}\n\n---\n${ticketText(p, t)}`);
        return { text: `Tiket ${t.id} diserahkan ke ${roleLabel(to)}. Akhiri giliranmu kecuali masih ada tiket lain.` };
      }
      case 'simpan_dokumen': {
        const t = need(a.tiket);
        const jenis = DOC_LABEL[a.jenis] ? a.jenis : 'analisa_teknis';
        t.docs = t.docs.filter((d) => !(d.jenis === jenis && d.role === role));
        t.docs.push({ jenis, role, isi: String(a.isi || ''), t: Date.now() });
        t.updated = Date.now();
        addChat(pid, { from: 'system', kind: 'doc', ticket: t.id, text: `${roleLabel(role)} menyimpan ${DOC_LABEL[jenis]} untuk ${t.id}.` });
        return { text: `Dokumen ${DOC_LABEL[jenis]} tersimpan di ${t.id}.` };
      }
      case 'ajukan_rencana': {
        const t = need(a.tiket);
        if (t.status === 'tunggu_klien') return { error: `Tiket ${t.id} masih menunggu persetujuan klien.` };
        const n = Math.max(1, Math.min(4, +a.programmer || 1));
        const tasks = Array.isArray(a.tugas) ? a.tugas.map(String) : [];
        t.plan = { text: String(a.rencana || ''), programmer: n, qa: Math.max(0, Math.min(4, +a.qa || 0)), repos: Array.isArray(a.repo) ? a.repo.map(String) : [], tasks, status: 'menunggu', by: role, t: Date.now() };
        setTicket(p, t, 'menunggu_persetujuan', 'rencana SA diajukan');
        t.holder = 'user';
        addChat(pid, { from: role, kind: 'approval', ticket: t.id, text: t.plan.text, programmer: t.plan.programmer, qa: t.plan.qa, repos: t.plan.repos, tasks: t.plan.tasks });
        return { text: `Rencana ${t.id} sudah tampil di dashboard untuk disetujui pengguna. Akhiri giliranmu sekarang; keputusannya datang sebagai pesan.` };
      }
      case 'selesai_kerja': {
        const t = need(a.tiket);
        const d = t.work?.devs?.[inst];
        if (!d) return { error: `Kamu bukan Programmer yang ditugaskan di ${t.id}.` };
        if (!['dikerjakan', 'perbaikan'].includes(t.status)) return { error: `${t.id} sedang ${t.status}, bukan tahap pengerjaan.` };
        const commits = [];
        for (const r of t.work.repos) {
          const c = commitAll(path.join(devDir(pid, t.id, inst), r.name), `${t.id} Programmer ${inst}: ${clip(a.ringkasan, 60)}`);
          if (c) commits.push(`${r.name}@${c}`);
        }
        Object.assign(d, { status: 'selesai', summary: String(a.ringkasan || ''), test: String(a.cara_uji || ''), t: Date.now() });
        addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `Programmer ${inst} selesai di ${t.id}${commits.length ? ' (' + commits.join(', ') + ')' : ' (tanpa perubahan file)'}: ${clip(a.ringkasan, 200)}` });
        if (Object.values(t.work.devs).every((x) => x.status === 'selesai')) startReview(pid, t);
        return { text: `Tercatat. ${commits.length ? 'Perubahan sudah di-commit.' : 'Tidak ada perubahan file yang di-commit.'} Akhiri giliranmu; SA akan me-review.` };
      }
      case 'butuh_bantuan': {
        const t = need(a.tiket);
        addChat(pid, { from: 'system', kind: 'handoff', ticket: t.id, by: 'dev', to: 'sa', text: `Programmer ${inst} → SA · ${t.id}: ${clip(a.masalah, 220)}` });
        workerFor(pid, 'sa').enqueue(`[Dari Programmer ${inst}] Minta bantuan untuk ${t.id}:\n${a.masalah}\n\nJawab dengan arahkan_programmer (programmer: ${inst}).`);
        return { text: 'Pertanyaanmu terkirim ke SA. Akhiri giliranmu; jawabannya datang sebagai pesan.' };
      }
      case 'lapor_run': {
        const t = need(a.tiket);
        if (inst !== 'run' || t.status !== 'run_aplikasi') return { error: 'lapor_run hanya untuk tahap menjalankan aplikasi.' };
        for (const r of t.work.repos) commitAll(path.join(intDir(pid, t.id), r.name), `${t.id}: perbaikan saat run aplikasi`);
        if (a.berhasil) {
          t.work.run = { ok: true, summary: String(a.ringkasan || ''), t: Date.now() };
          addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `Aplikasi ${t.id} berjalan tanpa error: ${clip(a.ringkasan, 160)}` });
          startQA(pid, t);
          return { text: 'Hasil run tercatat. Tiket diteruskan ke QA.' };
        }
        setTicket(p, t, 'review_kode', `run gagal: ${clip(a.ringkasan, 160)}`);
        t.holder = 'sa';
        t.work.run = { ok: false, summary: String(a.ringkasan || ''), t: Date.now() };
        addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `Run aplikasi ${t.id} gagal; dikembalikan ke SA. ${clip(a.ringkasan, 200)}` });
        workerFor(pid, 'sa').enqueue(`[Dari Programmer] Run aplikasi ${t.id} GAGAL:\n${a.ringkasan}\n\nWorktree branch tiket: ${intDir(pid, t.id)}\nPutuskan langkahnya dengan minta_perbaikan (programmer 0 = semua, atau nomor tertentu).`);
        return { text: 'Hasil run tercatat dan dikirim ke SA.' };
      }
      case 'lapor_uji': {
        const t = need(a.tiket);
        const q = t.work?.qa?.[inst];
        if (!q || t.status !== 'testing') return { error: `Kamu bukan QA yang sedang menguji ${t.id}.` };
        Object.assign(q, { status: a.lulus ? 'lulus' : 'gagal', hasil: String(a.hasil || ''), temuan: String(a.temuan || ''), t: Date.now() });
        addChat(pid, { from: 'qa', who: `QA ${inst}`, kind: 'qa', ticket: t.id, pass: !!a.lulus, text: a.lulus ? a.hasil : `${a.temuan || ''}\n\n${a.hasil || ''}`.trim() });
        const all = Object.values(t.work.qa);
        if (all.every((x) => x.status !== 'uji')) finishQA(pid, t);
        return { text: 'Hasil uji tercatat.' };
      }
      case 'arahkan_programmer': {
        const t = need(a.tiket);
        const n = String(a.programmer);
        if (!t.work?.devs?.[n]) return { error: `Programmer ${n} tidak ada di ${t.id}.` };
        addChat(pid, { from: 'system', kind: 'handoff', ticket: t.id, by: 'sa', to: 'dev', text: `SA → Programmer ${n} · ${t.id}: ${clip(a.pesan, 220)}` });
        devWorker(pid, t, n).enqueue(`[Dari SA] Arahan untuk ${t.id}:\n${a.pesan}`);
        return { text: `Arahan terkirim ke Programmer ${n}.` };
      }
      case 'minta_perbaikan': {
        const t = need(a.tiket);
        if (t.status !== 'review_kode') return { error: `${t.id} tidak sedang direview (status ${t.status}).` };
        const all = Object.keys(t.work.devs);
        const targets = +a.programmer ? [String(a.programmer)].filter((n) => all.includes(n)) : all;
        if (!targets.length) return { error: `Programmer ${a.programmer} tidak ada di ${t.id}.` };
        t.work.round = (t.work.round || 1) + 1;
        setTicket(p, t, 'perbaikan', clip(a.catatan, 200));
        t.holder = 'dev';
        addChat(pid, { from: 'sa', kind: 'review', ticket: t.id, verdict: 'fix', text: a.catatan, targets });
        for (const n of targets) {
          t.work.devs[n].status = 'perbaikan';
          devWorker(pid, t, n).enqueue(`[Dari SA] Hasil review ${t.id} (putaran ${t.work.round - 1}): perlu perbaikan.\n\n${a.catatan}\n\nPerbaiki di worktree-mu, lalu selesai_kerja lagi.`);
        }
        return { text: `Permintaan perbaikan terkirim ke Programmer ${targets.join(', ')}.` };
      }
      case 'lolos_review': {
        const t = need(a.tiket);
        if (t.status !== 'review_kode') return { error: `${t.id} tidak sedang direview (status ${t.status}).` };
        addChat(pid, { from: 'sa', kind: 'review', ticket: t.id, verdict: 'pass', text: a.catatan });
        const conflicts = [];
        for (const [n] of Object.entries(t.work.devs)) {
          for (const r of t.work.repos) {
            const m = mergeInto(path.join(intDir(pid, t.id), r.name), `ahq/${t.id}-p${n}`, `${t.id}: gabungkan kerja Programmer ${n}`);
            if (!m.ok) conflicts.push({ n, repo: r.name, files: m.conflicts });
          }
        }
        if (conflicts.length) {
          setTicket(p, t, 'perbaikan', 'konflik saat menggabungkan');
          t.holder = 'dev';
          for (const c of conflicts) {
            t.work.devs[c.n].status = 'perbaikan';
            devWorker(pid, t, c.n).enqueue(`[Sistem] Kerjamu di ${t.id} lolos review, tapi bentrok saat digabung ke branch ahq/${t.id} (repo ${c.repo}):\n${c.files}\n\nDi worktree-mu, jalankan \`git merge ahq/${t.id}\`, selesaikan konfliknya, commit, lalu selesai_kerja lagi.`);
          }
          addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `Konflik saat menggabungkan ${t.id}: ${conflicts.map((c) => `Programmer ${c.n} (${c.repo})`).join(', ')}. Programmer menyelesaikan konfliknya.` });
          return { text: 'Review tercatat, tapi ada konflik penggabungan; Programmer yang bersangkutan diminta menyelesaikannya.' };
        }
        setTicket(p, t, 'run_aplikasi', 'lolos review, digabung ke branch tiket');
        t.holder = 'dev';
        addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `Kerja semua Programmer digabung ke branch ahq/${t.id}. Programmer menjalankan aplikasi.` });
        const tests = Object.entries(t.work.devs).map(([n, d]) => `- Programmer ${n}: ${d.test || '(tidak disebutkan)'}`).join('\n');
        devWorker(pid, t, 'run').enqueue(`[Sistem] ${t.id} lolos review SA dan sudah digabung di branch ahq/${t.id} (folder kerjamu).\n\nLokasi kerja:\n${pathMap(pid, t, 'run')}\n\nJalankan test/aplikasi sampai tidak ada error. Cara uji dari para Programmer:\n${tests}\n\nLalu lapor_run.`);
        return { text: `${t.id} lolos review dan digabung. Programmer menjalankan aplikasinya.` };
      }
      case 'tahan_klien': {
        const t = need(a.tiket);
        setTicket(p, t, 'tunggu_klien', a.alasan);
        t.holder = 'pm';
        addChat(pid, { from: 'system', kind: 'ticket', ticket: t.id, text: `Tiket ${t.id} ditahan: menunggu persetujuan klien. ${clip(a.alasan, 160)}` });
        return { text: `Tiket ${t.id} ditahan sampai klien setuju.` };
      }
      case 'lanjutkan_tiket': {
        const t = need(a.tiket);
        if (t.status !== 'tunggu_klien') return { text: `Tiket ${t.id} tidak sedang ditahan (status ${t.status}).` };
        setTicket(p, t, 'baru', a.catatan || 'klien setuju');
        t.holder = 'pm';
        addChat(pid, { from: 'system', kind: 'ticket', ticket: t.id, text: `Tiket ${t.id} dilepas dari tunggu klien.${a.catatan ? ' ' + clip(a.catatan, 160) : ''}` });
        return { text: `Tiket ${t.id} dilepas. Distribusikan dengan serahkan (BA untuk bisnis, SA untuk teknis).` };
      }
      case 'lapor': {
        addChat(pid, { from: role, kind: 'report', ticket: a.tiket ? String(a.tiket).toUpperCase() : null, text: String(a.isi || '') });
        return { text: 'Laporan terkirim ke pengguna.' };
      }
      case 'selesaikan_tiket': {
        const t = need(a.tiket);
        setTicket(p, t, 'selesai', a.ringkasan);
        t.holder = null;
        const kept = cleanupWorktrees(pid, t);
        addChat(pid, { from: 'system', kind: 'ticket', ticket: t.id, text: `Tiket ${t.id} selesai. ${clip(a.ringkasan, 160)}${kept ? ` Worktree dibersihkan; branch ${kept} tetap ada untuk kamu merge.` : ''}` });
        return { text: `Tiket ${t.id} ditandai selesai.` };
      }
      case 'baca_tiket':
        return { text: ticketText(p, need(a.tiket)) };
      case 'daftar_tiket': {
        const rows = p.state.tickets.map((t) => `${t.id} [${t.status}${t.holder ? ', ' + roleLabel(t.holder) : ''}] (${t.jenis}) ${t.judul}`);
        return { text: rows.length ? rows.join('\n') : 'Belum ada tiket.' };
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

// The user approves or sends back the SA's technical plan.
function decidePlan(pid, ticketId, decision, note) {
  const p = projects.get(pid);
  const t = ticketOf(p, ticketId);
  if (!t?.plan || t.status !== 'menunggu_persetujuan') return false;
  const msg = [...p.state.chat].reverse().find((m) => m.kind === 'approval' && m.ticket === t.id);
  if (decision === 'approve') {
    t.plan.status = 'disetujui';
    setTicket(p, t, 'siap_dikerjakan', 'rencana disetujui pengguna');
    t.holder = 'dev';
    if (msg) msg.decision = 'approve';
    startWork(pid, t);
  } else {
    t.plan.status = 'revisi';
    t.plan.note = String(note || '');
    setTicket(p, t, 'analisa_teknis', `minta revisi: ${clip(note, 160)}`);
    t.holder = 'sa';
    if (msg) {
      msg.decision = 'revise';
      msg.note = t.plan.note;
    }
    workerFor(pid, t.plan.by || 'sa').enqueue(`[Dari pengguna] Rencana teknis ${t.id} diminta revisi.\n\nCatatan pengguna:\n${note || '(tanpa catatan)'}\n\nPerbaiki rencananya lalu ajukan lagi dengan ajukan_rencana.`);
  }
  save(pid);
  emit(pid);
  return true;
}

// ---------------- ticket work (Programmers) ----------------
const devDir = (pid, tid, n) => path.join(worktreeRoot(pid), tid, n === 'run' ? 'tiket' : `p${n}`);
const intDir = (pid, tid) => path.join(worktreeRoot(pid), tid, 'tiket');
const WORK_STATUS = new Set(['dikerjakan', 'review_kode', 'perbaikan', 'run_aplikasi', 'testing']);
function devWorker(pid, t, n) {
  return workerFor(pid, 'dev', String(n), { dir: devDir(pid, t.id, String(n)), ticket: t.id, mode: n === 'run' ? 'run' : 'kerja', repos: t.work.repos.map((r) => r.name) });
}

// After the user approves the SA's plan: one branch per ticket, one branch + worktree per Programmer.
function startWork(pid, t) {
  const p = projects.get(pid);
  const gitFolders = p.meta.folders.filter(isRepo);
  const wanted = new Set((t.plan.repos || []).map((x) => path.basename(String(x))));
  let repos = gitFolders.filter((f) => wanted.has(path.basename(f)));
  if (!repos.length) repos = gitFolders;
  if (!repos.length) {
    setTicket(p, t, 'gagal', 'tidak ada repo git di folder project');
    addChat(pid, { from: 'system', kind: 'error', ticket: t.id, text: `${t.id} tidak bisa dikerjakan: tidak ada folder project yang berupa repo git.` });
    return;
  }
  const n = t.plan.programmer;
  const work = { repos: repos.map((f) => ({ name: path.basename(f), src: f })), base: {}, devs: {}, round: 1 };
  try {
    for (const r of work.repos) {
      const ref = currentRef(r.src);
      work.base[r.name] = ref;
      ensureWorktree(r.src, path.join(intDir(pid, t.id), r.name), `ahq/${t.id}`, ref.commit);
      for (let i = 1; i <= n; i++) ensureWorktree(r.src, path.join(devDir(pid, t.id, String(i)), r.name), `ahq/${t.id}-p${i}`, `ahq/${t.id}`);
    }
  } catch (e) {
    setTicket(p, t, 'gagal', 'gagal menyiapkan worktree');
    addChat(pid, { from: 'system', kind: 'error', ticket: t.id, text: `Gagal menyiapkan branch/worktree untuk ${t.id}: ${clip(e.stderr || e.message, 300)}` });
    return;
  }
  for (let i = 1; i <= n; i++) work.devs[String(i)] = { status: 'kerja', task: t.plan.tasks?.[i - 1] || '' };
  t.work = work;
  setTicket(p, t, 'dikerjakan', `${n} Programmer mulai`);
  t.holder = 'dev';
  const from = work.repos.map((r) => `${r.name} (${work.base[r.name].branch})`).join(', ');
  addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `Rencana ${t.id} disetujui. Branch ahq/${t.id} dibuat dari ${from}; ${n} Programmer mulai bekerja di worktree terpisah.` });
  for (let i = 1; i <= n; i++) assignDev(pid, t, String(i));
}
function assignDev(pid, t, n) {
  const p = projects.get(pid);
  const task = t.work.devs[n].task || 'Kerjakan rencana SA (semua bagian, karena tidak ada pembagian tugas).';
  devWorker(pid, t, n).enqueue(`[Dari SA] Kamu Programmer ${n} untuk ${t.id}.\n\nLokasi kerjamu (WAJIB): semua perubahan dibuat di worktree berikut, bukan di folder asli. Path di rencana SA yang menunjuk folder asli harus kamu terjemahkan ke worktree ini.\n${pathMap(pid, t, n)}\n\nTugasmu:\n${task}\n\n---\n${ticketText(p, t)}`);
}

// All Programmers are done: send the SA a review packet with each branch's diff.
function startReview(pid, t) {
  const p = projects.get(pid);
  setTicket(p, t, 'review_kode', `review putaran ${t.work.round}`);
  t.holder = 'sa';
  const parts = [];
  for (const [n, d] of Object.entries(t.work.devs)) {
    parts.push(`## Programmer ${n}\nTugas: ${d.task || '(seluruh rencana)'}\nRingkasan: ${d.summary}\nCara uji: ${d.test || '-'}`);
    for (const r of t.work.repos) {
      const dir = path.join(devDir(pid, t.id, n), r.name);
      const diff = diffAgainst(dir, `ahq/${t.id}`);
      parts.push(`### ${r.name} — worktree: ${dir}\n${diff.stat}\n\n\`\`\`diff\n${diff.patch}\n\`\`\``);
    }
  }
  addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `Semua Programmer selesai di ${t.id}. SA mulai review (putaran ${t.work.round}).` });
  workerFor(pid, 'sa').enqueue(`[Sistem] Review kode ${t.id}, putaran ${t.work.round}. Periksa apakah kode bersih, rapi, efisien, dan sesuai rencana. Boleh membaca file di worktree. Lalu minta_perbaikan atau lolos_review.\n\n${parts.join('\n\n')}`);
}

// Original repo folder -> this Programmer's worktree copy (for the policy and for task messages).
function mirrorsFor(p, w) {
  if ((w.role !== 'dev' && w.role !== 'qa') || !w.opts.dir) return [];
  const t = ticketOf(p, w.opts.ticket);
  return (t?.work?.repos || []).flatMap((r) => {
    const dst = path.join(w.opts.dir, r.name);
    return [r.src, safeReal(r.src)].filter(Boolean).map((src) => ({ src, dst }));
  });
}
function pathMap(pid, t, n) {
  return t.work.repos.map((r) => `- ${r.name}: UBAH di ${path.join(devDir(pid, t.id, n), r.name)}   (folder asli ${r.src} hanya untuk dibaca)`).join('\n');
}

// ---------------- QA ----------------
const qaDir = (pid, tid, n) => path.join(worktreeRoot(pid), tid, `qa${n}`);
function qaWorker(pid, t, n) {
  return workerFor(pid, 'qa', String(n), { dir: qaDir(pid, t.id, n), ticket: t.id, mode: 'qa', repos: t.work.repos.map((r) => r.name) });
}

// The ticket branch runs cleanly: hand it to the QA testers from the plan (or straight to the PM when the plan has no QA).
function startQA(pid, t) {
  const p = projects.get(pid);
  const n = t.plan?.qa ?? 1;
  if (!n) return toPM(pid, t, 'Rencana SA tidak memakai QA.');
  try {
    for (let i = 1; i <= n; i++) for (const r of t.work.repos) ensureDetached(r.src, path.join(qaDir(pid, t.id, i), r.name), `ahq/${t.id}`);
  } catch (e) {
    setTicket(p, t, 'gagal', 'gagal menyiapkan worktree QA');
    addChat(pid, { from: 'system', kind: 'error', ticket: t.id, text: `Gagal menyiapkan salinan untuk QA ${t.id}: ${clip(e.stderr || e.message, 300)}` });
    return;
  }
  t.work.qa = {};
  for (let i = 1; i <= n; i++) t.work.qa[String(i)] = { status: 'uji' };
  t.work.qaRound = (t.work.qaRound || 0) + 1;
  setTicket(p, t, 'testing', `QA putaran ${t.work.qaRound}`);
  t.holder = 'qa';
  const useCases = (t.docs || []).filter((d) => d.jenis === 'use_case');
  addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `${n} QA mulai menguji ${t.id} (putaran ${t.work.qaRound})${useCases.length ? ' memakai use case dari BA' : '; tidak ada use case BA, QA memakai rencana SA'}.` });
  for (let i = 1; i <= n; i++) {
    const part = n > 1 ? `Kamu QA ${i} dari ${n}. Bagi skenario: kerjakan skenario nomor ganjil/genap atau bagian ke-${i} secara adil, dan sebutkan di laporanmu skenario mana yang kamu uji.` : 'Uji semua skenario.';
    const paths = t.work.repos.map((r) => `- ${r.name}: ${path.join(qaDir(pid, t.id, i), r.name)}`).join('\n');
    qaWorker(pid, t, i).enqueue(`[Sistem] Uji ${t.id} di branch ahq/${t.id}.\n${part}\n\nSalinan yang kamu uji:\n${paths}\n\n---\n${ticketText(p, t)}`);
  }
}

// Every QA reported: all passed -> PM reports to the user; otherwise the findings go to the SA.
function finishQA(pid, t) {
  const p = projects.get(pid);
  const results = Object.entries(t.work.qa);
  const failed = results.filter(([, q]) => q.status === 'gagal');
  if (!failed.length) return toPM(pid, t, `QA lulus (${results.length} penguji).`);
  setTicket(p, t, 'review_kode', `QA menemukan masalah (${failed.length} dari ${results.length})`);
  t.holder = 'sa';
  addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `QA menemukan masalah di ${t.id}; dikembalikan ke SA untuk diperbaiki Programmer.` });
  const findings = failed.map(([n, q]) => `## QA ${n}\nTemuan: ${q.temuan}\nHasil: ${q.hasil}`).join('\n\n');
  workerFor(pid, 'sa').enqueue(`[Dari QA] ${t.id} GAGAL uji. Analisa temuannya, lalu minta_perbaikan ke Programmer yang tepat (0 = semua). Setelah diperbaiki dan lolos review, aplikasi dijalankan dan QA menguji ulang.\n\n${findings}`);
}

// Ticket is verified: the PM reports to the user and closes it after the user accepts.
function toPM(pid, t, note) {
  const p = projects.get(pid);
  setTicket(p, t, 'laporan', note);
  t.holder = 'pm';
  const how = t.work.repos.map((r) => `- ${r.name} (${r.src}): git diff ${t.work.base[r.name]?.branch || 'HEAD'}...ahq/${t.id}`).join('\n');
  addChat(pid, { from: 'system', kind: 'work', ticket: t.id, text: `${t.id} lulus. PM menyiapkan laporan untukmu.` });
  workerFor(pid, 'pm').enqueue(`[Sistem] ${t.id} selesai dikerjakan dan ${note}\n\nLaporkan ke pengguna dengan lapor: apa yang berubah, hasil QA, branch hasilnya (ahq/${t.id}), dan cara melihat perubahannya:\n${how}\nTanyakan apakah pengguna menerimanya. Panggil selesaikan_tiket hanya setelah pengguna menyatakan menerima. Merge dilakukan pengguna sendiri.\n\n---\n${ticketText(p, t)}`);
}

// Remove the ticket's worktrees but keep its branches for the user to merge.
function cleanupWorktrees(pid, t) {
  if (!t.work) return null;
  const root = path.join(worktreeRoot(pid), t.id);
  let dirs = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) for (const r of t.work.repos) removeWorktree(r.src, path.join(root, d, r.name));
  fs.rmSync(root, { recursive: true, force: true });
  for (const k of [...workers.keys()]) if (workers.get(k).opts?.ticket === t.id && workers.get(k).pid === pid && !workers.get(k).busy) workers.delete(k);
  return `ahq/${t.id}`;
}

// Continue a ticket whose agents were interrupted (e.g. the orchestrator restarted). Only on the user's request.
function resumeTicket(pid, t) {
  if (!t.work || !WORK_STATUS.has(t.status)) return false;
  if (t.status === 'testing') {
    for (const [n, q] of Object.entries(t.work.qa || {})) if (q.status === 'uji') qaWorker(pid, t, n).enqueue(`[Sistem] Lanjutkan pengujian ${t.id} (sempat terhenti), lalu lapor_uji.`);
    return true;
  }
  if (t.status === 'review_kode') startReview(pid, t);
  else if (t.status === 'run_aplikasi') devWorker(pid, t, 'run').enqueue(`[Sistem] Lanjutkan menjalankan aplikasi ${t.id} lalu lapor_run.`);
  else for (const [n, d] of Object.entries(t.work.devs)) if (d.status !== 'selesai') devWorker(pid, t, n).enqueue(`[Sistem] Lanjutkan tugasmu di ${t.id} (pekerjaan sempat terhenti). Periksa worktree-mu, selesaikan, lalu selesai_kerja.`);
  return true;
}

// ---------------- snapshot for the dashboard ----------------
function agentRecord(w) {
  const p = w.p;
  const perm = [...pending.values()].find((r) => r.pid === w.pid && r.role === w.role && (r.inst || '') === w.inst);
  const question = !w.inst && p.state.chat.find((m) => m.kind === 'question' && !m.answered && m.from === w.role);
  let state = 'idle', task = null, tool = '—';
  if (w.busy && perm) [state, task] = ['waiting', `minta izin: ${perm.summary}`];
  else if (w.busy) ({ state, task, tool } = w.activity || { state: 'thinking', task: 'berpikir…', tool: '—' });
  else if (question) [state, task] = ['waiting', 'menunggu jawabanmu'];
  else if (w.inbox.length && Date.now() < pausedUntil[w.engine]) task = `istirahat: kuota habis, lanjut ${hhmm(pausedUntil[w.engine])}`;
  else if (w.inbox.length) task = 'antre';
  else if (w.error) [state, task] = ['error', w.error];
  return {
    id: `team:${w.pid}:${w.role}${w.inst ? ':' + w.inst : ''}`, source: w.engine, name: w.label, state, task, tool: tool || '—',
    model: w.cfg.model || DEFAULT_MODEL[w.engine] || 'bawaan', project: p.meta.name, tokens: w.tokens, started: w.started, updated: w.updated,
  };
}
function snapshot(pid) {
  const p = projects.get(pid);
  const team = Object.entries(ROLES).filter(([, r]) => r.active && !r.multi).map(([role]) => workerFor(pid, role));
  for (const t of p.state.tickets) {
    if (!t.work || !WORK_STATUS.has(t.status)) continue;
    if (t.status !== 'testing') for (const n of Object.keys(t.work.devs)) team.push(devWorker(pid, t, n));
    if (t.status === 'run_aplikasi') team.push(devWorker(pid, t, 'run'));
    if (t.status === 'testing') for (const n of Object.keys(t.work.qa || {})) team.push(qaWorker(pid, t, n));
  }
  return {
    project: p.meta,
    agents: team.map(agentRecord),
    chat: p.state.chat.slice(-200),
    tickets: p.state.tickets,
    pending: [...pending.values()].filter((r) => r.pid === pid).map(({ resolve, ...r }) => r),
    paused: Object.fromEntries(ENGINES.filter((e) => Date.now() < pausedUntil[e]).map((e) => [e, pausedUntil[e]])),
    active,
    maxActive: MAX_ACTIVE,
  };
}
const emitTimers = {};
function emit(pid) {
  if (!clients.get(pid)?.size) return;
  clearTimeout(emitTimers[pid]);
  emitTimers[pid] = setTimeout(() => {
    const data = `data: ${JSON.stringify(snapshot(pid))}\n\n`;
    for (const res of clients.get(pid) || []) res.write(data);
  }, 50);
}

// ---------------- HTTP ----------------
function slug(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'project';
  let id = base;
  for (let i = 2; projects.has(id); i++) id = `${base}-${i}`;
  return id;
}
function engines() {
  return Object.fromEntries([['claude', findBin('claude')], ['opencode', findBin('opencode')], ['cursor', findBin('cursor-agent')]].map(([k, v]) => [k, { available: !!v, defaultModel: DEFAULT_MODEL[k] }]));
}
const CLAUDE_MODELS = [
  { value: 'sonnet', provider: 'claude', label: 'sonnet — Claude Sonnet terbaru' },
  { value: 'opus', provider: 'claude', label: 'opus — Claude Opus terbaru' },
  { value: 'haiku', provider: 'claude', label: 'haiku — Claude Haiku terbaru (hemat)' },
];
const modelCache = {};
async function modelsFor(engine, refresh) {
  const c = modelCache[engine];
  if (c && !refresh && Date.now() - c.t < 10 * 60 * 1000) return c.models;
  const models = engine === 'claude' ? CLAUDE_MODELS : engine === 'cursor' ? await listCursorModels() : await listOpencodeModels();
  modelCache[engine] = { t: Date.now(), models };
  return models;
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

  // Internal routes: MCP server and Cursor hook, authenticated with the shared token.
  if (url.pathname.startsWith('/internal/')) {
    const b = await body(req);
    if (!b || b.token !== TOKEN || !projects.has(b.project)) return send(res, 403, { error: 'ditolak' });
    if (url.pathname === '/internal/tool') return send(res, 200, teamTool(b.project, b.role, b.tool, b.args, b.inst || ''));
    if (url.pathname === '/internal/permission') {
      req.socket.setTimeout(0);
      return send(res, 200, await decide({ pid: b.project, role: b.role, inst: b.inst || '', engine: b.engine, tool: b.tool, input: b.input }));
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
      const meta = { id, name: clip(b.name, 60), folders: cleanFolders(b.folders), roles: { pm: { engine, model: '' } }, created: Date.now() };
      projects.set(id, { meta, state: { chat: [], tickets: [], seq: { t: 0, q: 0, m: 0 }, remembered: [] }, sessions: {} });
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
      if (b.roles) for (const [role, cfg] of Object.entries(b.roles)) {
        if (!ROLES[role] || !ENGINES.includes(cfg.engine)) continue;
        p.meta.roles[role] = { engine: cfg.engine, model: clip(cfg.model || '', 80) };
      }
      save(pid);
      emit(pid);
      return ok(p.meta);
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
      addChat(pid, { from: 'user', kind: 'message', text });
      workerFor(pid, 'pm').enqueue(text);
      return ok({ ok: true });
    }
    if (action === 'answer' && req.method === 'POST') {
      const b = await body(req);
      const q = p.state.chat.find((m) => m.kind === 'question' && m.question === b?.question);
      const text = String(b?.text || '').trim();
      if (!q || q.answered || !text) return bad(400, 'pertanyaan tidak valid');
      q.answered = true;
      q.answer = text;
      const t = q.ticket ? ticketOf(p, q.ticket) : null;
      if (t && t.status === 'tanya_pengguna') setTicket(p, t, t.prev || 'baru', 'pengguna menjawab');
      addChat(pid, { from: 'user', kind: 'answer', question: q.question, text });
      workerFor(pid, q.from).enqueue(`Jawaban pengguna untuk pertanyaanmu ${q.question}${t ? ` (tiket ${t.id})` : ''}:\nPertanyaan: ${q.text}\nJawaban: ${text}`);
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
    if (action === 'resume' && req.method === 'POST') {
      const b = await body(req);
      const t = ticketOf(p, b?.ticket);
      return t && resumeTicket(pid, t) ? ok({ ok: true }) : bad(400, 'tiket tidak sedang dikerjakan');
    }
    if (action === 'plan' && req.method === 'POST') {
      const b = await body(req);
      if (!['approve', 'revise'].includes(b?.decision)) return bad(400, 'decision: approve | revise');
      if (b.decision === 'revise' && !String(b.note || '').trim()) return bad(400, 'Tulis catatan revisinya.');
      return decidePlan(pid, b.ticket, b.decision, b.note) ? ok({ ok: true }) : bad(400, 'rencana tidak sedang menunggu keputusan');
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
