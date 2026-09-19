import { z } from 'zod';
export const launchSchema = z.object({ runner: z.enum(['demo', 'codex']), task: z.string().trim().min(1).max(8000) }).strict();
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(8192) }).strict(),
  z.object({ type: z.literal('resize'), cols: z.number().int().min(20).max(300), rows: z.number().int().min(5).max(120) }).strict(),
]);
export type LaunchInput = z.infer<typeof launchSchema>;
export type AgentStatus = 'creating' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'interrupted';
export interface AgentRecord { id: string; name: string; runner: LaunchInput['runner']; task: string; status: AgentStatus; branch?: string; baseBranch?: string; startCommit?: string; worktree?: string; createdAt: string; endedAt?: string; exitCode?: number; error?: string }
export const isActive = (status: AgentStatus) => ['creating','running','stopping'].includes(status);
export interface RepositoryInfo { name: string; baseBranch: string; startCommit: string; demoAllowed: boolean }
export type ServerMessage = { type: 'status'; agent: AgentRecord } | { type: 'output'; data: string } | { type: 'replay'; data: string } | { type: 'error'; message: string };

export const EXPLANATION_MIN = 30;
export const EXPLANATION_MAX = 6000;
export const answerKeys = ['problem', 'solution', 'edgeCase'] as const;
export const nonWhitespaceLength = (text: string) => Array.from(text.replace(/\s/gu, '')).length;
export const answersSchema = z.object({ problem: z.string().max(EXPLANATION_MAX), solution: z.string().max(EXPLANATION_MAX), edgeCase: z.string().max(EXPLANATION_MAX) }).strict();
export type Answers = z.infer<typeof answersSchema>;
export const explanationComplete = (answers: Answers) => answerKeys.every(key => nonWhitespaceLength(answers[key]) >= EXPLANATION_MIN);
export const explanationSchema = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/), answers: answersSchema, intent: z.enum(['draft', 'complete']) }).strict();
export type ExplanationInput = z.infer<typeof explanationSchema>;
export interface ExplanationRecord { agentId: string; version: string; answers: Answers; status: 'draft' | 'completed'; updatedAt: string; completedAt?: string }
export interface ReviewFile { id: string; path: string; previousPath?: string; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'type-changed'; oldMode: string; newMode: string; additions: number | null; deletions: number | null; unsupported: boolean; limited: boolean; reason?: string }
export interface ReviewSnapshot { agentId: string; version: string; createdAt: string; files: ReviewFile[]; additions: number; deletions: number; canComplete: boolean; explanation: ExplanationRecord | null; previousExplanation: ExplanationRecord | null; outdated: boolean }
export interface ReviewContent { version: string; fileId: string; before: string; after: string }

export type ServiceErrorCode =
  | 'BACKEND_UNREACHABLE' | 'TERMINAL_DISCONNECTED' | 'DATABASE_UNAVAILABLE'
  | 'GROQ_NOT_CONFIGURED' | 'QUIZ_GENERATION_FAILED' | 'REVIEW_OUTDATED'
  | 'EXPLANATION_REQUIRED' | 'QUIZ_NOT_PASSED' | 'AGENT_RUNNING'
  | 'DIRTY_BASE' | 'STALE_BASE' | 'MERGE_CONFLICT' | 'WORKTREE_MISSING'
  | 'MERGE_RECORD_PENDING' | 'INVALID_REQUEST' | 'NOT_FOUND'
  | 'DRAWING_NOT_FOUND' | 'DRAWING_TOO_LARGE' | 'INVALID_DRAWING_DATA'
  | 'DRAWING_SAVE_CONFLICT' | 'QUIZ_PASS_REQUIRED' | 'DRAWING_INCOMPLETE'
  | 'STORAGE_UNAVAILABLE' | 'DRAWING_UPLOAD_FAILED' | 'REVIEWER_MODE_DISABLED'
  | 'INVALID_RUBRIC_SCORE' | 'POINT_ALREADY_AWARDED' | 'SCORE_UNAVAILABLE';
