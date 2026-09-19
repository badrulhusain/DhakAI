import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRecord, BadgeAward, DependencyStatus, DrawingChecklistRecord, DrawingRecord, ExplanationRecord, MergeOperation, PointTransaction, QuizAttempt, QuizDefinition, ReviewFile, ReviewerMark } from '@classroom/shared';
import { ServiceError } from './service-error.js';

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
  getDrawing(agentId: string, version: string): Promise<DrawingRecord | null>;
  latestDrawing(agentId: string): Promise<DrawingRecord | null>;
  saveDrawing(record: DrawingRecord, expectedRevision: number): Promise<DrawingRecord>;
  saveChecklist(record: DrawingChecklistRecord): Promise<DrawingChecklistRecord>;
  getChecklist(agentId: string, version: string): Promise<DrawingChecklistRecord | null>;
  saveDrawingPreview(record: DrawingRecord, png: Uint8Array): Promise<string>;
  readDrawingPreview(record: DrawingRecord): Promise<Uint8Array>;
  getReviewerMark(agentId: string, version: string): Promise<ReviewerMark | null>;
  saveReviewerMark(record: ReviewerMark): Promise<ReviewerMark>;
  listPoints(agentId: string, version: string): Promise<PointTransaction[]>;
  awardPoint(record: PointTransaction): Promise<{ record: PointTransaction; awarded: boolean }>;
  listBadges(agentId: string, version: string): Promise<BadgeAward[]>;
  awardBadge(record: BadgeAward): Promise<{ record: BadgeAward; awarded: boolean }>;
}

interface LocalState {
  schemaVersion: 2;
  runs: Record<string, AgentRecord>;
  reviews: Record<string, StoredReview>;
  explanations: Record<string, ExplanationRecord>;
  quizzes: Record<string, QuizDefinition>;
  attempts: Record<string, QuizAttempt>;
  merges: Record<string, MergeOperation>;
  drawings: Record<string, DrawingRecord>;
  checklists: Record<string, DrawingChecklistRecord>;
  reviewerMarks: Record<string, ReviewerMark>;
  points: Record<string, PointTransaction>;
  badges: Record<string, BadgeAward>;
}

const emptyState = (): LocalState => ({ schemaVersion: 2, runs: {}, reviews: {}, explanations: {}, quizzes: {}, attempts: {}, merges: {}, drawings: {}, checklists: {}, reviewerMarks: {}, points: {}, badges: {} });
const key = (agentId: string, version: string) => `${agentId}:${version}`;

