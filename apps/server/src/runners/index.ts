import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { LaunchInput } from '@classroom/shared';
export interface Runner { prepare(task: string): Promise<{ executable: string; args: string[] }> }
export async function resolveExecutable(executable: string) {
  const candidates = executable.includes(path.sep) ? [path.resolve(executable)] : (process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, executable));
  for (const candidate of candidates) { try { await access(candidate, constants.X_OK); return candidate; } catch {} }
  throw new Error(`Executable not found or not executable: ${executable}. Install Codex CLI or set CODEX_EXECUTABLE to its full path.`);
}
export function runners(config: { repo: string; demoRepo: string; demoScript: string; codexExecutable: string }): Record<LaunchInput['runner'], Runner> {
  return {
    demo: { async prepare() {
      if (await realpath(config.repo) !== await realpath(config.demoRepo).catch(() => '')) throw new Error('The scripted demo is restricted to the bundled sample repository. Run npm run demo:setup and use the default TARGET_REPO.');
      return { executable: process.execPath, args: [config.demoScript] };
    } },
    codex: { async prepare(task) { return { executable: await resolveExecutable(config.codexExecutable), args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', '--no-alt-screen', '--', task] }; } },
  };
}
