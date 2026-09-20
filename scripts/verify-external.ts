import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { GroqQuizProvider } from '../apps/server/src/quiz-service.js';
import { resolveExecutable } from '../apps/server/src/runners/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env') });
const requested = new Set(process.argv.slice(2));
const wants = (name: string) => requested.size === 0 || requested.has('--all') || requested.has(`--${name}`);
const exec = promisify(execFile);
let failed = false;

if (wants('supabase')) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) console.log('SKIPPED Supabase: not configured.');
  else {
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const id = `phase5-check-${randomUUID()}`; const objectPath = `_verification/${id}.png`;
    try {
      const tables = ['agent_runs', 'review_versions', 'explanations', 'quiz_definitions', 'quiz_attempts', 'merge_operations', 'drawings', 'drawing_checklists', 'reviewer_rubric_marks', 'point_transactions', 'badge_awards'];
      for (const table of tables) { const { error } = await client.from(table).select('*', { head: true, count: 'exact' }).limit(1); if (error) throw new Error(`${table}: ${error.message}`); }
      const now = new Date().toISOString(); const record = { id, name: 'Phase 5 verification', runner: 'demo', task: 'Temporary connectivity check', status: 'completed', createdAt: now, endedAt: now };
      const inserted = await client.from('agent_runs').insert({ id, status: 'completed', record, created_at: now }).select('id').single(); if (inserted.error || inserted.data?.id !== id) throw new Error(inserted.error?.message || 'temporary record was not returned');
      const read = await client.from('agent_runs').select('id').eq('id', id).single(); if (read.error || read.data?.id !== id) throw new Error(read.error?.message || 'temporary record could not be read');
      const bucket = await client.storage.getBucket('learning-drawings'); if (bucket.error || !bucket.data || bucket.data.public) throw new Error(bucket.error?.message || 'learning-drawings bucket is missing or public');
      const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
      const upload = await client.storage.from('learning-drawings').upload(objectPath, png, { contentType: 'image/png', upsert: false }); if (upload.error) throw new Error(upload.error.message);
      const download = await client.storage.from('learning-drawings').download(objectPath); if (download.error || !download.data || (await download.data.arrayBuffer()).byteLength !== png.byteLength) throw new Error(download.error?.message || 'private object round-trip did not match');
      console.log('LIVE PASS Supabase: connected; migrations present; temporary row and private object round-trip succeeded.');
    } catch (error) { failed = true; console.error(`LIVE FAIL Supabase: ${error instanceof Error ? error.message : 'unknown error'}`); }
    finally { await client.storage.from('learning-drawings').remove([objectPath]); await client.from('agent_runs').delete().eq('id', id); }
  }
}

if (wants('groq')) {
  if (!process.env.GROQ_API_KEY || !process.env.GROQ_MODEL) console.log('SKIPPED Groq: not configured.');
  else try {
    const after = "export function createTask(title) { if (typeof title !== 'string' || title.trim().length === 0) throw new TypeError('Task title must not be empty.'); return { title }; }";
    const id = createHash('sha256').update('task.js').digest('hex');
    const provider = new GroqQuizProvider(process.env.GROQ_API_KEY, process.env.GROQ_MODEL, 20_000);
    const questions = await provider.generate([{ id, path: 'task.js', before: 'export function createTask(title) { return { title }; }', after }]);
    if (questions.length !== 3) throw new Error('provider did not return exactly three validated questions');
    console.log(`LIVE PASS Groq: one structured quiz request validated with model ${process.env.GROQ_MODEL}.`);
  } catch (error) { failed = true; console.error(`LIVE FAIL Groq: ${error instanceof Error ? error.message : 'unknown error'}`); }
}

if (wants('codex')) {
  try { const executable = await resolveExecutable(process.env.CODEX_EXECUTABLE || 'codex'); const { stdout, stderr } = await exec(executable, ['--version'], { timeout: 5_000 }); console.log(`LOCAL PASS Codex CLI: ${(stdout || stderr).trim() || 'executable responded'}. Authentication was not probed and no coding task was started.`); }
  catch (error) { failed = true; console.error(`LOCAL FAIL Codex CLI: ${error instanceof Error ? error.message : 'unknown error'}`); }
}

process.exitCode = failed ? 1 : 0;