export interface DependencyStatus {
  database: { mode: 'local' | 'supabase'; available: boolean; message: string };
  quizProvider: { mode: 'demo' | 'groq' | 'unavailable'; configured: boolean; message: string; model?: string };
  reviewerMode?: { enabled: boolean; label: string };
}
export const optionSchema = z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(1000) }).strict();
export const evidenceSchema = z.object({ fileId: z.string().regex(/^[a-f0-9]{64}$/), path: z.string().min(1).max(4096), excerpt: z.string().min(1).max(3000) }).strict();
export const quizQuestionPrivateSchema = z.object({
  id: z.string().min(1).max(80), prompt: z.string().min(1).max(2000),
  options: z.array(optionSchema).length(4), correctOptionId: z.string().min(1).max(80),
  explanation: z.string().min(1).max(3000), evidence: evidenceSchema,
}).strict().superRefine((question, context) => {
  const ids = question.options.map(option => option.id);
  if (new Set(ids).size !== 4) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Option IDs must be distinct.' });
  if (new Set(question.options.map(option => option.text.trim().toLowerCase())).size !== 4) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Option text must be distinct.' });
  if (!ids.includes(question.correctOptionId)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Correct option must belong to the question.' });
});
export const quizQuestionsSchema = z.object({ questions: z.array(quizQuestionPrivateSchema).length(3) }).strict().superRefine((quiz, context) => {
  if (new Set(quiz.questions.map(question => question.id)).size !== 3) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Question IDs must be distinct.' });
});
export type QuizQuestionPrivate = z.infer<typeof quizQuestionPrivateSchema>;
export type QuizQuestion = Omit<QuizQuestionPrivate, 'correctOptionId' | 'explanation'>;
export interface QuizDefinition { id: string; agentId: string; version: string; provider: 'demo' | 'groq'; model: string; label: string; questions: QuizQuestionPrivate[]; createdAt: string }
export interface PublicQuiz { id: string; agentId: string; version: string; provider: 'demo' | 'groq'; label: string; questions: QuizQuestion[]; createdAt: string; attemptCount: number; passed: boolean }
export const quizSubmissionSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/), quizId: z.string().uuid(), submissionId: z.string().uuid(),
  answers: z.array(z.object({ questionId: z.string().min(1).max(80), optionId: z.string().min(1).max(80) }).strict()).length(3),
}).strict();
export type QuizSubmission = z.infer<typeof quizSubmissionSchema>;
export interface QuizFeedback { questionId: string; selectedOptionId: string; correctOptionId: string; correct: boolean; explanation: string }
export interface QuizAttempt { id: string; submissionId: string; quizId: string; agentId: string; version: string; selections: Record<string, string>; score: number; passed: boolean; feedback: QuizFeedback[]; createdAt: string }
export interface MergeBlocker { code: ServiceErrorCode; message: string }
export interface MergeEligibility { eligible: boolean; version?: string; blockers: MergeBlocker[]; existingOperation?: MergeOperation }
export interface MergeOperation { id: string; agentId: string; version: string; status: 'pending' | 'succeeded' | 'record-pending' | 'failed'; branch: string; baseCommit: string; resultCommit?: string; errorCode?: ServiceErrorCode; error?: string; validation?: { status: 'passed' | 'failed' | 'not-configured'; message: string }; createdAt: string; updatedAt: string }

