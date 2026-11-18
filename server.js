#!/usr/bin/env node
// Agent HQ — server lokal. Membaca aktivitas Claude Code, Cursor, dan opencode
// dari file/database di Mac ini (hanya baca), dan menerima laporan dari bot
// (mis. bot Grok) lewat POST /api/events. Tanpa dependensi: `node server.js`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mockup');
const PORT = +process.env.PORT || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const HOME = os.homedir();
const WINDOW_ENV = +process.env.WINDOW_MIN || 24 * 60; // nilai awal dari env
let WINDOW = WINDOW_ENV * 60e3; // sesi yang lebih lama dari ini disembunyikan
const MIN = 60e3;

// Jendela waktu (WINDOW) bisa diubah langsung dari dashboard lewat POST /api/settings.
// Perubahan hanya berlaku di memori proses (tidak menulis apa pun ke disk), jadi tidak
// melanggar prinsip read-only. Nilai awal datang dari env WINDOW_MIN.
const WINDOW_MIN_BOUNDS = [1, 60 * 24 * 365]; // 1 menit .. 1 tahun
function setWindowMin(m) {
  const v = Math.round(Number(m));
  if (!Number.isFinite(v) || v < WINDOW_MIN_BOUNDS[0] || v > WINDOW_MIN_BOUNDS[1]) return null;
  WINDOW = v * MIN;
  return v;
}
function windowSettings() {
  return {
    windowMin: Math.round(WINDOW / MIN),
    envWindowMin: WINDOW_ENV,
    min: WINDOW_MIN_BOUNDS[0],
    max: WINDOW_MIN_BOUNDS[1],
    pinnedByEnv: Math.round(WINDOW / MIN) === Math.round(WINDOW_ENV),
  };
}

// Lokasi data bisa diganti lewat env (dipakai saat jalan di Docker)
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(HOME, '.claude', 'projects');
const CURSOR_DIR = process.env.CURSOR_DIR || path.join(HOME, '.cursor', 'projects');
const OPENCODE_DB = process.env.OPENCODE_DB || path.join(HOME, '.local', 'share', 'opencode', 'opencode.db');
const HOST_USER = process.env.HOST_USER || os.userInfo().username;
// Waktu dibuat file; beberapa filesystem (mount Docker) tidak menyediakannya
const born = (st) => st.birthtimeMs || st.ctimeMs || st.mtimeMs;

// ---------- util ----------
const clip = (s, n = 60) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const NAMES = ['Kiko', 'Bima', 'Luna', 'Pipo', 'Sari', 'Dodo', 'Mimi', 'Tono', 'Caca', 'Bobo', 'Lili', 'Riko', 'Nana', 'Jojo', 'Tata', 'Momo', 'Gigi', 'Yoyo', 'Dede', 'Koko', 'Fifi', 'Zaza', 'Lulu', 'Popo', 'Wawa', 'Cici', 'Rara', 'Titi', 'Hoho', 'Nunu'];
const nameOf = new Map();
function nameFor(id, taken) {
  if (!nameOf.has(id)) {
    let i = hash(id) % NAMES.length;
    for (let n = 0; n < NAMES.length && taken.has(NAMES[i]); n++) i = (i + 1) % NAMES.length;
    nameOf.set(id, NAMES[i]);
  }
  taken.add(nameOf.get(id));
  return nameOf.get(id);
}

function toolState(name) {
  const t = String(name).toLowerCase().split('__').pop();
  if (/^(askuserquestion|exitplanmode|askquestion|question)$/.test(t)) return 'waiting';
  if (/^(todowrite|todo_write|update_plan|wrap_up)$/.test(t)) return 'thinking';
  if (/^(edit|write|multiedit|notebookedit|strreplace|str_replace|search_replace|edit_file|applypatch|apply_patch|patch|delete|editnotebook)$/.test(t)) return 'coding';
  if (/^(read|read_file|grep|glob|ls|list|webfetch|websearch|fetch|toolsearch|semanticsearch|codebase_search|readlints|get_page_text|read_page)$/.test(t)) return 'reading';
  return 'running';
}
function describe(name, input) {
  input = input && typeof input === 'object' ? input : {};
  const state = toolState(name);
  const short = String(name).split('__').pop();
  if (state === 'waiting') return /plan/i.test(short) ? 'minta persetujuan rencana' : 'bertanya ke kamu';
  if (state === 'thinking') return 'menyusun rencana';
  const f = input.file_path || input.filePath || input.target_file || input.notebook_path || input.path;
  if (input.command) return clip(input.description || input.command);
  if (input.pattern || input.query) return `mencari "${clip(input.pattern || input.query, 32)}"`;
  if (typeof f === 'string') return `${state === 'coding' ? 'mengedit' : 'membaca'} ${path.basename(f)}`;
  if (typeof input.url === 'string') return `membuka ${clip(input.url.replace(/^https?:\/\//, ''), 40)}`;
  if (input.description) return clip(input.description);
  return `memakai ${short}`;
}

