import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.runtime');
const demoRepo = path.join(runtime, 'demo-repo');
const worktreeRoot = path.join(runtime, 'worktrees');
const dataRoot = path.join(runtime, 'data');
const serviceFile = path.join(runtime, 'services.json');
const recordsFile = path.join(dataRoot, 'learning-records.json');
const exactChildren = child => path.dirname(child) === runtime || path.dirname(child) === root;
const exists = target => access(target).then(() => true).catch(() => false);
const git = async (repo, ...args) => (await exec('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
const expectedTask = `export function createTask(title) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new TypeError('Task title must not be empty.');
  }
  return { title };
}
`;
const expectedTest = `import assert from 'node:assert/strict';
import test from 'node:test';
import { createTask } from './task.js';

test('creates a task with its title', () => {
  assert.deepEqual(createTask('Review the diff'), { title: 'Review the diff' });
});

test('rejects a whitespace-only title', () => {
  assert.throws(() => createTask('   '), {
    name: 'TypeError',
    message: 'Task title must not be empty.',
  });
});
`;

if (await exists(serviceFile)) {
  console.error('Demo reset stopped: a project service registry exists. Run npm run stop first so no managed agent can be active.');
  process.exit(1);
}

const state = await readFile(recordsFile, 'utf8').then(JSON.parse).catch(() => null);
const demoIds = new Set(Object.values(state?.runs ?? {}).filter(record => record?.runner === 'demo').map(record => record.id));
let preserved = false;
let preservedWorktree = false;
if (await exists(path.join(demoRepo, '.git'))) {
  const canonicalDemo = await realpath(demoRepo);
  if (canonicalDemo !== demoRepo) throw new Error('Refusing reset because the demo repository resolves outside its exact managed path.');
  const porcelain = (await git(demoRepo, 'worktree', 'list', '--porcelain')).split('\n\n').filter(Boolean);
  for (const block of porcelain) {
    const location = block.match(/^worktree (.+)$/m)?.[1];
    const branchRef = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    if (!location || location === demoRepo || !branchRef?.startsWith('classroom/agent-')) continue;
    const agentId = branchRef.slice('classroom/agent-'.length);
    if (!demoIds.has(agentId)) { console.warn(`Preserved worktree without a matching local Demo record: ${location}`); preserved = preservedWorktree = true; continue; }
    const canonical = await realpath(location).catch(() => '');
    if (!canonical || path.dirname(canonical) !== worktreeRoot || path.basename(canonical) !== `agent-${agentId}`) { console.warn(`Preserved unrecognized worktree: ${location}`); preserved = preservedWorktree = true; continue; }
    const status = await git(canonical, 'status', '--porcelain', '--untracked-files=all');
    const allowed = new Set([' M task.js', ' M task.test.js']);
    if (status && status.split('\n').some(line => !allowed.has(line))) { console.warn(`Preserved demo worktree with unexpected changes: ${canonical}`); preserved = preservedWorktree = true; continue; }
    if (status && (await readFile(path.join(canonical, 'task.js'), 'utf8').catch(() => '')) !== expectedTask) { console.warn(`Preserved demo worktree whose task.js differs from the deterministic demo output: ${canonical}`); preserved = preservedWorktree = true; continue; }
    if (status && (await readFile(path.join(canonical, 'task.test.js'), 'utf8').catch(() => '')) !== expectedTest) { console.warn(`Preserved demo worktree whose task.test.js differs from the deterministic demo output: ${canonical}`); preserved = preservedWorktree = true; continue; }
    await git(demoRepo, 'worktree', 'remove', '--force', canonical);
    await git(demoRepo, 'branch', '-D', branchRef).catch(() => '');
    console.log(`Removed verified demo worktree: ${path.basename(canonical)}`);
  }
  const baseStatus = await git(demoRepo, 'status', '--porcelain', '--untracked-files=all');
  if (baseStatus || preservedWorktree) { console.warn('Preserved the demo repository because its base checkout or a linked worktree must be kept.'); preserved = true; }
  else { await rm(demoRepo, { recursive: true }); console.log('Removed generated demo repository.'); }
}

if (state && await exists(recordsFile)) {
  const belongs = record => record && demoIds.has(record.agentId);
  for (const name of ['reviews', 'explanations', 'quizzes', 'attempts', 'merges', 'drawings', 'checklists', 'reviewerMarks', 'points', 'badges']) {
    state[name] = Object.fromEntries(Object.entries(state[name] ?? {}).filter(([, record]) => !belongs(record)));
  }
  state.runs = Object.fromEntries(Object.entries(state.runs ?? {}).filter(([id]) => !demoIds.has(id)));
  await writeFile(recordsFile, JSON.stringify(state), { mode: 0o600 });
  for (const id of demoIds) {
    const drawings = path.join(dataRoot, 'drawings', id);
    if (path.dirname(drawings) === path.join(dataRoot, 'drawings')) await rm(drawings, { recursive: true, force: true });
  }
  console.log(`Removed ${demoIds.size} bundled-demo learning record(s); live Supabase was not touched.`);
}

for (const target of [path.join(root, 'test-results'), path.join(root, 'playwright-report')]) {
  if (exactChildren(target)) await rm(target, { recursive: true, force: true });
}
for (const target of [serviceFile, `${serviceFile}.lock`]) if (path.dirname(target) === runtime) await rm(target, { force: true });
console.log(preserved ? 'Demo reset completed with preserved resources listed above.' : 'Demo reset completed safely. Run npm run demo:setup to recreate the sample.');
