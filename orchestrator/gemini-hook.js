#!/usr/bin/env node
// Gemini CLI BeforeTool hook for team sessions. Asks the orchestrator and waits for its decision.
// Gemini itself fails OPEN on hook errors, so this hook fails CLOSED: any error -> exit 2 (tool blocked, reason on stderr).
import { fileURLToPath } from 'node:url';
import { postInternal } from './lib.js';

// Returns { code, stdout, stderr }; never throws.
export async function run(raw, post = postInternal, env = process.env) {
  try {
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || !input.tool_name) throw new Error('input hook tidak valid');
    const r = await post('/internal/permission', {
      project: env.AHQ_PROJECT,
      role: env.AHQ_ROLE,
      inst: env.AHQ_INST || '',
      engine: 'gemini',
      tool: input.tool_name,
      input: input.tool_input || {},
    });
    if (r?.allow === true) return { code: 0, stdout: JSON.stringify({ decision: 'allow' }), stderr: '' };
    const reason = r?.message || 'Ditolak oleh Agent HQ.';
    return { code: 0, stdout: JSON.stringify({ decision: 'deny', reason }), stderr: '' };
  } catch (e) {
    return { code: 2, stdout: '', stderr: `Agent HQ orchestrator tidak bisa dihubungi atau input salah (${e.message}); tool ditolak demi keamanan.` };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', async () => {
    const r = await run(raw);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = r.code;
  });
  process.stdin.on('error', () => {
    process.stderr.write('Gagal membaca stdin hook; tool ditolak demi keamanan.');
    process.exitCode = 2;
  });
}
