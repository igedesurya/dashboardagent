// Run: node --test orchestrator/test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStreamParser, createGemini, listGeminiModels, mapGeminiModelsJson, QUOTA } from '../engines/gemini.js';
import { run as runHook } from '../gemini-hook.js';
import { normalize, classify } from '../policy.js';

const lines = (a) => a.map((e) => JSON.stringify(e));

function workspaceWithHook() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemws-'));
  fs.mkdirSync(path.join(dir, '.gemini'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.gemini', 'settings.json'),
    JSON.stringify({ hooks: { BeforeTool: [{ type: 'command', command: 'true', timeout: 86400000 }] } })
  );
  return dir;
}

function fakeBin(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakegem-'));
  const f = path.join(dir, 'gemini');
  fs.writeFileSync(f, `#!/usr/bin/env node\n${script}`, { mode: 0o755 });
  return f;
}

test('parser: real Gemini 0.71.1 fixtures (init, delta, tool_use, policy_violation, quota)', () => {
  const ev = [];
  let sid = null;
  const p = createStreamParser({ onSession: (id) => (sid = id), onEvent: (e) => ev.push(e) });
  for (const l of lines([
    { type: 'init', session_id: '7f3a1c2e-1111-2222-3333-444455556666', model: 'auto' },
    { type: 'message', role: 'user', content: 'baca tiket T-002' },
    { type: 'message', role: 'assistant', content: 'Baik', delta: true },
    { type: 'message', role: 'assistant', content: ', saya cek.', delta: true },
    {
      type: 'tool_use',
      tool_name: 'update_topic',
      tool_id: 'tu-topic',
      parameters: { topic: 'T-002 Gemini CLI' },
    },
    {
      type: 'tool_use',
      tool_name: 'mcp_ahq_baca_tiket',
      tool_id: 'tu-mcp',
      parameters: { tiket: 'T-002', wait_for_previous: false },
    },
    {
      type: 'tool_result',
      tool_id: 'tu-mcp',
      status: 'error',
      error: { type: 'policy_violation', message: 'Ditolak oleh Agent HQ.' },
    },
    {
      type: 'result',
      status: 'error',
      error: { message: 'You have exhausted your daily quota on this model.' },
      stats: { total_tokens: 120, input_tokens: 80, output_tokens: 40 },
    },
  ])) p.feed(l);
  assert.equal(sid, '7f3a1c2e-1111-2222-3333-444455556666');
  assert.equal(p.state.text, 'Baik, saya cek.');
  assert.equal(p.state.done.status, 'error');
  assert.match(p.state.done.error.message, /exhausted your daily quota/);
  assert.ok(QUOTA.test(p.state.done.error.message));
  assert.deepEqual(ev, [
    { type: 'tool', name: 'update_topic', input: { topic: 'T-002 Gemini CLI' } },
    { type: 'tool', name: 'mcp_ahq_baca_tiket', input: { tiket: 'T-002', wait_for_previous: false } },
    { type: 'usage', tokens: 120 },
  ]);
});

test('parser: error warning vs error', () => {
  const p = createStreamParser();
  p.feed(JSON.stringify({ type: 'error', severity: 'warning', message: 'hati-hati' }));
  assert.equal(p.state.error, null);
  p.feed(JSON.stringify({ type: 'error', severity: 'error', message: '429 RESOURCE_EXHAUSTED' }));
  assert.match(p.state.error, /429/);
});

test('quota regex', () => {
  for (const s of [
    'Quota exceeded',
    'rate limit',
    'rate-limit',
    'RESOURCE_EXHAUSTED',
    'HTTP 429',
    'usage limit reached',
    'You have exhausted your daily quota on this model.',
  ]) assert.ok(QUOTA.test(s), s);
  assert.ok(!QUOTA.test('syntax error'));
});

test('mapGeminiModelsJson from gemini models -o json', () => {
  const mapped = mapGeminiModelsJson([
    {
      id: 'auto',
      displayName: 'Auto',
      description: 'Let Gemini CLI decide the best model for the task',
    },
    { id: 'gemini-3.8-flash', displayName: 'gemini-3.8-flash', description: '' },
    { modelId: 'x', name: 'X' },
    null,
    { displayName: 'no-id' },
  ]);
  assert.deepEqual(mapped, [
    { value: 'auto', provider: 'gemini', label: 'Auto — Let Gemini CLI decide the best model for the task' },
    { value: 'gemini-3.8-flash', provider: 'gemini', label: 'gemini-3.8-flash' },
    { value: 'x', provider: 'gemini', label: 'X' },
  ]);
  assert.deepEqual(mapGeminiModelsJson([]), []);
  assert.deepEqual(mapGeminiModelsJson({ models: [{ id: 'm1', displayName: 'M1' }] }), [
    { value: 'm1', provider: 'gemini', label: 'M1' },
  ]);
});

