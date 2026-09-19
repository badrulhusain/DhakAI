import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { AgentManager } from '../src/agent-manager.js';
import { createApp } from '../src/server.js';
import { git, inspectRepository } from '../src/git.js';
import { appendOutput, OUTPUT_LIMIT } from '../src/terminal.js';
import { clientMessageSchema } from '@classroom/shared';
const demoScript = fileURLToPath(new URL('../../../scripts/demo-runner.mjs', import.meta.url));
const origin = 'http://127.0.0.1:3000';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classroom-test-')); const repo = path.join(root, 'repo'); await mkdir(repo);
  await git(repo, 'init', '-b', 'main'); await writeFile(path.join(repo, 'greet.js'), 'export function greet(name) { return `Hello, ${name}`; }\n');
  await git(repo, 'add', '.'); await git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial');
  const config = { repo, demoRepo: repo, demoScript, worktreeRoot: path.join(root, 'worktrees'), codexExecutable: '/missing/codex', stopTimeout: 150 };
  return { root, repo, config, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function until(predicate: () => boolean, timeout = 7000) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition'); await new Promise(r => setTimeout(r, 25)); } }
function connect(url: string) { const ws = new WebSocket(url, { origin }); const messages: any[] = []; ws.on('message', data => messages.push(JSON.parse(data.toString()))); return { ws, messages }; }
test('full HTTP / PTY / WebSocket demo, isolation, duplicate rejection, replay, input and natural completion', async () => {
  const f = await fixture(); const manager = new AgentManager(f.config); const app = await createApp(manager, [origin]);
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r)); const port = (app.server.address() as { port: number }).port; const base = `http://127.0.0.1:${port}`;
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  try {
    const health = await fetch(`${base}/health`); assert.equal(health.status, 200); assert.equal((await health.json() as { status: string }).status, 'ok');
    const dependencies = await fetch(`${base}/api/dependencies`, { headers }); assert.equal(dependencies.status, 200); assert.deepEqual(await dependencies.json(), { database: { mode: 'local', available: true, message: 'Local demo storage available' }, quizProvider: { mode: 'unavailable', configured: false, message: 'Groq is not configured. Bundled demo agents still use the Demo quiz.' }, reviewerMode: { enabled: false, label: 'Reviewer mode disabled' } });
    assert.equal((await fetch(`${base}/api/state`)).status, 403);
    assert.equal((await fetch(`${base}/api/state`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/agents`, { method: 'POST', headers, body: JSON.stringify({ runner: 'shell', task: 'x' }) })).status, 400);
    const response = await fetch(`${base}/api/agents`, { method: 'POST', headers, body: JSON.stringify({ runner: 'demo', task: 'Demo greeting' }) });
    assert.equal(response.status, 201); const { agent } = await response.json() as any;
    assert.notEqual(agent.worktree, f.repo); assert.equal(agent.baseBranch, 'main'); assert.equal(await git(agent.worktree, 'branch', '--show-current'), agent.branch);
    const duplicate = await fetch(`${base}/api/agents`, { method: 'POST', headers, body: JSON.stringify({ runner: 'demo', task: 'Second' }) }); assert.equal(duplicate.status, 409);
    assert.equal((await fetch(`${base}/api/agents/${agent.id}/review`, { headers })).status, 409);
    const first = connect(`ws://127.0.0.1:${port}/terminal/${agent.id}`);
    await until(() => first.messages.some(m => m.data?.includes('Press Enter')));
    first.ws.close(); await until(() => first.ws.readyState === WebSocket.CLOSED);
    const second = connect(`ws://127.0.0.1:${port}/terminal/${agent.id}`);
    await until(() => second.messages.some(m => m.type === 'replay' && m.data.includes('Press Enter')));
    second.ws.send(JSON.stringify({ type: 'resize', cols: 0, rows: 9999 })); await until(() => second.messages.some(m => m.type === 'error'));
    second.ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 })); second.ws.send(JSON.stringify({ type: 'input', data: '\r' }));
    await until(() => manager.get(agent.id).record.status === 'completed');
    await until(() => second.messages.some(m => m.type === 'status' && m.agent.status === 'completed'));
    assert.match(await readFile(path.join(agent.worktree, 'greet.js'), 'utf8'), /\$\{name\}!/);
    assert.doesNotMatch(await readFile(path.join(f.repo, 'greet.js'), 'utf8'), /\$\{name\}!/);
    assert.equal(await git(f.repo, 'status', '--porcelain'), ''); assert.equal(await git(f.repo, 'branch', '--show-current'), 'main');
    const reviewResponse = await fetch(`${base}/api/agents/${agent.id}/review`, { headers }); assert.equal(reviewResponse.status, 200);
    const review = await reviewResponse.json() as any; assert.equal(review.files.length, 1);
    const mergeOperation = await fetch(`${base}/api/agents/${agent.id}/merge`, { headers }); assert.equal(mergeOperation.status, 200); assert.deepEqual(await mergeOperation.json(), { operation: null });
    assert.equal((await fetch(`${base}/api/agents/${agent.id}/review/files/${'0'.repeat(64)}?version=${review.version}`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/agents/${agent.id}/explanation`, { method: 'PUT', headers, body: JSON.stringify({ version: review.version, answers: { problem: 'x', solution: 'y', edgeCase: 'z' }, intent: 'complete' }) })).status, 400);
    assert.equal((await fetch(`${base}/api/agents/${agent.id}/explanation`, { method: 'PUT', headers: { ...headers, Origin: 'https://unrelated.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/api/agents/${agent.id}/explanation`, { method: 'PUT', headers, body: JSON.stringify({ data: 'x'.repeat(129 * 1024) }) })).status, 413);
    second.ws.close();
  } finally { await app.close(); await f.cleanup(); }
});
test('stop terminates PTY, updates state, retains worktree and allows another launch', async () => {
  const f = await fixture(); const m = new AgentManager(f.config);
  try { const a = await m.launch({ runner: 'demo', task: 'Stop me' }); await until(() => m.get(a.id).output.includes('Press Enter')); const pid = m.get(a.id).pty!.pid; m.stop(a.id); await until(() => m.get(a.id).record.status === 'stopped'); assert.throws(() => process.kill(pid, 0)); assert.equal(await git(a.worktree!, 'branch', '--show-current'), a.branch); const b = await m.launch({ runner: 'demo', task: 'Again' }); assert.notEqual(a.branch, b.branch); } finally { await m.shutdown(); await f.cleanup(); }
});
test('missing repo, dirty repo, missing executable, detached HEAD and empty repo are useful failures', async () => {
  const f = await fixture();
  try {
    await assert.rejects(inspectRepository(path.join(f.root, 'missing')), /does not exist/);
    const m = new AgentManager(f.config); await assert.rejects(m.launch({ runner: 'codex', task: 'x' }), /Executable not found/);
    await writeFile(path.join(f.repo, 'untracked.txt'), 'keep'); await assert.rejects(m.launch({ runner: 'demo', task: 'x' }), /dirty/); assert.equal(await readFile(path.join(f.repo, 'untracked.txt'), 'utf8'), 'keep'); await rm(path.join(f.repo, 'untracked.txt'));
    await git(f.repo, 'checkout', '--detach'); await assert.rejects(inspectRepository(f.repo), /detached HEAD/);
    const empty = path.join(f.root, 'empty'); await mkdir(empty); await git(empty, 'init'); await assert.rejects(inspectRepository(empty), /at least one commit/);
  } finally { await f.cleanup(); }
});
test('concurrent launch reservation, nonzero exit and failed startup cleanup', async () => {
  const f = await fixture();
  const bad = { prepare: async () => ({ executable: '/missing/binary', args: [] }) };
  const m = new AgentManager(f.config, { demo: bad, codex: bad });
  try {
    const first = m.launch({ runner: 'demo', task: 'x' }); await assert.rejects(m.launch({ runner: 'demo', task: 'y' }), /already active/); await assert.rejects(first);
    assert.equal(m.list()[0].status, 'failed'); assert.equal((await git(f.repo, 'worktree', 'list', '--porcelain')).split('worktree ').length, 2);
    const fail = { prepare: async () => ({ executable: process.execPath, args: ['-e', 'process.exit(7)'] }) };
    const n = new AgentManager(f.config, { demo: fail, codex: fail }); const a = await n.launch({ runner: 'demo', task: 'Fail' }); await until(() => n.get(a.id).record.status === 'failed'); assert.equal(n.get(a.id).record.exitCode, 7); await n.shutdown();
  } finally { await m.shutdown(); await f.cleanup(); }
});
test('demo restriction, worktree placement, bounded buffer and message validation', async () => {
  const f = await fixture();
  try {
    const m = new AgentManager({ ...f.config, demoRepo: f.root }); await assert.rejects(m.launch({ runner: 'demo', task: 'x' }), /restricted/);
    const n = new AgentManager({ ...f.config, worktreeRoot: f.repo }); await assert.rejects(n.launch({ runner: 'demo', task: 'x' }), /outside/);
    assert.equal(appendOutput('a'.repeat(OUTPUT_LIMIT), 'tail').length, OUTPUT_LIMIT); assert.ok(appendOutput('a'.repeat(OUTPUT_LIMIT), 'tail').endsWith('tail'));
    for (const message of [{ type: 'exec', command: 'sh' }, { type: 'input', data: 'x'.repeat(8193) }, { type: 'resize', cols: 301, rows: 20 }]) assert.equal(clientMessageSchema.safeParse(message).success, false);
  } finally { await f.cleanup(); }
});
test('force stop kills a runner that ignores SIGTERM and shutdown waits for exit', async () => {
  const f = await fixture(); const adapter = { prepare: async () => ({ executable: process.execPath, args: ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"] }) }; const m = new AgentManager(f.config, { demo: adapter, codex: adapter });
  try { const a = await m.launch({ runner: 'demo', task: 'x' }); await until(() => m.get(a.id).output.includes('ready')); const pid = m.get(a.id).pty!.pid; await m.shutdown(); assert.equal(m.get(a.id).record.status, 'stopped'); assert.throws(() => process.kill(pid, 0)); } finally { await m.shutdown(); await f.cleanup(); }
});
