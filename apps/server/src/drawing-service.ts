import { randomUUID } from 'node:crypto';
import { DRAWING_CAPTION_MIN, DRAWING_DATA_MAX_BYTES, DRAWING_IMAGE_MAX_BYTES, drawingCompleteSchema, drawingSaveSchema, nonWhitespaceLength, reviewerMarkSchema, type AgentRecord, type DrawingCompleteInput, type DrawingRecord, type DrawingSaveInput, type ReviewerMarkInput } from '@classroom/shared';
import type { LearningStore } from './learning-store.js';
import type { QuizService } from './quiz-service.js';
import type { ReviewService } from './review-service.js';
import { ServiceError } from './service-error.js';

export class DrawingService {
  constructor(private getAgent: (id: string) => AgentRecord, private reviews: ReviewService, private quizzes: QuizService, private store: LearningStore, readonly reviewerMode: boolean) {}

  async get(agentId: string, version: string) {
    this.getAgent(agentId); const current = await this.reviews.currentSnapshot(agentId);
    if (current.version !== version) throw new ServiceError('REVIEW_OUTDATED', 'That drawing request does not match the current review version.', 409);
    const drawing = await this.store.getDrawing(agentId, version); const latest = await this.store.latestDrawing(agentId);
    return { drawing, checklist: await this.store.getChecklist(agentId, version), reviewerMark: await this.store.getReviewerMark(agentId, version), previousDrawing: latest && latest.reviewVersion !== version ? latest : null, quizPassed: await this.quizzes.hasPassed(agentId, version), reviewerMode: this.reviewerMode };
  }

  async save(agentId: string, value: DrawingSaveInput) {
    this.assertPayloadSize(value); const parsed = drawingSaveSchema.safeParse(value);
    if (!parsed.success) throw new ServiceError('INVALID_DRAWING_DATA', 'Drawing data, title, caption, guide, or revision is invalid.', 400, parsed.error.flatten());
    const current = await this.current(agentId, parsed.data.version); const existing = await this.store.getDrawing(agentId, current.version);
    if (existing?.status === 'completed') throw new ServiceError('DRAWING_SAVE_CONFLICT', 'This drawing is already complete and preserved for this review.', 409, existing);
    const now = new Date().toISOString(); const record: DrawingRecord = { id: existing?.id ?? randomUUID(), agentId, reviewVersion: current.version, learnerId: 'local-session', drawingVersion: existing?.drawingVersion ?? ((await this.store.latestDrawing(agentId))?.drawingVersion ?? 0) + 1, revision: parsed.data.revision + 1, title: parsed.data.title, caption: parsed.data.caption, guide: parsed.data.guide, paths: parsed.data.paths, status: 'draft', createdAt: existing?.createdAt ?? now, updatedAt: now };
    return this.store.saveDrawing(record, parsed.data.revision);
  }

  async complete(agentId: string, value: DrawingCompleteInput) {
    this.assertPayloadSize(value); const parsed = drawingCompleteSchema.safeParse(value);
    if (!parsed.success) throw new ServiceError('INVALID_DRAWING_DATA', 'Drawing completion data is invalid or too large.', 400, parsed.error.flatten());
    const input = parsed.data; const current = await this.current(agentId, input.version); const existing = await this.store.getDrawing(agentId, input.version);
    if (existing?.status === 'completed' && existing.completionIdempotencyKey === input.idempotencyKey) return existing;
    if (!await this.quizzes.hasPassed(agentId, input.version)) throw new ServiceError('QUIZ_PASS_REQUIRED', 'Pass the quiz for this review version before completing the drawing.', 409);
    if (!input.title.trim()) throw new ServiceError('DRAWING_INCOMPLETE', 'Add a drawing title before completing it.', 400);
    if (nonWhitespaceLength(input.caption) < DRAWING_CAPTION_MIN) throw new ServiceError('DRAWING_INCOMPLETE', `The caption needs at least ${DRAWING_CAPTION_MIN} non-whitespace characters.`, 400);
    if (!input.paths.some(path => path.drawMode && path.paths.length > 0)) throw new ServiceError('DRAWING_INCOMPLETE', 'Add at least one pen stroke before completing the drawing.', 400);
    if (!Object.values(input.checklist).every(Boolean)) throw new ServiceError('DRAWING_INCOMPLETE', 'Complete all four learner checklist items before completing the drawing.', 400);
    const png = this.parsePng(input.previewDataUrl); const draft = await this.save(agentId, { version: input.version, revision: input.revision, title: input.title, caption: input.caption, guide: input.guide, paths: input.paths });
    let storageObjectPath: string;
    try { storageObjectPath = await this.store.saveDrawingPreview(draft, png); }
    catch (error) { throw new ServiceError('DRAWING_UPLOAD_FAILED', `Editable drawing data was saved as revision ${draft.revision}, but the preview upload failed. Retry completion to export it again. ${error instanceof Error ? error.message : ''}`.trim(), 503, draft); }
    const now = new Date().toISOString(); const checklist = { drawingId: draft.id, agentId, reviewVersion: current.version, checklist: input.checklist, completed: true, createdAt: now, updatedAt: now };
    try { await this.store.saveChecklist(checklist); } catch (error) { throw new ServiceError('STORAGE_UNAVAILABLE', `The editable drawing and PNG were saved, but completion metadata could not be persisted. Retry completion. ${error instanceof Error ? error.message : ''}`.trim(), 503, draft); }
    const completed: DrawingRecord = { ...draft, status: 'completed', storageObjectPath, completionIdempotencyKey: input.idempotencyKey, revision: draft.revision + 1, completedAt: now, updatedAt: now };
    return this.store.saveDrawing(completed, draft.revision);
  }

