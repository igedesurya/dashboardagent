// Run: node --test orchestrator/test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStreamParser, createGemini, listGeminiModels, QUOTA } from '../engines/gemini.js';
import { run as runHook } from '../gemini-hook.js';
import { normalize, classify } from '../policy.js';

const lines = (a) => a.map((e) => JSON.stringify(e));

test('parser: init, message, tool_use, result', () => {
  const ev = [];
  let sid = null;
  const p = createStreamParser({ onSession: (id) => (sid = id), onEvent: (e) => ev.push(e) });
  for (const l of lines([
    { type: 'init', session_id: 'abc-123', model: 'auto' },
    { type: 'message', role: 'user', content: 'halo' },
    { type: 'message', role: 'assistant', content: 'Ha', delta: true },
    { type: 'message', role: 'assistant', content: 'lo', delta: true },
    { type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { file_path: 'a.js' } },
    { type: 'tool_result', tool_id: 't1', status: 'success' },
    { type: 'weird_new_event', x: 1 },
    { type: 'message', role: 'assistant', content: 'Selesai.' },
    { type: 'result', status: 'success', stats: { total_tokens: 42 } },
  ])) p.feed(l);
  p.feed('bukan json');
  assert.equal(sid, 'abc-123');
  assert.equal(p.state.text, 'Halo\n\nSelesai.');
  assert.deepEqual(ev, [{ type: 'tool', name: 'read_file', input: { file_path: 'a.js' } }, { type: 'usage', tokens: 42 }]);
});

test('parser: error warning vs error', () => {
  const p = createStreamParser();
  p.feed(JSON.stringify({ type: 'error', severity: 'warning', message: 'hati-hati' }));
  assert.equal(p.state.error, null);
  p.feed(JSON.stringify({ type: 'error', severity: 'error', message: '429 RESOURCE_EXHAUSTED' }));
  assert.match(p.state.error, /429/);
});

test('quota regex', () => {
  for (const s of ['Quota exceeded', 'rate limit', 'rate-limit', 'RESOURCE_EXHAUSTED', 'HTTP 429', 'usage limit reached']) assert.ok(QUOTA.test(s), s);
  assert.ok(!QUOTA.test('syntax error'));
});

test('listGeminiModels default + override', async () => {
  const m = await listGeminiModels();
  assert.deepEqual(m.slice(0, 4).map((x) => x.value), ['auto', 'pro', 'flash', 'flash-lite']);
  assert.ok(m.every((x) => x.provider === 'gemini' && x.label));
  process.env.AHQ_GEMINI_MODELS = 'x-1, y-2';
  assert.deepEqual((await listGeminiModels()).map((x) => x.value), ['x-1', 'y-2']);
  delete process.env.AHQ_GEMINI_MODELS;
});

test('createGemini: binary not found', async () => {
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  const g = createGemini({ workspace: '/tmp', prompt: 'p', onSession() {}, onEvent() {} });
  process.env.PATH = saved;
  const r = await g.send('hai');
  // findBin also checks fixed dirs; only assert when gemini is really absent
  if (!r.ok) assert.equal(r.error, 'Gemini CLI (perintah `gemini`) tidak ditemukan.');
});

function fakeBin(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakegem-'));
  const f = path.join(dir, 'gemini');
  fs.writeFileSync(f, `#!/usr/bin/env node\n${script}`, { mode: 0o755 });
  return f;
}

test('createGemini: full turn with fake CLI, args and resume', async () => {
  const bin = fakeBin(`
const a = process.argv.slice(2);
console.log(JSON.stringify({type:'init', session_id:'s-1'}));
console.log(JSON.stringify({type:'message', role:'assistant', content: JSON.stringify(a)}));
console.log(JSON.stringify({type:'result', status:'success', stats:{input_tokens:3, output_tokens:4}}));
`);
  const ev = [];
  let sid;
  const g = createGemini({ workspace: os.tmpdir(), model: 'flash', prompt: 'PERAN', roots: ['/a', '/b'], bin, onSession: (id) => (sid = id), onEvent: (e) => ev.push(e) });
  const r = await g.send('tugas');
  assert.equal(r.ok, true);
  const args = JSON.parse(r.text);
  assert.deepEqual(args.slice(0, 5), ['-p', 'PERAN\n\n---\n\ntugas', '--output-format', 'stream-json', '--approval-mode']);
  assert.ok(args.includes('yolo') && args.includes('-m') && args.includes('flash'));
  assert.equal(args[args.indexOf('--include-directories') + 1], '/a,/b');
  assert.ok(!args.includes('--resume'));
  assert.equal(sid, 's-1');
  assert.deepEqual(ev, [{ type: 'usage', tokens: 7 }]);
  const r2 = JSON.parse((await g.send('lagi')).text);
  assert.equal(r2[1], 'lagi');
  assert.equal(r2[r2.indexOf('--resume') + 1], 's-1');
});

test('createGemini: quota error and non-zero exit', async () => {
  const bin = fakeBin(`console.error('429 RESOURCE_EXHAUSTED'); process.exit(1);`);
  const r = await createGemini({ workspace: os.tmpdir(), prompt: 'p', bin, onSession() {}, onEvent() {} }).send('x');
  assert.equal(r.ok, false);
  assert.equal(r.quota, true);
  const bin2 = fakeBin(`console.log(JSON.stringify({type:'error', message:'boom'})); process.exit(1);`);
  const r2 = await createGemini({ workspace: os.tmpdir(), prompt: 'p', bin: bin2, onSession() {}, onEvent() {} }).send('x');
  assert.deepEqual([r2.ok, r2.error, r2.quota], [false, 'boom', false]);
});

test('normalize gemini', () => {
  const n = (t, i) => normalize('gemini', t, i);
  assert.deepEqual(n('run_shell_command', { command: 'ls' }), { kind: 'shell', command: 'ls', label: 'run_shell_command' });
  for (const t of ['read_file', 'list_directory', 'glob', 'grep_search', 'search_file_content', 'read_many_files']) assert.equal(n(t, {}).kind, 'read', t);
  assert.deepEqual(n('read_file', { file_path: 'a' }).paths, ['a']);
  assert.deepEqual(n('list_directory', { dir_path: 'src' }).paths, ['src']);
  assert.deepEqual(n('read_many_files', { paths: ['a', 'b'], include: ['*.js'] }).paths, ['a', 'b', '*.js']);
  assert.deepEqual(n('replace', { file_path: 'x.js' }), { kind: 'edit', paths: ['x.js'], label: 'replace' });
  assert.equal(n('write_file', { file_path: 'y' }).kind, 'edit');
  assert.equal(n('web_fetch', { prompt: 'u' }).kind, 'web');
  assert.equal(n('google_web_search', { query: 'q' }).kind, 'web');
  for (const t of ['write_todos', 'ask_user', 'activate_skill', 'enter_plan_mode']) assert.equal(n(t).kind, 'meta', t);
  assert.equal(n('exit_plan_mode', {}).kind, 'plan');
  assert.equal(n('mcp_ahq_baca_tiket', {}).kind, 'ahq');
  assert.equal(n('mcp_other_tool', {}).kind, 'other');
  assert.equal(n('tool_baru', {}).kind, 'other');
  // other engines unaffected
  assert.equal(normalize('claude', 'run_shell_command', { command: 'ls' }).kind, 'other');
  assert.equal(normalize('claude', 'mcp_ahq_x', {}).kind, 'other');
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
