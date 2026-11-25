// opencode adapter: one shared `opencode serve` on 127.0.0.1, one opencode session per role.
// Permission requests arrive as SSE events and are answered through the API.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { childEnv, findBin, DATA, ensureDir } from '../lib.js';

let BASE = null;

// Ask the OS for a free port so a leftover server from an earlier run can never block us.
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// ---- shared server ----
let server = null; // { proc, auth, ready: Promise }
const listeners = new Map(); // sessionID -> handler(event)
let permissionHandler = null; // (event) => void, set by the orchestrator

export function onOpencodePermission(fn) {
  permissionHandler = fn;
}

function startServer() {
  if (server) return server.ready;
  const bin = findBin('opencode');
  if (!bin) return Promise.reject(new Error('opencode tidak ditemukan.'));
  server = { proc: null, auth: null };
  server.ready = freePort().then((port) => new Promise((resolve, reject) => {
  BASE = `http://127.0.0.1:${port}`;
  const proc = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ensureDir(DATA), env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  server.proc = proc;
    let out = '';
    const onData = (d) => {
      out += d;
      const m = out.match(/server password (\S+)/);
      if (m && /listening/.test(out) && !server.auth) {
        server.auth = 'Basic ' + Buffer.from('opencode:' + m[1]).toString('base64');
        resolve();
        subscribe();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    const timer = setTimeout(() => reject(new Error('opencode serve tidak siap dalam 30 detik.')), 30000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      server = null;
      reject(new Error(`opencode serve berhenti (kode ${code}): ${out.slice(-300)}`));
    });
  }));
  server.ready.catch(() => {
    server?.proc?.kill();
    server = null;
  });
  return server.ready;
}

async function api(method, p, body) {
  await startServer();
  const r = await fetch(BASE + p, { method, headers: { authorization: server.auth, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {}
  if (!r.ok) throw new Error(`opencode ${method} ${p}: ${r.status} ${t.slice(0, 200)}`);
  return j;
}

async function subscribe() {
  for (;;) {
    if (!server?.auth) return;
    try {
      const r = await fetch(BASE + '/api/event', { headers: { authorization: server.auth } });
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k);
          buf = buf.slice(k + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!data) continue;
          let e;
          try {
            e = JSON.parse(data);
          } catch {
            continue;
          }
          const sid = e.data?.sessionID;
          if (e.type === 'permission.asked') permissionHandler?.(e.data);
          if (sid && listeners.has(sid)) listeners.get(sid)(e);
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function replyPermission(sessionID, requestID, allow, message) {
  await api('POST', `/api/session/${sessionID}/permission/${requestID}/reply`, { decision: allow ? 'once' : 'reject', message: message || null });
}

// Every model the user's opencode can use (all configured providers, including 9router), as "provider/model".
export async function listOpencodeModels() {
  const r = await api('GET', '/api/model');
  return (r?.data || [])
    .map((m) => ({
      value: `${m.providerID}/${m.id}`,
      provider: m.providerID,
      label: m.name && m.name !== m.id ? `${m.id} — ${m.name}` : m.id,
      free: /-free$/.test(m.id) || (m.cost && m.cost.input === 0 && m.cost.output === 0),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.value.localeCompare(b.value));
}

export function stopOpencode() {
  server?.proc?.kill();
}

// ---- per-role adapter ----
export function createOpencode({ project, role, workspace, model, sessionId, onSession, onEvent, agent }) {
  let current = null;
  const toolNames = new Map();

  async function ensureSession() {
    if (sessionId) {
      try {
        await api('GET', `/api/session/${sessionId}`);
        return sessionId;
      } catch {
        sessionId = null;
      }
    }
    const [providerID, ...rest] = String(model || '').split('/');
    const body = {
      title: `Agent HQ · ${project.name} · ${role.toUpperCase()}`,
      location: { directory: workspace },
      agent: agent || 'build',
      // Every tool asks; the orchestrator's policy decides (allow quietly, deny, or ask the user).
      permissions: [{ action: '*', resource: '*', effect: 'ask' }],
    };
    if (rest.length) body.model = { providerID, id: rest.join('/') };
    const s = await api('POST', '/api/session', body);
    sessionId = s.data.id;
    onSession(sessionId);
    return sessionId;
  }

  function handle(e) {
    const d = e.data || {};
    // Any streamed event (reasoning, text, tool progress) proves the session is alive.
    if (current) onEvent({ type: 'alive' });
    if (e.type === 'session.tool.input.started') toolNames.set(d.id, d.name);
    if (e.type === 'session.tool.called') onEvent({ type: 'tool', name: toolNames.get(d.id) || 'tool', input: d.input });
    if (e.type === 'session.usage.updated' && d.tokens) onEvent({ type: 'usage', tokens: (d.tokens.input || 0) + (d.tokens.output || 0) + (d.tokens.cache?.read || 0) });
    if (!current) return;
    // The same text part can be reported more than once; keep one copy per message part.
    const part = `${d.assistantMessageID}:${d.ordinal}`;
    // Some models repeat the same reply in a second step; show it once.
    if (e.type === 'session.text.ended' && d.text && !current.parts.has(part) && d.text.trim() !== current.last) {
      current.parts.add(part);
      current.last = d.text.trim();
      current.text += (current.text ? '\n\n' : '') + d.text;
    }
    if (e.type === 'session.step.failed' && d.error) current.error = d.error;
    if (e.type === 'session.execution.succeeded') finish({ ok: true });
    if (e.type === 'session.execution.failed') {
      const err = current.error || d.error || {};
      finish({ ok: false, error: err.message || 'opencode gagal', quota: err.type === 'provider.quota' || err.status === 402 || err.status === 429 });
    }
  }

  function finish(r) {
    const c = current;
    current = null;
    c?.resolve({ text: c.text.trim(), ...r });
  }

  return {
    async send(text) {
      try {
        const sid = await ensureSession();
        listeners.set(sid, handle);
        return await new Promise((resolve) => {
          current = { resolve, text: '', error: null, parts: new Set(), last: null };
          api('POST', `/api/session/${sid}/prompt`, { text }).catch((e) => finish({ ok: false, error: e.message }));
        });
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    stop() {
      if (sessionId) api('POST', `/api/session/${sessionId}/interrupt`).catch(() => {});
      // Release the waiting turn even if opencode never reports the interruption.
      if (current) finish({ ok: false, error: 'dihentikan' });
    },
  };
}
