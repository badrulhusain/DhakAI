import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, mkdir } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
export const git = async (repo: string, ...args: string[]) => (await exec('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
export async function inspectRepository(repo: string) {
  let canonical: string;
  try { canonical = await realpath(repo); } catch { throw new Error(`Repository does not exist: ${repo}. Run npm run demo:setup or set TARGET_REPO.`); }
  let top: string;
  try { top = await git(canonical, 'rev-parse', '--show-toplevel'); } catch { throw new Error('Configured repository is not a Git working tree.'); }
  if (await realpath(top) !== canonical) throw new Error('TARGET_REPO must point to the repository root.');
  let startCommit: string;
  try { startCommit = await git(repo, 'rev-parse', '--verify', 'HEAD'); } catch { throw new Error('Repository must contain at least one commit.'); }
  let baseBranch: string;
  try { baseBranch = await git(repo, 'symbolic-ref', '--quiet', '--short', 'HEAD'); } catch { throw new Error('Repository has a detached HEAD. Check out a named branch first.'); }
  return { name: path.basename(canonical), baseBranch, startCommit };
}
export async function createWorktree(repo: string, root: string, id: string) {
  const info = await inspectRepository(repo);
  if (await git(repo, 'status', '--porcelain', '--untracked-files=all')) throw new Error('Base working tree is dirty. Commit or move your changes yourself before launching; Agent Classroom will not alter them.');
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const canonicalRepo = await realpath(repo);
  const relative = path.relative(canonicalRepo, canonicalRoot);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('WORKTREE_ROOT must be outside the target repository.');
  const branch = `classroom/agent-${id}`;
  const worktree = path.join(canonicalRoot, `agent-${id}`);
  await git(repo, 'worktree', 'add', '-b', branch, worktree, info.startCommit);
  return { ...info, branch, worktree };
}
export async function cleanupFailedWorktree(repo: string, worktree: string, branch: string, startCommit: string) {
  // Never force removal: retain anything a process may already have changed.
  if (await git(worktree, 'status', '--porcelain') || await git(worktree, 'rev-parse', 'HEAD') !== startCommit) return;
  await git(repo, 'worktree', 'remove', worktree);
  await git(repo, 'branch', '-d', branch);
}
