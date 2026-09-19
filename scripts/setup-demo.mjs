import { mkdir, cp, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = `${root}.runtime/demo-repo`;
try { await access(`${target}/.git`); console.log(`Demo already exists: ${target}`); process.exit(0); } catch {}
await mkdir(target, { recursive: true });
await cp(`${root}samples/demo`, target, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', target, ...args]);
git('init', '-b', 'main'); git('add', '.');
git('-c', 'user.name=Agent Classroom', '-c', 'user.email=demo@localhost', 'commit', '-m', 'Initialize classroom demo');
console.log(`Demo repository ready: ${target}`);
