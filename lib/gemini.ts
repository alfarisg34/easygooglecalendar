import { telegramContext } from './telegram-context';
import { safeError } from './safe-error';
import { DateTime } from 'luxon';
import { CalendarEvent, ExtractionRequest, ExtractionResponse } from './types';
import { buildGoogleCalendarUrl } from './calendar-builder';
import { callCustomOcrService } from './ocr-service';

const EVENT_UPDATE_INSTRUCTIONS = "ATURAN SURAT/PESAN PERUBAHAN: Jika ada narasi semula menjadi, revisi, ralat, penjadwalan ulang, perubahan waktu/tempat, atau perintah /update, tambahkan properti \"update\". Jangan membuat kegiatan baru. Gunakan HANYA nilai BARU pada update, bukan nilai semula. Format update: {\"original_date\":\"YYYY-MM-DD (tanggal semula jika tertulis)\",\"date\":\"YYYY-MM-DD (tanggal baru jika tertulis)\",\"start_clock\":\"HH:mm (jam mulai baru)\",\"end_clock\":\"HH:mm (jam akhir baru)\",\"location\":\"tempat baru\"}. Hilangkan setiap properti yang tidak disebutkan; jangan menebak tanggal/jam/tempat pada update. Untuk jam baru s.d. selesai, end_clock adalah 2 jam setelah start_clock. Judul harus nama kegiatan asli, tanpa awalan perubahan/ralat/penjadwalan ulang. Pesan yang hanya menyebut jam/tempat baru tetap merupakan update jika ada /update. Undangan biasa tidak memiliki properti update.";

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
  const warnings:string[]=Array.isArray(raw.validation_warnings)?raw.validation_warnings.filter((value:unknown):value is string=>typeof value==='string').slice(0,5).map((value:string)=>value.slice(0,200)):[];
  if(raw.needs_confirmation===true&&!warnings.length)warnings.push('Hasil ekstraksi mengandung asumsi yang perlu diperiksa.');
  
  // Validate start_time and end_time
  let startDate: Date;
  if (raw.start_time) {
    const parsed=typeof raw.start_time==='string'&&/T\d{2}:\d{2}/.test(raw.start_time)?DateTime.fromISO(raw.start_time,{zone:'Asia/Jakarta',setZone:true}):null;
    startDate=parsed?.isValid?parsed.toJSDate():new Date(NaN);
    if (isNaN(startDate.getTime())) {
      warnings.push('Tanggal/jam mulai tidak valid; wajib dilengkapi.');
    }
  } else {
    startDate = new Date(NaN);
    warnings.push('Tanggal/jam mulai belum terbaca; wajib dilengkapi.');
  }

  let endDate: Date;
  if (raw.end_time) {
    const parsed=typeof raw.end_time==='string'&&/T\d{2}:\d{2}/.test(raw.end_time)?DateTime.fromISO(raw.end_time,{zone:'Asia/Jakarta',setZone:true}):null;
    endDate=parsed?.isValid?parsed.toJSDate():new Date(NaN);
    if (isNaN(endDate.getTime()) || endDate <= startDate) {
      endDate = new Date(startDate.getTime() + 2 * 3600000); // 2 hours duration default
      warnings.push('Jam selesai diasumsikan 2 jam setelah mulai.');
    }
  } else {
    endDate = new Date(startDate.getTime() + 2 * 3600000);
    warnings.push('Jam selesai diasumsikan 2 jam setelah mulai.');
  }

  // Format JP text
  const jpText = raw.jp ? String(raw.jp).trim() : '';

  // Format Location
  let locationStr = (raw.location || '').trim();
  if (!locationStr) {
    if(!raw.is_online || !raw.meeting_link)warnings.push('Tempat/link kegiatan belum jelas; periksa sebelum menyimpan.');
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
  if(typeof raw.title!=='string'||!raw.title.trim())warnings.push('Judul kegiatan belum terbaca; periksa sebelum menyimpan.');
  const event: CalendarEvent = {
    title: (raw.title || 'Agenda Kegiatan / Rapat').trim(),
    start_time: Number.isNaN(startDate.getTime()) ? '' : startDate.toISOString(),
    end_time: Number.isNaN(endDate.getTime()) ? '' : endDate.toISOString(),
    ...(warnings.length ? {validation_warnings:warnings,needs_confirmation:true} : {}),
    is_online: Boolean(raw.is_online),
    location: locationStr,
    meeting_link: (raw.meeting_link || '').trim(),
    meeting_id_pass: (raw.meeting_id_pass || '').trim(),
    jp: jpText,
    speakers: speakersStr,
    description: (raw.description || '').trim()
  };

  event.google_calendar_url = event.start_time && event.end_time ? buildGoogleCalendarUrl(event) : '';
  return event;
}

/**
 * Main Extraction Engine via Google Gemini Multimodal / Text Reasoning
 */
