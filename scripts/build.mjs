import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env') });
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
