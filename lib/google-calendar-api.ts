import { google } from 'googleapis';
import { CalendarEvent } from './types';
import { getGoogleOAuth2Client } from './google-auth';
import { getUserGoogleAuth, saveUserGoogleAuth } from './token-store';

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

    // Listen to token refresh events and update token-store automatically
    oauth2Client.on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        userAuth.accessToken = newTokens.access_token;
        if (newTokens.refresh_token) userAuth.refreshToken = newTokens.refresh_token;
        if (newTokens.expiry_date) userAuth.expiryDate = newTokens.expiry_date;
        userAuth.updatedAt = new Date().toISOString();
        await saveUserGoogleAuth(userAuth);
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

    const res = await calendar.events.insert({
      calendarId: targetCalendarId,
      requestBody: calendarPayload
    });

    return {
      success: true,
      htmlLink: res.data.htmlLink || undefined,
      eventId: res.data.id || undefined
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal menambahkan event ke Google Calendar: ${err.message}`
    };
  }
}
