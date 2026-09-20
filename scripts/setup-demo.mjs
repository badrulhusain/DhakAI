import { mkdir, cp, access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = `${root}.runtime/demo-repo`;
const sample = `${root}samples/demo`;
const completedTask = `export function createTask(title) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new TypeError('Task title must not be empty.');
  }
  return { title };
}
`;
const completedTest = `import assert from 'node:assert/strict';
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
try {
  await access(`${target}/.git`);
  const status = execFileSync('git', ['-C', target, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  if (status) { console.warn('Demo repository has uncommitted changes. Services will start, but Demo launch stays protected by the repository cleanliness check.'); process.exit(0); }
  const files = ['package.json', 'task.js', 'task.test.js'];
  const [actualFiles, expectedFiles] = await Promise.all([
    Promise.all(files.map(file => readFile(`${target}/${file}`, 'utf8').catch(() => ''))),
    Promise.all(files.map(file => readFile(`${sample}/${file}`, 'utf8'))),
  ]);
  const matches = actualFiles.map((actual, index) => actual === expectedFiles[index]);
  if (matches.every(Boolean)) { console.log(`Demo repository ready: ${target}`); process.exit(0); }
  const managedFilesExist = await Promise.all(files.map(file => access(`${target}/${file}`).then(() => true).catch(() => false)));
  const isCompletedDemo = actualFiles[0] === expectedFiles[0] && actualFiles[1] === completedTask && actualFiles[2] === completedTest;
  if (managedFilesExist.some(Boolean) && !isCompletedDemo) { console.warn('Demo sample differs from the bundled baseline. Services will start without overwriting it; use npm run demo:reset when you want a fresh Demo run.'); process.exit(0); }
  await cp(sample, target, { recursive: true });
  execFileSync('git', ['-C', target, 'add', '--', ...files]);
  execFileSync('git', ['-C', target, '-c', 'user.name=Agent Classroom', '-c', 'user.email=demo@localhost', 'commit', '-m', isCompletedDemo ? 'Reset classroom demo sample' : 'Add current classroom demo sample']);
  console.log(`${isCompletedDemo ? 'Reset completed' : 'Updated older'} demo repository safely: ${target}`);
  process.exit(0);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await mkdir(target, { recursive: true });
await cp(sample, target, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', target, ...args]);
git('init', '-b', 'main'); git('add', '.');
git('-c', 'user.name=Agent Classroom', '-c', 'user.email=demo@localhost', 'commit', '-m', 'Initialize classroom demo');
console.log(`Demo repository ready: ${target}`);
