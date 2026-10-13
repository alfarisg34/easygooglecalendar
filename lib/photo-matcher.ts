let exifrModule: any = null;
try {
  exifrModule = require('exifr');
} catch (e) {
  // exifr is optional; fallback to AI visual inspection
}

import { DateTime } from 'luxon';
import { ExtractedEventRecord } from './db';
import { normalizeModelName, parseGeminiJson } from './gemini';

export interface PhotoMetadata {
  takenAt?: string; // ISO 8601 with timezone (e.g. 2026-09-10T10:15:22+07:00)
  dateStr?: string; // YYYY-MM-DD
  timeStr?: string; // HH:mm:ss
  latitude?: number;
  longitude?: number;
  cameraMake?: string;
  cameraModel?: string;
  software?: string;
  hasCameraExif: boolean;
  rawExif?: any;
}

export interface PhotoMatchResult {
  bestMatch: ExtractedEventRecord | null;
  ambiguous: boolean;
  confidence: number; // 0.0 - 1.0
  matchReason: string;
  candidates: Array<{
    event: ExtractedEventRecord;
    score: number;
    reason: string;
  }>;
}

export interface WatermarkDetectionResult {
  detected: boolean;
  detectedDateTime?: string; // ISO 8601
  locationText?: string;
  rawWatermarkText?: string;
}

/**
 * Extracts EXIF camera metadata, GPS, and creation timestamp from an image buffer
 */
export async function extractPhotoMetadata(buffer: Buffer): Promise<PhotoMetadata> {
  if (!exifrModule) {
    return { hasCameraExif: false };
  }

  try {
    const raw = await exifrModule.parse(buffer, {
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'ModifyDate',
        'GPSLatitude',
        'GPSLongitude',
        'Make',
        'Model',
        'Software',
        'Orientation'
      ]
    });

    if (!raw) {
      return { hasCameraExif: false };
    }

    const cameraMake = raw.Make ? String(raw.Make).trim() : undefined;
    const cameraModel = raw.Model ? String(raw.Model).trim() : undefined;
    const software = raw.Software ? String(raw.Software).trim() : undefined;
    const latitude = typeof raw.latitude === 'number' ? raw.latitude : (typeof raw.GPSLatitude === 'number' ? raw.GPSLatitude : undefined);
    const longitude = typeof raw.longitude === 'number' ? raw.longitude : (typeof raw.GPSLongitude === 'number' ? raw.GPSLongitude : undefined);

    // Determine timestamp from DateTimeOriginal or CreateDate
    const rawDate = raw.DateTimeOriginal || raw.CreateDate || raw.ModifyDate;
    let takenAt: string | undefined;
    let dateStr: string | undefined;
    let timeStr: string | undefined;

    if (rawDate) {
      let dt: DateTime;
      if (rawDate instanceof Date) {
        dt = DateTime.fromJSDate(rawDate).setZone('Asia/Jakarta');
      } else if (typeof rawDate === 'string') {
        // EXIF format is typically "YYYY:MM:DD HH:MM:SS"
        const cleaned = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
        dt = DateTime.fromISO(cleaned, { zone: 'Asia/Jakarta' });
        if (!dt.isValid) {
          dt = DateTime.fromFormat(rawDate, 'yyyy:MM:dd HH:mm:ss', { zone: 'Asia/Jakarta' });
        }
      } else {
        dt = DateTime.now().setZone('Asia/Jakarta');
      }

      if (dt.isValid) {
        takenAt = dt.toISO() || undefined;
        dateStr = dt.toFormat('yyyy-MM-dd');
        timeStr = dt.toFormat('HH:mm:ss');
      }
    }

    const hasCameraExif = Boolean(
      cameraMake || cameraModel || (takenAt && !software?.toLowerCase().includes('canva') && !software?.toLowerCase().includes('photoshop'))
    );

    return {
      takenAt,
      dateStr,
      timeStr,
      latitude,
      longitude,
      cameraMake,
      cameraModel,
      software,
      hasCameraExif,
      rawExif: raw
    };
  } catch (err) {
    console.warn('Error parsing EXIF metadata:', err);
    return { hasCameraExif: false };
  }
}

