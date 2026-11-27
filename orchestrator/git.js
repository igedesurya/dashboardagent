// Local git reads. Agents work on the branch the user already has open.
import { execFileSync } from 'node:child_process';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trim();
}
function tryGit(cwd, ...args) {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message).trim() };
  }
}

export function isRepo(dir) {
  return tryGit(dir, 'rev-parse', '--is-inside-work-tree').out === 'true';
}

export function currentRef(repo) {
  const b = tryGit(repo, 'rev-parse', '--abbrev-ref', 'HEAD').out;
  return { branch: b, commit: git(repo, 'rev-parse', 'HEAD') };
}
