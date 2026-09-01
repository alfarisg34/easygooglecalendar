import { NextRequest, NextResponse } from 'next/server';
import { callCustomOcrService } from '@/lib/ocr-service';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let apiKey = req.headers.get('x-api-key') || '';
    let base64Data = '';
    let mimeType = 'application/pdf';
    let model = 'gemini-3.6-flash';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      apiKey = (formData.get('apiKey') as string) || apiKey;
      model = (formData.get('model') as string) || model;

      if (!file) {
        return NextResponse.json({ success: false, error: 'Berkas tidak ditemukan.' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      base64Data = Buffer.from(arrayBuffer).toString('base64');
      mimeType = file.type || 'application/pdf';
    } else {
      const body = await req.json();
      apiKey = body.apiKey || apiKey;
      base64Data = body.base64Data || '';
      mimeType = body.mimeType || 'application/pdf';
      model = body.model || model;
    }

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Google Gemini API Key diperlukan.' },
        { status: 401 }
      );
    }

    const ocrResult = await callCustomOcrService({
      apiKey,
      base64Data,
      mimeType,
      model
    });

    return NextResponse.json(ocrResult, { status: ocrResult.success ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Gagal memproses OCR: ${err.message}` },
      { status: 500 }
    );
  }
}
