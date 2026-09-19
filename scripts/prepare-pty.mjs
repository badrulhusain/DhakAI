// Some node-pty npm archives omit the executable bit on the macOS spawn helper.
import { chmod, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('node-pty/package.json'));
if (process.platform === 'darwin') {
  for (const base of ['prebuilds', 'build']) {
    const dir = path.join(root, base);
    for (const item of await readdir(dir, { recursive: true }).catch(() => [])) {
      if (path.basename(item) === 'spawn-helper') await chmod(path.join(dir, item), 0o755);
    }
  }
}
