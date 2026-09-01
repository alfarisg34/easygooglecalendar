import { CalendarEvent, ExtractionRequest, ExtractionResponse } from './types';
import { buildGoogleCalendarUrl } from './calendar-builder';
import { callCustomOcrService } from './ocr-service';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Sanitizes and parses JSON returned by Google Gemini
 */
export function parseGeminiJson(rawResponseText: string): any {
  let cleaned = rawResponseText.trim();
  
  // Remove markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt regex extraction of outermost JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error(`Gagal mem-parsing output JSON dari AI: ${cleaned.substring(0, 200)}...`);
  }
}

/**
 * Normalizes and validates extracted event data to produce a robust CalendarEvent
 */
export function normalizeCalendarEvent(raw: any): CalendarEvent {
  const now = new Date();
  
  // Validate start_time and end_time
  let startDate: Date;
  if (raw.start_time) {
    startDate = new Date(raw.start_time);
    if (isNaN(startDate.getTime())) {
      startDate = new Date(now.getTime() + 86400000); // Tomorrow default
    }
  } else {
    startDate = new Date(now.getTime() + 86400000);
  }

  let endDate: Date;
  if (raw.end_time) {
    endDate = new Date(raw.end_time);
    if (isNaN(endDate.getTime()) || endDate <= startDate) {
      endDate = new Date(startDate.getTime() + 2 * 3600000); // 2 hours duration default
    }
  } else {
    endDate = new Date(startDate.getTime() + 2 * 3600000);
  }

  // Format JP text
  const jpText = raw.jp ? String(raw.jp).trim() : '';

  // Format Location
  let locationStr = (raw.location || '').trim();
  if (!locationStr) {
    locationStr = raw.is_online ? 'Zoom Meeting' : 'Menyusul / Sesuai Undangan';
  }
  if (raw.is_online && raw.meeting_id_pass && !locationStr.includes(raw.meeting_id_pass)) {
    locationStr = `${locationStr} (${raw.meeting_id_pass})`;
  }

  // Format Speakers
  let speakersStr = '';
  if (raw.speakers) {
    speakersStr = Array.isArray(raw.speakers) ? raw.speakers.join(', ') : String(raw.speakers).trim();
  }

  // Build clean event
  const event: CalendarEvent = {
    title: (raw.title || 'Agenda Kegiatan / Rapat').trim(),
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    is_online: Boolean(raw.is_online),
    location: locationStr,
    meeting_link: (raw.meeting_link || '').trim(),
    meeting_id_pass: (raw.meeting_id_pass || '').trim(),
    jp: jpText,
    speakers: speakersStr,
    description: (raw.description || '').trim()
  };

  event.google_calendar_url = buildGoogleCalendarUrl(event);
  return event;
}

/**
 * Main Extraction Engine via Google Gemini Multimodal / Text Reasoning
 */
export async function extractEventFromSource(request: ExtractionRequest): Promise<ExtractionResponse> {
  const apiKey = request.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'Google Gemini API Key tidak ditemukan. Mohon masukkan API Key Anda (BYOK).'
    };
  }

  const model = request.model || 'gemini-2.5-flash';
  const nowISO = new Date().toISOString();

  // Route 1: Using Custom OCR Service first if requested
  if (request.engine === 'ocr_service' && (request.sourceType === 'pdf' || request.sourceType === 'image') && request.base64Data) {
    const ocrResult = await callCustomOcrService({
      apiKey,
      base64Data: request.base64Data,
      mimeType: request.mimeType,
      model
    });

    if (!ocrResult.success || !ocrResult.text) {
      return {
        success: false,
        error: ocrResult.error || 'Gagal mengekstrak teks melalui layanan OCR.'
      };
    }

    // Now extract structured event from OCR text
    return extractFromTextContent({
      apiKey,
      model,
      rawText: ocrResult.text,
      rawOcrText: ocrResult.text,
      engineUsed: 'ocr_service'
    });
  }

  // Route 2: Multimodal direct reasoning with Gemini
  if (request.sourceType === 'pdf' || request.sourceType === 'image') {
    if (!request.base64Data) {
      return { success: false, error: 'Data berkas base64 tidak ditemukan.' };
    }

    const mimeType = request.mimeType || (request.sourceType === 'pdf' ? 'application/pdf' : 'image/jpeg');

    const promptText = `Analisis ${request.sourceType === 'pdf' ? 'seluruh halaman dokumen surat undangan dinas / kegiatan resmi' : 'poster / flyer kegiatan'} bahasa Indonesia ini secara visual dan teliti, lalu ekstrak seluruh informasi kegiatan ke dalam format JSON murni:

Waktu Referensi Saat Ini: ${nowISO}

Panduan Ekstraksi Informasi Dokumen:
1. 'title': Judul/nama kegiatan spesifik dan informatif (Contoh: 'Rapat Klasifikasi Sistem Aplikasi dan Pelaporan Data Ketenagakerjaan' atau 'Sharing Session 7: Mainstreaming Gender'). JANGAN hanya menulis 'Undangan' atau 'Webinar'.
2. 'start_time': Waktu mulai acara dalam format ISO 8601 dengan timezone Indonesia (+07:00), contoh: '2026-09-03T09:00:00+07:00'. Ambil dari tanggal dan jam pelaksanaan di surat/poster atau lampiran rundown.
3. 'end_time': Waktu selesai acara format ISO 8601 (+07:00). Jika tertulis jam selesai (misal 13.00 - 17.00 -> jam 17:00), gunakan jam tersebut. Jika tertulis 's.d. selesai' dan tidak ada jam akhir, buat default 2 jam setelah start_time.
4. 'is_online': boolean (true jika daring/hybrid via Zoom/GMeet/Teams/YouTube Live, false jika luring/offline murni).
5. 'location': Alamat gedung/tempat acara lengkap atau keterangan platform daring (contoh: 'Balai Perluasan Kesempatan Kerja Bekasi, Jl. Guntur Raya No.1, Bekasi Barat' atau 'Zoom Meeting').
6. 'meeting_link': URL link meeting / registrasi / presensi jika tercantum.
7. 'meeting_id_pass': Meeting ID Zoom (10/11 digit angka akurat) dan Passcode jika ada.
8. 'jp': Jumlah Jam Pelajaran / sertifikat jika ada (contoh: '3 JP', '32 JP'). Kosongkan "" jika tidak ada.
9. 'speakers': Narasumber / pengisi acara / pembicara lengkap jika tertera.
10. 'description': Rangkuman lengkap nomor surat dinas, agenda rapat, rundown kegiatan, topik pembahasan, dan daftar peserta/instansi yang diundang.

Format JSON yang Wajib Dikembalikan (HANYA JSON murni tanpa markdown):
{
  "title": "Judul Kegiatan Spesifik",
  "start_time": "2026-09-03T09:00:00+07:00",
  "end_time": "2026-09-03T17:00:00+07:00",
  "is_online": false,
  "location": "Nama Tempat / Platform",
  "meeting_link": "",
  "meeting_id_pass": "",
  "jp": "",
  "speakers": "",
  "description": "Rangkuman agenda dan nomor surat..."
}`;

    return callGeminiGenerateContent({
      apiKey,
      model,
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: request.base64Data
          }
        },
        {
          text: promptText
        }
      ],
      engineUsed: 'gemini'
    });
  }

  // Route 3: Direct text message extraction
  return extractFromTextContent({
    apiKey,
    model,
    rawText: request.text || '',
    engineUsed: 'gemini'
  });
}