// Baca N byte terakhir file JSONL -> array objek
function tailJson(file, size, bytes) {
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, size - len);
  } finally {
    fs.closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n');
  if (len < size) lines.shift(); // baris pertama terpotong
  const out = [];
  for (const l of lines) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {}
  }
  return out;
}
const parsed = new Map(); // file -> { key, info }
function cached(file, st, parse) {
  const key = `${st.mtimeMs}:${st.size}`;
  const c = parsed.get(file);
  if (c && c.key === key) return c.info;
  const info = parse(file, st);
  parsed.set(file, { key, info });
  return info;
}
const IDLE = { state: 'idle', task: null, tool: '—' };
const THINK = (task = 'berpikir…') => ({ state: 'thinking', task, tool: '—' });

// ---------- Claude Code ----------
function parseClaude(file, st) {
  const pick = (bytes) => tailJson(file, st.size, bytes).filter((e) => (e.type === 'user' || e.type === 'assistant') && !e.isSidechain && e.message);
  let entries = pick(768 * 1024);
  if (!entries.length && st.size > 768 * 1024) entries = pick(8 * 1024 * 1024);
  const pending = new Map();
  let last = null, cwd, model, usage;
  for (const e of entries) {
    cwd = e.cwd || cwd;
    const c = e.message.content;
    if (e.type === 'assistant') {
      if (e.message.model && !e.message.model.startsWith('<')) model = e.message.model;
      if (e.message.usage) usage = e.message.usage;
      if (e.isApiErrorMessage) { last = { kind: 'error' }; continue; }
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type === 'tool_use') { pending.set(b.id, { name: b.name, input: b.input }); last = { kind: 'tool' }; }
        else if (b.type === 'text') last = { kind: 'text', stop: e.message.stop_reason };
        else last = { kind: 'thinking' };
      }
    } else {
      const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
      for (const b of blocks) {
        if (b.type === 'tool_result') { pending.delete(b.tool_use_id); last = { kind: 'result' }; }
        else if (b.type === 'text') {
          pending.clear();
          last = { kind: /^\s*(<local-command|<command-name|\[Request interrupted)/.test(b.text || '') ? 'meta' : 'prompt' };
        }
      }
    }
  }
  const u = usage || {};
  const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
  return { cwd, model, tokens: tokens || null, last, pending: [...pending.values()].pop() };
}
function claudeState(info, age) {
  const p = info.pending;
  if (p) {
    if (age > 30 * MIN) return IDLE;
    let state = toolState(p.name);
    let task = describe(p.name, p.input);
    // Edit/Write selesai dalam sekejap; kalau menggantung, hampir pasti menunggu izin
    if (state === 'coding' && age > 15e3) { state = 'waiting'; task = 'minta izin: ' + task; }
    return { state, task, tool: p.name.split('__').pop() };
  }
  const k = info.last?.kind;
  if (k === 'error') return age < 10 * MIN ? { state: 'error', task: 'API error', tool: '—' } : IDLE;
  if (k === 'text') return info.last.stop === 'end_turn' || age > 20e3 ? IDLE : THINK('menulis jawaban');
  if (!k || k === 'meta') return IDLE;
  return age < 3 * MIN ? THINK() : IDLE;
}
function scanClaude(now, out) {
  let dirs = [];
  try { dirs = fs.readdirSync(CLAUDE_DIR); } catch { return; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(CLAUDE_DIR, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(CLAUDE_DIR, d, f);
      try {
        const st = fs.statSync(file);
        const age = now - st.mtimeMs;
        if (age > WINDOW) continue;
        const info = cached(file, st, parseClaude);
        if (!info.last) continue;
        const cstate = claudeState(info, age);
        // Sesi yang sudah selesai tidak ditampilkan kalau sudah lewat 30 menit:
        // jendela waktu (WINDOW) hanya berlaku untuk sesi yang masih aktif.
        if (cstate.state === 'idle' && age > 30 * MIN) continue;
        out.push({
          id: 'claude:' + f.slice(0, -6), source: 'claude', ...cstate,
          model: info.model || '—', project: info.cwd ? path.basename(info.cwd) : d,
          tokens: info.tokens, started: born(st), updated: st.mtimeMs,
        });
      } catch {}
    }
  }
}

