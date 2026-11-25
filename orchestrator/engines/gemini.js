// Gemini adapter: one `gemini` (Gemini CLI) process per turn, continuing the same session with --resume.
// Security is enforced by the BeforeTool hook in the workspace (.gemini/settings.json), so --approval-mode yolo is required.
// Workspace must be trusted via GEMINI_CLI_TRUST_WORKSPACE=true so project hooks load (--skip-trust silently disables hooks).
// Event names follow the documented `--output-format stream-json` stream; unknown events are ignored.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { childEnv, findBin } from '../lib.js';

export const QUOTA = /quota|rate.?limit|resource_exhausted|429|usage limit/i;
const TURN_TIMEOUT = 60 * 60 * 1000;
const MODELS_TIMEOUT = 60_000;
const NOT_FOUND = 'Gemini CLI (perintah `gemini`) tidak ditemukan.';
const HOOK_MISSING = 'Konfigurasi hook Gemini tidak ditemukan di workspace; giliran dibatalkan demi keamanan.';

// Fallback when `gemini models -o json` fails or returns nothing. Overridable with AHQ_GEMINI_MODELS="a,b,c".
const DEFAULT_MODELS = [
  'auto',
  'gemini-3.1-pro-preview-customtools',
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
];

// Maps the JSON from `gemini models -o json` into dashboard model options. Exported for unit tests.
export function mapGeminiModelsJson(data) {
  const items = Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
  return items
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const id = m.id || m.modelId || m.name;
      if (!id) return null;
      const display = m.displayName || m.name || String(id);
      const desc = m.description ? ` — ${m.description}` : '';
      return { value: String(id), provider: 'gemini', label: display + desc };
    })
    .filter(Boolean);
}

function modelsFromIds(ids) {
  return ids.map((value) => ({ value, provider: 'gemini', label: value }));
}

export function listGeminiModels() {
  const custom = String(process.env.AHQ_GEMINI_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (custom.length) return Promise.resolve(modelsFromIds(custom));

  const bin = findBin('gemini');
  if (!bin) return Promise.resolve(modelsFromIds(DEFAULT_MODELS));

  return new Promise((resolve) => {
    execFile(bin, ['models', '-o', 'json'], { env: childEnv(), timeout: MODELS_TIMEOUT, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(modelsFromIds(DEFAULT_MODELS));
      try {
        const mapped = mapGeminiModelsJson(JSON.parse(String(stdout || '')));
        resolve(mapped.length ? mapped : modelsFromIds(DEFAULT_MODELS));
      } catch {
        resolve(modelsFromIds(DEFAULT_MODELS));
      }
    });
  });
}

function hasBeforeToolHook(workspace) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, '.gemini', 'settings.json'), 'utf8'));
    const hooks = settings?.hooks?.BeforeTool;
    return Array.isArray(hooks) ? hooks.length > 0 : Boolean(hooks);
  } catch {
    return false;
  }
}

// Turns stream-json lines into adapter state + onEvent calls. Exported so it can be tested with fixtures.
export function createStreamParser({ onSession = () => {}, onEvent = () => {} } = {}) {
  const st = { sessionId: null, text: '', error: null, done: null };
  return {
    state: st,
    feed(line) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      if (!e || typeof e !== 'object') return;
      switch (e.type) {
        case 'init': {
          const id = e.session_id || e.sessionId;
          if (id && id !== st.sessionId) {
            st.sessionId = id;
            onSession(id);
          }
          break;
        }
        case 'message': {
          if (e.role !== 'assistant' || typeof e.content !== 'string' || !e.content) break;
          // Streamed chunks (delta) are glued together; whole messages become separate paragraphs.
          st.text += e.delta ? e.content : (st.text ? '\n\n' : '') + e.content;
          break;
        }
        case 'tool_use':
          onEvent({ type: 'tool', name: e.tool_name || e.name || 'tool', input: e.parameters || e.input || e.args || {} });
          break;
        case 'error':
          // "warning" severity does not fail the turn.
          if (e.severity !== 'warning') st.error = String(e.message || e.error?.message || e.error || 'Gemini error');
          break;
        case 'result': {
          st.done = e;
          const s = e.stats || {};
          const tokens = s.total_tokens ?? ((s.input_tokens || 0) + (s.output_tokens || 0));
          if (tokens) onEvent({ type: 'usage', tokens });
          break;
        }
        default:
          break; // tool_result and anything unknown
      }
    },
  };
}

export function createGemini({ workspace, model, prompt, sessionId, onSession, onEvent, roots, bin: binOverride }) {
  const bin = binOverride !== undefined ? binOverride : findBin('gemini');
  let proc = null;
  let first = !sessionId;

  return {
    async send(text) {
      if (!bin) return { ok: false, error: NOT_FOUND };
      if (!hasBeforeToolHook(workspace)) return { ok: false, error: HOOK_MISSING };
      // GEMINI.md in the workspace carries the role; the first message repeats it in case it is not loaded.
      const body = first ? `${prompt}\n\n---\n\n${text}` : text;
      first = false;
      const args = ['-p', body, '--output-format', 'stream-json', '--approval-mode', 'yolo'];
      if (model) args.push('-m', model);
      if (roots?.length) args.push('--include-directories', roots.join(','));
      if (sessionId) args.push('--resume', sessionId);
      return new Promise((resolve) => {
        let err = '', buf = '';
        const parser = createStreamParser({
          onSession: (id) => {
            sessionId = id;
            onSession?.(id);
          },
          onEvent: (e) => onEvent?.(e),
        });
        const st = parser.state;
        const env = childEnv({ GEMINI_CLI_TRUST_WORKSPACE: 'true' });
        const p = (proc = spawn(bin, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] }));
        const timer = setTimeout(() => p.kill(), TURN_TIMEOUT);
        p.stdout.on('data', (d) => {
          buf += d;
          let k;
          while ((k = buf.indexOf('\n')) >= 0) {
            parser.feed(buf.slice(0, k));
            buf = buf.slice(k + 1);
          }
        });
        p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
        p.on('error', (e) => {
          clearTimeout(timer);
          proc = null;
          resolve({ ok: false, error: e.message, quota: QUOTA.test(e.message) });
        });
        p.on('close', (code) => {
          clearTimeout(timer);
          proc = null;
          if (buf.trim()) parser.feed(buf);
          const failed = st.error || st.done?.status === 'error' || code !== 0;
          if (!failed) return resolve({ ok: true, text: st.text.trim() });
          const msg = (st.error || st.done?.error?.message || err || `gemini berhenti (kode ${code}).`).toString().trim();
          resolve({ ok: false, text: st.text.trim(), error: msg, quota: QUOTA.test(msg) || QUOTA.test(err) });
        });
      });
    },
    stop() {
      proc?.kill();
    },
  };
}
