import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readlink, realpath, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AgentRecord, ReviewFile } from '@classroom/shared';
const exec = promisify(execFile);
export const FILE_LIMIT = 64 * 1024;
const TOTAL_LIMIT = 2 * 1024 * 1024;
export class ReviewError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export async function inspectGit(repo: string, args: string[], maxBuffer = 4 * 1024 * 1024) {
  return (await exec('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'buffer', maxBuffer, timeout: 30000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_EXTERNAL_DIFF: '' } })).stdout;
}
interface Entry { mode: string; oid: string; data?: Buffer; size: number }
export interface CollectedReview { version: string; files: ReviewFile[]; content: Map<string, { before: string; after: string }>; additions: number; deletions: number; canComplete: boolean }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function validPath(name: string) { if (path.isAbsolute(name) || name.split('/').some(p => p === '..' || p === '.' || p === '.git')) throw new ReviewError('Unsafe repository path.'); }
async function readEntry(root: string, name: string, algorithm: string): Promise<Entry | null> {
  validPath(name);
  const parts = name.split('/');
  for (let i = 1; i < parts.length; i++) {
    const parent = await lstat(path.join(root, ...parts.slice(0, i))).catch(() => null);
    if (!parent) return null;
    if (parent.isSymbolicLink() || !parent.isDirectory()) return null; // Never traverse a symlink ancestor.
  }
  const full = path.join(root, name);
  const stat = await lstat(full).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
  if (!stat) return null;
  if (stat.isSymbolicLink()) { const data = await readlink(full, { encoding: 'buffer' }); return { mode: '120000', oid: createHash(algorithm).update(`blob ${data.length}\0`).update(data).digest('hex'), size: data.length }; }
  if (!stat.isFile()) throw new ReviewError(`Unsupported directory, submodule, or special file: ${name}. Remove it from this review before continuing.`);
  const canonical = await realpath(full);
  if (!canonical.startsWith(root + path.sep)) throw new ReviewError('A file resolved outside the worktree. Refresh changes.');
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (before.ino !== stat.ino || before.dev !== stat.dev || !before.isFile()) throw new ReviewError('Files changed during inspection. Refresh changes.', 409);
    const digest = createHash(algorithm).update(`blob ${before.size}\0`);
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { const buffer = Buffer.from(chunk); digest.update(buffer); length += buffer.length; if (before.size <= FILE_LIMIT && length <= FILE_LIMIT) chunks.push(buffer); }
    const after = await handle.stat();
    if (before.size !== length || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new ReviewError('Files changed during inspection. Refresh changes.', 409);
    return { mode: before.mode & 0o111 ? '100755' : '100644', oid: digest.digest('hex'), size: length, data: length <= FILE_LIMIT ? Buffer.concat(chunks) : undefined };
  } finally { await handle.close(); }
}
async function scan(repo: string, algorithm: string, base: Map<string, Entry>) {
  const output = await inspectGit(repo, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const names = [...new Set(output.toString('utf8').split('\0').filter(Boolean))].sort();
  if (names.length > 20000 || !Buffer.from(output.toString('utf8')).equals(output)) throw new ReviewError('Repository exceeds inspection limits or has non-UTF-8 filenames.');
  const entries = new Map<string, Entry>(); let retained = 0;
  for (const name of names) { const entry = await readEntry(repo, name, algorithm); if (entry) { if (entry.oid === base.get(name)?.oid) entry.data = undefined; if (entry.data) { retained += entry.data.length; if (retained > TOTAL_LIMIT) entry.data = undefined; } entries.set(name, entry); } }
  return entries;
}
function signature(entries: Map<string, Entry>) { return JSON.stringify([...entries].map(([name, e]) => [name, e.mode, e.oid])); }
function textContent(data: Buffer) { if (data.includes(0)) return null; try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); } catch { return null; } }
export async function collectReview(agent: AgentRecord): Promise<CollectedReview> {
  if (!agent.worktree || !agent.startCommit) throw new ReviewError('This agent has no retained worktree or recorded base commit.');
  let repo: string;
  try { if ((await lstat(agent.worktree)).isSymbolicLink()) throw new Error('symlink root'); repo = await realpath(agent.worktree); if (repo !== path.resolve(agent.worktree)) throw new Error('worktree location changed'); } catch { throw new ReviewError('Agent worktree is missing. Restore it before reviewing.'); }
  try { await inspectGit(repo, ['cat-file', '-e', `${agent.startCommit}^{commit}`]); } catch { throw new ReviewError('Recorded base commit is unavailable.'); }
  try {
    const algorithm = (await inspectGit(repo, ['rev-parse', '--show-object-format'])).toString().trim();
    const base = new Map<string, Entry>();
    const tree = await inspectGit(repo, ['ls-tree', '-r', '-z', '--full-tree', agent.startCommit]);
    if (!Buffer.from(tree.toString('utf8')).equals(tree)) throw new ReviewError('Recorded base contains non-UTF-8 filenames, which this review cannot display.');
    for (const row of tree.toString().split('\0').filter(Boolean)) { const tab = row.indexOf('\t'); const [mode, , oid] = row.slice(0, tab).split(' '); base.set(row.slice(tab + 1), { mode, oid, size: 0 }); }
    let current = await scan(repo, algorithm, base); let stable = false;
    for (let attempt = 0; attempt < 2; attempt++) { const verify = await scan(repo, algorithm, base); if (signature(current) === signature(verify)) { stable = true; break; } current = verify; }
    if (!stable) throw new ReviewError('Files changed during inspection. Stop external edits and refresh changes.', 409);
    const version = hash(JSON.stringify([agent.startCommit, signature(current)]));
    const paths = [...new Set([...base.keys(), ...current.keys()])].sort();
    const changes = paths.filter(name => base.get(name)?.oid !== current.get(name)?.oid || base.get(name)?.mode !== current.get(name)?.mode);
    if (changes.length > 1000) throw new ReviewError('More than 1,000 changed files. This review exceeds the MVP limit.');
    const deleted = new Set(changes.filter(name => !current.has(name)));
    const pairs: { name: string; oldName: string; renamed: boolean }[] = [];
    for (const name of changes.filter(name => current.has(name))) {
      const previous = !base.has(name) ? [...deleted].find(old => base.get(old)!.oid === current.get(name)!.oid && base.get(old)!.mode === current.get(name)!.mode) : undefined;
      if (previous) deleted.delete(previous);
      pairs.push({ name, oldName: previous ?? name, renamed: !!previous });
    }
    for (const name of deleted) pairs.push({ name, oldName: name, renamed: false });
    const content = new Map<string, { before: string; after: string }>(); const files: ReviewFile[] = []; let total = 0;
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'classroom-diff-'));
    try {
      for (const { name, oldName, renamed } of pairs) {
        const old = base.get(oldName), next = current.get(name);
        const file: ReviewFile = { id: hash(JSON.stringify([oldName, name])), path: name, ...(renamed ? { previousPath: oldName } : {}), status: renamed ? 'renamed' : !old ? 'added' : !next ? 'deleted' : old.mode.slice(0, 3) !== next.mode.slice(0, 3) ? 'type-changed' : 'modified', oldMode: old?.mode ?? '000000', newMode: next?.mode ?? '000000', additions: null, deletions: null, unsupported: false, limited: false };
        if ([old, next].some(e => e && !['100644', '100755'].includes(e.mode))) { file.unsupported = true; file.reason = 'Symlink or unsupported file type. Its content is not followed or rendered.'; }
        let before = Buffer.alloc(0), after = next?.data;
        if (!next) after = Buffer.alloc(0);
        if (!file.unsupported && old) { const size = Number((await inspectGit(repo, ['cat-file', '-s', old.oid])).toString()); if (size <= FILE_LIMIT) before = await inspectGit(repo, ['cat-file', 'blob', old.oid], FILE_LIMIT + 1024); else { file.limited = true; } }
        if (next && old?.oid === next.oid && !file.limited) after = before;
        total += before.length + (after?.length ?? 0);
        if (!file.unsupported && (file.limited || !after || total > TOTAL_LIMIT)) { file.limited = true; file.reason = 'Content exceeds the 64 KiB per-side or 2 MiB review limit. Completion is disabled.'; }
        if (!file.unsupported && !file.limited) {
          const beforeText = textContent(before), afterText = textContent(after!);
          if (beforeText === null || afterText === null) { file.unsupported = true; file.reason = 'Binary or non-UTF-8 content cannot be reviewed in this phase.'; }
          else {
            content.set(file.id, { before: beforeText, after: afterText });
            await writeFile(path.join(temporary, 'before'), before); await writeFile(path.join(temporary, 'after'), after!);
            let stats: Buffer;
            try { stats = await inspectGit(temporary, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--numstat', '--', 'before', 'after']); }
            catch (e) { if ((e as { code?: number }).code !== 1) throw e; stats = (e as unknown as { stdout: Buffer }).stdout; }
            const [add = '0', remove = '0'] = stats.toString().trim().split(/\s+/); file.additions = Number(add || 0); file.deletions = Number(remove || 0);
          }
        }
        files.push(file);
      }
    } finally { await rm(temporary, { recursive: true, force: true }); }
    return { version, files, content, additions: files.reduce((n, f) => n + (f.additions ?? 0), 0), deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0), canComplete: files.length > 0 && files.every(f => !f.unsupported && !f.limited) };
  } catch (e) { if (e instanceof ReviewError) throw e; throw new ReviewError(`Git inspection failed: ${(e as Error).message}`); }
}
