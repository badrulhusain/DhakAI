import { mkdir, readFile, rename, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExplanationRecord } from '@classroom/shared';
export class ExplanationStore {
  constructor(readonly directory: string) {}
  private location(agentId: string, version: string) { if (!/^[\w-]+$/.test(agentId) || !/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid explanation identifier.'); return path.join(this.directory, agentId, `${version}.json`); }
  async get(agentId: string, version: string): Promise<ExplanationRecord | null> { try { return JSON.parse(await readFile(this.location(agentId, version), 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Saved explanation could not be read.'); } }
  async latest(agentId: string): Promise<ExplanationRecord | null> { const folder = path.dirname(this.location(agentId, '0'.repeat(64))); const names = await readdir(folder).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; }); const records = await Promise.all(names.filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => this.get(agentId, n.slice(0, -5)))); return records.filter((r): r is ExplanationRecord => !!r).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null; }
  async save(record: ExplanationRecord) { const target = this.location(record.agentId, record.version); const temp = `${target}.${randomUUID()}.tmp`; try { await mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' }); await rename(temp, target); } catch { throw new Error('Save failed. Your answers are still in the form; try again.'); } finally { await rm(temp, { force: true }).catch(() => {}); } return record; }
}