/** Validate watermark fields before using them as capture time. Never invent a missing clock. */
export function parseWatermarkTimestamp(raw: unknown): WatermarkDetectionResult {
  if (!raw || typeof raw !== 'object') return { detected: false };
  const data = raw as Record<string, unknown>;
  if (data.detected !== true || typeof data.date !== 'string' || typeof data.time !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(data.time)) return { detected: false };
  const zone = typeof data.timezone === 'string' ? data.timezone : '+07:00';
  if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(zone)) return { detected: false };
  const date = DateTime.fromISO(data.date);
  const timestamp = DateTime.fromISO(`${data.date}T${data.time}${zone}`, { setZone: true });
  if (!date.isValid || !timestamp.isValid) return { detected: false };
  return { detected: true, detectedDateTime: timestamp.toISO()!,
    locationText: typeof data.location === 'string' ? data.location : '',
    rawWatermarkText: typeof data.rawText === 'string' ? data.rawText : '' };
}

/** Capture time must come from evidence, never from the upload clock. */
export function resolvePhotoTimestamp(metadata: PhotoMetadata, watermark: WatermarkDetectionResult | null): string | null {
  for (const time of [metadata.takenAt, watermark?.detected ? watermark.detectedDateTime : undefined]) {
    if (time && DateTime.fromISO(time).isValid) return time;
  }
  return null;
}

