import { isInvalidGoogleGrant, GOOGLE_RECONNECT_MESSAGE } from './google-api-error';
import { google, calendar_v3 } from 'googleapis';
import { CalendarEvent } from './types';
import { getGoogleOAuth2Client } from './google-auth';
import { getUserGoogleAuth, saveUserGoogleAuth } from './token-store';
import { updateUserGoogleTokens } from './db';
import { createEventFolderAndUpload } from './google-drive-api';
import { createHash } from 'crypto';
import { telegramContext } from './telegram-context';
import { safeError } from './safe-error';

export interface CalendarAttachmentResult {
  attached: boolean;
  error?: string;
}

/** Append a Drive file without replacing unrelated attachments or recreating the event. */
export async function attachDriveFileToCalendarEvent(params: {
  userId: string | number; eventId: string; calendarId?: string;
  file: { fileId: string; fileUrl: string; fileName?: string; mimeType?: string };
}): Promise<CalendarAttachmentResult> {
  try {
    const auth = await getUserGoogleAuth(params.userId);
    if (!auth?.refreshToken) return { attached: false, error: GOOGLE_RECONNECT_MESSAGE };
    const oauth = getGoogleOAuth2Client();
    oauth.setCredentials({ refresh_token: auth.refreshToken, access_token: auth.accessToken, expiry_date: auth.expiryDate });
    oauth.on('tokens', tokens => {
      if (!tokens.access_token) return;
      void (async () => {
        await updateUserGoogleTokens({ userId: auth.userId || params.userId, accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token || undefined, expiryDate: tokens.expiry_date || undefined });
        await saveUserGoogleAuth({ ...auth, accessToken: tokens.access_token!, refreshToken: tokens.refresh_token || auth.refreshToken,
          expiryDate: tokens.expiry_date || auth.expiryDate, updatedAt: new Date().toISOString() });
      })().catch(() => console.error('Could not persist attachment OAuth token'));
    });
    const calendar = google.calendar({ version: 'v3', auth: oauth });
    const identity = { calendarId: params.calendarId?.trim() || 'primary', eventId: params.eventId };
    const current = await calendar.events.get(identity, { timeout: 10000, retry: false });
    if (current.data.status === 'cancelled') return { attached: false, error: 'Event sudah dihapus di Google Calendar.' };
    const existing = current.data.attachments || [];
    if (existing.some(file => file.fileId === params.file.fileId || file.fileUrl === params.file.fileUrl)) return { attached: true };
    if (existing.length >= 25) return { attached: false, error: 'Batas 25 lampiran pada event Google Calendar sudah tercapai.' };
    const attachments: calendar_v3.Schema$EventAttachment[] = existing.map(file => ({
      fileUrl: file.fileUrl, title: file.title, mimeType: file.mimeType,
      ...(!file.fileId && file.iconLink ? { iconLink: file.iconLink } : {})
    }));
    attachments.push({ fileUrl: params.file.fileUrl, title: params.file.fileName || 'Berkas undangan', mimeType: params.file.mimeType });
    await calendar.events.patch({ ...identity, supportsAttachments: true, sendUpdates: 'none', requestBody: { attachments } }, {
      timeout: 10000, retry: false, ...(current.data.etag ? { headers: { 'If-Match': current.data.etag } } : {})
    });
    return { attached: true };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
    return { attached: false, error: isInvalidGoogleGrant(error) ? GOOGLE_RECONNECT_MESSAGE
      : code === 412 ? 'Event berubah di Google Calendar saat lampiran dipasang. Berkas tetap tersedia di Drive.'
      : code === 401 || code === 403 ? 'Izin untuk memasang lampiran ditolak. Periksa akses Google Calendar dan Drive.'
      : 'Lampiran belum dapat dipasang di Google Calendar. Berkas yang sudah diunggah tetap tersedia di Drive.' };
  }
}

/** Keep event creation independent from archival/attachment failures. */
export async function syncGoogleCalendarEventWithSource(params: Parameters<typeof createEventFolderAndUpload>[0] & { calendarId?: string }) {
  const insertResult = await insertGoogleCalendarEvent(params.userId, params.event, params.calendarId);
  let gdriveResult: Awaited<ReturnType<typeof createEventFolderAndUpload>>;
  try { gdriveResult = await createEventFolderAndUpload(params); }
  catch { gdriveResult = { success: false, error: 'Berkas sumber belum dapat diunggah ke Google Drive.' }; }
  let attachmentResult: CalendarAttachmentResult = { attached: false,
    error: !insertResult.success ? 'Event belum berhasil dibuat di Google Calendar.'
      : gdriveResult.error || 'Berkas sumber belum tersedia untuk dilampirkan.' };
  if (insertResult.success && insertResult.eventId && gdriveResult.fileId && gdriveResult.fileUrl) {
    attachmentResult = await attachDriveFileToCalendarEvent({ userId: params.userId, calendarId: params.calendarId,
      eventId: insertResult.eventId, file: { fileId: gdriveResult.fileId, fileUrl: gdriveResult.fileUrl,
        fileName: gdriveResult.fileName, mimeType: gdriveResult.mimeType } });
  }
  return { insertResult, gdriveResult, attachmentResult };
}

