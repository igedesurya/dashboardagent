// Security policy: "security questions go to the user, ordinary work does not".
// Every engine's permission request is normalized here and classified as allow / deny / ask.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, clip } from './lib.js';
import { TOOLS } from './roles.js';

const SECRET = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa)[^/]*|\.npmrc|\.pypirc|\.netrc|credentials[^/]*|secrets?\.(json|ya?ml|toml))$/i;
const SECRET_OK = /\.env\.(example|sample|template)$/i;

// Shell commands that always need the user's approval, for every role.
const SENSITIVE_SHELL = [
  [/\b(curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp)\b/, 'akses jaringan ke luar Mac'],
  [/\bsudo\b|\bsu\s/, 'menjalankan sebagai admin (sudo)'],
  [/\b(kill|pkill|killall|launchctl|shutdown|reboot)\b/, 'menghentikan proses atau mengubah sistem'],
  [/\bgit\s+(push|pull|fetch|clone|remote|reset\s+--hard|clean\s+-|checkout\s+-f|branch\s+-D|rebase)\b/, 'operasi git berisiko atau ke remote'],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall|rm|update|upgrade|publish)\b|\b(pip3?|uv|poetry)\s+(install|add|uninstall)\b|\b(brew|apt|apt-get|gem|cargo\s+install|go\s+install|pod\s+install|flutter\s+pub\s+(add|upgrade))\b/, 'memasang atau menghapus paket'],
  [/\b(docker\s+(push|login|rm|rmi|system)|kubectl|terraform|vercel|netlify|firebase\s+deploy|fly\s+deploy|gcloud|aws|az)\b/, 'deploy atau layanan cloud'],
  [/\b(psql|mysql|mongo|mongosh|redis-cli|sqlcmd)\b/, 'mengakses database'],
  [/\b(printenv|env)\b\s*($|\|)|\bsecurity\s+find-|\bkeychain\b/, 'membaca rahasia atau kredensial'],
  [/\b(chmod|chown|osascript|defaults\s+write|crontab)\b/, 'mengubah izin atau pengaturan sistem'],
  [/\brm\s+(-\w*[rf]\w*\s+)+/, 'menghapus file secara paksa'],
];
const RM_FORCE = SENSITIVE_SHELL.find(([, why]) => why === 'menghapus file secara paksa')[0];
const KILL = SENSITIVE_SHELL.find(([, why]) => why.startsWith('menghentikan proses'))[0];
// These are asked every time: "Selalu izinkan" is never offered for them.
const NEVER_REMEMBER = new Set(['menjalankan sebagai admin (sudo)', 'menghentikan proses atau mengubah sistem', 'operasi git berisiko atau ke remote', 'deploy atau layanan cloud', 'membaca rahasia atau kredensial', 'mengubah izin atau pengaturan sistem', 'menghapus file secara paksa']);

