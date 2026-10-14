import { NextRequest, NextResponse } from 'next/server';
import { extractEventFromSource } from '@/lib/gemini';
import { generateICSContent } from '@/lib/calendar-builder';
import { syncGoogleCalendarEventWithSource, CalendarAttachmentResult } from '@/lib/google-calendar-api';
import { getUserGoogleAuth } from '@/lib/token-store';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, saveExtractedEvent, getRecentExtractedEventsForUser } from '@/lib/db';
import { ExtractionRequest } from '@/lib/types';
import { findDuplicateEvent } from '@/lib/duplicate-detector';
import { safeError } from '@/lib/safe-error';

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
    let forceSync = false;

    // Retrieve session user if present
    const session = await getSessionFromRequest(req);
    let dbUser = null;
    if (session) {
      dbUser = (await getUserById(session.userId)) || (await getUserByEmail(session.email));
      if (dbUser?.calendar_id) {
        customCalendarId = dbUser.calendar_id;
      }
    }

    const userId = dbUser?.id || session?.userId || 'web_user';
    if(session && req.headers.get('origin') && req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({success:false,error:'Origin ditolak.'},{status:403});

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const text = formData.get('text') as string | null;
      passedApiKey = (formData.get('apiKey') as string) || req.headers.get('x-api-key') || '';
      passedModel = (formData.get('model') as string) || '';
      passedEngine = (formData.get('engine') as string) || '';
      autoSync = formData.get('autoSync') === 'true';
      forceSync = formData.get('forceSync') === 'true';
      if (formData.get('calendarId')) {
        customCalendarId = formData.get('calendarId') as string;
      }

      const finalApiKey = passedApiKey || dbUser?.gemini_api_key || (session?process.env.GEMINI_API_KEY:'') || '';
      const finalModel = passedModel || dbUser?.model_name || 'gemini-2.0-flash';
      const finalEngine = (passedEngine || dbUser?.ocr_engine || 'gemini') as any;

      if (file) {
        if(file.size>8*1024*1024)return NextResponse.json({success:false,error:'Batas berkas 8 MB.'},{status:413});
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
      forceSync = Boolean(body.forceSync);
      if (body.calendarId) customCalendarId = body.calendarId;

      const finalApiKey = passedApiKey || dbUser?.gemini_api_key || (session?process.env.GEMINI_API_KEY:'') || '';
      const finalModel = body.model || dbUser?.model_name || 'gemini-2.0-flash';
      const finalEngine = body.engine || dbUser?.ocr_engine || 'gemini';

      extractionParams = {
        ...body,
        apiKey: finalApiKey,
        model: finalModel,
        engine: finalEngine
      };
    }
    if((extractionParams.base64Data?.length||0)>12*1024*1024 || (extractionParams.text?.length||0)>50000)return NextResponse.json({success:false,error:'Sumber melampaui batas pemrosesan.'},{status:413});

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
    if(result.event.needs_confirmation)return NextResponse.json({...result,requiresConfirmation:true,
      message:'Tanggal/jam perlu diperiksa. Agenda belum dibuat. Lengkapi sumber undangan dan proses kembali, atau gunakan konfirmasi di bot Telegram.'});

    // Attach ICS content string
    const icsContent = generateICSContent(result.event);

    // Check for duplicate activity across user's previously extracted events
    const targetUserId = session?.userId || dbUser?.id || session?.email || userId;
    const candidateIds = [
      targetUserId,
      session?.userId,
      session?.email,
      dbUser?.id,
      dbUser?.email,
      dbUser?.telegram_chat_id,
    ];

    const recentEvents = session?await getRecentExtractedEventsForUser(candidateIds, 60):[];
    const duplicateCheck = findDuplicateEvent(result.event, recentEvents);

    if (duplicateCheck.isDuplicate && duplicateCheck.matchedEvent && (!forceSync || duplicateCheck.matchedEvent.activity_status === 'cancelled')) {
      return NextResponse.json({
        ...result,
        icsContent,
        isDuplicate: true,
        duplicateReason: duplicateCheck.reason,
        matchedEvent: duplicateCheck.matchedEvent,
        matchedDetails: duplicateCheck.matchedDetails,
        message: duplicateCheck.matchedEvent.activity_status === 'cancelled'
          ? 'Kegiatan ini sudah dibatalkan. Gunakan Aktifkan kembali untuk memulihkan kegiatan yang sama.'
          : 'Data kegiatan ini sudah pernah diproses sebelumnya.'
      });
    }

    let autoSyncResult: { synced: boolean; email: string; calendarId: string; htmlLink?: string; eventId?: string; attachmentResult: CalendarAttachmentResult } | null = null;
    let gdriveResult: Awaited<ReturnType<typeof syncGoogleCalendarEventWithSource>>['gdriveResult'] | null = null;

    // Check if auto-sync to Google Calendar is active for this user
    if (session && (autoSync || userId)) {
      const userAuth = await getUserGoogleAuth(userId);
      if (userAuth && userAuth.refreshToken) {
        const synced = await syncGoogleCalendarEventWithSource({ userId, event: result.event,
          calendarId: customCalendarId, parentFolderId: dbUser?.gdrive_root_folder_id,
          fileData: { base64Data: extractionParams.base64Data, textContent: extractionParams.text,
            fileName: extractionParams.fileName, mimeType: extractionParams.mimeType, sourceType: extractionParams.sourceType } });
        gdriveResult = synced.gdriveResult;
        if (synced.insertResult.success) {
          autoSyncResult = { synced: true, email: userAuth.email, calendarId: customCalendarId,
            htmlLink: synced.insertResult.htmlLink, eventId: synced.insertResult.eventId, attachmentResult: synced.attachmentResult };
        }
      }
    }

    // Save to extracted_events history in Neon PostgreSQL
    let savedRecord = null;
    if (session && targetUserId) {
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
          google_event_id: autoSyncResult?.eventId,
          google_calendar_id: customCalendarId || 'primary',
          synced_to_calendar: Boolean(autoSyncResult?.synced),
          gdrive_folder_id: gdriveResult?.folderId,
          gdrive_folder_url: gdriveResult?.folderUrl,
          gdrive_file_id: gdriveResult?.fileId,
          gdrive_file_url: gdriveResult?.fileUrl,
          source_type: extractionParams.sourceType || 'web',
          file_name: extractionParams.fileName || (extractionParams.sourceType === 'text' ? 'salinan_undangan.txt' : 'Dokumen')
        });
      } catch (err) {
        console.error('Failed to save extracted event record');
      }
    }

    return NextResponse.json({
      ...result,
      icsContent,
      autoSyncResult,
      gdriveResult,
      savedRecord
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Internal Server Error: ${safeError(err)}` },
      { status: 500 }
    );
  }
}