/** Read camera watermark text with model fallback when EXIF is missing. */
export async function detectWatermarkTimestamp(params: {
  base64Data: string; mimeType?: string; apiKey: string; model?: string;
}): Promise<WatermarkDetectionResult> {
  const apiKey = (params.apiKey || process.env.GEMINI_API_KEY || '').replace(/^["']|["']$/g, '').trim();
  if (!apiKey) return { detected: false };
  const models = [...new Set([normalizeModelName(params.model), 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'])];
  const promptText = `Periksa foto dokumentasi ini dengan teliti, khususnya pada sudut-sudut foto (kiri bawah, kanan bawah, atau atas) untuk mencari teks stempel visual (*timestamp / watermark* dari aplikasi GPS Map Camera, Timestamp Camera, atau penanda waktu lainnya).
Jangan menebak tanggal atau jam, jangan memakai waktu saat ini, dan jangan memakai waktu pada layar rapat sebagai waktu pengambilan. Baca tanggal dengan nama bulan Indonesia dan jam pada stempel kamera, lalu konversi ke YYYY-MM-DD dan HH:mm:ss. Jika tanggal atau jam tidak terbaca lengkap, kembalikan detected: false.
Jika terdapat tanggal, jam (WIB/WITA/WIT), atau alamat/lokasi koordinat yang tercetak di foto, ekstrak ke format JSON murni:
{
  "detected": true,
  "date": "YYYY-MM-DD",
  "time": "HH:mm:ss",
  "timezone": "+07:00",
  "location": "Alamat atau gedung jika tercetak di watermark",
  "rawText": "Teks lengkap yang terbaca di watermark"
}

Jika TIDAK ADA stempel tanggal/jam yang tercetak di foto, kembalikan:
{
  "detected": false
}`;
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ contents: [{ parts: [
          { inlineData: { mimeType: params.mimeType || 'image/jpeg', data: params.base64Data } }, { text: promptText }
        ] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } })
      });
      if (!res.ok) {
        console.warn(`Watermark OCR failed with model ${model}: HTTP ${res.status}`);
        if ([404, 429, 503].includes(res.status)) continue;
        return { detected: false };
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const result = parseWatermarkTimestamp(parseGeminiJson(text));
      if (result.detected) return result;
    } catch {
      console.warn(`Watermark OCR response unavailable or invalid with model ${model}`);
    }
  }
  return { detected: false };
}

export interface ClassificationResult {
  isActivityPhoto: boolean;
  confidence: number;
  reason: string;
  hasTimestampWatermark?: boolean;
  watermarkData?: {
    detected: boolean;
    date?: string;
    time?: string;
    timezone?: string;
    location?: string;
    coordinates?: string;
    appName?: string;
    rawText?: string;
  };
}

/**
 * Classifies an image as an activity documentation photo vs a flyer/invitation poster
 */
export async function classifyImageIntent(params: {
  buffer: Buffer;
  base64Data?: string;
  mimeType?: string;
  apiKey?: string;
  hasCameraExif?: boolean;
}): Promise<ClassificationResult> {
  // If image possesses legitimate physical camera metadata (Make, Model), strong confidence it's an activity photo
  if (params.hasCameraExif) {
    return {
      isActivityPhoto: true,
      confidence: 0.95,
      hasTimestampWatermark: false,
      reason: 'Memiliki metadata kamera fisik (EXIF Camera Hardware detected).'
    };
  }

  // If no API key is provided, assume activity photo if handled by photo route
  if (!params.apiKey || !params.base64Data) {
    return {
      isActivityPhoto: true,
      confidence: 0.7,
      hasTimestampWatermark: false,
      reason: 'Diunggah melalui stasiun foto dokumentasi.'
    };
  }

  // Fast AI visual classification with watermark intelligence
  try {
    const apiKey = params.apiKey.replace(/^["']|["']$/g, '').trim();
    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const promptText = `Periksa gambar ini secara visual dan teliti untuk mengklasifikasikannya ke dalam salah satu kategori:

KATEGORI 1: 'activity_photo' (FOTO DOKUMENTASI KEGIATAN NYATA)
- Foto pemotretan fisik dunia nyata yang memotret kegiatan yang sedang berlangsung atau selesai: orang-orang rapat di meja/ruangan pertemuan, selfie/wefie peserta rapat, suasana apel/seminar/pelatihan/bimtek di aula, sambutan pejabat, suasana kantor, atau dokumentasi lapangan.
- CIRI KHAS SANGAT PENTING (WATERMARK / STEMPEL KAMERA):
  Foto dokumentasi kedinasan/kantor SANGAT SERING menggunakan aplikasi kamera ber-watermark seperti:
  * TimeMark (logo teks TimeMark di sudut, teks tanggal & jam besar, alamat jalan lengkap, koordinat lat/long, inset kotak peta mini Google Maps)
  * GPS Map Camera (overlay peta mini, koordinat GPS lintang/bujur, alamat lokasi, tanggal dan jam)
  * Timestamp Camera / Open Camera / Surveyor Camera (teks stempel tanggal & jam warna putih/kuning/oranye di sudut bawah atau atas)
- PERINGATAN KERAS: JIKA GAMBAR ADALAH FOTO DUNIA NYATA (misal: orang-orang di ruang rapat, selfie kegiatan, meja pertemuan) DENGAN STEMPEL WATERMARK SEPERTI ITU, GAMBAR INI ADALAH 100% 'activity_photo' (isActivityPhoto: true, confidence: 0.99)! Stempel waktu dan lokasi tersebut adalah BUKTI OTENTIK foto dokumentasi kegiatan fisik, BUKAN poster flyer!

KATEGORI 2: 'flyer_poster' (POSTER / FLYER / PAMFLET AGENDA DIGITAL)
- Desain grafis promosi digital murni (hasil Canva, Photoshop, Illustrator) untuk mengumumkan acara yang AKAN DATANG.
- Ciri: Tipografi judul besar promosi, foto profil narasumber dalam bingkai grafis/lingkaran, link registrasi (bit.ly, Zoom ID/passcode, Google Form), teks "Live on Zoom / YouTube", keterangan HTM / Gratis, dan logo instansi/sponsor.
- BUKAN foto suasana kegiatan di ruangan fisik dengan stempel timestamp kamera.

Ekstrak juga informasi stempel watermark/timestamp (jika ada pada foto) ke dalam format JSON murni:
{
  "isActivityPhoto": boolean,
  "confidence": number,
  "hasTimestampWatermark": boolean,
  "watermarkData": {
    "detected": boolean,
    "date": "YYYY-MM-DD",
    "time": "HH:mm:ss",
    "timezone": "+07:00",
    "location": "Alamat jalan atau nama gedung jika tercetak di watermark",
    "coordinates": "Koordinat lat/long jika tertera",
    "appName": "TimeMark / GPS Map Camera / Timestamp Camera / lainnya",
    "rawText": "Teks lengkap yang terbaca pada stempel watermark"
  },
  "reason": "Penjelasan singkat klasifikasi dalam bahasa Indonesia"
}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: params.mimeType || 'image/jpeg',
                  data: params.base64Data
                }
              },
              { text: promptText }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
        const isActivity = Boolean(parsed.isActivityPhoto);
        const hasWatermark = Boolean(parsed.hasTimestampWatermark || (parsed.watermarkData && parsed.watermarkData.detected));
        const conf = Number(parsed.confidence) || (hasWatermark ? 0.98 : (isActivity ? 0.92 : 0.8));
        return {
          isActivityPhoto: isActivity || hasWatermark,
          confidence: conf,
          hasTimestampWatermark: hasWatermark,
          watermarkData: (parsed.watermarkData && parsed.watermarkData.detected) ? parsed.watermarkData : undefined,
          reason: parsed.reason || (hasWatermark ? 'Foto dokumentasi kegiatan dengan stempel watermark kamera.' : 'Klasifikasi visual AI.')
        };
      }
    }
  } catch (err) {
    console.warn('AI classification failed, defaulting to activity photo:', err);
  }

  return {
    isActivityPhoto: true,
    confidence: 0.75,
    hasTimestampWatermark: false,
    reason: 'Format gambar dokumentasi kegiatan fisik.'
  };
}

/**
 * Matches photo timestamp to user's extracted events
 *
 * Scoring Model:
 * 1.00 - Photo timestamp strictly inside [start_time, end_time]
 * 0.92 - Photo timestamp within 60 minutes before start_time (Registration / Preparation)
 * 0.90 - Photo timestamp within 120 minutes after end_time (Closing / Photo Session)
 * 0.65 - Photo on the same date (YYYY-MM-DD) but outside immediate buffer
 * 0.00 - Different date
 */
export function matchPhotoToUserEvents(params: {
  photoTimeIso: string;
  events: ExtractedEventRecord[];
  locationHint?: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
}): PhotoMatchResult {
  const { photoTimeIso, events } = params;
  const photoDt = DateTime.fromISO(photoTimeIso).setZone('Asia/Jakarta');

  if (!photoDt.isValid || events.length === 0) {
    return {
      bestMatch: null,
      ambiguous: false,
      confidence: 0,
      matchReason: 'Waktu foto tidak valid atau belum ada riwayat agenda yang terdaftar.',
      candidates: []
    };
  }

  const bufferBefore = params.bufferBeforeMinutes ?? 60; // 1 hour buffer before
  const bufferAfter = params.bufferAfterMinutes ?? 120;  // 2 hours buffer after

  const candidates: Array<{
    event: ExtractedEventRecord;
    score: number;
    reason: string;
  }> = [];

  const photoDateStr = photoDt.toFormat('yyyy-MM-dd');

  for (const event of events) {
    if (event.activity_status === 'cancelled') continue;
    const startDt = DateTime.fromISO(event.start_time).setZone('Asia/Jakarta');
    const endDt = DateTime.fromISO(event.end_time).setZone('Asia/Jakarta');

    if (!startDt.isValid || !endDt.isValid) continue;

    const eventDateStr = startDt.toFormat('yyyy-MM-dd');
    const isSameDate = photoDateStr === eventDateStr;

    // Case 1: Photo is strictly between start and end
    if (photoDt >= startDt && photoDt <= endDt) {
      candidates.push({
        event,
        score: 1.0,
        reason: `Foto diambil saat kegiatan berlangsung (${startDt.toFormat('HH:mm')} - ${endDt.toFormat('HH:mm')} WIB).`
      });
      continue;
    }

    // Case 2: Photo is within pre-event buffer (e.g. 1 hour before start)
    const prepStart = startDt.minus({ minutes: bufferBefore });
    if (photoDt >= prepStart && photoDt < startDt) {
      const diffMins = Math.round(startDt.diff(photoDt, 'minutes').minutes);
      candidates.push({
        event,
        score: 0.92,
        reason: `Foto diambil ${diffMins} menit sebelum acara dimulai (fase persiapan/registrasi).`
      });
      continue;
    }

    // Case 3: Photo is within post-event buffer (e.g. 2 hours after end)
    const postEnd = endDt.plus({ minutes: bufferAfter });
    if (photoDt > endDt && photoDt <= postEnd) {
      const diffMins = Math.round(photoDt.diff(endDt, 'minutes').minutes);
      candidates.push({
        event,
        score: 0.90,
        reason: `Foto diambil ${diffMins} menit setelah acara selesai (sesi foto bersama / penutupan).`
      });
      continue;
    }

    // Case 4: Same date, but further apart
    if (isSameDate) {
      candidates.push({
        event,
        score: 0.65,
        reason: `Kegiatan diselenggarakan pada tanggal yang sama (${eventDateStr}).`
      });
      continue;
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  const highCandidates = candidates.filter(candidate => candidate.score >= 0.85);
  const ambiguous = highCandidates.length > 1;
  const bestMatch = highCandidates.length === 1 ? highCandidates[0].event : null;
  const bestScore = candidates.length > 0 ? candidates[0].score : 0;
  const matchReason = candidates.length > 0 ? candidates[0].reason : 'Tidak ditemukan agenda pada tanggal/waktu foto ini.';

  return {
    bestMatch,
    ambiguous,
    confidence: bestScore,
    matchReason,
    candidates
  };
}
