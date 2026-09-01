import { NextRequest, NextResponse } from 'next/server';
import { extractEventFromSource } from '@/lib/gemini';
import { generateICSContent } from '@/lib/calendar-builder';
import { insertGoogleCalendarEvent } from '@/lib/google-calendar-api';
import { getUserGoogleAuth } from '@/lib/token-store';
import { ExtractionRequest } from '@/lib/types';

export const maxDuration = 60; // 60 seconds serverless timeout

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let extractionParams: ExtractionRequest;
    let autoSync = false;
    let userId = req.headers.get('x-user-id') || 'web_anonymous';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const text = formData.get('text') as string | null;
      const apiKey = (formData.get('apiKey') as string) || req.headers.get('x-api-key') || '';
      const model = (formData.get('model') as string) || 'gemini-3.6-flash';
      const engine = (formData.get('engine') as any) || 'gemini';
      autoSync = formData.get('autoSync') === 'true';
      userId = (formData.get('userId') as string) || userId;

      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Data = buffer.toString('base64');
        const mimeType = file.type || 'application/pdf';
        const isPdf = mimeType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');

        extractionParams = {
          apiKey,
          model,
          engine,
          sourceType: isPdf ? 'pdf' : 'image',
          base64Data,
          mimeType,
          fileName: file.name
        };
      } else if (text) {
        extractionParams = {
          apiKey,
          model,
          engine,
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
      const apiKey = body.apiKey || req.headers.get('x-api-key') || '';
      autoSync = Boolean(body.autoSync);
      userId = body.userId || userId;
      extractionParams = {
        ...body,
        apiKey
      };
    }

    if (!extractionParams.apiKey && !process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: 'Google Gemini API Key wajib diisi (BYOK). Dapatkan gratis di Google AI Studio (aistudio.google.com).'
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
        const directInsert = await insertGoogleCalendarEvent(userId, result.event);
        if (directInsert.success) {
          autoSyncResult = {
            synced: true,
            email: userAuth.email,
            htmlLink: directInsert.htmlLink
          };
        }
      }
    }

    return NextResponse.json({
      ...result,
      icsContent,
      autoSyncResult
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Internal Server Error: ${err.message}` },
      { status: 500 }
    );
  }
}
