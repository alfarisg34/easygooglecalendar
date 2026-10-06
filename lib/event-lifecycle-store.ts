import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { initDatabase, ExtractedEventRecord } from './db';

export interface EventOwner {
  userId: string;
  email?: string;
  telegramChatId?: string;
}

export function ownerIds(owner: EventOwner): string[] {
  const raw = owner.telegramChatId?.replace(/^tg_/, '');
  return [...new Set([owner.userId, owner.email, ...(raw ? [raw, `tg_${raw}`] : [])]
    .filter((id): id is string => Boolean(id)))];
}

async function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL;
  if (!url) return null;
  if (!await initDatabase()) throw new Error('Database belum dapat diakses. Coba lagi.');
  return neon(url);
}

const localPath = path.join(process.cwd(), '.user_events.json');
function localEvents(): ExtractedEventRecord[] {
  return fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) as ExtractedEventRecord[] : [];
}

export async function findOwnedEvent(owner: EventOwner, id: string): Promise<ExtractedEventRecord | null> {
  const sql = await database();
  const ids = ownerIds(owner);
  if (sql) {
    const rows = await sql`SELECT * FROM extracted_events WHERE id = ${id} AND user_id = ANY(${ids}) LIMIT 1`;
    return (rows[0] as ExtractedEventRecord | undefined) || null;
  }
  return localEvents().find(e => e.id === id && ids.includes(e.user_id)) || null;
}

export async function listOwnedAgenda(owner: EventOwner, status: 'active' | 'cancelled', page: number = 1): Promise<{ events: ExtractedEventRecord[]; total: number }> {
  const sql = await database();
  const ids = ownerIds(owner);
  const offset = (page - 1) * 10;
  const cutoff = new Date().toISOString();
  if (sql) {
    const count = await sql`SELECT COUNT(*)::int AS total FROM extracted_events WHERE user_id = ANY(${ids})
      AND activity_status = ${status} AND (${status} = 'cancelled' OR end_time::timestamptz >= ${cutoff}::timestamptz)`;
    const rows = await sql`SELECT * FROM extracted_events WHERE user_id = ANY(${ids})
      AND activity_status = ${status} AND (${status} = 'cancelled' OR end_time::timestamptz >= ${cutoff}::timestamptz)
      ORDER BY start_time::timestamptz ASC, id ASC LIMIT 10 OFFSET ${offset}`;
    return { events: rows as ExtractedEventRecord[], total: Number(count[0].total) };
  }
  const events = localEvents().filter(e => ids.includes(e.user_id) && (e.activity_status || 'active') === status
    && (status === 'cancelled' || Date.parse(e.end_time) >= Date.parse(cutoff)))
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time) || a.id.localeCompare(b.id));
  return { events: events.slice(offset, offset + 10), total: events.length };
}

