import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRecord, MergeOperation, QuizQuestionPrivate } from '@classroom/shared';
import { createWorktree, git } from '../src/git.js';
import { LocalLearningStore } from '../src/learning-store.js';
import { ReviewService } from '../src/review-service.js';
import { DemoQuizProvider, QuizService, diagramJsonSchema, type QuizProvider } from '../src/quiz-service.js';
import { MergeService } from '../src/merge-service.js';
import { AgentManager } from '../src/agent-manager.js';

const explanation = { problem: 'The greeting was missing clear friendly punctuation after the supplied name.', solution: 'The return template now appends an exclamation mark after interpolating the name.', edgeCase: 'Test an empty string and a Unicode name to verify interpolation and punctuation.' };

test('strict diagram schema requires every declared edge property', () => {
  assert.deepEqual(diagramJsonSchema.properties.edges.items.required, ['from', 'to', 'label']);
});

class FailingMergeStore extends LocalLearningStore {
  failSucceeded = false;
  override async saveMerge(record: MergeOperation) { if (this.failSucceeded && record.status === 'succeeded') throw new Error('database offline'); return super.saveMerge(record); }
}

async function fixture(Store = LocalLearningStore) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classroom-phase3-')); const repo = path.join(root, 'repo'); await mkdir(repo);
  await git(repo, 'init', '-b', 'main'); await writeFile(path.join(repo, 'greet.js'), 'export const greet = name => `Hello, ${name}`;\n'); await writeFile(path.join(repo, 'keep.txt'), 'unchanged\n'); await git(repo, 'add', '.'); await git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'base');
  const worktree = await createWorktree(repo, path.join(root, 'worktrees'), randomUUID());
  const agent: AgentRecord = { id: randomUUID(), name: 'Agent test', runner: 'demo', task: 'Make the greeting friendly', status: 'completed', createdAt: new Date().toISOString(), endedAt: new Date().toISOString(), branch: worktree.branch, baseBranch: worktree.baseBranch, startCommit: worktree.startCommit, worktree: worktree.worktree };
  const store = new Store(path.join(root, 'data')); await store.init(); await store.saveRun(agent);
  const reviews = new ReviewService(() => agent, store); await writeFile(path.join(worktree.worktree, 'greet.js'), 'export const greet = name => `Hello, ${name}!`;\n');
  const review = await reviews.review(agent.id); await reviews.save(agent.id, { version: review.version, answers: explanation, intent: 'complete' });
  const quizzes = new QuizService(() => agent, reviews, store, new DemoQuizProvider()); const merges = new MergeService(() => agent, reviews, quizzes, store, { repository: repo, worktreeRoot: path.join(root, 'worktrees') });
  return { root, repo, agent, store, reviews, quizzes, merges, review, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function passQuiz(f: Awaited<ReturnType<typeof fixture>>) {
  const quiz = await f.quizzes.generate(f.agent.id); const submissionId = randomUUID();
  const attempt = await f.quizzes.submit(f.agent.id, { version: quiz.version, quizId: quiz.id, submissionId, answers: quiz.questions.map(question => ({ questionId: question.id, optionId: 'a' })) });
  return { quiz, attempt, submissionId };
}

test('restored run metadata keeps history and marks abandoned PTYs interrupted', async () => {
  const persisted: AgentRecord[] = [];
  const manager = new AgentManager({ repo: '/unused', demoRepo: '/unused', demoScript: '/unused', worktreeRoot: '/unused', codexExecutable: '/unused' }, undefined, async record => { persisted.push(record); });
  const running: AgentRecord = { id: randomUUID(), name: 'Agent restored', runner: 'demo', task: 'Retain this run', status: 'running', createdAt: new Date().toISOString(), worktree: '/retained/worktree' };
  manager.restore([running]); await manager.shutdown();
  const restored = manager.get(running.id);
  assert.equal(restored.record.status, 'interrupted');
  assert.match(restored.record.error ?? '', /PTY is no longer connected/);
  assert.match(restored.output, /Session restored/);
  assert.equal(persisted.at(-1)?.status, 'interrupted');
});

test('local storage imports Phase 2 explanation files without replacing them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classroom-phase2-import-'));
  try {
    const agentId = 'legacy-agent'; const version = 'a'.repeat(64); const legacyDirectory = path.join(root, 'explanations', agentId); await mkdir(legacyDirectory, { recursive: true });
    const record = { agentId, version, answers: explanation, status: 'completed' as const, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    await writeFile(path.join(legacyDirectory, `${version}.json`), JSON.stringify(record));
    const store = new LocalLearningStore(root); await store.init();
    assert.deepEqual(await store.getExplanation(agentId, version), record);
    assert.deepEqual(JSON.parse(await readFile(path.join(legacyDirectory, `${version}.json`), 'utf8')), record);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('quiz hides answer keys, grades on server, retries, passes, caches, and deduplicates submissions', async () => {
  const f = await fixture();
  try {
    const quiz = await f.quizzes.generate(f.agent.id); assert.equal(quiz.label, 'Demo quiz'); assert.equal(quiz.questions.length, 3);
    assert.equal(JSON.stringify(quiz).includes('correctOptionId'), false); assert.equal(JSON.stringify(quiz).includes('The returned greeting now'), false);
    const diagram = await f.quizzes.generateDiagram(f.agent.id); assert.equal(diagram.title, 'Task title validation flow'); assert.ok(diagram.nodes.some(node => node.kind === 'decision')); assert.ok(diagram.edges.some(edge => edge.label === 'Yes'));
    assert.equal((await f.quizzes.generate(f.agent.id)).id, quiz.id);
    const submissionId = randomUUID(); const wrong = await f.quizzes.submit(f.agent.id, { version: quiz.version, quizId: quiz.id, submissionId, answers: quiz.questions.map(question => ({ questionId: question.id, optionId: 'b' })) });
    assert.equal(wrong.score, 0); assert.equal(wrong.passed, false); assert.equal(wrong.feedback.length, 3); assert.equal((await f.quizzes.submit(f.agent.id, { version: quiz.version, quizId: quiz.id, submissionId, answers: quiz.questions.map(question => ({ questionId: question.id, optionId: 'b' })) })).id, wrong.id); assert.equal((await f.store.listAttempts(f.agent.id, quiz.version)).length, 1);
    const passed = await f.quizzes.submit(f.agent.id, { version: quiz.version, quizId: quiz.id, submissionId: randomUUID(), answers: quiz.questions.map(question => ({ questionId: question.id, optionId: 'a' })) }); assert.equal(passed.score, 3); assert.equal(passed.passed, true); assert.equal((await f.quizzes.get(f.agent.id))?.passed, true);
    await writeFile(path.join(f.agent.worktree!, 'greet.js'), 'export const greet = name => `Welcome, ${name}!`;\n');
    await assert.rejects(f.quizzes.submit(f.agent.id, { version: quiz.version, quizId: quiz.id, submissionId: randomUUID(), answers: quiz.questions.map(question => ({ questionId: question.id, optionId: 'a' })) }), /Code changed|does not belong/);
    assert.equal(await f.quizzes.hasPassed(f.agent.id, (await f.reviews.currentSnapshot(f.agent.id)).version), false);
  } finally { await f.cleanup(); }
});

test('malformed questions, bad evidence, provider errors, and secret paths fail clearly', async () => {
  const f = await fixture();
  try {
    const malformed: QuizProvider = { kind: 'groq', model: 'mock', async generate() { return [] as QuizQuestionPrivate[]; } };
    const service = new QuizService(() => ({ ...f.agent, runner: 'codex' }), f.reviews, f.store, new DemoQuizProvider(), malformed);
    await assert.rejects(service.generate(f.agent.id), /invalid quiz/);
    const failing: QuizProvider = { kind: 'groq', model: 'mock', async generate() { throw new Error('rate limited'); } };
    await assert.rejects(new QuizService(() => ({ ...f.agent, runner: 'codex' }), f.reviews, f.store, new DemoQuizProvider(), failing).generate(f.agent.id), /rate limited/);
    await writeFile(path.join(f.agent.worktree!, '.env'), 'API_KEY=not-uploaded\n'); const changed = await f.reviews.review(f.agent.id, true); await f.reviews.save(f.agent.id, { version: changed.version, answers: explanation, intent: 'complete' });
    await assert.rejects(new QuizService(() => ({ ...f.agent, runner: 'codex' }), f.reviews, f.store, new DemoQuizProvider(), malformed).generate(f.agent.id), /credentials or secrets/);
  } finally { await f.cleanup(); }
});

test('merge gate blocks direct calls, then merges exactly the reviewed snapshot and is concurrent/idempotent', async () => {
  const f = await fixture();
  try {
    const before = await git(f.repo, 'rev-parse', 'HEAD'); const blocked = await f.merges.eligibility(f.agent.id); assert.equal(blocked.eligible, false); assert.ok(blocked.blockers.some(item => item.code === 'QUIZ_NOT_PASSED')); await assert.rejects(f.merges.merge(f.agent.id), /Pass the current|3\/3/); assert.equal(await git(f.repo, 'rev-parse', 'HEAD'), before);
    await passQuiz(f); const ready = await f.merges.eligibility(f.agent.id); assert.equal(ready.eligible, true);
    const [one, two] = await Promise.all([f.merges.merge(f.agent.id), f.merges.merge(f.agent.id)]); assert.equal(one.resultCommit, two.resultCommit); assert.equal(await git(f.repo, 'rev-parse', 'HEAD'), one.resultCommit); assert.equal(await readFile(path.join(f.repo, 'greet.js'), 'utf8'), 'export const greet = name => `Hello, ${name}!`;\n'); assert.equal(await readFile(path.join(f.repo, 'keep.txt'), 'utf8'), 'unchanged\n'); assert.equal(await git(f.repo, 'status', '--porcelain'), ''); assert.equal(await readFile(path.join(f.agent.worktree!, 'greet.js'), 'utf8'), 'export const greet = name => `Hello, ${name}!`;\n'); assert.equal((await f.merges.merge(f.agent.id)).resultCommit, one.resultCommit);
    const message = await git(f.repo, 'show', '-s', '--format=%B', one.resultCommit!); assert.match(message, new RegExp(`Agent-Classroom-Agent: ${f.agent.id}`)); assert.match(message, new RegExp(`Review-Version: ${f.review.version}`));
  } finally { await f.cleanup(); }
});

test('dirty, stale, and in-progress base states reject without mutation', async () => {
  const dirty = await fixture();
  try { await passQuiz(dirty); const head = await git(dirty.repo, 'rev-parse', 'HEAD'); await writeFile(path.join(dirty.repo, 'local.txt'), 'preserve me'); await assert.rejects(dirty.merges.merge(dirty.agent.id), /tracked or untracked/); assert.equal(await git(dirty.repo, 'rev-parse', 'HEAD'), head); assert.equal(await readFile(path.join(dirty.repo, 'local.txt'), 'utf8'), 'preserve me'); } finally { await dirty.cleanup(); }
  const stale = await fixture();
  try { await passQuiz(stale); await writeFile(path.join(stale.repo, 'base.txt'), 'base moved'); await git(stale.repo, 'add', 'base.txt'); await git(stale.repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'move base'); const moved = await git(stale.repo, 'rev-parse', 'HEAD'); await assert.rejects(stale.merges.merge(stale.agent.id), /base branch or commit moved|Base must remain/); assert.equal(await git(stale.repo, 'rev-parse', 'HEAD'), moved); } finally { await stale.cleanup(); }
  const conflict = await fixture();
  try { await passQuiz(conflict); const head = await git(conflict.repo, 'rev-parse', 'HEAD'); await writeFile(path.join(conflict.repo, '.git', 'MERGE_HEAD'), conflict.agent.startCommit! + '\n'); const state = await conflict.merges.eligibility(conflict.agent.id); assert.ok(state.blockers.some(item => item.code === 'MERGE_CONFLICT')); await assert.rejects(conflict.merges.merge(conflict.agent.id), /Git operation|merge/); assert.equal(await git(conflict.repo, 'rev-parse', 'HEAD'), head); } finally { await conflict.cleanup(); }
});

test('Git success plus persistence failure reports the commit and reconciles without a duplicate merge', async () => {
  const f = await fixture(FailingMergeStore);
  try {
    const failingStore = f.store as FailingMergeStore;
    await passQuiz(f); failingStore.failSucceeded = true; let resultCommit = '';
    await assert.rejects(f.merges.merge(f.agent.id), error => { resultCommit = (error as { details?: MergeOperation }).details?.resultCommit ?? ''; return (error as { code?: string }).code === 'MERGE_RECORD_PENDING' && !!resultCommit; });
    assert.equal(await git(f.repo, 'rev-parse', 'HEAD'), resultCommit); failingStore.failSucceeded = false;
    const reconciled = await f.merges.merge(f.agent.id); assert.equal(reconciled.resultCommit, resultCommit); assert.equal(await git(f.repo, 'rev-list', '--count', `${f.agent.startCommit}..HEAD`), '1');
  } finally { await f.cleanup(); }
});