test('listGeminiModels override + fallback ids', async () => {
  process.env.AHQ_GEMINI_MODELS = 'x-1, y-2';
  assert.deepEqual(
    (await listGeminiModels()).map((x) => x.value),
    ['x-1', 'y-2']
  );
  delete process.env.AHQ_GEMINI_MODELS;
  const m = await listGeminiModels();
  assert.ok(m.every((x) => x.provider === 'gemini' && x.label));
  assert.ok(m.length >= 1);
  // Fallback must not include obsolete aliases / gemini-2.5-* when dynamic list fails empty.
  if (m.every((x) => ['auto', 'gemini-3.1-pro-preview-customtools', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'].includes(x.value))) {
    assert.ok(!m.some((x) => ['pro', 'flash', 'flash-lite'].includes(x.value) || String(x.value).startsWith('gemini-2.5-')));
  }
});

test('createGemini: binary not found', async () => {
  const g = createGemini({ workspace: workspaceWithHook(), prompt: 'p', bin: '', onSession() {}, onEvent() {} });
  assert.deepEqual(await g.send('hai'), { ok: false, error: 'Gemini CLI (perintah `gemini`) tidak ditemukan.' });
});

test('createGemini: fails when BeforeTool hook missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemnohook-'));
  fs.mkdirSync(path.join(dir, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: {} }));
  const bin = fakeBin(`console.log('should not run');`);
  const r = await createGemini({ workspace: dir, prompt: 'p', bin, onSession() {}, onEvent() {} }).send('x');
  assert.equal(r.ok, false);
  assert.match(r.error, /Konfigurasi hook Gemini tidak ditemukan/);
});

test('createGemini: trust env set, no --skip-trust, resume works', async () => {
  const bin = fakeBin(`
const a = process.argv.slice(2);
const out = { args: a, trust: process.env.GEMINI_CLI_TRUST_WORKSPACE };
console.log(JSON.stringify({type:'init', session_id:'s-1'}));
console.log(JSON.stringify({type:'message', role:'assistant', content: JSON.stringify(out)}));
console.log(JSON.stringify({type:'result', status:'success', stats:{input_tokens:3, output_tokens:4}}));
`);
  const ev = [];
  let sid;
  const ws = workspaceWithHook();
  const g = createGemini({
    workspace: ws,
    model: 'gemini-3.8-flash',
    prompt: 'PERAN',
    roots: ['/a', '/b'],
    bin,
    onSession: (id) => (sid = id),
    onEvent: (e) => ev.push(e),
  });
  const r = await g.send('tugas');
  assert.equal(r.ok, true);
  const first = JSON.parse(r.text);
  assert.equal(first.trust, 'true');
  assert.ok(!first.args.includes('--skip-trust'));
  assert.deepEqual(first.args.slice(0, 5), ['-p', 'PERAN\n\n---\n\ntugas', '--output-format', 'stream-json', '--approval-mode']);
  assert.ok(first.args.includes('yolo') && first.args.includes('-m') && first.args.includes('gemini-3.8-flash'));
  assert.equal(first.args[first.args.indexOf('--include-directories') + 1], '/a,/b');
  assert.ok(!first.args.includes('--resume'));
  assert.equal(sid, 's-1');
  assert.deepEqual(ev, [{ type: 'usage', tokens: 7 }]);
  const r2 = JSON.parse((await g.send('lagi')).text);
  assert.equal(r2.args[1], 'lagi');
  assert.equal(r2.args[r2.args.indexOf('--resume') + 1], 's-1');
  assert.equal(r2.trust, 'true');
});

test('createGemini: quota error and non-zero exit', async () => {
  const ws = workspaceWithHook();
  const bin = fakeBin(`console.error('429 RESOURCE_EXHAUSTED'); process.exit(1);`);
  const r = await createGemini({ workspace: ws, prompt: 'p', bin, onSession() {}, onEvent() {} }).send('x');
  assert.equal(r.ok, false);
  assert.equal(r.quota, true);
  const bin2 = fakeBin(`
console.log(JSON.stringify({type:'result', status:'error', error:{message:'You have exhausted your daily quota on this model.'}}));
process.exit(1);
`);
  const r2 = await createGemini({ workspace: ws, prompt: 'p', bin: bin2, onSession() {}, onEvent() {} }).send('x');
  assert.equal(r2.ok, false);
  assert.equal(r2.quota, true);
  assert.match(r2.error, /exhausted your daily quota/);
});

