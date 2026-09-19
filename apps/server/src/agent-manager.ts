import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import { isActive, launchSchema, type AgentRecord, type LaunchInput, type ServerMessage } from '@classroom/shared';
import { createWorktree, cleanupFailedWorktree, inspectRepository } from './git.js';
import { runners, type Runner } from './runners/index.js';
import { appendOutput, signalTerminal, startTerminal } from './terminal.js';
export interface ManagerConfig { repo: string; worktreeRoot: string; demoRepo: string; demoScript: string; codexExecutable: string; stopTimeout?: number; dataRoot?: string }
interface Session { record: AgentRecord; output: string; pty?: IPty; timer?: NodeJS.Timeout; done?: Promise<void>; resolve?: () => void }
export class AgentManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private adapters: Record<LaunchInput['runner'], Runner>;
  private shuttingDown = false;
  private persistenceTail: Promise<void> = Promise.resolve();
  constructor(readonly config: ManagerConfig, adapters?: Record<LaunchInput['runner'], Runner>, private recordSink?: (record: AgentRecord) => Promise<void>) { super(); this.adapters = adapters ?? runners(config); }
  restore(records: AgentRecord[]) {
    for (const stored of records.slice(-25)) {
      const record = { ...stored };
      if (isActive(record.status)) {
        record.status = 'interrupted'; record.endedAt = new Date().toISOString();
        record.error = 'Backend restarted while this process was active. Its PTY is no longer connected; inspect the retained worktree before review or merge.';
      }
      this.sessions.set(record.id, { record, output: '\r\n[Session restored after backend restart. No PTY is connected.]\r\n', done: Promise.resolve() });
      this.persist(record);
    }
  }
  list() { return [...this.sessions.values()].map(s => ({ ...s.record })).reverse(); }
  get(id: string) { const s = this.sessions.get(id); if (!s) throw new Error('Agent not found.'); return s; }
  private persist(record: AgentRecord) {
    if (!this.recordSink) return;
    const snapshot = { ...record };
    this.persistenceTail = this.persistenceTail.catch(() => {}).then(() => this.recordSink!(snapshot)).catch(error => { this.emit('persistence-error', error); });
  }
  private publish(s: Session) { this.emit('message', s.record.id, { type: 'status', agent: { ...s.record } } satisfies ServerMessage); this.persist(s.record); }
  async launch(input: LaunchInput) {
    input = launchSchema.parse(input);
    if (this.shuttingDown) throw new Error('Server is shutting down.');
    if (this.list().some(a => isActive(a.status))) throw new Error('An agent is already active. Stop it before launching another.');
    // Reserve synchronously before any asynchronous repository work.
    const id = randomUUID();
    const s: Session = { record: { id, name: `Agent ${this.sessions.size + 1}`, ...input, status: 'creating', createdAt: new Date().toISOString() }, output: '' };
    this.sessions.set(id, s); this.publish(s);
    while (this.sessions.size > 25) { const oldest = this.sessions.keys().next().value!; this.sessions.delete(oldest); }
    s.done = new Promise(resolve => { s.resolve = resolve; });
    try {
      await inspectRepository(this.config.repo);
      const runner = await this.adapters[input.runner].prepare(input.task);
      const { name: _repositoryName, ...worktree } = await createWorktree(this.config.repo, this.config.worktreeRoot, id);
      Object.assign(s.record, worktree);
      if (s.record.status === 'stopping' || this.shuttingDown) { s.record.status = 'stopped'; s.record.endedAt = new Date().toISOString(); s.resolve?.(); this.publish(s); return { ...s.record }; }
      const terminal = startTerminal(runner.executable, runner.args, s.record.worktree!);
      s.pty = terminal;
      terminal.onData(data => { s.output = appendOutput(s.output, data); this.emit('message', id, { type: 'output', data } satisfies ServerMessage); });
      terminal.onExit(({ exitCode, signal }) => {
        clearTimeout(s.timer);
        signalTerminal(terminal, 'SIGKILL');
        s.pty = undefined;
        s.record.exitCode = exitCode;
        s.record.status = s.record.status === 'stopping' ? 'stopped' : exitCode === 0 && !signal ? 'completed' : 'failed';
        if (s.record.status === 'failed') s.record.error = `Runner exited with code ${exitCode}${signal ? ` (signal ${signal})` : ''}. Check the terminal for details.`;
        s.record.endedAt = new Date().toISOString(); this.publish(s); s.resolve?.();
      });
      s.record.status = 'running'; this.publish(s);
      return { ...s.record };
    } catch (error) {
      s.record.status = 'failed'; s.record.error = error instanceof Error ? error.message : 'Launch failed.';
      if (s.record.worktree) { try { await cleanupFailedWorktree(this.config.repo, s.record.worktree, s.record.branch!, s.record.startCommit!); } catch { s.record.error += ' Worktree retained because safe cleanup could not be confirmed.'; } }
      s.record.endedAt = new Date().toISOString(); this.publish(s); s.resolve?.(); throw new Error(s.record.error);
    }
  }
  input(id: string, data: string) { const s = this.get(id); if (s.record.status !== 'running' || !s.pty) throw new Error('Agent is not running.'); s.pty.write(data); }
  resize(id: string, cols: number, rows: number) { this.get(id).pty?.resize(cols, rows); }
  stop(id: string) {
    const s = this.get(id);
    if (!isActive(s.record.status) || s.record.status === 'stopping') return;
    s.record.status = 'stopping'; this.publish(s);
    if (s.pty) { const terminal = s.pty; signalTerminal(terminal, 'SIGTERM'); s.timer = setTimeout(() => signalTerminal(terminal, 'SIGKILL'), this.config.stopTimeout ?? 2000); }
  }
  async shutdown() { this.shuttingDown = true; for (const s of this.sessions.values()) if (isActive(s.record.status)) this.stop(s.record.id); await Promise.all([...this.sessions.values()].map(s => s.done)); await this.persistenceTail; }
}
