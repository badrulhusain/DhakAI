import * as pty from 'node-pty';
import { accessSync, constants } from 'node:fs';
export const OUTPUT_LIMIT = 128 * 1024;
export function appendOutput(previous: string, data: string) { return (previous + data).slice(-OUTPUT_LIMIT); }
export function startTerminal(executable: string, args: string[], cwd: string) {
  accessSync(executable, constants.X_OK);
  return pty.spawn(executable, args, { name: 'xterm-256color', cols: 100, rows: 28, cwd, env: { ...process.env, TERM: 'xterm-256color' } });
}
export function signalTerminal(terminal: pty.IPty, signal: 'SIGTERM' | 'SIGKILL') {
  // node-pty creates a process group on POSIX. Signal descendants as well as the runner.
  try { process.kill(-terminal.pid, signal); } catch { try { terminal.kill(signal); } catch {} }
}
