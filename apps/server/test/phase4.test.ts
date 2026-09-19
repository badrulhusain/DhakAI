import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRecord, DrawingCompleteInput, DrawingSaveInput } from '@classroom/shared';
import { createWorktree, git } from '../src/git.js';
import { LocalLearningStore } from '../src/learning-store.js';
import { ReviewService } from '../src/review-service.js';
import { DemoQuizProvider, QuizService } from '../src/quiz-service.js';
import { MergeService } from '../src/merge-service.js';
import { DrawingService } from '../src/drawing-service.js';
import { RewardService } from '../src/reward-service.js';

const explanation = { problem: 'The greeting was missing clear friendly punctuation after the supplied name.', solution: 'The return template now appends an exclamation mark after interpolating the name.', edgeCase: 'Test an empty string and a Unicode name to verify interpolation and punctuation.' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+XwL7WQAAAABJRU5ErkJggg==';
const pathData = [{ paths: [{ x: 10, y: 10 }, { x: 40, y: 50 }], strokeWidth: 4, strokeColor: '#172554', drawMode: true }];

class FailingPreviewStore extends LocalLearningStore {
  failPreview = true;
  override async saveDrawingPreview(record: Parameters<LocalLearningStore['saveDrawingPreview']>[0], bytes: Uint8Array) { if (this.failPreview) throw new Error('preview disk unavailable'); return super.saveDrawingPreview(record, bytes); }
}

async function fixture(reviewerMode = false, Store = LocalLearningStore) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classroom-phase4-')); const repo = path.join(root, 'repo'); await mkdir(repo);
  await git(repo, 'init', '-b', 'main'); await writeFile(path.join(repo, 'greet.js'), 'export const greet = name => `Hello, ${name}`;\n'); await git(repo, 'add', '.'); await git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'base');
  const worktree = await createWorktree(repo, path.join(root, 'worktrees'), randomUUID());
  const agent: AgentRecord = { id: randomUUID(), name: 'Agent drawing', runner: 'demo', task: 'Improve greeting', status: 'completed', createdAt: new Date().toISOString(), endedAt: new Date().toISOString(), branch: worktree.branch, baseBranch: worktree.baseBranch, startCommit: worktree.startCommit, worktree: worktree.worktree };
  const store = new Store(path.join(root, 'data')); await store.init(); await store.saveRun(agent); await writeFile(path.join(worktree.worktree, 'greet.js'), 'export const greet = name => `Hello, ${name}!`;\n');
  const find = (id: string) => { if (id !== agent.id) throw new Error('Agent not found'); return agent; };
  const reviews = new ReviewService(find, store); const review = await reviews.review(agent.id); await reviews.save(agent.id, { version: review.version, answers: explanation, intent: 'complete' });
  const quizzes = new QuizService(find, reviews, store, new DemoQuizProvider()); const drawings = new DrawingService(find, reviews, quizzes, store, reviewerMode); const rewards = new RewardService(store); const merges = new MergeService(find, reviews, quizzes, store, { repository: repo, worktreeRoot: path.join(root, 'worktrees') });
  return { root, repo, agent, store, reviews, review, quizzes, drawings, rewards, merges, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function passQuiz(f: Awaited<ReturnType<typeof fixture>>, wrongFirst = false) { const quiz = await f.quizzes.generate(f.agent.id); if (wrongFirst) await f.quizzes.submit(f.agent.id, { version: quiz.version, quizId: quiz.id, submissionId: randomUUID(), answers: quiz.questions.map(question => ({ questionId: question.id, optionId: 'b' })) }); return f.quizzes.submit(f.agent.id, { version: quiz.version, quizId: quiz.id, submissionId: randomUUID(), answers: quiz.questions.map(question => ({ questionId: question.id, optionId: 'a' })) }); }
function draft(version: string, revision = 0): DrawingSaveInput { return { version, revision, title: 'Greeting control flow', caption: 'The input name reaches the greeting result, including the empty-name edge case.', guide: 'input-condition-result', paths: pathData }; }
function completion(version: string, revision: number, idempotencyKey = randomUUID()): DrawingCompleteInput { return { ...draft(version, revision), checklist: { input: true, condition: true, result: true, edgeCase: true }, previewDataUrl: png, idempotencyKey }; }

test('drawing drafts restore and optimistic revisions prevent silent overwrites', async () => { const f = await fixture(); try {
  const [saved, conflict] = await Promise.allSettled([f.drawings.save(f.agent.id, draft(f.review.version)), f.drawings.save(f.agent.id, draft(f.review.version))]);
  assert.equal([saved, conflict].filter(item => item.status === 'fulfilled').length, 1); const rejected = [saved, conflict].find(item => item.status === 'rejected') as PromiseRejectedResult; assert.equal(rejected.reason.code, 'DRAWING_SAVE_CONFLICT');
  const restored = await f.drawings.get(f.agent.id, f.review.version); assert.equal(restored.drawing?.title, 'Greeting control flow'); assert.deepEqual(restored.drawing?.paths, pathData); assert.equal(restored.drawing?.revision, 1);
} finally { await f.cleanup(); } });

test('completion requires a current quiz pass, actual strokes, title, caption, and checklist', async () => { const f = await fixture(); try {
  const saved = await f.drawings.save(f.agent.id, draft(f.review.version)); await assert.rejects(f.drawings.complete(f.agent.id, completion(f.review.version, saved.revision)), error => (error as { code?: string }).code === 'QUIZ_PASS_REQUIRED'); await passQuiz(f);
  await assert.rejects(f.drawings.complete(f.agent.id, { ...completion(f.review.version, saved.revision), paths: [] }), error => (error as { code?: string }).code === 'DRAWING_INCOMPLETE');
  await assert.rejects(f.drawings.complete(f.agent.id, { ...completion(f.review.version, saved.revision), caption: 'too short' }), error => (error as { code?: string }).code === 'DRAWING_INCOMPLETE');
  await assert.rejects(f.drawings.complete(f.agent.id, { ...completion(f.review.version, saved.revision), checklist: { input: true, condition: true, result: true, edgeCase: false } }), error => (error as { code?: string }).code === 'DRAWING_INCOMPLETE');
  await assert.rejects(f.drawings.complete(f.agent.id, { ...completion(f.review.version, saved.revision), previewDataUrl: 'data:image/png;base64,bm90LXBuZw==' }), error => (error as { code?: string }).code === 'INVALID_DRAWING_DATA');
} finally { await f.cleanup(); } });

test('completion, preview, points, and badges are durable and idempotent', async () => { const f = await fixture(); try {
  await passQuiz(f); const saved = await f.drawings.save(f.agent.id, draft(f.review.version)); const key = randomUUID(); const complete = await f.drawings.complete(f.agent.id, completion(f.review.version, saved.revision, key)); const duplicate = await f.drawings.complete(f.agent.id, completion(f.review.version, saved.revision, key)); assert.equal(duplicate.id, complete.id); assert.equal(duplicate.revision, complete.revision);
  const preview = await f.drawings.preview(f.agent.id, f.review.version); assert.deepEqual(Array.from(preview.subarray(0, 8)), [137,80,78,71,13,10,26,10]); assert.match(complete.storageObjectPath ?? '', new RegExp(`^${f.agent.id}/${f.review.version}/`));
  await Promise.all([f.rewards.sync(f.agent.id, f.review.version), f.rewards.sync(f.agent.id, f.review.version), f.rewards.sync(f.agent.id, f.review.version)]); const score = await f.rewards.score(f.agent.id, f.review.version); assert.equal(score.total, 90); assert.equal(score.transactions.reduce((sum, item) => sum + item.points, 0), score.total); assert.equal(new Set(score.transactions.map(item => item.event)).size, score.transactions.length); assert.ok(score.badges.some(item => item.badge === 'visual_thinker')); assert.ok(score.badges.some(item => item.badge === 'quiz_master'));
  assert.equal((await readFile(path.join(f.root, 'data', 'drawings', f.agent.id, f.review.version, `${complete.id}.png`))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
} finally { await f.cleanup(); } });

test('preview failure preserves the editable revision and can be retried without points', async () => { const f = await fixture(false, FailingPreviewStore); try {
  await passQuiz(f); const saved = await f.drawings.save(f.agent.id, draft(f.review.version)); const key = randomUUID(); let preservedRevision = 0;
  await assert.rejects(f.drawings.complete(f.agent.id, completion(f.review.version, saved.revision, key)), error => { const problem = error as { code?: string; details?: { revision: number } }; preservedRevision = problem.details?.revision ?? 0; return problem.code === 'DRAWING_UPLOAD_FAILED' && preservedRevision === 2; });
  assert.equal((await f.store.getDrawing(f.agent.id, f.review.version))?.status, 'draft'); const before = await f.rewards.score(f.agent.id, f.review.version); assert.equal(before.drawingCompletion.earned, 0);
  (f.store as FailingPreviewStore).failPreview = false; const completed = await f.drawings.complete(f.agent.id, completion(f.review.version, preservedRevision, key)); assert.equal(completed.status, 'completed'); await f.rewards.sync(f.agent.id, f.review.version); assert.equal((await f.rewards.score(f.agent.id, f.review.version)).drawingCompletion.earned, 10);
} finally { await f.cleanup(); } });

test('changed code preserves a stale drawing and requires a new version', async () => { const f = await fixture(); try {
  await passQuiz(f); const saved = await f.drawings.save(f.agent.id, draft(f.review.version)); await f.drawings.complete(f.agent.id, completion(f.review.version, saved.revision)); await writeFile(path.join(f.agent.worktree!, 'greet.js'), 'export const greet = name => `Welcome, ${name}!`;\n'); const next = await f.reviews.review(f.agent.id, true);
  await assert.rejects(f.drawings.save(f.agent.id, draft(f.review.version)), error => (error as { code?: string }).code === 'REVIEW_OUTDATED'); const state = await f.drawings.get(f.agent.id, next.version); assert.equal(state.drawing, null); assert.equal(state.previousDrawing?.reviewVersion, f.review.version);
} finally { await f.cleanup(); } });

test('reviewer marks are disabled by default, validated server-side, and separate from points', async () => { const disabled = await fixture(); try { await passQuiz(disabled); const saved = await disabled.drawings.save(disabled.agent.id, draft(disabled.review.version)); const drawing = await disabled.drawings.complete(disabled.agent.id, completion(disabled.review.version, saved.revision)); await assert.rejects(disabled.drawings.mark(disabled.agent.id, { version: disabled.review.version, drawingId: drawing.id, criteria: { relationship: 5, flow: 4, condition: 4, edgeCase: 3 }, feedback: '', idempotencyKey: randomUUID() }), error => (error as { code?: string }).code === 'REVIEWER_MODE_DISABLED'); } finally { await disabled.cleanup(); }
  const enabled = await fixture(true); try { await passQuiz(enabled, true); const saved = await enabled.drawings.save(enabled.agent.id, draft(enabled.review.version)); const drawing = await enabled.drawings.complete(enabled.agent.id, completion(enabled.review.version, saved.revision)); await assert.rejects(enabled.drawings.mark(enabled.agent.id, { version: enabled.review.version, drawingId: drawing.id, criteria: { relationship: 6, flow: 4, condition: 4, edgeCase: 3 }, feedback: '', idempotencyKey: randomUUID() }), error => (error as { code?: string }).code === 'INVALID_RUBRIC_SCORE'); const mark = await enabled.drawings.mark(enabled.agent.id, { version: enabled.review.version, drawingId: drawing.id, criteria: { relationship: 5, flow: 4, condition: 4, edgeCase: 3 }, feedback: 'Clear flow.', idempotencyKey: randomUUID() }); assert.equal(mark.total, 16); const score = await enabled.rewards.score(enabled.agent.id, enabled.review.version); assert.equal(score.total, 80); assert.equal(score.remaining, 10); assert.equal(score.reviewerMark?.total, 16); } finally { await enabled.cleanup(); } });

test('drawing is optional for merge and drawing points cannot replace quiz or Git gates', async () => { const f = await fixture(); try {
  const draftRecord = await f.drawings.save(f.agent.id, draft(f.review.version)); assert.equal((await f.merges.eligibility(f.agent.id)).eligible, false); await assert.rejects(f.drawings.complete(f.agent.id, completion(f.review.version, draftRecord.revision)), error => (error as { code?: string }).code === 'QUIZ_PASS_REQUIRED'); await passQuiz(f); assert.equal((await f.merges.eligibility(f.agent.id)).eligible, true); const merged = await f.merges.merge(f.agent.id); assert.equal(merged.status, 'succeeded'); await f.rewards.sync(f.agent.id, f.review.version); const score = await f.rewards.score(f.agent.id, f.review.version); assert.equal(score.total, 90); assert.equal(score.remaining, 10); assert.equal(score.drawingCompletion.earned, 0); assert.ok(score.badges.some(item => item.badge === 'safe_merger'));
} finally { await f.cleanup(); } });
