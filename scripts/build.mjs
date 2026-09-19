import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env') });
const backendPort = Number(process.env.PORT || 4000);
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: path.join(root, 'apps/web'), stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: '.next', NEXT_PUBLIC_BACKEND_URL: `http://127.0.0.1:${backendPort}` },
});
child.once('exit', code => process.exit(code ?? 1));
