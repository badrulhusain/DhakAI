import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRecord, DependencyStatus, ExplanationRecord, MergeOperation, QuizAttempt, QuizDefinition, ReviewFile } from '@classroom/shared';

export interface StoredReview {
  agentId: string; version: string; createdAt: string; files: ReviewFile[];
  additions: number; deletions: number; canComplete: boolean;
}

export interface LearningStore {
  readonly mode: 'local' | 'supabase';
  init(): Promise<void>;
  health(): Promise<DependencyStatus['database']>;
  listRuns(): Promise<AgentRecord[]>;
  saveRun(record: AgentRecord): Promise<void>;
  saveReview(record: StoredReview): Promise<void>;
  getExplanation(agentId: string, version: string): Promise<ExplanationRecord | null>;
  latestExplanation(agentId: string): Promise<ExplanationRecord | null>;
  saveExplanation(record: ExplanationRecord): Promise<ExplanationRecord>;
  getQuiz(agentId: string, version: string): Promise<QuizDefinition | null>;
  saveQuiz(record: QuizDefinition): Promise<QuizDefinition>;
  getAttemptBySubmission(submissionId: string): Promise<QuizAttempt | null>;
  listAttempts(agentId: string, version: string): Promise<QuizAttempt[]>;
  saveAttempt(record: QuizAttempt): Promise<QuizAttempt>;
  getMerge(agentId: string, version: string): Promise<MergeOperation | null>;
  saveMerge(record: MergeOperation): Promise<MergeOperation>;
}

interface LocalState {
  schemaVersion: 1;
  runs: Record<string, AgentRecord>;
  reviews: Record<string, StoredReview>;
  explanations: Record<string, ExplanationRecord>;
  quizzes: Record<string, QuizDefinition>;
  attempts: Record<string, QuizAttempt>;
  merges: Record<string, MergeOperation>;
}

const emptyState = (): LocalState => ({ schemaVersion: 1, runs: {}, reviews: {}, explanations: {}, quizzes: {}, attempts: {}, merges: {} });
const key = (agentId: string, version: string) => `${agentId}:${version}`;

export class LocalLearningStore implements LearningStore {
  readonly mode = 'local' as const;
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(readonly directory: string) { this.file = path.join(directory, 'learning-records.json'); }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.state = JSON.parse(await readFile(this.file, 'utf8')) as LocalState; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Local learning records could not be read.'); }
    await this.importPhase2Explanations();
  }
  async health() { return { mode: this.mode, available: true, message: 'Local demo storage available' } as const; }
  async listRuns() { return Object.values(this.state.runs).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async saveRun(record: AgentRecord) { await this.update(state => { state.runs[record.id] = structuredClone(record); }); }
  async saveReview(record: StoredReview) { await this.update(state => { state.reviews[key(record.agentId, record.version)] = structuredClone(record); }); }
  async getExplanation(agentId: string, version: string) { return structuredClone(this.state.explanations[key(agentId, version)] ?? null); }
  async latestExplanation(agentId: string) { return structuredClone(Object.values(this.state.explanations).filter(record => record.agentId === agentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null); }
  async saveExplanation(record: ExplanationRecord) { await this.update(state => { state.explanations[key(record.agentId, record.version)] = structuredClone(record); }); return record; }
  async getQuiz(agentId: string, version: string) { return structuredClone(this.state.quizzes[key(agentId, version)] ?? null); }
  async saveQuiz(record: QuizDefinition) { await this.update(state => { state.quizzes[key(record.agentId, record.version)] = structuredClone(record); }); return record; }
  async getAttemptBySubmission(submissionId: string) { return structuredClone(this.state.attempts[submissionId] ?? null); }
  async listAttempts(agentId: string, version: string) { return structuredClone(Object.values(this.state.attempts).filter(record => record.agentId === agentId && record.version === version).sort((a, b) => a.createdAt.localeCompare(b.createdAt))); }
  async saveAttempt(record: QuizAttempt) { const existing = this.state.attempts[record.submissionId]; if (existing) return structuredClone(existing); await this.update(state => { state.attempts[record.submissionId] = structuredClone(record); }); return record; }
  async getMerge(agentId: string, version: string) { return structuredClone(this.state.merges[key(agentId, version)] ?? null); }
  async saveMerge(record: MergeOperation) { await this.update(state => { state.merges[key(record.agentId, record.version)] = structuredClone(record); }); return record; }
  private async update(change: (state: LocalState) => void) {
    const operation = this.queue.catch(() => {}).then(async () => {
      const next = structuredClone(this.state); change(next); const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); await rename(temporary, this.file); this.state = next; }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    });
    this.queue = operation; await operation;
  }
  private async importPhase2Explanations() {
    let changed = false;
    for (const legacyRoot of [this.directory, path.join(this.directory, 'explanations')]) {
      const agents = await readdir(legacyRoot, { withFileTypes: true }).catch(() => []);
      for (const agent of agents) {
        if (!agent.isDirectory() || !/^[\w-]+$/.test(agent.name)) continue;
        const files = await readdir(path.join(legacyRoot, agent.name)).catch(() => []);
        for (const file of files) {
          if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
          try {
            const record = JSON.parse(await readFile(path.join(legacyRoot, agent.name, file), 'utf8')) as ExplanationRecord;
            const recordKey = key(record.agentId, record.version);
            if (!this.state.explanations[recordKey]) { this.state.explanations[recordKey] = record; changed = true; }
          } catch { /* Leave unreadable legacy records untouched for manual recovery. */ }
        }
      }
    }
    if (changed) await this.update(() => {});
  }
}

