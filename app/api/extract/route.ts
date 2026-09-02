import { NextRequest, NextResponse } from 'next/server';
import { extractEventFromSource } from '@/lib/gemini';
import { generateICSContent } from '@/lib/calendar-builder';
import { insertGoogleCalendarEvent } from '@/lib/google-calendar-api';
import { getUserGoogleAuth } from '@/lib/token-store';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, saveExtractedEvent } from '@/lib/db';
import { ExtractionRequest } from '@/lib/types';

export const maxDuration = 60; // 60 seconds serverless timeout

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let extractionParams: ExtractionRequest;
    let autoSync = false;
    let passedApiKey = '';
    let passedModel = '';
    let passedEngine = '';
    let customCalendarId = 'primary';

    // Retrieve session user if present
    const session = await getSessionFromRequest(req);
    let dbUser = null;
    if (session) {
      dbUser = (await getUserById(session.userId)) || (await getUserByEmail(session.email));
      if (dbUser?.calendar_id) {
        customCalendarId = dbUser.calendar_id;
      }
    }

    let userId = dbUser?.id || session?.userId || req.headers.get('x-user-id') || 'web_user';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const text = formData.get('text') as string | null;
      passedApiKey = (formData.get('apiKey') as string) || req.headers.get('x-api-key') || '';
      passedModel = (formData.get('model') as string) || '';
      passedEngine = (formData.get('engine') as string) || '';
      autoSync = formData.get('autoSync') === 'true';
      userId = (formData.get('userId') as string) || userId;
      if (formData.get('calendarId')) {
        customCalendarId = formData.get('calendarId') as string;
      }

      const finalApiKey = passedApiKey || dbUser?.gemini_api_key || process.env.GEMINI_API_KEY || '';
      const finalModel = passedModel || dbUser?.model_name || 'gemini-2.0-flash';
      const finalEngine = (passedEngine || dbUser?.ocr_engine || 'gemini') as any;

      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Data = buffer.toString('base64');
        const mimeType = file.type || 'application/pdf';
        const isPdf = mimeType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');

        extractionParams = {
          apiKey: finalApiKey,
          model: finalModel,
          engine: finalEngine,
          sourceType: isPdf ? 'pdf' : 'image',
          base64Data,
          mimeType,
          fileName: file.name
        };
      } else if (text) {
        extractionParams = {
          apiKey: finalApiKey,
          model: finalModel,
          engine: finalEngine,
          sourceType: 'text',
          text
        };
      } else {
        return NextResponse.json(
          { success: false, error: 'Mohon unggah berkas PDF/Gambar atau masukkan teks undangan.' },
          { status: 400 }
        );
      }
    } else {
      const body = await req.json();
      passedApiKey = body.apiKey || req.headers.get('x-api-key') || '';
      autoSync = Boolean(body.autoSync);
      userId = body.userId || userId;
      if (body.calendarId) customCalendarId = body.calendarId;

      const finalApiKey = passedApiKey || dbUser?.gemini_api_key || process.env.GEMINI_API_KEY || '';
      const finalModel = body.model || dbUser?.model_name || 'gemini-2.0-flash';
      const finalEngine = body.engine || dbUser?.ocr_engine || 'gemini';

      extractionParams = {
        ...body,
        apiKey: finalApiKey,
        model: finalModel,
        engine: finalEngine
      };
    }

    if (!extractionParams.apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Google Gemini API Key wajib diisi. Silakan isi di tab Pengaturan atau pada form.'
        },
        { status: 401 }
      );
    }

    const result = await extractEventFromSource(extractionParams);

    if (!result.success || !result.event) {
      return NextResponse.json(
        { success: false, error: result.error || 'Gagal mengekstrak agenda kegiatan.' },
        { status: 500 }
      );
    }

    // Attach ICS content string
    const icsContent = generateICSContent(result.event);

    let autoSyncResult: any = null;

    // Check if auto-sync to Google Calendar is active for this user
    if (autoSync || userId) {
      const userAuth = await getUserGoogleAuth(userId);
      if (userAuth && userAuth.refreshToken) {
        const directInsert = await insertGoogleCalendarEvent(userId, result.event, customCalendarId);
        if (directInsert.success) {
          autoSyncResult = {
            synced: true,
            email: userAuth.email,
            calendarId: customCalendarId,
            htmlLink: directInsert.htmlLink
          };
        }
      }
    }

    // Save to extracted_events history in Neon PostgreSQL
    let savedRecord = null;
    const targetUserId = session?.userId || dbUser?.id || session?.email || userId;
    if (targetUserId) {
      try {
        savedRecord = await saveExtractedEvent({
          user_id: targetUserId,
          title: result.event.title,
          start_time: result.event.start_time,
          end_time: result.event.end_time,
          is_online: result.event.is_online,
          location: result.event.location,
          meeting_link: result.event.meeting_link,
          meeting_id_pass: result.event.meeting_id_pass,
          jp: result.event.jp,
          speakers: result.event.speakers,
          description: result.event.description,
          google_calendar_url: autoSyncResult?.htmlLink || result.event.google_calendar_url,
          synced_to_calendar: Boolean(autoSyncResult?.synced),
          source_type: extractionParams.sourceType || 'web',
          file_name: extractionParams.fileName || (extractionParams.sourceType === 'text' ? 'Teks Undangan' : 'Dokumen')
        });
      } catch (err) {
        console.error('Failed to save extracted event record:', err);
      }
    }

    return NextResponse.json({
      ...result,
      icsContent,
      autoSyncResult,
      savedRecord
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Internal Server Error: ${err.message}` },
      { status: 500 }
    );
  }
}