export class LocalLearningStore implements LearningStore {
  readonly mode = 'local' as const;
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(readonly directory: string) { this.file = path.join(directory, 'learning-records.json'); }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.state = { ...emptyState(), ...JSON.parse(await readFile(this.file, 'utf8')), schemaVersion: 2 } as LocalState; }
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
  async getDrawing(agentId: string, version: string) { return structuredClone(this.state.drawings[key(agentId, version)] ?? null); }
  async latestDrawing(agentId: string) { return structuredClone(Object.values(this.state.drawings).filter(record => record.agentId === agentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null); }
  async saveDrawing(record: DrawingRecord, expectedRevision: number) { return this.update(state => {
    const recordKey = key(record.agentId, record.reviewVersion); const existing = state.drawings[recordKey];
    if ((existing?.revision ?? 0) !== expectedRevision) throw new ServiceError('DRAWING_SAVE_CONFLICT', 'This drawing changed in another save. Reload it before saving again.', 409, existing);
    state.drawings[recordKey] = structuredClone(record); return record;
  }); }
  async saveChecklist(record: DrawingChecklistRecord) { await this.update(state => { state.checklists[key(record.agentId, record.reviewVersion)] = structuredClone(record); }); return record; }
  async getChecklist(agentId: string, version: string) { return structuredClone(this.state.checklists[key(agentId, version)] ?? null); }
  async saveDrawingPreview(record: DrawingRecord, png: Uint8Array) {
    const directory = path.join(this.directory, 'drawings', record.agentId, record.reviewVersion);
    const objectPath = `${record.agentId}/${record.reviewVersion}/${record.id}.png`; const target = path.join(directory, `${record.id}.png`); const temporary = `${target}.${randomUUID()}.tmp`;
    try { await mkdir(directory, { recursive: true, mode: 0o700 }); await writeFile(temporary, png, { mode: 0o600, flag: 'wx' }); await rename(temporary, target); return objectPath; }
    catch (error) { throw new ServiceError('DRAWING_UPLOAD_FAILED', `Editable drawing data was saved, but its local PNG preview could not be stored: ${error instanceof Error ? error.message : 'storage error'}`, 503); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async readDrawingPreview(record: DrawingRecord) { if (!record.storageObjectPath) throw new ServiceError('DRAWING_NOT_FOUND', 'This drawing has no exported preview.', 404); try { return await readFile(path.join(this.directory, 'drawings', record.agentId, record.reviewVersion, `${record.id}.png`)); } catch { throw new ServiceError('STORAGE_UNAVAILABLE', 'The saved drawing metadata exists, but its private preview file is unavailable.', 503); } }
  async getReviewerMark(agentId: string, version: string) { return structuredClone(this.state.reviewerMarks[key(agentId, version)] ?? null); }
  async saveReviewerMark(record: ReviewerMark) { await this.update(state => { state.reviewerMarks[key(record.agentId, record.reviewVersion)] = structuredClone(record); }); return record; }
  async listPoints(agentId: string, version: string) { return structuredClone(Object.values(this.state.points).filter(record => record.agentId === agentId && record.reviewVersion === version).sort((a, b) => a.createdAt.localeCompare(b.createdAt))); }
  async awardPoint(record: PointTransaction) { return this.update(state => { const eventKey = `${key(record.agentId, record.reviewVersion)}:${record.event}`; const existing = state.points[eventKey]; if (existing) return { record: structuredClone(existing), awarded: false }; state.points[eventKey] = structuredClone(record); return { record, awarded: true }; }); }
  async listBadges(agentId: string, version: string) { return structuredClone(Object.values(this.state.badges).filter(record => record.agentId === agentId && record.reviewVersion === version).sort((a, b) => a.createdAt.localeCompare(b.createdAt))); }
  async awardBadge(record: BadgeAward) { return this.update(state => { const badgeKey = `${key(record.agentId, record.reviewVersion)}:${record.badge}`; const existing = state.badges[badgeKey]; if (existing) return { record: structuredClone(existing), awarded: false }; state.badges[badgeKey] = structuredClone(record); return { record, awarded: true }; }); }
  private async update<T>(change: (state: LocalState) => T): Promise<T> {
    let result!: T;
    const operation = this.queue.catch(() => {}).then(async () => {
      const next = structuredClone(this.state); result = change(next); const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); await rename(temporary, this.file); this.state = next; }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    });
    this.queue = operation; await operation; return result;
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
    const [runs, drawings, bucket] = await Promise.all([this.client.from('agent_runs').select('id', { head: true, count: 'exact' }).limit(1), this.client.from('drawings').select('id', { head: true, count: 'exact' }).limit(1), this.client.storage.getBucket('learning-drawings')]);
    const unavailable = runs.error || drawings.error || bucket.error || !bucket.data || bucket.data.public;
    const value: DependencyStatus['database'] = unavailable ? { mode: this.mode, available: false, message: 'Supabase unavailable, Phase 4 migration missing, or learning-drawings is not private' } : { mode: this.mode, available: true, message: 'Supabase and private drawing storage available' };
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
  async getDrawing(agentId: string, version: string) { const { data, error } = await this.client.from('drawings').select('record').eq('agent_id', agentId).eq('review_version', version).maybeSingle(); return assertData(data, error)?.record as DrawingRecord ?? null; }
  async latestDrawing(agentId: string) { const { data, error } = await this.client.from('drawings').select('record').eq('agent_id', agentId).order('updated_at', { ascending: false }).limit(1).maybeSingle(); return assertData(data, error)?.record as DrawingRecord ?? null; }
  async saveDrawing(record: DrawingRecord, expectedRevision: number) {
    if (expectedRevision === 0) {
      const { data, error } = await this.client.from('drawings').insert({ id: record.id, agent_id: record.agentId, review_version: record.reviewVersion, revision: record.revision, status: record.status, storage_object_path: record.storageObjectPath ?? null, record, created_at: record.createdAt, updated_at: record.updatedAt, completed_at: record.completedAt ?? null }).select('record').single();
      if (error?.code === '23505') throw new ServiceError('DRAWING_SAVE_CONFLICT', 'A drawing already exists for this review. Reload it before saving.', 409, await this.getDrawing(record.agentId, record.reviewVersion));
      return assertData(data, error).record as DrawingRecord;
    }
    const { data, error } = await this.client.from('drawings').update({ revision: record.revision, status: record.status, storage_object_path: record.storageObjectPath ?? null, record, updated_at: record.updatedAt, completed_at: record.completedAt ?? null }).eq('agent_id', record.agentId).eq('review_version', record.reviewVersion).eq('revision', expectedRevision).select('record').maybeSingle();
    assertData(data, error); if (!data) throw new ServiceError('DRAWING_SAVE_CONFLICT', 'This drawing changed in another save. Reload it before saving again.', 409, await this.getDrawing(record.agentId, record.reviewVersion)); return data.record as DrawingRecord;
  }
  async saveChecklist(record: DrawingChecklistRecord) { const { error } = await this.client.from('drawing_checklists').upsert({ drawing_id: record.drawingId, agent_id: record.agentId, review_version: record.reviewVersion, checklist: record.checklist, completed: record.completed, created_at: record.createdAt, updated_at: record.updatedAt }, { onConflict: 'agent_id,review_version' }); assertData(true, error); return record; }
  async getChecklist(agentId: string, version: string) { const { data, error } = await this.client.from('drawing_checklists').select('*').eq('agent_id', agentId).eq('review_version', version).maybeSingle(); if (!data) return assertData(data, error); return { drawingId: data.drawing_id, agentId: data.agent_id, reviewVersion: data.review_version, checklist: data.checklist, completed: data.completed, createdAt: data.created_at, updatedAt: data.updated_at } as DrawingChecklistRecord; }
  async saveDrawingPreview(record: DrawingRecord, png: Uint8Array) { const objectPath = `${record.agentId}/${record.reviewVersion}/${record.id}.png`; const { error } = await this.client.storage.from('learning-drawings').upload(objectPath, png, { contentType: 'image/png', upsert: true, cacheControl: '3600' }); if (error) throw new ServiceError('DRAWING_UPLOAD_FAILED', `Private drawing upload failed: ${error.message}`, 503); return objectPath; }
  async readDrawingPreview(record: DrawingRecord) { if (!record.storageObjectPath) throw new ServiceError('DRAWING_NOT_FOUND', 'This drawing has no exported preview.', 404); const { data, error } = await this.client.storage.from('learning-drawings').download(record.storageObjectPath); if (error || !data) throw new ServiceError('STORAGE_UNAVAILABLE', 'The private drawing preview is unavailable.', 503); return new Uint8Array(await data.arrayBuffer()); }
  async getReviewerMark(agentId: string, version: string) { const { data, error } = await this.client.from('reviewer_rubric_marks').select('record').eq('agent_id', agentId).eq('review_version', version).maybeSingle(); return assertData(data, error)?.record as ReviewerMark ?? null; }
  async saveReviewerMark(record: ReviewerMark) { const { error } = await this.client.from('reviewer_rubric_marks').upsert({ id: record.id, drawing_id: record.drawingId, agent_id: record.agentId, review_version: record.reviewVersion, total: record.total, record, updated_at: record.updatedAt, created_at: record.createdAt }, { onConflict: 'agent_id,review_version' }); assertData(true, error); return record; }
  async listPoints(agentId: string, version: string) { const { data, error } = await this.client.from('point_transactions').select('record').eq('agent_id', agentId).eq('review_version', version).order('created_at'); return assertData(data, error).map((row: any) => row.record as PointTransaction); }
  async awardPoint(record: PointTransaction) { const { data, error } = await this.client.from('point_transactions').insert({ id: record.id, agent_id: record.agentId, review_version: record.reviewVersion, event_key: record.event, points: record.points, record, created_at: record.createdAt }).select('record').single(); if (error?.code === '23505') { const existing = (await this.listPoints(record.agentId, record.reviewVersion)).find(item => item.event === record.event)!; return { record: existing, awarded: false }; } return { record: assertData(data, error).record as PointTransaction, awarded: true }; }
  async listBadges(agentId: string, version: string) { const { data, error } = await this.client.from('badge_awards').select('record').eq('agent_id', agentId).eq('review_version', version).order('created_at'); return assertData(data, error).map((row: any) => row.record as BadgeAward); }
  async awardBadge(record: BadgeAward) { const { data, error } = await this.client.from('badge_awards').insert({ id: record.id, agent_id: record.agentId, review_version: record.reviewVersion, badge_key: record.badge, record, created_at: record.createdAt }).select('record').single(); if (error?.code === '23505') { const existing = (await this.listBadges(record.agentId, record.reviewVersion)).find(item => item.badge === record.badge)!; return { record: existing, awarded: false }; } return { record: assertData(data, error).record as BadgeAward, awarded: true }; }
}

export function createLearningStore(config: { mode?: string; directory: string; supabaseUrl?: string; supabaseSecretKey?: string }): LearningStore {
  if (config.mode === 'supabase') {
    if (!config.supabaseUrl || !config.supabaseSecretKey) throw new Error('DATABASE_UNAVAILABLE: STORAGE_MODE=supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
    return new SupabaseLearningStore(config.supabaseUrl, config.supabaseSecretKey);
  }
  if (config.mode && config.mode !== 'local') throw new Error('STORAGE_MODE must be explicitly set to local or supabase.');
  return new LocalLearningStore(config.directory);
}