export const DRAWING_TITLE_MAX = 120;
export const DRAWING_CAPTION_MIN = 30;
export const DRAWING_CAPTION_MAX = 1200;
export const DRAWING_DATA_MAX_BYTES = 2 * 1024 * 1024;
export const DRAWING_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const drawingGuideSchema = z.enum(['blank', 'flowchart', 'before-after', 'input-condition-result']);
export type DrawingGuide = z.infer<typeof drawingGuideSchema>;
export const drawingPathSchema = z.object({
  paths: z.array(z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000) }).strict()).min(1).max(20000),
  strokeWidth: z.number().finite().min(1).max(40),
  strokeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  drawMode: z.boolean(),
  startTimestamp: z.number().finite().optional(),
  endTimestamp: z.number().finite().optional(),
}).strict();
export type DrawingPath = z.infer<typeof drawingPathSchema>;
export const drawingChecklistSchema = z.object({ input: z.boolean(), condition: z.boolean(), result: z.boolean(), edgeCase: z.boolean() }).strict();
export type DrawingChecklist = z.infer<typeof drawingChecklistSchema>;
export const drawingSaveSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().min(0),
  title: z.string().trim().max(DRAWING_TITLE_MAX), caption: z.string().max(DRAWING_CAPTION_MAX),
  guide: drawingGuideSchema, paths: z.array(drawingPathSchema).max(5000),
}).strict();
export const drawingCompleteSchema = drawingSaveSchema.extend({
  checklist: drawingChecklistSchema,
  previewDataUrl: z.string().max(Math.ceil(DRAWING_IMAGE_MAX_BYTES * 1.4)),
  idempotencyKey: z.string().uuid(),
}).strict();
export type DrawingSaveInput = z.infer<typeof drawingSaveSchema>;
export type DrawingCompleteInput = z.infer<typeof drawingCompleteSchema>;
export interface DrawingRecord {
  id: string; agentId: string; reviewVersion: string; learnerId?: string; drawingVersion: number;
  revision: number; title: string; caption: string; guide: DrawingGuide; paths: DrawingPath[];
  status: 'draft' | 'completed'; storageObjectPath?: string; createdAt: string; updatedAt: string; completedAt?: string;
}
export interface DrawingChecklistRecord { drawingId: string; agentId: string; reviewVersion: string; checklist: DrawingChecklist; completed: boolean; createdAt: string; updatedAt: string }
export const rubricCriteriaSchema = z.object({ relationship: z.number().int().min(0).max(5), flow: z.number().int().min(0).max(5), condition: z.number().int().min(0).max(5), edgeCase: z.number().int().min(0).max(5) }).strict();
export const reviewerMarkSchema = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/), drawingId: z.string().uuid(), criteria: rubricCriteriaSchema, feedback: z.string().max(3000), idempotencyKey: z.string().uuid() }).strict();
export type ReviewerMarkInput = z.infer<typeof reviewerMarkSchema>;
export interface ReviewerMark { id: string; drawingId: string; agentId: string; reviewVersion: string; criteria: z.infer<typeof rubricCriteriaSchema>; total: number; feedback: string; mode: 'demo-reviewer'; createdAt: string; updatedAt: string }
export const pointEvents = ['explanation_completed', 'quiz_passed', 'quiz_first_attempt', 'drawing_completed', 'drawing_checklist_complete', 'merge_verified'] as const;
export type PointEvent = typeof pointEvents[number];
export interface PointTransaction { id: string; agentId: string; reviewVersion: string; event: PointEvent; points: number; createdAt: string }
export const badgeKeys = ['code_reader', 'quiz_master', 'visual_thinker', 'safe_merger', 'full_journey'] as const;
export type BadgeKey = typeof badgeKeys[number];
export interface BadgeAward { id: string; agentId: string; reviewVersion: string; badge: BadgeKey; createdAt: string }
export interface ScoreActivity { event: PointEvent; label: string; earned: number; available: number }
export interface ScoreSummary {
  agentId: string; reviewVersion: string; stale: boolean; total: number; maximum: 100; remaining: number;
  activities: ScoreActivity[]; transactions: PointTransaction[]; badges: BadgeAward[];
  drawingCompletion: { earned: number; available: 10 }; reviewerMark: ReviewerMark | null;
}
