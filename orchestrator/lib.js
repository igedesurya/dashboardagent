// Shared paths and helpers for the orchestrator, its MCP server, and the Cursor hook.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

export const PORT = +process.env.AHQ_PORT || 5180;
export const HOME = os.homedir();
export const DATA = process.env.AHQ_HOME || path.join(HOME, '.agent-hq');
export const TOKEN_FILE = path.join(DATA, 'token');
export const MAX_ACTIVE = 2; // global limit of agents working at the same time

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Token shared with the MCP server and hook processes; never sent to the browser.
export function loadToken({ create = false } = {}) {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    if (!create) return null;
    ensureDir(DATA);
    const tok = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(TOKEN_FILE, tok, { mode: 0o600 });
    return tok;
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

// POST to the local orchestrator without client-side timeouts (permission requests can wait for hours).
export function postInternal(route, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, token: loadToken() });
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: route, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(s));
          } catch {
            reject(new Error(`bad response ${res.statusCode}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

// Locate an executable in PATH or in the usual per-user install locations.
export function findBin(name, extra = []) {
  const dirs = [...(process.env.PATH || '').split(':'), path.join(HOME, '.local/bin'), path.join(HOME, '.opencode/bin'), '/opt/homebrew/bin', '/usr/local/bin', ...extra];
  for (const d of dirs) {
    const p = path.join(d, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

// Environment for spawned agents: drop variables that make a nested Claude Code think it runs inside another session.
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ANTHROPIC_API_KEY') delete env[k];
  env.PATH = [path.join(HOME, '.local/bin'), path.join(HOME, '.opencode/bin'), '/opt/homebrew/bin', '/usr/local/bin', env.PATH].filter(Boolean).join(':');
  return env;
}

export const clip = (s, n = 80) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
