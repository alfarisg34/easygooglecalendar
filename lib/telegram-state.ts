import { neon } from '@neondatabase/serverless';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

/** Encrypted durable state. Production must never fall back to ephemeral files. */
export interface BotState<T> { id: string; kind: string; value: T; version: number; due: number; expires: number }
const localPath = path.join(process.cwd(), '.telegram_state.json');
function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET wajib dikonfigurasi.');
  return createHash('sha256').update(secret || 'easycal-local-development-only').digest();
}
function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function open<T>(value: string): T {
  const bytes = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')) as T;
}
interface Stored { id: string; kind: string; payload: string; version: number; due: number; expires: number }
let initialized: Promise<void> | undefined;
async function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') throw new Error('Database persisten wajib untuk bot produksi.');
    return null;
  }
  const sql = neon(url);
  if (!initialized) initialized = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS telegram_state (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, due BIGINT NOT NULL, expires BIGINT NOT NULL)`;
    await sql`CREATE INDEX IF NOT EXISTS telegram_state_due_idx ON telegram_state (kind, due)`;
  })().catch(error => { initialized = undefined; throw error; });
  await initialized;
  return sql;
}
function local(): Record<string, Stored> {
  return fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) as Record<string, Stored> : {};
}
const decode = <T>(row: Stored): BotState<T> => ({ ...row, due: Number(row.due), expires: Number(row.expires), value: open<T>(row.payload) });
export async function readBotState<T>(id: string): Promise<BotState<T> | null> {
  const sql = await database();
  const row = sql ? (await sql`SELECT * FROM telegram_state WHERE id = ${id} AND expires > ${Date.now()}`)[0] as Stored | undefined : local()[id];
  return row && Number(row.expires) > Date.now() ? decode<T>(row) : null;
}
/** expected=0 inserts; otherwise compare-and-swap prevents parallel workers/callbacks. */
export async function writeBotState<T>(id: string, kind: string, value: T, expected = 0, due = Date.now(), expires = Date.now() + 86400000): Promise<boolean> {
  const payload = seal(value);
  const sql = await database();
  if (sql) {
    const rows = expected === 0
      ? await sql`INSERT INTO telegram_state (id,kind,payload,version,due,expires) VALUES (${id},${kind},${payload},1,${due},${expires}) ON CONFLICT (id) DO NOTHING RETURNING id`
      : await sql`UPDATE telegram_state SET payload=${payload},version=version+1,due=${due},expires=${expires} WHERE id=${id} AND version=${expected} RETURNING id`;
    return rows.length === 1;
  }
  const rows = local();
  if ((rows[id]?.version || 0) !== expected) return false;
  rows[id] = { id, kind, payload, version: expected + 1, due, expires };
  fs.writeFileSync(localPath, JSON.stringify(rows));
  return true;
}
export async function dueBotStates<T>(kind: string, limit = 20): Promise<BotState<T>[]> {
  const sql = await database();
  const now = Date.now();
  const rows = sql ? await sql`SELECT * FROM telegram_state WHERE kind=${kind} AND due<=${now} AND expires>${now} ORDER BY due LIMIT ${limit}`
    : Object.values(local()).filter(row => row.kind === kind && row.due <= now && row.expires > now).sort((a,b) => a.due-b.due).slice(0,limit);
  return (rows as Stored[]).map(row => decode<T>(row));
}
export async function cleanBotStates(): Promise<void> {
  const sql = await database();
  if (sql) await sql`DELETE FROM telegram_state WHERE expires < ${Date.now()}`;
  else { const rows = local(); for (const [id,row] of Object.entries(rows)) if (row.expires < Date.now()) delete rows[id]; fs.writeFileSync(localPath, JSON.stringify(rows)); }
}
export const botIdentity = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 24);
