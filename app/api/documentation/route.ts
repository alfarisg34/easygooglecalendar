import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, getRecentExtractedEventsForUser, saveEventDocumentation, getEventDocumentations, updateEventGdriveFolder } from '@/lib/db';
import { extractPhotoMetadata, detectWatermarkTimestamp, matchPhotoToUserEvents, classifyImageIntent } from '@/lib/photo-matcher';
import { uploadDocumentationPhotoToDrive } from '@/lib/google-drive-api';
import { getUserGoogleAuth } from '@/lib/token-store';
import { DateTime } from 'luxon';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    let dbUser = null;
    if (session) {
      dbUser = (await getUserById(session.userId)) || (await getUserByEmail(session.email));
    }

    const userId = dbUser?.id || session?.userId || req.headers.get('x-user-id') || 'web_user';
    const userAuth = await getUserGoogleAuth(userId);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const explicitEventId = (formData.get('eventId') as string) || '';
    const forceUpload = formData.get('forceUpload') === 'true';
    const passedApiKey = (formData.get('apiKey') as string) || req.headers.get('x-api-key') || '';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Mohon unggah berkas foto dokumentasi kegiatan.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'image/jpeg';
    const base64Data = buffer.toString('base64');
    const effectiveApiKey = passedApiKey || dbUser?.gemini_api_key || process.env.GEMINI_API_KEY || '';

    // 1. Extract EXIF metadata (camera, timestamp, GPS)
    const photoMeta = await extractPhotoMetadata(buffer);

    // 2. Classify intent to prevent accidental poster uploads in documentation station
    const classification = await classifyImageIntent({
      buffer,
      base64Data,
      mimeType,
      apiKey: effectiveApiKey,
      hasCameraExif: photoMeta.hasCameraExif
    });

    if (!classification.isActivityPhoto && !forceUpload && !explicitEventId) {
      return NextResponse.json({
        success: false,
        isFlyerSuspected: true,
        message: 'Gambar ini terdeteksi sebagai Poster Flyer / Pamflet Undangan, bukan foto dokumentasi kegiatan fisik. Silakan gunakan tab "Poster Flyer" untuk mengekstrak agenda baru, atau konfirmasi jika ingin tetap mengunggah sebagai dokumentasi.',
        classification
      }, { status: 422 });
    }

    // 3. Detect Watermark Timestamp if EXIF timestamp is missing (e.g. from WhatsApp compression)
    let watermarkResult = null;
    if (classification?.watermarkData?.detected && classification.watermarkData.date) {
      const wm = classification.watermarkData;
      const timePart = wm.time || '10:00:00';
      const tzPart = wm.timezone || '+07:00';
      const combined = `${wm.date}T${timePart}${tzPart}`;
      const dt = DateTime.fromISO(combined);
      watermarkResult = {
        detected: true,
        detectedDateTime: dt.isValid ? dt.toISO() || combined : combined,
        locationText: wm.location || '',
        rawWatermarkText: wm.rawText || ''
      };
    } else if (!photoMeta.takenAt && effectiveApiKey) {
      watermarkResult = await detectWatermarkTimestamp({
        base64Data,
        mimeType,
        apiKey: effectiveApiKey,
        model: dbUser?.model_name
      });
    }

    // Determine effective taken_at timestamp
    const nowIso = new Date().toISOString();
    let effectiveTakenAt = photoMeta.takenAt || watermarkResult?.detectedDateTime || nowIso;
    let matchMethod: 'exif_timestamp' | 'ocr_watermark' | 'manual_selection' | 'fallback_today' = 'exif_timestamp';

    if (explicitEventId) {
      matchMethod = 'manual_selection';
    } else if (photoMeta.takenAt) {
      matchMethod = 'exif_timestamp';
    } else if (watermarkResult?.detectedDateTime) {
      matchMethod = 'ocr_watermark';
    } else {
      matchMethod = 'fallback_today';
    }

    // 4. Retrieve recent events for the user to match against
    const candidateUserIds = [
      userId,
      session?.userId,
      session?.email,
      dbUser?.id,
      dbUser?.email,
      dbUser?.telegram_chat_id
    ];
    const recentEvents = await getRecentExtractedEventsForUser(candidateUserIds, 60);

    let targetEvent = null;
    let matchResult = null;

    if (explicitEventId) {
      targetEvent = recentEvents.find(e => e.id === explicitEventId) || null;
      if (!targetEvent && recentEvents.length > 0) {
        targetEvent = recentEvents[0];
      }
    } else {
      matchResult = matchPhotoToUserEvents({
        photoTimeIso: effectiveTakenAt,
        events: recentEvents,
        locationHint: watermarkResult?.locationText
      });

      // Check if ambiguous (multiple events on same date with high proximity)
      const highCandidates = matchResult.candidates.filter(c => c.score >= 0.85);
      if (highCandidates.length > 1 && !forceUpload) {
        return NextResponse.json({
          success: false,
          requiresSelection: true,
          photoMetadata: photoMeta,
          watermark: watermarkResult,
          effectiveTakenAt,
          candidateEvents: highCandidates,
          message: 'Ditemukan lebih dari 1 kegiatan pada waktu yang berdekatan. Silakan pilih folder kegiatan yang sesuai.'
        });
      }

      if (matchResult.bestMatch) {
        targetEvent = matchResult.bestMatch;
      }
    }

    if (!targetEvent) {
      return NextResponse.json({
        success: false,
        noMatchFound: true,
        photoMetadata: photoMeta,
        watermark: watermarkResult,
        effectiveTakenAt,
        availableEvents: recentEvents.slice(0, 10),
        message: 'Tidak ditemukan agenda kegiatan yang cocok dengan tanggal/jam foto ini. Silakan pilih agenda secara manual.'
      });
    }

    // 5. Check Google Drive authorization
    if (!userAuth || !userAuth.refreshToken) {
      return NextResponse.json({
        success: false,
        error: 'Akun Google Anda belum terhubung atau belum memiliki izin akses Google Drive. Silakan lakukan Login Ulang dengan Google.'
      }, { status: 403 });
    }

    // 6. Upload photo to the event's Google Drive folder
    const uploadRes = await uploadDocumentationPhotoToDrive({
      userId,
      event: targetEvent,
      parentFolderId: dbUser?.gdrive_root_folder_id,
      buffer,
      originalFileName: file.name,
      mimeType,
      takenAtIso: effectiveTakenAt
    });

    if (!uploadRes.success) {
      return NextResponse.json({
        success: false,
        error: uploadRes.error || 'Gagal mengunggah berkas ke Google Drive.'
      }, { status: 500 });
    }

    // If a new folder was created for this event, persist folder ID to event record
    if (uploadRes.folderId && !targetEvent.gdrive_folder_id) {
      await updateEventGdriveFolder({
        eventId: targetEvent.id,
        folderId: uploadRes.folderId,
        folderUrl: uploadRes.folderUrl || `https://drive.google.com/drive/folders/${uploadRes.folderId}`
      });
      targetEvent.gdrive_folder_id = uploadRes.folderId;
      targetEvent.gdrive_folder_url = uploadRes.folderUrl;
    }

    // 7. Save photo record into event_documentations table
    const docRecord = await saveEventDocumentation({
      event_id: targetEvent.id,
      user_id: String(userId),
      gdrive_file_id: uploadRes.fileId || '',
      gdrive_file_url: uploadRes.fileUrl || uploadRes.folderUrl || '',
      file_name: uploadRes.fileName || file.name,
      file_size: file.size,
      mime_type: mimeType,
      taken_at: effectiveTakenAt,
      match_method: matchMethod
    });

    return NextResponse.json({
      success: true,
      event: targetEvent,
      docRecord,
      uploadResult: uploadRes,
      photoMetadata: photoMeta,
      watermark: watermarkResult,
      effectiveTakenAt,
      matchMethod,
      confidence: matchResult?.confidence ?? 1.0,
      message: `Foto dokumentasi berhasil diarsipkan ke folder Google Drive kegiatan: "${targetEvent.title}"`
    });

  } catch (err: any) {
    console.error('Documentation upload error:', err);
    return NextResponse.json(
      { success: false, error: `Terjadi kesalahan saat memproses foto: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');

    if (!eventId) {
      return NextResponse.json({ error: 'Parameter eventId diperlukan' }, { status: 400 });
    }

    const docs = await getEventDocumentations(eventId);
    return NextResponse.json({
      success: true,
      documentations: docs
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
