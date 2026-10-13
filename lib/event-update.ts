import { DateTime } from 'luxon';
import { CalendarEvent, EventUpdate } from './types';
import { ExtractedEventRecord } from './db';
import { normalizeTitleKeywords, calculateJaccardSimilarity } from './duplicate-detector';
import { EventOwner, findOwnedEvent, claimEventChange, saveLifecycleState } from './event-lifecycle-store';
import { changeEventLifecycle } from './event-lifecycle';

export function matchUpdateEvent(event: CalendarEvent, records: ExtractedEventRecord[]): ExtractedEventRecord | undefined {
  const title = normalizeTitleKeywords(event.title);
  if (title.length < 2) return undefined;
  const matches = records.filter(record => (record.activity_status || 'active') === 'active'
    && calculateJaccardSimilarity(title, normalizeTitleKeywords(record.title)) >= 0.8
    && (!event.update?.original_date || DateTime.fromISO(record.start_time).setZone('Asia/Jakarta').toISODate() === event.update.original_date));
  return matches.length === 1 ? matches[0] : undefined;
}

export function mergeEventUpdate(record: ExtractedEventRecord, update: EventUpdate): ExtractedEventRecord {
  const keys = Object.keys(update);
  if (keys.some(key => !['original_date', 'date', 'start_clock', 'end_clock', 'location'].includes(key))
    || Object.values(update).some(value => typeof value !== 'string')
    || !keys.some(key => key !== 'original_date')) throw new Error('Perubahan waktu atau tempat belum terbaca. Kirim ulang dengan keterangan yang jelas.');
  for (const date of [update.date, update.original_date]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid)) throw new Error('Tanggal perubahan tidak valid.');
  }
  for (const clock of [update.start_clock, update.end_clock]) {
    if (clock !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error('Jam perubahan tidak valid.');
  }
  const oldStart = DateTime.fromISO(record.start_time).setZone('Asia/Jakarta');
  const oldEnd = DateTime.fromISO(record.end_time).setZone('Asia/Jakarta');
  if (!oldStart.isValid || !oldEnd.isValid) throw new Error('Waktu kegiatan lama tidak valid.');
  const date = update.date || oldStart.toISODate();
  const start = DateTime.fromISO(`${date}T${update.start_clock || oldStart.toFormat('HH:mm:ss')}`, { zone: 'Asia/Jakarta' });
  const end = update.end_clock ? DateTime.fromISO(`${date}T${update.end_clock}`, { zone: 'Asia/Jakarta' })
    : start.plus({ milliseconds: oldEnd.toMillis() - oldStart.toMillis() });
  if (!start.isValid || !end.isValid || end <= start) throw new Error('Waktu selesai harus sesudah waktu mulai.');
  if (update.location !== undefined && !update.location.trim()) throw new Error('Tempat baru tidak boleh kosong.');
  return { ...record, start_time: start.toISO()!, end_time: end.toISO()!,
    ...(update.location !== undefined ? { location: update.location.trim() } : {}) };
}

export async function updateExistingEvent(params: {
  owner: EventOwner; eventId: string; expectedVersion: number; update: EventUpdate; calendarId?: string;
}): Promise<{ event: ExtractedEventRecord; message: string }> {
  const current = await findOwnedEvent(params.owner, params.eventId);
  if (!current || (current.lifecycle_version || 0) !== params.expectedVersion) throw new Error('Kegiatan berubah atau tidak ditemukan. Ketik /agenda dan pilih kembali.');
  if (current.activity_status === 'cancelled') throw new Error('Aktifkan kembali kegiatan sebelum memperbarui jadwal.');
  if (current.lifecycle_sync === 'error') throw new Error('Ketik sinkron sesuai nomor /agenda terlebih dahulu untuk menyelesaikan perubahan sebelumnya.');
  const updated = mergeEventUpdate(current, params.update);
  const claimed = await claimEventChange(params.owner, current, 'active', 'Perubahan waktu/tempat', 'telegram');
  if (!claimed) throw new Error('Kegiatan sedang diproses. Ketik /agenda dan coba lagi.');
  Object.assign(claimed, { start_time: updated.start_time, end_time: updated.end_time, location: updated.location });
  // Save desired schedule before Google call so /agenda -> sinkron can recover a failed patch.
  claimed.lifecycle_sync = 'error';
  await saveLifecycleState(claimed);
  const result = await changeEventLifecycle({ owner: params.owner, eventId: claimed.id, expectedVersion: claimed.lifecycle_version || 0,
    action: 'retry', channel: 'telegram', calendarId: params.calendarId });
  return { event: result.event, message: result.event.lifecycle_sync === 'error'
    ? `Perubahan disimpan di EasyCal; Google Calendar belum diperbarui. ${result.event.lifecycle_error} Ketik /agenda lalu sinkron sesuai nomor kegiatan.`
    : 'Waktu/tempat kegiatan diperbarui. ' + (result.event.synced_to_calendar ? 'Google Calendar sudah diperbarui.' : 'Kegiatan ini belum terhubung ke Google Calendar.') };
}
