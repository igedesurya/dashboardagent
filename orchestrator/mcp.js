#!/usr/bin/env node
// MCP server (stdio) started by each agent engine. It forwards tool calls to the orchestrator.
// Env: AHQ_PROJECT, AHQ_ROLE, AHQ_ENGINE.
import readline from 'node:readline';
import { postInternal } from './lib.js';
import { toolsFor } from './roles.js';

const PROJECT = process.env.AHQ_PROJECT;
const ROLE = process.env.AHQ_ROLE || 'worker';
const INST = process.env.AHQ_INST || '';
const ENGINE = process.env.AHQ_ENGINE || 'claude';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const text = (s, isError = false) => ({ content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) });

async function call(name, args) {
  if (name === 'izin') {
    // Claude Code asks us whether a tool may run; the orchestrator may wait for the user.
    const r = await postInternal('/internal/permission', { project: PROJECT, role: ROLE, inst: INST, engine: ENGINE, tool: args.tool_name, input: args.input || {} });
    const out = r.allow ? { behavior: 'allow', updatedInput: args.input || {} } : { behavior: 'deny', message: r.message || 'Ditolak.' };
    return text(JSON.stringify(out));
  }
  const r = await postInternal('/internal/tool', { project: PROJECT, role: ROLE, inst: INST, tool: name, args });
  return text(r.text ?? r.error ?? 'ok', !!r.error);
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ahq', version: '1.0.0' } } });
  }
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: toolsFor(ROLE, ENGINE) } });
  if (m.method === 'tools/call') {
    const { name, arguments: args = {} } = m.params || {};
    try {
      return send({ jsonrpc: '2.0', id: m.id, result: await call(name, args) });
    } catch (e) {
      return send({ jsonrpc: '2.0', id: m.id, result: text(`Orchestrator tidak bisa dihubungi: ${e.message}`, true) });
    }
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
