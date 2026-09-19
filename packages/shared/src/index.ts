import { z } from 'zod';
export const launchSchema = z.object({ runner: z.enum(['demo', 'codex']), task: z.string().trim().min(1).max(8000) }).strict();
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(8192) }).strict(),
  z.object({ type: z.literal('resize'), cols: z.number().int().min(20).max(300), rows: z.number().int().min(5).max(120) }).strict(),
]);
export type LaunchInput = z.infer<typeof launchSchema>;
export type AgentStatus = 'creating' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed';
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
