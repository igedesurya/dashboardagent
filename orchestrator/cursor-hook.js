#!/usr/bin/env node
// Cursor preToolUse hook for team sessions. Asks the orchestrator and waits for its decision.
// Fails closed: if the orchestrator is unreachable, the tool is denied.
import { postInternal } from './lib.js';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', async () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {}
  let out;
  try {
    const r = await postInternal('/internal/permission', {
      project: process.env.AHQ_PROJECT,
      role: process.env.AHQ_ROLE,
      inst: process.env.AHQ_INST || '',
      engine: 'cursor',
      tool: input.tool_name,
      input: input.tool_input || {},
    });
    out = r.allow ? { permission: 'allow', decision: 'allow' } : { permission: 'deny', decision: 'deny', userMessage: r.message, agentMessage: r.message };
  } catch (e) {
    const msg = `Agent HQ orchestrator tidak bisa dihubungi (${e.message}); tool ditolak demi keamanan.`;
    out = { permission: 'deny', decision: 'deny', userMessage: msg, agentMessage: msg };
  }
  process.stdout.write(JSON.stringify(out));
});