// ---------- Cursor ----------
function parseCursor(file, st) {
  let last = null;
  for (const e of tailJson(file, st.size, 512 * 1024)) {
    if (e.role === 'assistant') {
      for (const b of e.message?.content || []) {
        if (b.type === 'tool_use') last = { kind: 'tool', name: b.name, input: b.input };
        else if (b.type === 'text') last = { kind: 'text' };
      }
    } else if (e.role === 'user') last = { kind: 'prompt' };
    else if (e.type && e.status) last = { kind: 'end', status: String(e.status) };
  }
  return { last };
}
function cursorState(info, age) {
  const l = info.last;
  if (l.kind === 'end') return /error|fail/i.test(l.status) && age < 10 * MIN ? { state: 'error', task: 'giliran gagal', tool: '—' } : IDLE;
  if (l.kind === 'tool') return age < 2 * MIN ? { state: toolState(l.name), task: describe(l.name, l.input), tool: l.name } : IDLE;
  if (l.kind === 'text') return age < 20e3 ? THINK('menulis jawaban') : IDLE;
  return age < 2 * MIN ? THINK() : IDLE;
}
function scanCursor(now, out) {
  let dirs = [];
  try { dirs = fs.readdirSync(CURSOR_DIR); } catch { return; }
  const prefix = `Users-${HOST_USER}-`;
  for (const d of dirs) {
    const tdir = path.join(CURSOR_DIR, d, 'agent-transcripts');
    let sessions = [];
    try { sessions = fs.readdirSync(tdir); } catch { continue; }
    for (const s of sessions) {
      const file = path.join(tdir, s, s + '.jsonl');
      try {
        const st = fs.statSync(file);
        const age = now - st.mtimeMs;
        if (age > WINDOW) continue;
        const info = cached(file, st, parseCursor);
        if (!info.last) continue;
        out.push({
          id: 'cursor:' + s, source: 'cursor', ...cursorState(info, age),
          model: '—', project: d.startsWith('var-folders') ? 'tmp' : d.startsWith(prefix) ? d.slice(prefix.length) : d,
          tokens: null, started: born(st), updated: st.mtimeMs,
        });
      } catch {}
    }
  }
}

// ---------- opencode ----------
// opencode punya dua skema database:
//   lama  -> session + message + part   (part.data berisi satu blok)
//   baru  -> session_v2 + session_message (satu baris = satu pesan utuh, berisi array content)
// Kita deteksi otomatis dan pakai query yang sesuai.
let ocDb = null, ocStmt = null, sqlite = null, ocSchema = null;
try { sqlite = await import('node:sqlite'); } catch {}

const OC_SQL_V1 = `
SELECT s.id, s.title, s.directory, s.model, s.time_created AS started,
  s.tokens_input + s.tokens_output + s.tokens_cache_read AS tokens,
  (SELECT json_object(
     'type', json_extract(p.data,'$.type'), 'tool', json_extract(p.data,'$.tool'),
     'status', json_extract(p.data,'$.state.status'), 'reason', json_extract(p.data,'$.reason'),
     'command', json_extract(p.data,'$.state.input.command'), 'description', json_extract(p.data,'$.state.input.description'),
     'filePath', json_extract(p.data,'$.state.input.filePath'), 'pattern', json_extract(p.data,'$.state.input.pattern'),
     'url', json_extract(p.data,'$.state.input.url'), 't', p.time_updated)
   FROM part p WHERE p.session_id = s.id ORDER BY p.time_created DESC, p.id DESC LIMIT 1) AS last,
  (SELECT json_extract(m.data,'$.error.name') FROM message m WHERE m.session_id = s.id ORDER BY m.time_created DESC, m.id DESC LIMIT 1) AS err
FROM session s WHERE s.parent_id IS NULL AND s.time_archived IS NULL AND s.time_updated > ?`;