function assertData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(`Supabase persistence failed: ${error.message}`);
  return data as T;
}

export class SupabaseLearningStore implements LearningStore {
  readonly mode = 'supabase' as const;
  private client: SupabaseClient;
  private healthCache?: { at: number; value: DependencyStatus['database'] };
  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  async init() { const health = await this.health(); if (!health.available) throw new Error(health.message); }
  async health() {
    if (this.healthCache && Date.now() - this.healthCache.at < 30_000) return this.healthCache.value;
    const { error } = await this.client.from('agent_runs').select('id', { head: true, count: 'exact' }).limit(1);
    const value: DependencyStatus['database'] = error ? { mode: this.mode, available: false, message: 'Supabase unavailable or migration missing' } : { mode: this.mode, available: true, message: 'Supabase available' };
    this.healthCache = { at: Date.now(), value }; return value;
  }
  async listRuns() { const { data, error } = await this.client.from('agent_runs').select('record').order('created_at'); return assertData(data, error).map((row: any) => row.record as AgentRecord); }
  async saveRun(record: AgentRecord) { const { error } = await this.client.from('agent_runs').upsert({ id: record.id, record, status: record.status, created_at: record.createdAt, updated_at: new Date().toISOString() }); assertData(true, error); }
  async saveReview(record: StoredReview) { const { error } = await this.client.from('review_versions').upsert({ agent_id: record.agentId, version: record.version, record, created_at: record.createdAt }); assertData(true, error); }
  async getExplanation(agentId: string, version: string) { const { data, error } = await this.client.from('explanations').select('record').eq('agent_id', agentId).eq('review_version', version).maybeSingle(); return assertData(data, error)?.record as ExplanationRecord ?? null; }
  async latestExplanation(agentId: string) { const { data, error } = await this.client.from('explanations').select('record').eq('agent_id', agentId).order('updated_at', { ascending: false }).limit(1).maybeSingle(); return assertData(data, error)?.record as ExplanationRecord ?? null; }
  async saveExplanation(record: ExplanationRecord) { const { error } = await this.client.from('explanations').upsert({ agent_id: record.agentId, review_version: record.version, record, status: record.status, updated_at: record.updatedAt, completed_at: record.completedAt ?? null }); assertData(true, error); return record; }
  async getQuiz(agentId: string, version: string) { const { data, error } = await this.client.from('quiz_definitions').select('record').eq('agent_id', agentId).eq('review_version', version).maybeSingle(); return assertData(data, error)?.record as QuizDefinition ?? null; }
  async saveQuiz(record: QuizDefinition) { const { error } = await this.client.from('quiz_definitions').upsert({ id: record.id, agent_id: record.agentId, review_version: record.version, provider: record.provider, model: record.model, record, created_at: record.createdAt }); assertData(true, error); return record; }
  async getAttemptBySubmission(submissionId: string) { const { data, error } = await this.client.from('quiz_attempts').select('record').eq('submission_id', submissionId).maybeSingle(); return assertData(data, error)?.record as QuizAttempt ?? null; }
  async listAttempts(agentId: string, version: string) { const { data, error } = await this.client.from('quiz_attempts').select('record').eq('agent_id', agentId).eq('review_version', version).order('created_at'); return assertData(data, error).map((row: any) => row.record as QuizAttempt); }
  async saveAttempt(record: QuizAttempt) { const existing = await this.getAttemptBySubmission(record.submissionId); if (existing) return existing; const { data, error } = await this.client.from('quiz_attempts').insert({ id: record.id, submission_id: record.submissionId, quiz_id: record.quizId, agent_id: record.agentId, review_version: record.version, score: record.score, passed: record.passed, record, created_at: record.createdAt }).select('record').single(); if (error?.code === '23505') return (await this.getAttemptBySubmission(record.submissionId))!; return assertData(data, error).record as QuizAttempt; }
  async getMerge(agentId: string, version: string) { const { data, error } = await this.client.from('merge_operations').select('record').eq('agent_id', agentId).eq('review_version', version).maybeSingle(); return assertData(data, error)?.record as MergeOperation ?? null; }
  async saveMerge(record: MergeOperation) { const { error } = await this.client.from('merge_operations').upsert({ id: record.id, agent_id: record.agentId, review_version: record.version, status: record.status, result_commit: record.resultCommit ?? null, record, updated_at: record.updatedAt, created_at: record.createdAt }); assertData(true, error); return record; }
}

export function createLearningStore(config: { mode?: string; directory: string; supabaseUrl?: string; supabaseSecretKey?: string }): LearningStore {
  if (config.mode === 'supabase') {
    if (!config.supabaseUrl || !config.supabaseSecretKey) throw new Error('DATABASE_UNAVAILABLE: STORAGE_MODE=supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
    return new SupabaseLearningStore(config.supabaseUrl, config.supabaseSecretKey);
  }
  if (config.mode && config.mode !== 'local') throw new Error('STORAGE_MODE must be explicitly set to local or supabase.');
  return new LocalLearningStore(config.directory);
}