  async preview(agentId: string, version: string) { this.getAgent(agentId); const drawing = await this.store.getDrawing(agentId, version); if (!drawing || drawing.status !== 'completed') throw new ServiceError('DRAWING_NOT_FOUND', 'Completed drawing preview not found.', 404); return this.store.readDrawingPreview(drawing); }

  async mark(agentId: string, value: ReviewerMarkInput) {
    if (!this.reviewerMode) throw new ServiceError('REVIEWER_MODE_DISABLED', 'Local demo reviewer mode is disabled. Set ENABLE_DEMO_REVIEWER_MODE=true on the server to enable it.', 403);
    const parsed = reviewerMarkSchema.safeParse(value); if (!parsed.success) throw new ServiceError('INVALID_RUBRIC_SCORE', 'Each rubric criterion must be a whole number from 0 to 5.', 400, parsed.error.flatten());
    await this.current(agentId, parsed.data.version); const drawing = await this.store.getDrawing(agentId, parsed.data.version);
    if (!drawing || drawing.id !== parsed.data.drawingId || drawing.status !== 'completed') throw new ServiceError('DRAWING_NOT_FOUND', 'A completed drawing for this agent and review is required.', 404);
    const previous = await this.store.getReviewerMark(agentId, parsed.data.version); if (previous?.idempotencyKey === parsed.data.idempotencyKey) return previous; const now = new Date().toISOString(); const total = Object.values(parsed.data.criteria).reduce((sum, score) => sum + score, 0);
    return this.store.saveReviewerMark({ id: previous?.id ?? randomUUID(), drawingId: drawing.id, agentId, reviewVersion: parsed.data.version, criteria: parsed.data.criteria, total, feedback: parsed.data.feedback, mode: 'demo-reviewer', idempotencyKey: parsed.data.idempotencyKey, createdAt: previous?.createdAt ?? now, updatedAt: now });
  }

  private async current(agentId: string, version: string) { this.getAgent(agentId); const current = await this.reviews.currentSnapshot(agentId); if (current.version !== version) throw new ServiceError('REVIEW_OUTDATED', 'The code changed. Preserve this drawing as history and start or copy a drawing for the new review.', 409); return current; }
  private assertPayloadSize(value: unknown) { const drawing = value as { paths?: unknown }; if (Buffer.byteLength(JSON.stringify(drawing.paths ?? [])) > DRAWING_DATA_MAX_BYTES) throw new ServiceError('DRAWING_TOO_LARGE', 'The editable drawing data exceeds the 2 MB limit. Clear unnecessary strokes and try again.', 413); }
  private parsePng(value: string) { if (!value.startsWith('data:image/png;base64,')) throw new ServiceError('INVALID_DRAWING_DATA', 'The exported preview must be a PNG image.', 400); let bytes: Buffer; try { bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64'); } catch { throw new ServiceError('INVALID_DRAWING_DATA', 'The exported PNG could not be decoded.', 400); } if (!bytes.length || bytes.length > DRAWING_IMAGE_MAX_BYTES) throw new ServiceError('DRAWING_TOO_LARGE', 'The exported PNG exceeds the 4 MB limit.', 413); if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new ServiceError('INVALID_DRAWING_DATA', 'The exported preview is not a valid PNG.', 400); return bytes; }
}