// Skema baru: ambil pesan terakhir (assistant/user/idle) per sesi. `agent` & `model` ikut di baris pesan.
const OC_SQL_V2 = `
SELECT s.id, s.title, s.directory, s.model, s.time_created AS started,
  s.tokens_input + s.tokens_output + s.tokens_cache_read AS tokens,
  s.time_updated AS updated,
  (SELECT sm.type FROM session_message sm WHERE sm.session_id = s.id ORDER BY sm.seq DESC LIMIT 1) AS lastType,
  (SELECT sm.data FROM session_message sm WHERE sm.session_id = s.id ORDER BY sm.seq DESC LIMIT 1) AS lastData,
  (SELECT sm.data FROM session_message sm WHERE sm.session_id = s.id AND sm.type='assistant' ORDER BY sm.seq DESC LIMIT 1) AS lastAssistantData
FROM session_v2 s WHERE s.parent_id IS NULL AND s.time_archived IS NULL AND s.time_updated > ?`;

function detectOcSchema(db) {
  const has = (table) =>
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  // Pakai session_v2 hanya kalau memang ada isinya; kalau kosong, skema lama yang dipakai.
  if (has('session_v2')) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM session_v2').get();
    if (Number(n?.n) > 0) return 'v2';
  }
  return has('session') ? 'v1' : null;
}

// Ubah pesan skema baru jadi bentuk ringkas yang sama dengan `last` skema lama
function ocV2Last(type, data) {
  let d = {};
  try { d = JSON.parse(data) || {}; } catch {}
  const t = d?.time?.created ?? d?.time?.completed ?? 0;
  if (type === 'idle') return { type: 'idle', t };
  if (type === 'compaction') return { type: 'compaction', t };
  const blocks = Array.isArray(d.content) ? d.content : [];
  const tool = [...blocks].reverse().find((b) => b?.type === 'tool');
  if (tool) {
    const input = tool.state?.input || {};
    return {
      type: 'tool', tool: tool.name, status: tool.state?.status,
      command: input.command, description: input.description, filePath: input.filePath,
      path: input.path, pattern: input.pattern, url: input.url, t,
    };
  }
  // tidak ada tool: assistant yang sudah selesai = berpikir/merangkum jawaban
  return { type: 'text', t, agent: d.agent, model: d.model?.id, error: d.error?.message || d.error?.name };
}

function opencodeState(l, err, age) {
  if (err && age < 10 * MIN) return { state: 'error', task: clip(err), tool: '—' };
  if (l.type === 'tool') {
    if (l.status === 'running' || l.status === 'pending') {
      return age < 30 * MIN ? { state: toolState(l.tool), task: describe(l.tool, l), tool: l.tool } : IDLE;
    }
    return age < MIN ? THINK() : IDLE;
  }
  if (l.type === 'step-finish' && l.reason === 'stop') return IDLE;
  return age < 2 * MIN ? THINK() : IDLE;
}
function scanOpencode(now, out) {
  if (!sqlite || !fs.existsSync(OPENCODE_DB)) return;
  try {
    if (!ocDb) {
      ocDb = new sqlite.DatabaseSync(OPENCODE_DB, { readOnly: true });
      ocSchema = detectOcSchema(ocDb);
      if (ocSchema === 'v2') ocStmt = ocDb.prepare(OC_SQL_V2);
      else if (ocSchema === 'v1') ocStmt = ocDb.prepare(OC_SQL_V1);
      else ocStmt = null;
    }
    if (!ocStmt) return;
    if (ocSchema === 'v2') {
      for (const r of ocStmt.all(now - WINDOW)) {
        if (!r.lastData) continue;
        const l = ocV2Last(r.lastType, r.lastData);
        // error dari pesan assistant terakhir (lastData bisa berupa idle/user, bukan assistant)
        let err = null;
        try {
          const d = JSON.parse(r.lastAssistantData || 'null');
          err = d?.error?.message || d?.error?.name || null;
        } catch {}
        let model = '—';
        try { model = JSON.parse(r.model).id || model; } catch {}
        const age = now - (l.t || r.updated || now);
        const ostate = opencodeState(l, err, age);
        // Sesi yang sudah selesai (state idle) tidak ditampilkan kalau sudah
        // lewat 30 menit, supaya sesi lama tidak menumpuk sebagai agent.
        if (ostate.state === 'idle' && age > 30 * MIN) continue;
        out.push({
          id: 'opencode:' + r.id, source: 'opencode', ...ostate,
          model, project: path.basename(r.directory || '') || '—',
          tokens: Number(r.tokens) || null, started: Number(r.started), updated: Number(l.t || r.updated) || now,
        });
      }
    } else {
      for (const r of ocStmt.all(now - WINDOW)) {
        if (!r.last) continue;
        const l = JSON.parse(r.last);
        let model = '—';
        try { model = JSON.parse(r.model).id || model; } catch {}
        const age = now - (l.t || 0);
        const ostate = opencodeState(l, r.err, age);
        if (ostate.state === 'idle' && age > 30 * MIN) continue;
        out.push({
          id: 'opencode:' + r.id, source: 'opencode', ...ostate,
          model, project: path.basename(r.directory || '') || '—',
          tokens: Number(r.tokens) || null, started: Number(r.started), updated: Number(l.t) || now,
        });
      }
    }
  } catch {
    try { ocDb?.close(); } catch {}
    ocDb = ocStmt = null; ocSchema = null; // coba buka lagi di putaran berikutnya
  }
}