/** Atomic version claim prevents competing web/Telegram actions from updating Google simultaneously. */
export async function claimEventChange(owner: EventOwner, event: ExtractedEventRecord, status: 'active' | 'cancelled', reason: string, channel: 'web' | 'telegram'): Promise<ExtractedEventRecord | null> {
  const sql = await database();
  const version = event.lifecycle_version || 0;
  const now = new Date().toISOString();
  const retry = (event.activity_status || 'active') === status;
  const entry = JSON.stringify([{ status, reason, channel, at: now, retry }]);
  const ids = ownerIds(owner);
  if (sql) {
    const rows = await sql`UPDATE extracted_events SET activity_status = ${status}, lifecycle_version = lifecycle_version + 1,
      lifecycle_sync = 'processing', lifecycle_error = NULL, lifecycle_updated_at = ${now},
      cancellation_reason = CASE WHEN ${status} = 'cancelled' THEN ${reason} ELSE cancellation_reason END,
      cancelled_at = CASE WHEN ${status} = 'cancelled' AND NOT ${retry} THEN ${now}::timestamptz ELSE cancelled_at END,
      lifecycle_channel = ${channel}, lifecycle_history = lifecycle_history || ${entry}::jsonb
      WHERE id = ${event.id} AND user_id = ANY(${ids}) AND lifecycle_version = ${version}
      AND (lifecycle_sync != 'processing' OR lifecycle_updated_at < NOW() - INTERVAL '2 minutes') RETURNING *`;
    return (rows[0] as ExtractedEventRecord | undefined) || null;
  }
  const events = localEvents();
  const found = events.find(e => e.id === event.id && ids.includes(e.user_id));
  if (!found || (found.lifecycle_version || 0) !== version || (found.lifecycle_sync === 'processing'
    && Date.parse(found.lifecycle_updated_at || now) > Date.now() - 120000)) return null;
  Object.assign(found, { activity_status: status, lifecycle_version: version + 1, lifecycle_sync: 'processing',
    lifecycle_error: '', lifecycle_updated_at: now, lifecycle_channel: channel,
    ...(status === 'cancelled' ? { cancellation_reason: reason, cancelled_at: retry ? found.cancelled_at : now } : {}) });
  const historyEvent = found as ExtractedEventRecord & { lifecycle_history?: unknown[] };
  historyEvent.lifecycle_history = [...(historyEvent.lifecycle_history || []), ...JSON.parse(entry) as unknown[]];
  fs.writeFileSync(localPath, JSON.stringify(events, null, 2));
  return found;
}

export async function saveLifecycleState(event: ExtractedEventRecord): Promise<void> {
  const sql = await database();
  if (sql) {
    const rows = await sql`UPDATE extracted_events SET lifecycle_sync = ${event.lifecycle_sync || 'synced'},
      lifecycle_error = ${event.lifecycle_error || null}, calendar_backup = ${JSON.stringify(event.calendar_backup || null)}::jsonb,
      google_event_id = ${event.google_event_id || ''}, google_calendar_id = ${event.google_calendar_id || ''}
      WHERE id = ${event.id} AND lifecycle_version = ${event.lifecycle_version || 0} RETURNING id`;
    if (!rows.length) throw new Error('Kegiatan berubah saat sinkronisasi. Muat ulang daftar.');
    return;
  }
  const events = localEvents();
  const index = events.findIndex(e => e.id === event.id && (e.lifecycle_version || 0) === event.lifecycle_version);
  if (index < 0) throw new Error('Kegiatan berubah saat sinkronisasi. Muat ulang daftar.');
  events[index] = event;
  fs.writeFileSync(localPath, JSON.stringify(events, null, 2));
}

export interface AgendaSession {
  ids: string[];
  versions: number[];
  status: 'active' | 'cancelled';
  pending?: { id: string; version: number; action: 'cancel' | 'restore'; reason: string; token: string };
  expiresAt: number;
}
const sessionPath = path.join(process.cwd(), '.telegram_agenda_sessions.json');
function localSessions(): Record<string, AgendaSession> {
  return fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as Record<string, AgendaSession> : {};
}

export async function readAgendaSession(key: string): Promise<AgendaSession | null> {
  const sql = await database();
  let session: AgendaSession | undefined;
  if (sql) {
    const rows = await sql`SELECT payload FROM telegram_agenda_sessions WHERE session_key = ${key} AND expires_at > NOW()`;
    session = rows[0]?.payload as AgendaSession | undefined;
  } else session = localSessions()[key];
  return session && session.expiresAt > Date.now() ? session : null;
}

export async function writeAgendaSession(key: string, session: AgendaSession): Promise<void> {
  const sql = await database();
  if (sql) {
    await sql`INSERT INTO telegram_agenda_sessions (session_key, payload, expires_at)
      VALUES (${key}, ${JSON.stringify(session)}::jsonb, ${new Date(session.expiresAt).toISOString()})
      ON CONFLICT (session_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`;
    return;
  }
  const sessions = localSessions();
  sessions[key] = session;
  fs.writeFileSync(sessionPath, JSON.stringify(sessions, null, 2));
}