/**
 * Extracts structured event from raw text / chat message
 */
async function extractFromTextContent(params: {
  apiKey: string;
  model: string;
  rawText: string;
  rawOcrText?: string;
  engineUsed?: 'gemini' | 'ocr_service' | 'hybrid';
}): Promise<ExtractionResponse> {
  const nowISO = new Date().toISOString();

  const promptText = `Analisis pesan chat undangan dinas / pengumuman kegiatan / hasil OCR dokumen bahasa Indonesia berikut dan ekstrak seluruh informasi kegiatan ke dalam format JSON murni:

Waktu Referensi Saat Ini: ${nowISO}

Teks Dokumen / Undangan:
"""
${params.rawText}
"""

Panduan Ekstraksi Informasi:
1. 'title': Judul/nama kegiatan spesifik dan informatif. JANGAN hanya menulis 'Undangan'.
2. 'start_time': Waktu mulai acara dalam format ISO 8601 dengan timezone Indonesia (+07:00), contoh: '2026-08-31T09:00:00+07:00'.
3. 'end_time': Waktu selesai acara format ISO 8601 (+07:00). Jika tidak disebutkan jam selesai, buat default 2 jam setelah start_time.
4. 'is_online': boolean (true jika daring/hybrid via Zoom/GMeet/Teams/YouTube, false jika luring/offline murni).
5. 'location': Lokasi kegiatan (platform daring Zoom/YouTube atau alamat gedung).
6. 'meeting_link': URL tautan pendaftaran / registrasi / Zoom / YouTube Live jika tercantum.
7. 'meeting_id_pass': Meeting ID Zoom dan Passcode jika ada.
8. 'jp': Jumlah Jam Pelajaran jika ada. Kosongkan "" jika tidak ada.
9. 'speakers': Narasumber / pengisi acara jika tertera.
10. 'description': Deskripsi lengkap agenda acara, penyelenggara, dan link meeting.

Format JSON yang Wajib Dikembalikan (HANYA JSON murni tanpa markdown):
{
  "title": "Judul Kegiatan Spesifik",
  "start_time": "2026-08-31T09:00:00+07:00",
  "end_time": "2026-08-31T11:00:00+07:00",
  "is_online": true,
  "location": "Zoom Meeting",
  "meeting_link": "https://...",
  "meeting_id_pass": "Meeting ID: 812 2913 2801 | Pass: SIKN",
  "jp": "",
  "speakers": "",
  "description": "Deskripsi agenda rapat..."
}`;

  return callGeminiGenerateContent({
    apiKey: params.apiKey,
    model: params.model,
    parts: [{ text: promptText }],
    rawOcrText: params.rawOcrText,
    engineUsed: params.engineUsed
  });
}

/**
 * Helper to call Google Gemini GenerateContent REST API
 */
async function callGeminiGenerateContent(params: {
  apiKey: string;
  model: string;
  parts: any[];
  rawOcrText?: string;
  engineUsed?: 'gemini' | 'ocr_service' | 'hybrid';
}): Promise<ExtractionResponse> {
  const url = `${GEMINI_API_URL}/${params.model}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: params.parts
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error?.message || `Google Gemini API Error (${response.status}): ${response.statusText}`
      };
    }

    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return {
        success: false,
        error: 'Google Gemini tidak mengembalikan teks respons.'
      };
    }

    const parsedJson = parseGeminiJson(candidateText);
    const event = normalizeCalendarEvent(parsedJson);

    return {
      success: true,
      event,
      rawOcrText: params.rawOcrText,
      modelUsed: params.model,
      engineUsed: params.engineUsed || 'gemini'
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal memproses dengan Google Gemini: ${err.message}`
    };
  }
}