// ---------- Aplikasi Grok Bot (cache lokal, hanya baca) ----------
// Aplikasi menyimpan daftar bot ("roster") dan transkrip tiap bot sebagai JSON.
// Nama file = base32 dari kuncinya. Isi pesan tidak pernah dikirim ke dashboard.
// Grok Bot hanya ada di macOS. Di Linux/Windows env GROK_DIR biasanya tidak diisi,
// jadi folder ini tidak akan ditemukan dan scanGrokApp() langsung berhenti tanpa error.
const GROK_DIR = process.env.GROK_DIR || path.join(HOME, 'Library', 'Application Support', 'Grok Bot', 'sand-client-persistence');
const b32key = new Map();
function b32(name) {
  if (!b32key.has(name)) {
    let bits = 0, val = 0;
    const out = [];
    for (const ch of name.toLowerCase()) {
      const i = 'abcdefghijklmnopqrstuvwxyz234567'.indexOf(ch);
      if (i < 0) break;
      val = (val << 5) | i;
      bits += 5;
      if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); }
    }
    b32key.set(name, Buffer.from(out).toString('utf8'));
  }
  return b32key.get(name);
}
const readBlob = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).value;
function parseGrokTranscript(file) {
  const entries = readBlob(file)?.entries || [];
  const last = entries[entries.length - 1];
  return last ? { userLast: last.kind === 'message' && last.role === 'user', ts: last.timestampMs || 0 } : null;
}
function scanGrokApp(now, out) {
  let files = [];
  try { files = fs.readdirSync(GROK_DIR).filter((f) => f.endsWith('.blob')); } catch { return; }
  const transcripts = new Map();
  let roster = null;
  for (const f of files) {
    const key = b32(f.slice(0, -5));
    if (key.endsWith('.roster.last-roster')) roster = f;
    const m = key.match(/\.transcript\.replicas\.([0-9a-f-]{36})$/);
    if (m) transcripts.set(m[1], f);
  }
  if (!roster) return;
  try {
    const rfile = path.join(GROK_DIR, roster);
    const rows = cached(rfile, fs.statSync(rfile), (f) => readBlob(f)?.rows || []);
    for (const r of rows) {
      if (r.isRemovedFromSidebar) continue;
      let t = null;
      try {
        const tfile = path.join(GROK_DIR, transcripts.get(r.id) || '');
        if (transcripts.has(r.id)) t = cached(tfile, fs.statSync(tfile), parseGrokTranscript);
      } catch {}
      const updated = Math.max(r.lastActivityAt || 0, t?.ts || 0);
      if (now - updated > WINDOW) continue;
      let s = IDLE;
      if (r.awaitingUserResponse) s = { state: 'waiting', task: 'menunggu jawabanmu', tool: '—' };
      // Grok Bot tidak memberi sinyal 'selesai' yang eksplisit; selama ada
      // aktivitas dalam 15 menit terakhir, anggap masih mengerjakan tugas.
      else if (now - updated < 15 * MIN) s = { state: 'reading', task: 'meneliti / mencari informasi', tool: '—' };
      out.push({
        id: 'grok:' + r.id, source: 'grok', name: clip(r.name || 'Grok', 16), ...s,
        model: 'Grok', project: 'Grok Bot', tokens: null, started: r.createdAt || updated, updated,
      });
    }
  } catch {}
}

