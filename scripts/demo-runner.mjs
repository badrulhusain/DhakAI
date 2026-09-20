import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
console.log('\x1b[36mAgent Classroom · scripted demo\x1b[0m');
console.log('Demo mode · no network, Codex, Groq, or Supabase required.');
console.log('Task: Add validation that rejects empty task titles and add a test for whitespace-only input.');
await pause(500);
console.log('01  Inspecting task.js and task.test.js in this isolated worktree…');
const before = await readFile('task.js', 'utf8');
const beforeTest = await readFile('task.test.js', 'utf8');
if (!before.includes('return { title };') || !beforeTest.includes('creates a task with its title')) throw new Error('The bundled demo repository does not match its expected starting state. Run npm run demo:reset.');
await pause(500);
console.log('02  Plan: reject non-string, empty, and whitespace-only titles, then prove the boundary with a test.');
const reader = createInterface({ input: process.stdin, output: process.stdout });
await new Promise(resolve => reader.question('Press Enter to apply the reviewed plan › ', resolve));
reader.close();
await writeFile('task.js', `export function createTask(title) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new TypeError('Task title must not be empty.');
  }
  return { title };
}
`);
await writeFile('task.test.js', `${beforeTest.trimEnd()}

test('rejects a whitespace-only title', () => {
  assert.throws(() => createTask('   '), {
    name: 'TypeError',
    message: 'Task title must not be empty.',
  });
});
`);
console.log('\r\n03  Added title validation and a whitespace-only regression test.');
await pause(400);
console.log('04  Running the sample repository tests…');
const exitCode = await new Promise(resolve => {
  const child = spawn(process.execPath, ['--test'], { cwd: process.cwd(), stdio: 'inherit' });
  child.once('exit', code => resolve(code ?? 1));
});
if (exitCode !== 0) throw new Error(`Demo tests failed with exit code ${exitCode}.`);
console.log('05  Tests pass. The base checkout is still unchanged.');
await pause(500);
console.log('\x1b[32m✓ Demo complete. Review the exact code and test diff next.\x1b[0m');