test('normalize gemini: update_topic=meta, invoke_agent=other', () => {
  const n = (t, i) => normalize('gemini', t, i);
  assert.equal(n('update_topic', { topic: 'x' }).kind, 'meta');
  assert.equal(n('invoke_agent', { name: 'helper' }).kind, 'other');
  assert.deepEqual(n('run_shell_command', { command: 'ls' }), { kind: 'shell', command: 'ls', label: 'run_shell_command' });
  for (const t of ['read_file', 'list_directory', 'glob', 'grep_search', 'search_file_content', 'read_many_files']) assert.equal(n(t, {}).kind, 'read', t);
  assert.deepEqual(n('read_file', { file_path: 'a' }).paths, ['a']);
  assert.deepEqual(n('list_directory', { dir_path: 'src' }).paths, ['src']);
  assert.deepEqual(n('read_many_files', { paths: ['a', 'b'], include: ['*.js'] }).paths, ['a', 'b', '*.js']);
  assert.deepEqual(n('replace', { file_path: 'x.js' }), { kind: 'edit', paths: ['x.js'], label: 'replace' });
  assert.equal(n('write_file', { file_path: 'y' }).kind, 'edit');
  assert.equal(n('web_fetch', { prompt: 'u' }).kind, 'web');
  assert.equal(n('google_web_search', { query: 'q' }).kind, 'web');
  for (const t of ['write_todos', 'ask_user', 'activate_skill', 'enter_plan_mode', 'update_topic']) assert.equal(n(t).kind, 'meta', t);
  assert.equal(n('exit_plan_mode', {}).kind, 'plan');
  assert.equal(n('mcp_ahq_baca_tiket', {}).kind, 'ahq');
  assert.equal(n('mcp_other_tool', {}).kind, 'other');
  assert.equal(n('tool_baru', {}).kind, 'other');
  // other engines unaffected
  assert.equal(normalize('claude', 'run_shell_command', { command: 'ls' }).kind, 'other');
  assert.equal(normalize('claude', 'mcp_ahq_x', {}).kind, 'other');
  assert.equal(normalize('claude', 'update_topic', {}).kind, 'other');
});

test('gemini policy end to end: readOnly/noEdit deny edit', () => {
  const ctx = { roots: ['/w'], writeRoots: ['/w'] };
  const edit = normalize('gemini', 'replace', { file_path: '/w/a.js' });
  assert.equal(classify(edit, { ...ctx, readOnly: true }).decision, 'deny');
  assert.equal(classify(edit, { ...ctx, noEdit: true }).decision, 'deny');
  assert.equal(classify(edit, ctx).decision, 'allow');
  assert.equal(classify(normalize('gemini', 'run_shell_command', { command: 'curl x' }), ctx).decision, 'ask');
});

test('hook: allow, deny, fail closed', async () => {
  const input = JSON.stringify({ tool_name: 'run_shell_command', tool_input: { command: 'ls' } });
  let sent;
  const env = { AHQ_PROJECT: 'p', AHQ_ROLE: 'dev', AHQ_INST: '1' };
  const allow = await runHook(input, async (route, body) => ((sent = [route, body]), { allow: true }), env);
  assert.deepEqual([allow.code, JSON.parse(allow.stdout)], [0, { decision: 'allow' }]);
  assert.equal(sent[0], '/internal/permission');
  assert.deepEqual(sent[1], { project: 'p', role: 'dev', inst: '1', engine: 'gemini', tool: 'run_shell_command', input: { command: 'ls' } });
  const deny = await runHook(input, async () => ({ allow: false, message: 'tidak boleh' }), env);
  assert.deepEqual([deny.code, JSON.parse(deny.stdout)], [0, { decision: 'deny', reason: 'tidak boleh' }]);
  const net = await runHook(input, async () => { throw new Error('ECONNREFUSED'); }, env);
  assert.equal(net.code, 2);
  assert.match(net.stderr, /ECONNREFUSED/);
  assert.equal((await runHook('{bukan json', async () => ({ allow: true }), env)).code, 2);
  assert.equal((await runHook('', async () => ({ allow: true }), env)).code, 2);
  assert.equal((await runHook(input, async () => ({}), env)).stdout.includes('deny'), true);
});