export async function extractEventFromSource(request: ExtractionRequest): Promise<ExtractionResponse> {
  let apiKey = (request.apiKey || process.env.GEMINI_API_KEY || '').trim();
  apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

  if (!apiKey) {
    return {
      success: false,
      error: 'Google Gemini API Key tidak ditemukan. Mohon masukkan API Key Anda (BYOK).'
    };
  }

  const model = normalizeModelName(request.model || 'gemini-2.0-flash');
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
Jangan mengarang tanggal atau jam. Jika waktu mulai tidak disebutkan atau tidak dapat dibaca, isi start_time dan end_time dengan null. Tanggal acuan hanya untuk menafsirkan narasi relatif yang benar-benar ada. Jika jam akhir diasumsikan (termasuk s.d. selesai), tambahkan needs_confirmation: true dan validation_warnings: ["Jam selesai diasumsikan 2 jam setelah mulai."]. Tandai asumsi judul, tempat atau waktu lain dengan peringatan dan needs_confirmation: true.

${EVENT_UPDATE_INSTRUCTIONS}


${request.sourceType === 'image' ? `PERINGATAN PENTING KHUSUS GAMBAR:
Jika berkas gambar ini BUKAN poster/flyer pengumuman/undangan kegiatan (misalnya berupa foto dunia nyata seperti selfie/wefie, foto suasana orang rapat di ruangan/meja pertemuan, atau foto dokumentasi berkamera dengan stempel TimeMark / GPS Map Camera / Timestamp Camera), JANGAN memaksakan membuat agenda baru dari teks stempel tanggal dan alamat jalan tersebut.
Kembalikan HANYA JSON murni:
{
  "is_not_event": true,
  "error": "Berkas ini terdeteksi sebagai foto dokumentasi fisik kegiatan, bukan poster undangan agenda."
}

Jika gambar MEMANG merupakan poster / flyer desain grafis undangan agenda kegiatan:` : ''}

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
Jangan mengarang tanggal atau jam. Jika waktu mulai tidak disebutkan atau tidak dapat dibaca, isi start_time dan end_time dengan null. Tanggal acuan hanya untuk menafsirkan narasi relatif yang benar-benar ada. Jika jam akhir diasumsikan (termasuk s.d. selesai), tambahkan needs_confirmation: true dan validation_warnings: ["Jam selesai diasumsikan 2 jam setelah mulai."]. Tandai asumsi judul, tempat atau waktu lain dengan peringatan dan needs_confirmation: true.

${EVENT_UPDATE_INSTRUCTIONS}


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
 * Normalizes model name to clean, supported Gemini model identifiers
 */
export function normalizeModelName(rawModel?: string): string {
  if (!rawModel) return 'gemini-3.6-flash';
  const m = String(rawModel).trim().toLowerCase().replace(/^models\//, '');
  if (m.includes('3.7')) return 'gemini-3.7-flash';
  if (m.includes('3.6')) return 'gemini-3.6-flash';
  if (m.includes('3.5')) return 'gemini-3.5-flash';
  if (m.includes('3.1')) return 'gemini-3.1-flash-lite';
  if (m.includes('latest')) return 'gemini-flash-latest';
  return m || 'gemini-3.6-flash';
}

async function callGeminiGenerateContent(params: {
  apiKey: string;
  model: string;
  parts: any[];
  rawOcrText?: string;
  engineUsed?: 'gemini' | 'ocr_service' | 'hybrid';
}): Promise<ExtractionResponse> {
  const cleanApiKey = (params.apiKey || '').replace(/^["']|["']$/g, '').trim();
  const primaryModel = normalizeModelName(params.model);

  // Active 2026 Google Generative Language models with multi-tier quota fallback
  const modelsToTry = [
    primaryModel,
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite'
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastError = '';

  for (const currentModel of modelsToTry) {
    const url = `${GEMINI_API_URL}/${currentModel}:generateContent?key=${encodeURIComponent(cleanApiKey)}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal:AbortSignal.timeout(18000),
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
        const errorMsg = safeError(data.error?.message || `Google Gemini API Error (${response.status}): ${response.statusText}`);
        console.warn(`Gemini API returned HTTP ${response.status} with model ${currentModel}: ${errorMsg}. Trying next active model in chain...`);
        lastError = errorMsg;
        if(response.status===429||response.status>=500) {const context=telegramContext.getStore();if(context)context.retryableFailure=true;}

        // If error is 404 (model unavailable), 429 (rate-limit / quota on this model), or 503 (temporary high demand), try next active model!
        if (response.status === 404 || response.status === 429 || response.status === 503) {
          continue;
        }

        // For auth or payload errors (400, 401, 403), return directly
        return {
          success: false,
          error: `Gagal memproses dengan Google Gemini (${currentModel}): ${errorMsg}`
        };
      }

      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        lastError = 'Google Gemini tidak mengembalikan teks respons.';
        continue;
      }

      const parsedJson = parseGeminiJson(candidateText);
      if (parsedJson.is_not_event) {
        return {
          success: false,
          error: parsedJson.error || 'Berkas terdeteksi sebagai foto dokumentasi fisik kegiatan, bukan poster undangan agenda.'
        };
      }
      const context=telegramContext.getStore();if(context)context.retryableFailure=false;
      const event = normalizeCalendarEvent(parsedJson);
      if (parsedJson.update && typeof parsedJson.update === 'object' && !Array.isArray(parsedJson.update)) event.update = parsedJson.update;

      return {
        success: true,
        event,
        rawOcrText: params.rawOcrText,
        modelUsed: currentModel,
        engineUsed: params.engineUsed || 'gemini'
      };
    } catch (err: any) {
      lastError = safeError(err);
      const context=telegramContext.getStore();if(context)context.retryableFailure=true;
      console.warn(`Network error with model ${currentModel}: ${safeError(err)}.`);
    }
  }

  return {
    success: false,
    error: `Gagal memproses dengan Google Gemini: ${lastError}`
  };
}