// ---------- Bot lain lewat POST /api/events ----------
const BOT_STATES = new Set(['coding', 'running', 'reading', 'waiting', 'thinking', 'idle', 'error']);
const bots = new Map();
function botEvent(b) {
  const name = clip(b.agent || b.name || 'Grok', 16);
  const source = /^[a-z0-9_-]{1,16}$/.test(b.source || '') ? b.source : 'grok';
  const id = `${source}:${name}`;
  const status = String(b.status || b.state || '');
  if (status === 'offline') return bots.delete(id), { ok: true, removed: id };
  if (!BOT_STATES.has(status)) return { ok: false, error: `status harus salah satu dari: ${[...BOT_STATES].join(', ')}, offline` };
  const prev = bots.get(id);
  const now = Date.now();
  bots.set(id, {
    id, name, source, state: status,
    task: b.task ? clip(b.task, 80) : null, tool: clip(b.tool || '—', 24),
    model: clip(b.model || prev?.model || '—', 40), project: clip(b.project || prev?.project || '—', 40),
    tokens: Number.isFinite(+b.tokens) && b.tokens != null ? +b.tokens : prev?.tokens ?? null,
    started: prev?.started || now, updated: now,
  });
  return { ok: true, id };
}

// ---------- Snapshot ----------
function collect() {
  const now = Date.now();
  const out = [];
  scanClaude(now, out);
  scanCursor(now, out);
  scanOpencode(now, out);
  scanGrokApp(now, out);
  out.sort((a, b) => a.started - b.started);
  const taken = new Set([...bots.values(), ...out].map((b) => b.name).filter(Boolean));
  for (const a of out) a.name ||= nameFor(a.id, taken);
  for (const [id, b] of bots) {
    if (now - b.updated > WINDOW) bots.delete(id);
    else out.push(b);
  }
  return out;
}

const clients = new Set();
let snapshot = '[]';
function tick() {
  let next;
  try { next = JSON.stringify(collect()); } catch (e) { return console.error('scan gagal:', e.message); }
  if (next === snapshot) return;
  snapshot = next;
  for (const res of clients) res.write(`data: ${snapshot}\n\n`);
}
tick();
setInterval(tick, 2000);
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/agents') return json(res, 200, snapshot);
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${snapshot}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, windowSettings());
  if (url.pathname === '/api/settings' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { return json(res, 400, { ok: false, error: 'JSON tidak valid' }); }
      const v = setWindowMin(parsed.windowMin ?? parsed.minutes ?? parsed.value);
      if (v === null) return json(res, 400, { ok: false, error: `windowMin harus angka ${WINDOW_MIN_BOUNDS[0]}..${WINDOW_MIN_BOUNDS[1]}` });
      tick();
      return json(res, 200, { ok: true, ...windowSettings() });
    });
    return;
  }
  if (url.pathname === '/api/events') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'pakai POST' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      let r;
      try { r = botEvent(JSON.parse(body)); } catch { r = { ok: false, error: 'JSON tidak valid' }; }
      json(res, r.ok ? 200 : 400, r);
      if (r.ok) tick();
    });
    return;
  }
  // file statis
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]|\.\.)+/, '');
  const file = path.join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT)) return json(res, 403, { ok: false });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { ok: false, error: 'tidak ditemukan' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, HOST, () => {
  console.log(`Agent HQ jalan di http://${HOST}:${PORT}`);
  console.log(`Sumber: Claude Code, Cursor, Grok Bot, opencode${sqlite ? '' : ' (opencode nonaktif: node:sqlite tidak tersedia)'} · bot lain: POST /api/events`);
});
