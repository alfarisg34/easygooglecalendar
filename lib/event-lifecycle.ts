import { google, calendar_v3 } from 'googleapis';
import { getGoogleOAuth2Client } from './google-auth';
import { getUserGoogleAuth } from './token-store';
import { updateUserGoogleTokens, CalendarBackup, ExtractedEventRecord } from './db';
import { EventOwner, findOwnedEvent, claimEventChange, saveLifecycleState } from './event-lifecycle-store';

export type LifecycleAction = 'cancel' | 'restore' | 'retry';

/** Legacy records stored only htmlLink. Decode its exact event/calendar identity; never guess from title. */
export function resolveCalendarIdentity(event: ExtractedEventRecord, fallbackCalendar: string): { eventId: string; calendarId: string } {
  let eventId = event.google_event_id || '';
  let calendarId = event.google_calendar_id || '';
  if (event.google_calendar_url) {
    try {
      const url = new URL(event.google_calendar_url);
      if (url.hostname === 'calendar.google.com' || url.hostname === 'www.google.com') {
        const eid = url.searchParams.get('eid');
        if (eid) {
          const decoded = Buffer.from(eid, 'base64').toString('utf8');
          const space = decoded.indexOf(' ');
          if (space > 0) {
            eventId ||= decoded.slice(0, space);
            calendarId ||= decoded.slice(space + 1);
          }
        }
      }
    } catch { /* Invalid legacy links are reported below. */ }
  }
  if (!eventId) throw new Error('ID kegiatan Google Calendar belum tersedia. Hubungi pengelola untuk menghubungkan riwayat lama; pengingat belum dapat diubah.');
  return { eventId, calendarId: calendarId || fallbackCalendar || 'primary' };
}

export function buildCalendarBackup(event: calendar_v3.Schema$Event): CalendarBackup {
  return {
    summary: event.summary || '', description: event.description || '', transparency: event.transparency || 'opaque',
    reminders: {
      useDefault: event.reminders?.useDefault ?? true,
      ...(event.reminders?.overrides ? { overrides: event.reminders.overrides.map(r => ({ method: r.method || 'popup', minutes: r.minutes ?? 15 })) } : {})
    }
  };
}

export function cancellationPayload(backup: CalendarBackup, reason: string, at: string): calendar_v3.Schema$Event {
  return {
    summary: `[DIBATALKAN] ${backup.summary}`,
    description: `${backup.description}\n\nDibatalkan melalui EasyCal pada ${at}.${reason ? `\nAlasan: ${reason}` : ''}`.trim(),
    transparency: 'transparent', reminders: { useDefault: false, overrides: [] }
  };
}

async function syncCalendar(owner: EventOwner, event: ExtractedEventRecord, fallbackCalendar: string): Promise<void> {
  const auth = await getUserGoogleAuth(owner.userId);
  if (!auth?.refreshToken) throw new Error('Hubungkan kembali akun Google untuk memperbarui kalender.');
  const oauth = getGoogleOAuth2Client();
  oauth.setCredentials({ refresh_token: auth.refreshToken, access_token: auth.accessToken, expiry_date: auth.expiryDate });
  oauth.on('tokens', tokens => {
    if (tokens.access_token) void updateUserGoogleTokens({ userId: owner.userId, accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || undefined, expiryDate: tokens.expiry_date || undefined })
      .catch(() => console.error('Could not persist refreshed lifecycle OAuth token'));
  });
  const calendar = google.calendar({ version: 'v3', auth: oauth });
  const identity = resolveCalendarIdentity(event, fallbackCalendar);
  const args = { calendarId: identity.calendarId, eventId: identity.eventId };
  const current = await calendar.events.get(args, { timeout: 20000, retry: false });
  if (current.data.status === 'cancelled') throw new Error('Kegiatan sudah dihapus di Google Calendar. Pulihkan di Google Calendar terlebih dahulu, lalu coba sinkronisasi lagi.');
  if (current.data.attendees?.length) throw new Error('Kegiatan ini memiliki peserta undangan. Kelola pembatalannya di Google Calendar agar pemberitahuan peserta ditangani dengan benar.');
  event.google_event_id = identity.eventId;
  event.google_calendar_id = identity.calendarId;
  if (event.activity_status === 'cancelled' && !event.calendar_backup) {
    event.calendar_backup = buildCalendarBackup(current.data);
    // Persist before patch so a retry cannot overwrite the original reminders/title.
    await saveLifecycleState(event);
  }
  if (event.activity_status === 'active' && !event.calendar_backup) {
    // A failed cancellation that never reached Google requires no restoration.
    return;
  }
  const backup = event.calendar_backup;
  if (!backup) throw new Error('Cadangan konfigurasi kalender belum tersedia.');
  const payload = event.activity_status === 'cancelled'
    ? cancellationPayload(backup, event.cancellation_reason || '', event.cancelled_at || new Date().toISOString())
    : { ...backup, reminders: { ...backup.reminders, overrides: backup.reminders.overrides || [] } };
  await calendar.events.patch({ ...args, requestBody: payload, sendUpdates: 'none' }, {
    timeout: 20000, retry: false, ...(current.data.etag ? { headers: { 'If-Match': current.data.etag } } : {})
  });
  if (event.activity_status === 'active') event.calendar_backup = null;
}

