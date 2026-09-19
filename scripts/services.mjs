import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import dotenv from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url)); dotenv.config({ path: path.join(root, '.env') });
const registry = path.join(root, '.runtime/services.json');
const stamp = pid => { try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart=,command='], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const owned = record => record.root === root && stamp(record.pid) === record.identity && record.identity.includes('scripts/services.mjs');
if (process.argv[2] === 'stop') {
  const record = await readFile(registry, 'utf8').then(JSON.parse).catch(() => null);
  if (!record || !owned(record)) { console.log('No verified managed project services to stop.'); process.exit(0); }
  try { const response = await fetch(`http://127.0.0.1:${record.backendPort}/api/state`, { headers: { Origin: `http://127.0.0.1:${record.webPort}` }, signal: AbortSignal.timeout(2000) }); const data = await response.json(); if (data.agents?.some(a => ['creating','running','stopping'].includes(a.status))) { console.error('An agent is active. Stop it in the dashboard before stopping project services.'); process.exit(1); } } catch { console.log('Backend is unreachable; stopping only the supervisor whose PID, start time, command, and project root match the registry.'); }
  process.kill(record.pid, 'SIGTERM'); console.log(`Stopping verified Agent Classroom supervisor ${record.pid}.`); process.exit(0);
}
const webPort = Number(process.env.WEB_PORT || 3000), backendPort = Number(process.env.PORT || 4000);
if (![webPort, backendPort].every(p => Number.isInteger(p) && p > 1024 && p < 65536) || webPort === backendPort) throw new Error('WEB_PORT and PORT must be distinct valid ports above 1024.');
const available = port => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', () => reject(new Error(`Port ${port} is occupied. Use npm run stop for managed project services, or configure another port. No process was killed.`))); s.listen(port, '127.0.0.1', () => s.close(resolve)); });
await available(webPort); await available(backendPort); await mkdir(path.dirname(registry), { recursive: true });
const old = await readFile(registry, 'utf8').then(JSON.parse).catch(() => null); if (old && owned(old)) throw new Error('This project already has a managed service supervisor.');
const lockPath = registry + '.lock'; const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Service startup lock exists. Check project processes before removing .runtime/services.json.lock.'); });
const production = process.argv[2] === 'production';
const env = { ...process.env, PORT: String(backendPort), WEB_PORT: String(webPort), NEXT_PUBLIC_BACKEND_URL: `http://127.0.0.1:${backendPort}`, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || `http://127.0.0.1:${webPort},http://localhost:${webPort}`, NEXT_DIST_DIR: production ? '.next' : '.next-dev' };
const children = [spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(root, 'apps/server'), env, stdio: 'inherit' }), spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], { cwd: path.join(root, 'apps/web'), env, stdio: 'inherit' })];
await writeFile(registry, JSON.stringify({ root, pid: process.pid, identity: stamp(process.pid), webPort, backendPort, children: children.map(p => ({ pid: p.pid, identity: stamp(p.pid) })) }));
console.log(`Agent Classroom: http://127.0.0.1:${webPort} · backend ${backendPort}`);
let closing = false;
async function stop() { if (closing) return; closing = true; for (const child of children) if (child.exitCode === null) child.kill('SIGTERM'); const force = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }, 8000); await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))); clearTimeout(force); await rm(registry, { force: true }); await lock.close(); await rm(lockPath, { force: true }); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop); for (const child of children) child.on('exit', () => { if (!closing) void stop(); });