/**
 * Inserts an event directly into a user's Google Calendar using their stored refresh_token
 */
export async function insertGoogleCalendarEvent(
  userId: string | number,
  event: CalendarEvent,
  customCalendarId?: string
): Promise<{
  success: boolean;
  htmlLink?: string;
  eventId?: string;
  error?: string;
}> {
  const userAuth = await getUserGoogleAuth(userId);
  if (!userAuth || !userAuth.refreshToken) {
    return {
      success: false,
      error: 'Akun Google belum terhubung. Silakan hubungkan akun Google terlebih dahulu.'
    };
  }

  try {
    const oauth2Client = getGoogleOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: userAuth.refreshToken,
      access_token: userAuth.accessToken,
      expiry_date: userAuth.expiryDate
    });

    // Listen to token refresh events and update token-store and Neon DB automatically
    oauth2Client.on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        userAuth.accessToken = newTokens.access_token;
        if (newTokens.refresh_token) userAuth.refreshToken = newTokens.refresh_token;
        if (newTokens.expiry_date) userAuth.expiryDate = newTokens.expiry_date;
        userAuth.updatedAt = new Date().toISOString();
        await saveUserGoogleAuth(userAuth);
        await updateUserGoogleTokens({
          userId: userAuth.userId || userId,
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || undefined,
          expiryDate: newTokens.expiry_date || undefined
        });
      }
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Format rich description
    let descriptionText = '';
    if (event.jp) descriptionText += `📚 Jam Pelajaran / Sertifikat: ${event.jp}\n`;
    if (event.meeting_link) descriptionText += `🔗 Link Meeting: ${event.meeting_link}\n`;
    if (event.meeting_id_pass) descriptionText += `🔑 Kredensial: ${event.meeting_id_pass}\n`;
    if (event.speakers) descriptionText += `👥 Narasumber: ${event.speakers}\n\n`;
    if (event.description) descriptionText += `📝 Agenda & Rincian:\n${event.description}`;

    const calendarPayload: any = {
      summary: event.title || 'Agenda Kegiatan / Rapat',
      location: event.location || (event.is_online ? 'Zoom Meeting' : ''),
      description: descriptionText.trim(),
      start: {
        dateTime: event.start_time,
        timeZone: 'Asia/Jakarta'
      },
      end: {
        dateTime: event.end_time,
        timeZone: 'Asia/Jakarta'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 },
          { method: 'popup', minutes: 60 }
        ]
      }
    };

    const targetCalendarId = customCalendarId && customCalendarId.trim() ? customCalendarId.trim() : 'primary';

    const operation=telegramContext.getStore()?.operationId;
    const stableId=operation?createHash('sha256').update(`${userId}:${targetCalendarId}:${operation}`).digest('hex'):undefined;
    if(stableId)calendarPayload.id=stableId;
    let res;
    try {res = await calendar.events.insert({
      calendarId: targetCalendarId,
      requestBody: calendarPayload
    },{timeout:15000,retry:false});}
    catch(error) {
      if(!stableId || !error || typeof error!=='object' || !('code' in error) || Number(error.code)!==409)throw error;
      res=await calendar.events.get({calendarId:targetCalendarId,eventId:stableId},{timeout:10000,retry:false});
      if(res.data.status==='cancelled')throw new Error('Event pemrosesan ini sudah dihapus; tidak dibuat ulang.');
    }

    return {
      success: true,
      htmlLink: res.data.htmlLink || undefined,
      eventId: res.data.id || undefined
    };
  } catch (err: any) {
    const code=Number(err.code||err.response?.status||0);
    const context=telegramContext.getStore();
    if(context && !isInvalidGoogleGrant(err) && (code===429||code>=500||/ECONN|ETIMEDOUT|timeout|fetch failed/i.test(String(err.message))))context.retryableFailure=true;
    return {
      success: false,
      error: isInvalidGoogleGrant(err) ? GOOGLE_RECONNECT_MESSAGE : `Gagal menambahkan event ke Google Calendar: ${safeError(err)}`
    };
  }
}