// Paths a command may touch without counting as "outside the project": tools, system files, temp dirs.
const SYSTEM_DIRS = ['/usr', '/bin', '/sbin', '/opt/homebrew', '/usr/local', '/dev', '/System', '/Library/Developer', '/Applications/Xcode.app', '/private/etc', '/etc', '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];

// Absolute, home-relative, and ..-escaping paths mentioned in a shell command.
function shellPaths(cmd, cwd) {
  const out = [];
  for (const seg of shellSegments(cmd)) {
    for (let w of seg.split(/\s+/)) {
      w = w.replace(/^['"]+|['";,)]+$/g, '').replace(/^[<>]+/, '').replace(/^-{1,2}[\w-]*=/, '').replace(/^\w+=/, '');
      if (!w || /^[a-z]+:\/\//i.test(w)) continue;
      if (w.startsWith('/') || w === '~' || w.startsWith('~/') || w.split('/').includes('..')) out.push(resolveP(w.replace(/\*.*$/, '') || '/', cwd));
    }
  }
  return out;
}

// rm -rf is fine when every target stays inside the role's own write area (e.g. __pycache__ in a worktree).
function rmStaysInside(cmd, writeRoots, cwd) {
  if (!writeRoots.length || !isInside(cwd, writeRoots)) return false;
  for (const seg of shellSegments(cmd)) {
    const words = seg.split(/\s+/);
    if (!words.includes('rm')) continue;
    const targets = words.slice(words.indexOf('rm') + 1).filter((w) => !w.startsWith('-'));
    if (!targets.length) return false;
    for (const t of targets) {
      const clean = t.replace(/^['"]|['"]$/g, '');
      if (!clean || /[$`~*]/.test(clean.replace(/\*\.pyc$/, '')) || clean.split('/').includes('..')) return false;
      if (!isInside(path.resolve(cwd, clean), writeRoots)) return false;
    }
  }
  return true;
}

// Read-only roles may run these without asking (when nothing sensitive is involved).
const READONLY_CMDS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'pwd', 'tree', 'file', 'stat', 'du', 'echo', 'sort', 'uniq', 'cut', 'jq', 'which', 'date', 'basename', 'dirname', 'realpath', 'readlink', 'less', 'diff', 'cd', 'true']);
const READONLY_GIT = new Set(['log', 'status', 'diff', 'show', 'branch', 'blame', 'ls-files', 'rev-parse', 'describe', 'shortlog', 'tag', 'grep']);

// Other projects' folders and the orchestrator's own data (except this role's area) are off limits.
const FORBIDDEN_MSG = 'Ini di luar project ini (data orchestrator atau project lain). Kerjakan hanya di folder project dan folder kerjamu.';
const isForbidden = (p, ctx) => isInside(p, ctx.forbidden || []) && !isInside(p, ctx.roots || []);

const isInside = (p, roots) => roots.some((r) => p === r || p.startsWith(r.endsWith('/') ? r : r + '/'));
const resolveP = (p, cwd) => path.resolve(cwd, String(p).replace(/^~(?=\/|$)/, HOME));

// Gemini CLI built-in tool names -> our request kinds. MCP tools are "mcp_<server>_<tool>".
const GEMINI_READ = new Set(['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search', 'search_file_content']);
const GEMINI_EDIT = new Set(['replace', 'write_file']);
const GEMINI_WEB = new Set(['web_fetch', 'google_web_search']);
const GEMINI_META = new Set(['write_todos', 'ask_user', 'activate_skill', 'enter_plan_mode', 'update_topic']);
// invoke_agent intentionally falls through to "other" (ask the user): sub-agent tool calls have not been proven to pass through the BeforeTool hook.

function normalizeGemini(t, input) {
  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x);
  if (/^mcp_ahq_/i.test(t)) return { kind: 'ahq', label: t };
  if (t === 'run_shell_command') return { kind: 'shell', command: input.command || '', label: t };
  if (GEMINI_READ.has(t)) return { kind: 'read', paths: [...list(input.file_path), ...list(input.dir_path), ...list(input.path), ...list(input.paths), ...list(input.include)], label: t };
  if (GEMINI_EDIT.has(t)) return { kind: 'edit', paths: list(input.file_path), label: t };
  if (GEMINI_WEB.has(t)) return { kind: 'web', target: input.url || input.prompt || input.query || '', label: t };
  if (GEMINI_META.has(t)) return { kind: 'meta', label: t };
  if (t === 'exit_plan_mode') return { kind: 'plan', plan: input.plan || '', label: t };
  return { kind: 'other', label: t, target: JSON.stringify(input).slice(0, 120) };
}

// Convert each engine's request into { kind, paths, command, label }.
export function normalize(engine, tool, input = {}) {
  const t = String(tool || '');
  const lower = t.toLowerCase();
  if (engine === 'gemini') return normalizeGemini(t, input || {});
  if (engine === 'opencode') {
    // opencode permission: action + resources
    const res = input.resources || [];
    if (t === 'shell' || t === 'bash') return { kind: 'shell', command: res.join(' | '), label: t };
    if (t === 'read' || t === 'list' || t === 'glob' || t === 'grep' || t === 'external_directory') return { kind: 'read', paths: res, label: t };
    if (t === 'edit' || t === 'write' || t === 'patch') return { kind: 'edit', paths: res, label: t };
    if (t === 'webfetch' || t === 'websearch') return { kind: 'web', target: res.join(' '), label: t };
    if (t === 'question' || t === 'todowrite' || t === 'todoread') return { kind: 'meta', label: t };
    if (/ahq/.test(lower) || res.some((r) => /ahq/.test(r))) return { kind: 'ahq', label: t };
    return { kind: 'other', label: t, target: res.join(' ') };
  }
  if (/^mcp__ahq__|^mcp:ahq|ahq-|^ahq[._]/i.test(t)) return { kind: 'ahq', label: t };
  // Cursor reports MCP tools as "MCP:<tool>" without the server name.
  const mcpName = t.match(/^mcp:(\w+)$/i)?.[1];
  if (mcpName && Object.hasOwn(TOOLS, mcpName)) return { kind: 'ahq', label: t };
  const file = input.file_path || input.path || input.notebook_path || input.target_file || input.filePath;
  if (/^(bash|shell|run_terminal_cmd|terminal)$/i.test(t)) return { kind: 'shell', command: input.command || '', label: t };
  if (/^(read|grep|glob|ls|list|search|codebase_?search|semanticsearch|readlints|read_file|list_dir)/i.test(t)) return { kind: 'read', paths: file ? [file] : [], label: t };
  if (/^(edit|write|multiedit|notebookedit|strreplace|str_replace|search_replace|edit_file|delete|applypatch|apply_patch)/i.test(t)) return { kind: 'edit', paths: file ? [file] : [], label: t };
  if (/^(webfetch|websearch|fetch|web_search)/i.test(t)) return { kind: 'web', target: input.url || input.query || '', label: t };
  if (/^(todowrite|task|agent|todo_write|update_todos)$/i.test(t)) return { kind: 'meta', label: t };
  if (/^exitplanmode$/i.test(t)) return { kind: 'plan', plan: input.plan || '', label: t };
  if (/^mcp/i.test(t)) return { kind: 'other', label: t, target: JSON.stringify(input).slice(0, 120) };
  return { kind: 'other', label: t, target: JSON.stringify(input).slice(0, 120) };
}

// Split a shell command on | || && ; and newlines, but not inside quotes ('a|b' is one argument).
function shellSegments(cmd) {
  const out = [];
  let cur = '', q = null;
  const s = String(cmd);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"') cur += s[++i] ?? '';
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
      continue;
    }
    if (c === '|' || c === ';' || c === '\n' || (c === '&' && s[i + 1] === '&')) {
      if (c === '&' || (c === '|' && s[i + 1] === '|')) i++;
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}
// Text outside quotes, for checks such as output redirection.
const unquoted = (cmd) => String(cmd).replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""');
// A path that does not exist cannot leak anything; glob suffixes like /* are ignored.
const exists = (p) => {
  try {
    return fs.existsSync(p.replace(/(\/\*+)+$|\*.*$/, '') || '/');
  } catch {
    return true;
  }
};

/**
 * ctx: { roots: [abs dirs the role may read], writeRoots, mirrors, forbidden: [abs dirs never allowed],
 *        readOnly: bool, noEdit: bool, remembered: Set<string> (this role's "always" keys) }
 * An "ask" with key null must be confirmed every time.
 * returns { decision: 'allow'|'deny'|'ask', summary, key, reason }
 */
export function classify(req, ctx) {
  const cwd = ctx.roots[0] || HOME;
  const mem = ctx.remembered || new Set();
  const ok = (summary) => ({ decision: 'allow', summary });
  const ask = (summary, key, reason) => (mem.has(key) ? { decision: 'allow', summary, key } : { decision: 'ask', summary, key, reason });
  const deny = (summary, reason) => ({ decision: 'deny', summary, reason });

  switch (req.kind) {
    case 'ahq':
    case 'meta':
      return ok(req.label);
    case 'read': {
      for (const raw of req.paths || []) {
        const p = resolveP(raw, cwd);
        if (isForbidden(p, ctx)) return deny(`Membaca area terlarang: ${clip(raw, 60)}`, FORBIDDEN_MSG);
        if (SECRET.test(p) && !SECRET_OK.test(p)) return ask(`Membaca file rahasia: ${clip(raw, 60)}`, null, 'file rahasia');
        if (!isInside(p, ctx.roots) && exists(p)) return ask(`Membaca di luar folder project: ${clip(raw, 60)}`, `read:${path.dirname(p)}`, 'di luar folder project');
      }
      return ok('membaca');
    }
    case 'edit': {
      if (ctx.readOnly) return deny('Mengubah file', 'Peran ini hanya membaca dan menganalisa. Perubahan kode dikerjakan Programmer setelah rencana SA disetujui pengguna.');
      if (ctx.noEdit) return deny('Mengubah file', 'QA tidak mengubah kode. Laporkan temuanmu dengan lapor_uji; Programmer yang memperbaikinya.');
      for (const raw of req.paths || []) {
        const p = resolveP(raw, cwd);
        // Programmers must never edit the user's own folder: point them at their worktree copy instead.
        for (const m of ctx.mirrors || []) {
          if (isInside(p, [m.src])) {
            const dst = path.join(m.dst, path.relative(m.src, p));
            return deny(`Mengubah folder asli: ${clip(raw, 60)}`, `Jangan mengubah folder project asli pengguna. Ubah salinannya di worktree-mu: ${dst}`);
          }
        }
        if (isForbidden(p, ctx)) return deny(`Mengubah area terlarang: ${clip(raw, 60)}`, FORBIDDEN_MSG);
        if (SECRET.test(p) && !SECRET_OK.test(p)) return ask(`Mengubah file rahasia: ${clip(raw, 60)}`, null, 'file rahasia');
        if (!isInside(p, ctx.writeRoots || ctx.roots)) return ask(`Mengubah file di luar area kerja: ${clip(raw, 60)}`, null, 'di luar area kerja');
      }
      return ok('mengubah file');
    }
    case 'shell': {
      const cmd = req.command || '';
      // Programmers run commands in their worktree, never in the user's own folder.
      for (const m of ctx.mirrors || []) {
        if (cmd.includes(m.src)) return deny(`Menjalankan di folder asli: ${clip(cmd, 80)}`, `Jangan menjalankan perintah di folder project asli pengguna. Pakai worktree-mu: ${m.dst}`);
      }
      const exact = `shell:${cmd.trim().replace(/\s+/g, ' ').slice(0, 400)}`;
      for (const p of shellPaths(cmd, cwd)) {
        if (isForbidden(p, ctx)) return deny(`Menyentuh area terlarang: ${clip(cmd, 80)}`, FORBIDDEN_MSG);
      }
      for (const [re, why] of SENSITIVE_SHELL) {
        const m = cmd.match(re);
        if (m && re === RM_FORCE && !ctx.readOnly && rmStaysInside(cmd, ctx.writeRoots || [], cwd)) continue;
        if (m && re === KILL && (ctx.readOnly || ctx.noEdit)) return deny(`Menghentikan proses: ${clip(cmd, 80)}`, 'Peran ini tidak boleh menghentikan proses. Kalau ada proses yang mengganggu, laporkan ke SA/PM.');
        if (m) return ask(`Menjalankan: ${clip(cmd, 90)}`, NEVER_REMEMBER.has(why) ? null : exact, why);
      }
      if (SECRET.test(cmd.replace(/\.env\.(example|sample|template)/g, ''))) return ask(`Menjalankan: ${clip(cmd, 90)}`, null, 'menyentuh file rahasia');
      for (const p of shellPaths(cmd, cwd)) {
        if (isInside(p, SYSTEM_DIRS) || isInside(p, ctx.roots)) continue;
        return ask(`Menjalankan: ${clip(cmd, 90)}`, exact, `menyentuh folder di luar project: ${clip(p, 70)}`);
      }
      if (ctx.readOnly) {
        if (/(^|[^>])>{1,2}(?!&)/.test(unquoted(cmd).replace(/2>&1|>\s*\/dev\/null/g, ''))) return ask(`Menjalankan: ${clip(cmd, 90)}`, exact, 'menulis ke file');
        for (const seg of shellSegments(cmd)) {
          const [w0, w1] = seg.replace(/^(\w+=\S+\s+)+/, '').split(/\s+/);
          const base = path.basename(w0 || '');
          if (base === 'git' && READONLY_GIT.has(w1)) continue;
          if (base === 'git' && w1 === 'stash' && /\bstash\s+(list|show)\b/.test(seg)) continue;
          if (base === 'sed' && !/\s-i\b/.test(seg)) continue;
          if (READONLY_CMDS.has(base)) continue;
          return ask(`Menjalankan: ${clip(cmd, 90)}`, exact, 'peran baca saja menjalankan perintah yang bisa mengubah sesuatu');
        }
      }
      return ok('menjalankan perintah');
    }
    case 'web': {
      // Remember per host only, never "all of the internet".
      const host = String(req.target || '').match(/^[a-z]+:\/\/([^/:?#]+)/i)?.[1];
      return ask(`Akses internet: ${clip(req.target || req.label, 80)}`, host ? `web:${host}` : null, 'akses jaringan ke luar Mac');
    }
    case 'plan':
      return ask('Persetujuan rencana', null, 'rencana perlu disetujui');
    default:
      return ask(`Memakai ${clip(req.label, 40)}${req.target ? ': ' + clip(req.target, 60) : ''}`, `tool:${req.label}`, 'tool tidak dikenal');
  }
}
