import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isActive, type AgentRecord, type MergeBlocker, type MergeEligibility, type MergeOperation } from '@classroom/shared';
import type { LearningStore } from './learning-store.js';
import type { ReviewService } from './review-service.js';
import type { QuizService } from './quiz-service.js';
import { git } from './git.js';
import { ServiceError } from './service-error.js';

const run = promisify(execFile);
const locks = new Map<string, Promise<void>>();

export interface MergeConfig { repository: string; worktreeRoot: string; validationExecutable?: string; validationArgs?: string[]; validationTimeout?: number }

async function noGitOperation(repo: string) {
  const gitDirRaw = await git(repo, 'rev-parse', '--git-dir'); const gitDir = path.resolve(repo, gitDirRaw);
  for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) if (await lstat(path.join(gitDir, marker)).then(() => true).catch(() => false)) return false;
  return true;
}

export class MergeService {
  constructor(private getAgent: (id: string) => AgentRecord, private reviews: ReviewService, private quizzes: QuizService, private store: LearningStore, private config: MergeConfig) {}
  async operation(agentId: string) {
    this.getAgent(agentId);
    const snapshot = await this.reviews.currentSnapshot(agentId);
    return this.store.getMerge(agentId, snapshot.version);
  }
  async eligibility(agentId: string): Promise<MergeEligibility> {
    const blockers: MergeBlocker[] = []; let version: string | undefined; let existingOperation: MergeOperation | undefined;
    let agent: AgentRecord;
    try { agent = this.getAgent(agentId); } catch { return { eligible: false, blockers: [{ code: 'NOT_FOUND', message: 'Agent not found.' }] }; }
    if (isActive(agent.status)) blockers.push({ code: 'AGENT_RUNNING', message: 'Wait for the agent process to exit.' });
    if (!agent.worktree || !await lstat(agent.worktree).then(stat => stat.isDirectory()).catch(() => false)) blockers.push({ code: 'WORKTREE_MISSING', message: 'The retained agent worktree is missing.' });
    try {
      const snapshot = await this.reviews.currentSnapshot(agentId); version = snapshot.version;
      if (!snapshot.files.length || !snapshot.canComplete) blockers.push({ code: 'REVIEW_OUTDATED', message: 'The current changes must be nonempty and fully reviewable.' });
      const explanation = await this.store.getExplanation(agentId, snapshot.version);
      if (explanation?.status !== 'completed') blockers.push({ code: 'EXPLANATION_REQUIRED', message: 'Complete the explanation for the current review.' });
      if (!await this.quizzes.hasPassed(agentId, snapshot.version)) blockers.push({ code: 'QUIZ_NOT_PASSED', message: 'Pass the current three-question quiz with 3/3.' });
      existingOperation = await this.store.getMerge(agentId, snapshot.version) ?? undefined;
      if (existingOperation?.status === 'succeeded') return { eligible: true, version, blockers: [], existingOperation };
      if (existingOperation?.status === 'pending' || existingOperation?.status === 'record-pending') blockers.push({ code: 'MERGE_RECORD_PENDING', message: 'A merge operation is pending or needs persistence reconciliation.' });
    } catch (error) { if (!blockers.some(item => item.code === 'WORKTREE_MISSING')) blockers.push({ code: 'REVIEW_OUTDATED', message: error instanceof Error ? error.message : 'Current review could not be verified.' }); }
    if (agent.startCommit && agent.baseBranch) {
      try {
        const branch = await git(this.config.repository, 'symbolic-ref', '--quiet', '--short', 'HEAD');
        const head = await git(this.config.repository, 'rev-parse', 'HEAD');
        if (branch !== agent.baseBranch || head !== agent.startCommit) blockers.push({ code: 'STALE_BASE', message: `Base must remain ${agent.baseBranch} at ${agent.startCommit.slice(0, 12)}.` });
        if (await git(this.config.repository, 'status', '--porcelain', '--untracked-files=all')) blockers.push({ code: 'DIRTY_BASE', message: 'The base checkout has tracked or untracked changes.' });
        if (!await noGitOperation(this.config.repository)) blockers.push({ code: 'MERGE_CONFLICT', message: 'Another Git merge, rebase, cherry-pick, or revert is underway.' });
      } catch (error) { blockers.push({ code: 'STALE_BASE', message: `Base repository could not be verified: ${error instanceof Error ? error.message : 'Git error'}` }); }
    }
    return { eligible: blockers.length === 0, version, blockers, existingOperation };
  }
  async merge(agentId: string) {
    const repository = await realpath(this.config.repository);
    return this.withLock(repository, async () => {
      const agent = this.getAgent(agentId); const snapshot = await this.reviews.currentSnapshot(agentId);
      const existing = await this.store.getMerge(agentId, snapshot.version);
      if (existing?.status === 'succeeded') return existing;
      const reconciled = await this.reconcile(agent, snapshot.version); if (reconciled) return reconciled;
      const eligibility = await this.eligibility(agentId); if (!eligibility.eligible) { const blocker = eligibility.blockers[0]; throw new ServiceError(blocker.code, blocker.message, 409, eligibility.blockers); }
      const now = new Date().toISOString(); let operation: MergeOperation = { id: randomUUID(), agentId, version: snapshot.version, status: 'pending', branch: agent.baseBranch!, baseCommit: agent.startCommit!, createdAt: now, updatedAt: now };
      try { await this.store.saveMerge(operation); } catch { throw new ServiceError('DATABASE_UNAVAILABLE', 'The merge was not started because its operation record could not be persisted.', 503); }
      const temporaryRoot = path.join(this.config.worktreeRoot, `.merge-${operation.id}`); const candidate = path.join(temporaryRoot, 'candidate'); const integration = path.join(temporaryRoot, 'integration');
      let candidateAdded = false, integrationAdded = false, gitSucceeded = false;
      try {
        await mkdir(temporaryRoot, { recursive: true });
        await git(repository, 'worktree', 'add', '--detach', candidate, agent.startCommit!); candidateAdded = true;
        await this.materialize(candidate, snapshot);
        await git(candidate, 'add', '-A', '--');
        const message = `Agent Classroom: ${agent.task.slice(0, 120)}\n\nAgent-Classroom-Agent: ${agent.id}\nReview-Version: ${snapshot.version}\nMerge-Operation: ${operation.id}`;
        await git(candidate, '-c', 'user.name=Agent Classroom', '-c', 'user.email=agent-classroom@localhost', 'commit', '-m', message);
        const resultCommit = await git(candidate, 'rev-parse', 'HEAD');
        await git(repository, 'worktree', 'add', '--detach', integration, agent.startCommit!); integrationAdded = true;
        try { await git(integration, 'merge', '--no-commit', '--no-ff', resultCommit); }
        catch { throw new ServiceError('MERGE_CONFLICT', 'The reviewed candidate did not merge cleanly in the isolated compatibility worktree.', 409); }
        const candidateTree = await git(candidate, 'rev-parse', 'HEAD^{tree}'); const integrationTree = await git(integration, 'write-tree');
        if (candidateTree !== integrationTree) throw new ServiceError('MERGE_CONFLICT', 'Compatibility merge did not produce the exact reviewed tree.', 409);
        await git(integration, 'merge', '--abort');
        await this.recheckBase(agent, snapshot.version);
        await git(repository, 'merge', '--ff-only', resultCommit); gitSucceeded = true;
        const finalHead = await git(repository, 'rev-parse', 'HEAD'); const finalTree = await git(repository, 'rev-parse', 'HEAD^{tree}');
        if (finalHead !== resultCommit || finalTree !== candidateTree || await git(repository, 'status', '--porcelain', '--untracked-files=all')) throw new ServiceError('MERGE_CONFLICT', 'Git updated the base, but final verification failed. Inspect the recorded commit before continuing.', 500);
        operation = { ...operation, status: 'succeeded', resultCommit, validation: await this.validate(repository), updatedAt: new Date().toISOString() };
        try { return await this.store.saveMerge(operation); }
        catch { operation.status = 'record-pending'; throw new ServiceError('MERGE_RECORD_PENDING', `Git merge succeeded at ${resultCommit}, but persistence failed. Retry to reconcile the record; do not merge manually.`, 503, operation); }
      } catch (error) {
        if (!gitSucceeded && !(error instanceof ServiceError && error.code === 'DATABASE_UNAVAILABLE')) {
          operation = { ...operation, status: 'failed', errorCode: error instanceof ServiceError ? error.code : 'MERGE_CONFLICT', error: error instanceof Error ? error.message : 'Merge failed.', updatedAt: new Date().toISOString() };
          await this.store.saveMerge(operation).catch(() => {});
        }
        throw error;
      } finally {
        if (integrationAdded) await git(repository, 'worktree', 'remove', '--force', integration).catch(() => {});
        if (candidateAdded) await git(repository, 'worktree', 'remove', '--force', candidate).catch(() => {});
        await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
  private async recheckBase(agent: AgentRecord, version: string) {
    const current = await this.reviews.currentSnapshot(agent.id); if (current.version !== version) throw new ServiceError('REVIEW_OUTDATED', 'Worktree contents changed after the quiz. Review, explain, and pass a new quiz.', 409);
    if (!await this.quizzes.hasPassed(agent.id, version)) throw new ServiceError('QUIZ_NOT_PASSED', 'The current review does not have a passing quiz.', 409);
    const branch = await git(this.config.repository, 'symbolic-ref', '--quiet', '--short', 'HEAD'); const head = await git(this.config.repository, 'rev-parse', 'HEAD');
    if (branch !== agent.baseBranch || head !== agent.startCommit) throw new ServiceError('STALE_BASE', 'The base branch or commit moved after this agent launched.', 409);
    if (await git(this.config.repository, 'status', '--porcelain', '--untracked-files=all')) throw new ServiceError('DIRTY_BASE', 'The base checkout became dirty. Nothing was merged.', 409);
    if (!await noGitOperation(this.config.repository)) throw new ServiceError('MERGE_CONFLICT', 'Another Git operation is underway in the base checkout.', 409);
  }
  private async materialize(root: string, snapshot: Awaited<ReturnType<ReviewService['currentSnapshot']>>) {
    for (const file of snapshot.files) {
      const content = snapshot.content.get(file.id); if (!content) throw new ServiceError('REVIEW_OUTDATED', `Reviewed content for ${file.path} is unavailable.`, 409);
      if (file.previousPath && file.previousPath !== file.path) await this.safeRemove(root, file.previousPath);
      if (file.status === 'deleted') { await this.safeRemove(root, file.path); continue; }
      await this.safeWrite(root, file.path, content.after, file.newMode === '100755' ? 0o755 : 0o644);
    }
  }
  private async safeRemove(root: string, relative: string) { const target = path.resolve(root, relative); if (!target.startsWith(root + path.sep)) throw new ServiceError('REVIEW_OUTDATED', 'Unsafe reviewed path.', 409); await rm(target, { recursive: true, force: true }); }
  private async safeWrite(root: string, relative: string, value: string, mode: number) {
    const target = path.resolve(root, relative); if (!target.startsWith(root + path.sep)) throw new ServiceError('REVIEW_OUTDATED', 'Unsafe reviewed path.', 409);
    const segments = relative.split('/'); let parent = root;
    for (const segment of segments.slice(0, -1)) { parent = path.join(parent, segment); const stat = await lstat(parent).catch(() => null); if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new ServiceError('MERGE_CONFLICT', `Cannot safely materialize ${relative} through a non-directory ancestor.`, 409); await mkdir(parent, { recursive: true }); }
    await rm(target, { recursive: true, force: true }); await writeFile(target, value, { mode }); await chmod(target, mode);
  }
  private async validate(repository: string): Promise<NonNullable<MergeOperation['validation']>> {
    if (!this.config.validationExecutable) return { status: 'not-configured', message: 'No server-configured validation command.' };
    try { const result = await run(this.config.validationExecutable, this.config.validationArgs ?? [], { cwd: repository, timeout: this.config.validationTimeout ?? 120_000, maxBuffer: 1024 * 1024 }); return { status: 'passed', message: (result.stdout || 'Validation passed.').trim().slice(0, 2000) }; }
    catch (error) { return { status: 'failed', message: `Merge completed, but validation failed: ${error instanceof Error ? error.message : 'command failed'}` }; }
  }
  private async reconcile(agent: AgentRecord, version: string) {
    const head = await git(this.config.repository, 'rev-parse', 'HEAD'); if (head === agent.startCommit) return null;
    const message = await git(this.config.repository, 'show', '-s', '--format=%B', head);
    if (!message.includes(`Agent-Classroom-Agent: ${agent.id}`) || !message.includes(`Review-Version: ${version}`)) return null;
    const now = new Date().toISOString(); const operation: MergeOperation = { id: message.match(/Merge-Operation: ([\w-]+)/)?.[1] ?? randomUUID(), agentId: agent.id, version, status: 'succeeded', branch: agent.baseBranch!, baseCommit: agent.startCommit!, resultCommit: head, validation: { status: 'not-configured', message: 'Reconciled from the auditable Git commit.' }, createdAt: now, updatedAt: now };
    try { return await this.store.saveMerge(operation); } catch { throw new ServiceError('MERGE_RECORD_PENDING', `Git already contains the reviewed merge at ${head}, but its database record is still unavailable.`, 503, operation); }
  }
  private async withLock<T>(repository: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(repository) ?? Promise.resolve(); let release!: () => void; const current = new Promise<void>(resolve => { release = resolve; }); const chain = previous.then(() => current); locks.set(repository, chain); await previous;
    const gitDir = path.resolve(repository, await git(repository, 'rev-parse', '--git-dir')); const lockPath = path.join(gitDir, 'agent-classroom-merge.lock'); let handle;
    try {
      try { handle = await open(lockPath, 'wx'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const owner = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{}')) as { pid?: number };
        let alive = false; if (owner.pid) try { process.kill(owner.pid, 0); alive = true; } catch {}
        if (alive) throw error;
        await rm(lockPath, { force: true }); handle = await open(lockPath, 'wx');
      }
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); return await action();
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ServiceError('MERGE_RECORD_PENDING', 'Another Agent Classroom process holds the repository merge lock.', 409); throw error; }
    finally { await handle?.close(); if (handle) await rm(lockPath, { force: true }); release(); if (locks.get(repository) === chain) locks.delete(repository); }
  }
}
