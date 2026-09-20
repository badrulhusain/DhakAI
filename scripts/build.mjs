import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  try {
    const content = readFileSync(envFile, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!(key in process.env)) process.env[key] = val;
      }
    }
  } catch { }
}
const backendPort = Number(process.env.PORT || 4000);
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || `http://127.0.0.1:${backendPort}`;
let parsedBackend;
try { parsedBackend = new URL(backendUrl); } catch { throw new Error('NEXT_PUBLIC_BACKEND_URL must be a valid absolute URL.'); }
if (!['http:', 'https:'].includes(parsedBackend.protocol) || parsedBackend.pathname !== '/' || parsedBackend.search || parsedBackend.hash || parsedBackend.username || parsedBackend.password) throw new Error('NEXT_PUBLIC_BACKEND_URL must be a bare HTTP(S) origin without credentials, a path, query, or hash.');
if (process.env.VERCEL && (parsedBackend.protocol !== 'https:' || ['127.0.0.1', 'localhost'].includes(parsedBackend.hostname))) throw new Error('Vercel builds require NEXT_PUBLIC_BACKEND_URL to be the public HTTPS origin of the persistent backend.');
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: path.join(root, 'apps/web'), stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: '.next', NEXT_PUBLIC_BACKEND_URL: parsedBackend.origin },
});
child.once('exit', code => process.exit(code ?? 1));
