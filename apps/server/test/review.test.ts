import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git, createWorktree } from '../src/git.js';
import { collectReview, FILE_LIMIT } from '../src/review-git.js';
import { ReviewService } from '../src/review-service.js';
import { LocalLearningStore } from '../src/learning-store.js';
import { explanationComplete, type AgentRecord, type Answers } from '@classroom/shared';
const answers: Answers = { problem: 'The original greeting was missing the friendly punctuation we need.', solution: 'The greeting now adds an exclamation mark after the supplied name.', edgeCase: 'Test an empty name and a Unicode name to check the resulting greeting.' };
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classroom-review-')); const repo = path.join(root, 'base'); await mkdir(repo);
  await git(repo, 'init', '-b', 'main');
  for (const [name, text] of Object.entries({ 'modify.txt': 'original\n', 'delete.txt': 'delete me\n', 'rename me.txt': 'keep these exact lines\nand this one\n', 'staged.txt': 'old stage\n', 'committed.txt': 'old commit\n', '.gitignore': '*.ignored\n' })) await writeFile(path.join(repo, name), text);
  await mkdir(path.join(repo, 'nested')); await writeFile(path.join(repo, 'nested', 'inside.txt'), 'safe base content\n');
  await git(repo, 'add', '.'); await git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'base');
  const worktree = await createWorktree(repo, path.join(root, 'worktrees'), 'review');
  const agent: AgentRecord = { id: 'test-agent', name: 'Agent test', task: 'Review test', runner: 'demo', status: 'stopped', createdAt: new Date().toISOString(), branch: worktree.branch, baseBranch: worktree.baseBranch, startCommit: worktree.startCommit, worktree: worktree.worktree };
  const store = new LocalLearningStore(path.join(root, 'data')); await store.init(); const service = new ReviewService(id => { if (id !== agent.id) throw new Error('Agent not found.'); return agent; }, store);
  return { root, repo, agent, work: worktree.worktree, store, service, cleanup: () => rm(root, { recursive: true, force: true }) };
}
test('collects combined committed, staged, unstaged, added, deleted, renamed and unusual paths without changing index/base', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.work, 'committed.txt'), 'new commit\n'); await git(f.work, 'add', 'committed.txt'); await git(f.work, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'agent commit');
    await writeFile(path.join(f.work, 'staged.txt'), 'staged\n'); await git(f.work, 'add', 'staged.txt'); await writeFile(path.join(f.work, 'staged.txt'), 'staged and unstaged\n');
    await writeFile(path.join(f.work, 'modify.txt'), 'changed\n'); await rm(path.join(f.work, 'delete.txt')); await rename(path.join(f.work, 'rename me.txt'), path.join(f.work, 'renamed file.txt'));
    await writeFile(path.join(f.work, 'new file\nwith tab\t.txt'), 'new\n'); await writeFile(path.join(f.work, 'secret.ignored'), 'ignored');
    const indexPath = await git(f.work, 'rev-parse', '--git-path', 'index'); const indexBefore = await readFile(indexPath); const baseBefore = await git(f.repo, 'status', '--porcelain');
    const review = await collectReview(f.agent); assert.equal(review.files.length, 6); assert.ok(review.canComplete);
    const byName = new Map(review.files.map(file => [file.path, file]));
    for (const name of ['committed.txt', 'staged.txt', 'modify.txt']) assert.equal(byName.get(name)?.status, 'modified');
    assert.equal(byName.get('delete.txt')?.status, 'deleted'); assert.equal(byName.get('renamed file.txt')?.previousPath, 'rename me.txt'); assert.equal(byName.get('new file\nwith tab\t.txt')?.status, 'added'); assert.ok(!byName.has('secret.ignored'));
    assert.equal(review.content.get(byName.get('staged.txt')!.id)?.after, 'staged and unstaged\n'); assert.equal(review.content.get(byName.get('committed.txt')!.id)?.before, 'old commit\n');
    assert.deepEqual(await readFile(indexPath), indexBefore); assert.equal(await git(f.repo, 'status', '--porcelain'), baseBefore); assert.equal(await readFile(path.join(f.repo, 'modify.txt'), 'utf8'), 'original\n');
    assert.equal((await collectReview(f.agent)).version, review.version); await chmod(path.join(f.work, 'modify.txt'), 0o755); assert.notEqual((await collectReview(f.agent)).version, review.version);
  } finally { await f.cleanup(); }
});
test('snapshot content is immutable, versions reject stale submissions, drafts/completions persist and gate rechecks current work', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.work, 'modify.txt'), 'first version\n'); const review = await f.service.review(f.agent.id);
    const draft = await f.service.save(f.agent.id, { version: review.version, answers: { ...answers, problem: 'partial' }, intent: 'draft' }); assert.equal(draft.status, 'draft');
    const restartedStore = new LocalLearningStore(f.store.directory); await restartedStore.init(); assert.deepEqual((await restartedStore.getExplanation(f.agent.id, review.version))?.answers.problem, 'partial');
    await assert.rejects(f.service.save(f.agent.id, { version: review.version, answers: { ...answers, problem: '    short   ' }, intent: 'complete' }), /30 non-whitespace/);
    assert.equal(explanationComplete({ ...answers, problem: 'x'.repeat(29) + ' \n\t' }), false);
    await f.service.save(f.agent.id, { version: review.version, answers, intent: 'complete' }); assert.equal((await f.service.isExplanationCompleteForCurrentReview(f.agent.id)).complete, true);
    const again = await f.service.review(f.agent.id, true); assert.equal(again.version, review.version); assert.equal(again.explanation?.status, 'completed');
    await writeFile(path.join(f.work, 'modify.txt'), 'second version\n'); assert.equal(f.service.file(f.agent.id, review.version, review.files[0].id).after, 'first version\n');
    await assert.rejects(f.service.save(f.agent.id, { version: review.version, answers, intent: 'complete' }), /changed before submission/);
    assert.equal((await f.service.isExplanationCompleteForCurrentReview(f.agent.id)).complete, false);
    const next = await f.service.review(f.agent.id); assert.notEqual(next.version, review.version); assert.equal(next.outdated, true); assert.deepEqual(next.previousExplanation?.answers, answers); const afterRestart = new LocalLearningStore(f.store.directory); await afterRestart.init(); assert.equal((await afterRestart.getExplanation(f.agent.id, review.version))?.status, 'completed');
    assert.throws(() => f.service.file(f.agent.id, review.version, review.files[0].id), /version changed/);
    assert.throws(() => f.service.file(f.agent.id, next.version, '../outside'), /does not belong/);
    await f.service.save(f.agent.id, { version: next.version, answers, intent: 'draft' }); assert.equal((await f.service.review(f.agent.id)).explanation?.status, 'draft');
    await assert.rejects(f.service.save(f.agent.id, { version: next.version, answers: { ...answers, solution: 'x'.repeat(6001) }, intent: 'draft' }), /6,000/);
  } finally { await f.cleanup(); }
});
test('binary, oversized and symlink content is explicit, versioned in full, and blocks completion', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'outside-secret'), 'MUST NOT READ'); await symlink(path.join(f.root, 'outside-secret'), path.join(f.work, 'link'));
    await mkdir(path.join(f.root, 'outside-dir')); await writeFile(path.join(f.root, 'outside-dir', 'inside.txt'), 'EXTERNAL CONTENT MUST NOT BE READ');
    await rm(path.join(f.work, 'nested'), { recursive: true }); await symlink(path.join(f.root, 'outside-dir'), path.join(f.work, 'nested'));
    await rm(path.join(f.work, 'modify.txt')); await symlink(path.join(f.root, 'outside-secret'), path.join(f.work, 'modify.txt'));
    await writeFile(path.join(f.work, 'binary'), Buffer.from([0, 1, 2])); await writeFile(path.join(f.work, 'large'), 'a'.repeat(FILE_LIMIT + 10));
    const review = await f.service.review(f.agent.id); assert.equal(review.canComplete, false); assert.equal(review.files.find(x => x.path === 'link')?.unsupported, true); assert.equal(review.files.find(x => x.path === 'binary')?.unsupported, true); assert.equal(review.files.find(x => x.path === 'large')?.limited, true);
    assert.throws(() => f.service.file(f.agent.id, review.version, review.files.find(x => x.path === 'link')!.id), /Symlink/);
    assert.equal(review.files.find(x => x.path === 'modify.txt')?.status, 'type-changed');
    const nested = review.files.find(x => x.path === 'nested/inside.txt')!; assert.equal(nested.status, 'deleted'); assert.equal(f.service.file(f.agent.id, review.version, nested.id).before, 'safe base content\n'); assert.equal(f.service.file(f.agent.id, review.version, nested.id).after, '');
    await assert.rejects(f.service.save(f.agent.id, { version: review.version, answers, intent: 'complete' }), /unsupported/);
    await writeFile(path.join(f.work, 'large'), 'a'.repeat(FILE_LIMIT + 9) + 'z'); assert.notEqual((await f.service.review(f.agent.id, true)).version, review.version);
    assert.equal(await readFile(path.join(f.root, 'outside-secret'), 'utf8'), 'MUST NOT READ');
  } finally { await f.cleanup(); }
});
test('running, missing worktree, missing base, empty review and failed persistence return useful errors', async () => {
  const f = await fixture();
  try {
    f.agent.status = 'running'; await assert.rejects(f.service.review(f.agent.id), /still running/); f.agent.status = 'failed';
    const empty = await f.service.review(f.agent.id); assert.equal(empty.files.length, 0); assert.equal(empty.canComplete, false);
    const base = f.agent.startCommit; f.agent.startCommit = '0'.repeat(40); await assert.rejects(f.service.review(f.agent.id, true), /base commit is unavailable/); f.agent.startCommit = base;
    await writeFile(path.join(f.work, 'modify.txt'), 'new'); const review = await f.service.review(f.agent.id, true);
    await rm(path.join(f.store.directory, 'learning-records.json')); await mkdir(path.join(f.store.directory, 'learning-records.json')); await assert.rejects(f.service.save(f.agent.id, { version: review.version, answers, intent: 'draft' }));
    await rm(f.work, { recursive: true }); await assert.rejects(f.service.review(f.agent.id, true), /worktree is missing/);
  } finally { await f.cleanup(); }
});