export async function changeEventLifecycle(params: {
  owner: EventOwner; eventId: string; action: LifecycleAction; expectedVersion: number;
  reason?: string; channel: 'web' | 'telegram'; calendarId?: string;
}): Promise<{ event: ExtractedEventRecord; message: string }> {
  const event = await findOwnedEvent(params.owner, params.eventId);
  if (!event) throw new Error('Kegiatan tidak ditemukan pada akun Anda.');
  if ((event.lifecycle_version || 0) !== params.expectedVersion) throw new Error('Kegiatan sudah berubah. Muat ulang daftar dan pilih kembali.');
  const current = event.activity_status || 'active';
  const target = params.action === 'retry' ? current : params.action === 'cancel' ? 'cancelled' : 'active';
  if (current === target && params.action !== 'retry') return { event, message: target === 'cancelled' ? 'Kegiatan sudah dibatalkan.' : 'Kegiatan sudah aktif.' };
  if (params.action === 'retry' && event.lifecycle_sync !== 'error' && event.lifecycle_sync !== 'processing') return { event, message: 'Kegiatan sudah tersinkronisasi.' };
  const reason = params.action === 'retry' ? event.cancellation_reason || '' : (params.reason || '').trim().slice(0, 500);
  const claimed = await claimEventChange(params.owner, event, target, reason, params.channel);
  if (!claimed) throw new Error('Kegiatan sedang diproses atau sudah berubah. Muat ulang dan coba lagi.');
  try {
    if (claimed.synced_to_calendar) {
      await syncCalendar(params.owner, claimed, params.calendarId || 'primary');
      claimed.lifecycle_sync = 'synced';
    } else claimed.lifecycle_sync = 'local';
    claimed.lifecycle_error = '';
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
    claimed.lifecycle_sync = 'error';
    claimed.lifecycle_error = code === 404 || code === 410 ? 'Kegiatan tidak ditemukan di Google Calendar. Pulihkan kegiatan di Google Calendar lalu coba lagi.'
      : code === 401 || code === 403 ? 'Akses kalender ditolak. Hubungkan ulang akun Google atau periksa izin kalender.'
      : code === 412 ? 'Kegiatan berubah di Google Calendar. Coba sinkronisasi lagi.'
      : error instanceof Error && !('config' in error) ? error.message : 'Google Calendar belum dapat diperbarui. Coba sinkronisasi lagi.';
  }
  await saveLifecycleState(claimed);
  const label = target === 'cancelled' ? 'dibatalkan' : 'diaktifkan kembali';
  const message = claimed.lifecycle_sync === 'error'
    ? `Kegiatan ${label} di EasyCal; Google Calendar belum diperbarui. ${target === 'cancelled' ? 'Pengingat mungkin masih aktif. ' : ''}${claimed.lifecycle_error}`
    : `Kegiatan ${label}. ${claimed.lifecycle_sync === 'synced' ? 'Google Calendar sudah diperbarui.' : 'Kegiatan ini belum tersinkronisasi ke Google Calendar.'}`;
  return { event: claimed, message };
}
