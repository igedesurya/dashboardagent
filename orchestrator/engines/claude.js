// Claude Code adapter: one long-lived process per role, stream JSON on stdin/stdout.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { childEnv, findBin, DATA, PORT } from '../lib.js';

const QUOTA = /usage limit|rate.?limit|quota|limit reached|overloaded|429/i;

export function createClaude({ project, role, inst = '', workspace, roots, model, prompt, sessionId, onSession, onEvent }) {
  const bin = findBin('claude');
  let proc = null;
  let current = null; // { resolve, text }
  let buf = '';

  const mcpConfig = JSON.stringify({
    mcpServers: { ahq: { command: process.execPath, args: [path.join(import.meta.dirname, '..', 'mcp.js')], env: { AHQ_PROJECT: project.id, AHQ_ROLE: role, AHQ_INST: inst, AHQ_ENGINE: 'claude', AHQ_HOME: DATA, AHQ_PORT: String(PORT) } } },
  });

  function start() {
    if (!bin) throw new Error('Claude Code (perintah `claude`) tidak ditemukan.');
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--strict-mcp-config', '--mcp-config', mcpConfig,
      '--permission-prompt-tool', 'mcp__ahq__izin',
      '--settings', path.join(workspace, '.ahq', 'claude-settings.json'),
      '--append-system-prompt', prompt,
      ...roots.flatMap((d) => ['--add-dir', d])];
    if (model) args.push('--model', model);
    if (sessionId) args.push('--resume', sessionId);
    proc = spawn(bin, args, { cwd: workspace, env: childEnv({ MCP_TOOL_TIMEOUT: '86400000' }), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stdout.on('data', (d) => {
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
        handle(e);
      }
    });
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    proc.on('close', (code) => {
      proc = null;
      if (current) {
        const msg = stderr.trim() || `Claude Code berhenti (kode ${code}).`;
        finish({ ok: false, error: msg, quota: QUOTA.test(msg) });
      }
    });
  }

  function finish(r) {
    const c = current;
    current = null;
    c?.resolve({ text: c.text.trim(), ...r });
  }

  function handle(e) {
    if (e.type === 'system' && e.subtype === 'init' && e.session_id) {
      sessionId = e.session_id;
      onSession(e.session_id);
    }
    if (!current) return;
    if (e.type === 'assistant') {
      for (const b of e.message?.content || []) {
        if (b.type === 'tool_use') onEvent({ type: 'tool', name: b.name, input: b.input });
        if (b.type === 'text' && b.text) current.text += (current.text ? '\n\n' : '') + b.text;
      }
      const u = e.message?.usage;
      if (u) onEvent({ type: 'usage', tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0) });
    }
    if (e.type === 'result') {
      const err = e.is_error || e.subtype !== 'success';
      const msg = err ? String(e.result || e.subtype) : null;
      if (!current.text && e.result && !err) current.text = String(e.result);
      finish({ ok: !err, error: msg, quota: err && QUOTA.test(msg) });
    }
  }

  return {
    send(text) {
      return new Promise((resolve) => {
        current = { resolve, text: '' };
        try {
          if (!proc) start();
          proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
        } catch (err) {
          finish({ ok: false, error: err.message });
        }
      });
    },
    stop() {
      proc?.kill();
      proc = null;
    },
  };
}
