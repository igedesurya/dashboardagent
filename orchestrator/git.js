// Git operations for ticket work. Everything stays local: no fetch, no push.
// The user's own folder and checked-out branch are never modified; agents work in separate worktrees.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_DIFF = 40000;

export function git(cwd, ...args) {
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

const branchExists = (repo, b) => tryGit(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`).ok;

// Create (or reuse) a worktree at `dir` on `branch`, starting from `from` when the branch is new.
export function ensureWorktree(repo, dir, branch, from) {
  if (fs.existsSync(path.join(dir, '.git'))) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (branchExists(repo, branch)) git(repo, 'worktree', 'add', dir, branch);
  else git(repo, 'worktree', 'add', '-b', branch, dir, from);
}

// Read-only copy of a branch for QA: a detached worktree, reset to the branch's latest commit each round.
export function ensureDetached(repo, dir, ref) {
  if (fs.existsSync(path.join(dir, '.git'))) {
    git(dir, 'checkout', '-q', '--force', '--detach', ref);
    tryGit(dir, 'clean', '-fdq');
    return;
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(repo, 'worktree', 'add', '--detach', dir, ref);
}

export function removeWorktree(repo, dir) {
  if (fs.existsSync(dir)) tryGit(repo, 'worktree', 'remove', '--force', dir);
  tryGit(repo, 'worktree', 'prune');
}

// Commit everything the agent changed in a worktree (respects .gitignore). Returns the new HEAD or null.
export function commitAll(dir, message) {
  git(dir, 'add', '-A');
  if (!tryGit(dir, 'diff', '--cached', '--quiet').ok) {
    git(dir, '-c', 'user.name=Agent HQ', '-c', 'user.email=agent-hq@localhost', 'commit', '-q', '-m', message);
    return git(dir, 'rev-parse', '--short', 'HEAD');
  }
  return null;
}

// Diff of a branch against the point where it left `base`, for SA review.
export function diffAgainst(dir, base) {
  const stat = tryGit(dir, 'diff', '--stat', `${base}...HEAD`).out;
  let patch = tryGit(dir, 'diff', `${base}...HEAD`).out;
  if (patch.length > MAX_DIFF) patch = patch.slice(0, MAX_DIFF) + `\n… (diff dipotong; baca file di worktree untuk lengkapnya)`;
  return { stat: stat || '(tidak ada perubahan)', patch };
}

// Merge a Programmer branch into the ticket branch (in the ticket's integration worktree).
export function mergeInto(intDir, branch, message) {
  const r = tryGit(intDir, '-c', 'user.name=Agent HQ', '-c', 'user.email=agent-hq@localhost', 'merge', '--no-ff', '-m', message, branch);
  if (r.ok) return { ok: true };
  const conflicts = tryGit(intDir, 'diff', '--name-only', '--diff-filter=U').out;
  tryGit(intDir, 'merge', '--abort');
  return { ok: false, conflicts: conflicts || r.out };
}

export function currentRef(repo) {
  const b = tryGit(repo, 'rev-parse', '--abbrev-ref', 'HEAD').out;
  return { branch: b, commit: git(repo, 'rev-parse', 'HEAD') };
}
