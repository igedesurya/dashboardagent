// Cursor adapter: one cursor-agent process per turn, continuing the same chat with --resume.
// Security is enforced by the preToolUse hook in the workspace (.cursor/hooks.json), so --force is required.
import { spawn, execFile } from 'node:child_process';
import { childEnv, findBin } from '../lib.js';

const QUOTA = /usage limit|rate.?limit|quota|limit reached|upgrade your plan|429/i;
const TURN_TIMEOUT = 60 * 60 * 1000;

// Models available to the user's Cursor account ("id - Name" lines from `cursor-agent models`).
export function listCursorModels() {
  const bin = findBin('cursor-agent');
  if (!bin) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(bin, ['models'], { env: childEnv(), timeout: 60000 }, (err, out) => {
      const models = String(out || '')
        .split('\n')
        .map((l) => l.match(/^\s*([\w.:-]+)\s+-\s+(.+?)\s*$/))
        .filter(Boolean)
        .map(([, id, name]) => ({ value: id, provider: 'cursor', label: `${id} — ${name.replace(/\s*\(current, default\)/, '')}` }));
      resolve(models);
    });
  });
}

export function createCursor({ workspace, model, prompt, sessionId, onSession, onEvent }) {
  const bin = findBin('cursor-agent');
  let proc = null;
  let first = !sessionId;

  function createChat() {
    return new Promise((resolve, reject) => {
      execFile(bin, ['create-chat'], { cwd: workspace, env: childEnv(), timeout: 60000 }, (err, out, errOut) => {
        const id = String(out).trim().split('\n').pop();
        if (err || !/^[\w-]{8,}$/.test(id)) return reject(new Error(String(errOut || err?.message || 'create-chat gagal').trim()));
        resolve(id);
      });
    });
  }

  return {
    async send(text) {
      if (!bin) return { ok: false, error: 'Cursor CLI (cursor-agent) tidak ditemukan.' };
      try {
        if (!sessionId) {
          sessionId = await createChat();
          onSession(sessionId);
        }
      } catch (e) {
        return { ok: false, error: e.message, quota: QUOTA.test(e.message) };
      }
      // Rules in .cursor/rules carry the role; the first message repeats them in case rules are not loaded.
      const body = first ? `${prompt}\n\n---\n\n${text}` : text;
      first = false;
      const args = ['-p', '--output-format', 'stream-json', '--trust', '--approve-mcps', '--force', '--resume', sessionId];
      if (model) args.push('--model', model);
      args.push(body);
      return new Promise((resolve) => {
        let out = '', err = '', buf = '', done = null;
        const p = (proc = spawn(bin, args, { cwd: workspace, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] }));
        const timer = setTimeout(() => p.kill(), TURN_TIMEOUT);
        p.stdout.on('data', (d) => {
          buf += d;
          let k;
          while ((k = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, k);
            buf = buf.slice(k + 1);
            let e;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.type === 'assistant') for (const b of e.message?.content || []) if (b.type === 'text' && b.text) out += (out ? '\n\n' : '') + b.text;
            if (e.type === 'tool_call' && e.subtype === 'started') {
              const kind = Object.keys(e.tool_call || {})[0] || 'tool';
              const a = e.tool_call[kind]?.args || {};
              onEvent({ type: 'tool', name: kind.replace(/ToolCall$/, ''), input: a });
            }
            if (e.type === 'result') done = e;
          }
        });
        p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
        p.on('close', (code) => {
          clearTimeout(timer);
          proc = null;
          if (done && !done.is_error) return resolve({ ok: true, text: (out || done.result || '').trim() });
          const msg = (done?.result || err || `cursor-agent berhenti (kode ${code}).`).toString().trim();
          resolve({ ok: false, text: out.trim(), error: msg, quota: QUOTA.test(msg) });
        });
      });
    },
    stop() {
      proc?.kill();
    },
  };
}
