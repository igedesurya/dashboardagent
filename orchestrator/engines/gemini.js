// Gemini adapter: one `gemini` (Gemini CLI) process per turn, continuing the same session with --resume.
// Security is enforced by the BeforeTool hook in the workspace (.gemini/settings.json), so --approval-mode yolo is required.
// Event names follow the documented `--output-format stream-json` stream; unknown events are ignored.
// NOTE: not yet verified against a real Gemini CLI (not installed on the dev Mac).
import { spawn } from 'node:child_process';
import { childEnv, findBin } from '../lib.js';

export const QUOTA = /quota|rate.?limit|resource_exhausted|429|usage limit/i;
const TURN_TIMEOUT = 60 * 60 * 1000;
const NOT_FOUND = 'Gemini CLI (perintah `gemini`) tidak ditemukan.';

// Gemini CLI has no "list models" command: static list, overridable with AHQ_GEMINI_MODELS="a,b,c".
const DEFAULT_MODELS = [
  ['auto', 'auto — pilih otomatis'],
  ['pro', 'pro — alias model Pro terbaru'],
  ['flash', 'flash — alias model Flash terbaru'],
  ['flash-lite', 'flash-lite — alias model Flash-Lite terbaru'],
  ['gemini-2.5-pro', 'gemini-2.5-pro'],
  ['gemini-2.5-flash', 'gemini-2.5-flash'],
  ['gemini-2.5-flash-lite', 'gemini-2.5-flash-lite'],
];

export function listGeminiModels() {
  const custom = String(process.env.AHQ_GEMINI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = custom.length ? custom.map((m) => [m, m]) : DEFAULT_MODELS;
  return Promise.resolve(list.map(([value, label]) => ({ value, provider: 'gemini', label })));
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
        const p = (proc = spawn(bin, args, { cwd: workspace, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] }));
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
