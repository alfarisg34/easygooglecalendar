import { CalendarEvent } from './types';
import { ExtractedEventRecord } from './db';
import { DateTime } from 'luxon';

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  confidence: number;
  reason: string;
  matchedEvent?: ExtractedEventRecord;
  matchedDetails?: {
    dateMatch: boolean;
    timeDiffMinutes: number;
    titleScore: number;
    meetingIdMatch: boolean;
    locationMatch: boolean;
  };
}

/**
 * Common Indonesian administrative acronym dictionary
 */
const ACRONYM_MAP: Record<string, string> = {
  rakor: 'rapat koordinasi',
  bimtek: 'bimbingan teknis',
  sosialisasi: 'sosialisasi',
  raker: 'rapat kerja',
  monev: 'monitoring evaluasi',
  diseminasi: 'diseminasi',
  desiminasi: 'diseminasi',
  workshop: 'lokakarya',
  webinar: 'seminar daring',
  pemda: 'pemerintah daerah',
  pemprov: 'pemerintah provinsi',
  pemkab: 'pemerintah kabupaten',
  pemkot: 'pemerintah kota',
  juknis: 'petunjuk teknis',
  juklak: 'petunjuk pelaksanaan',
  diklat: 'pendidikan pelatihan',
  bkpsdm: 'kepegawaian',
  bappeda: 'perencanaan',
  inspektorat: 'pengawasan',
  asn: 'aparatur sipil negara',
  pns: 'pegawai negeri sipil',
  gmeet: 'meet',
  zoom: 'zoom'
};

/**
 * Stop-words often found in Indonesian bureaucratic invitations / agendas
 */
const STOP_WORDS = new Set([
  'dan', 'atau', 'di', 'ke', 'dari', 'pada', 'dalam', 'untuk', 'dengan', 
  'yang', 'oleh', 'tentang', 'terkait', 'sehubungan', 'hal', 'perihal', 
  'acara', 'kegiatan', 'agenda', 'undangan', 'surat', 'pelaksanaan', 
  'jadwal', 'resmi', 'tahun', 'thn', '2024', '2025', '2026', '2027', 
  'pukul', 'jam', 'wib', 'wita', 'wit', 'bapak', 'ibu', 'yth', 'peserta',
  'hari', 'tanggal', 'tgl', 'mohon', 'diharapkan', 'kehadiran'
]);

/**
 * Normalizes text: expands acronyms, lowercases, removes punctuation, filters stopwords
 */
export function normalizeTitleKeywords(rawTitle: string): string[] {
  if (!rawTitle) return [];
  
  let cleaned = rawTitle
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Expand acronyms
  const words = cleaned.split(' ');
  const expandedWords: string[] = [];

  for (const word of words) {
    if (ACRONYM_MAP[word]) {
      expandedWords.push(...ACRONYM_MAP[word].split(' '));
    } else {
      expandedWords.push(word);
    }
  }

  // Filter stop-words and short tokens (< 3 characters unless acronyms)
  const tokens = expandedWords
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

  return Array.from(new Set(tokens));
}

/**
 * Computes Jaccard Similarity between two token lists: |A ∩ B| / |A ∪ B|
 */
export function calculateJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersectionCount = 0;
  for (const token of Array.from(setA)) {
    if (setB.has(token)) {
      intersectionCount++;
    }
  }

  const unionCount = new Set([...Array.from(setA), ...Array.from(setB)]).size;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

/**
 * Computes Token Containment score: |A ∩ B| / min(|A|, |B|)
 * Essential for comparing a shortened title ("Bimtek Kurikulum Merdeka")
 * against a full formal title ("Bimbingan Teknis Implementasi Kurikulum Merdeka Jenjang SMA")
 */
export function calculateContainmentScore(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersectionCount = 0;
  for (const token of Array.from(setA)) {
    if (setB.has(token)) {
      intersectionCount++;
    }
  }

  const minLength = Math.min(tokensA.length, tokensB.length);
  return minLength === 0 ? 0 : intersectionCount / minLength;
}

/**
 * Computes Dice's Bigram Coefficient for character string similarity (tolerant to slight typos/affixes)
 */
export function calculateDiceCoefficient(strA: string, strB: string): number {
  const cleanA = strA.toLowerCase().replace(/[^\w]/g, '');
  const cleanB = strB.toLowerCase().replace(/[^\w]/g, '');

  if (cleanA === cleanB) return 1.0;
  if (cleanA.length < 2 || cleanB.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  };

  const bigramsA = getBigrams(cleanA);
  const bigramsB = getBigrams(cleanB);

  let intersection = 0;
  for (const [bigram, countA] of Array.from(bigramsA.entries())) {
    if (bigramsB.has(bigram)) {
      intersection += Math.min(countA, bigramsB.get(bigram)!);
    }
  }

  const total = cleanA.length - 1 + cleanB.length - 1;
  return (2.0 * intersection) / total;
}

/**
 * Extracts a normalized 9 to 11 digit Zoom Meeting ID or Google Meet code
 */
export function extractMeetingId(text?: string | null): string | null {
  if (!text) return null;

  // Zoom: e.g. 812 2913 2801 or 812-2913-2801 or 81229132801
  const zoomMatch = text.match(/(?:zoom\.us\/(?:j|my)\/|\b)(\d{3,4}[ -]?\d{3,4}[ -]?\d{3,4})\b/i);
  if (zoomMatch) {
    const cleaned = zoomMatch[1].replace(/[\s-]/g, '');
    if (cleaned.length >= 9 && cleaned.length <= 11) {
      return cleaned;
    }
  }

  // Google Meet: e.g. abc-defg-hij
  const gmeetMatch = text.match(/(?:meet\.google\.com\/|\b)([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i);
  if (gmeetMatch) {
    return gmeetMatch[1].toLowerCase();
  }

  return null;
}

/**
 * Extracts normalized YYYY-MM-DD date and time in Asia/Jakarta timezone
 */
export function parseEventDateTime(isoString: string): {
  dateStr: string;
  minutesFromMidnight: number;
  isValid: boolean;
} {
  const dt = DateTime.fromISO(isoString).setZone('Asia/Jakarta');
  if (!dt.isValid) {
    return { dateStr: '', minutesFromMidnight: 0, isValid: false };
  }
  return {
    dateStr: dt.toFormat('yyyy-MM-dd'),
    minutesFromMidnight: dt.hour * 60 + dt.minute,
    isValid: true
  };
}

/**
 * Evaluates similarity between a newly extracted event and a previously recorded event
 */
export function evaluateEventPairSimilarity(
  newEvent: CalendarEvent,
  existingEvent: ExtractedEventRecord
): {
  isMatch: boolean;
  confidence: number;
  reason: string;
  details: {
    dateMatch: boolean;
    timeDiffMinutes: number;
    titleScore: number;
    meetingIdMatch: boolean;
    locationMatch: boolean;
  };
} {
  const newDt = parseEventDateTime(newEvent.start_time);
  const existDt = parseEventDateTime(existingEvent.start_time);

  const datesValid = newDt.isValid && existDt.isValid;
  const sameDay = datesValid && newDt.dateStr === existDt.dateStr;

  // Difference in calendar days
  let dayDiff = 999;
  if (datesValid) {
    const d1 = DateTime.fromISO(newDt.dateStr);
    const d2 = DateTime.fromISO(existDt.dateStr);
    dayDiff = Math.abs(Math.round(d1.diff(d2, 'days').days));
  }

  // Meeting ID comparison
  const newMeetingId = extractMeetingId(newEvent.meeting_id_pass) || extractMeetingId(newEvent.meeting_link);
  const existMeetingId = extractMeetingId(existingEvent.meeting_id_pass) || extractMeetingId(existingEvent.meeting_link);
  const meetingIdMatch = Boolean(newMeetingId && existMeetingId && newMeetingId === existMeetingId);

  // Time difference in minutes
  const timeDiffMinutes = datesValid && sameDay ? Math.abs(newDt.minutesFromMidnight - existDt.minutesFromMidnight) : 999;

  // Location comparison
  const locNew = (newEvent.location || '').toLowerCase();
  const locExist = (existingEvent.location || '').toLowerCase();
  let locationMatch = false;
  if (locNew && locExist && !locNew.includes('zoom') && !locExist.includes('zoom')) {
    const locKeywordsNew = locNew.replace(/[^\w\s]/g, '').split(' ').filter(w => w.length >= 4);
    const locKeywordsExist = locExist.replace(/[^\w\s]/g, '').split(' ').filter(w => w.length >= 4);
    const locOverlap = locKeywordsNew.some(w => locKeywordsExist.includes(w));
    if (locOverlap) locationMatch = true;
  }

  // Title similarity
  const tokensNew = normalizeTitleKeywords(newEvent.title);
  const tokensExist = normalizeTitleKeywords(existingEvent.title);

  const jaccard = calculateJaccardSimilarity(tokensNew, tokensExist);
  const containment = calculateContainmentScore(tokensNew, tokensExist);
  const dice = calculateDiceCoefficient(newEvent.title, existingEvent.title);

  // Blended title score
  // Containment is weighted because official PDF titles often have extra administrative prefixes/suffixes
  const titleScore = Math.max(
    jaccard * 0.6 + containment * 0.4,
    dice * 0.7 + containment * 0.3
  );

  // Case 1: Exact Virtual Meeting Match (Zoom ID matches + same day or ±1 day)
  if (meetingIdMatch && (sameDay || dayDiff <= 1)) {
    return {
      isMatch: true,
      confidence: 0.98,
      reason: `Kredensial Virtual Meeting (${newMeetingId}) sama persis pada tanggal pelaksanaan yang sama (${newDt.dateStr}).`,
      details: {
        dateMatch: sameDay,
        timeDiffMinutes,
        titleScore,
        meetingIdMatch: true,
        locationMatch
      }
    };
  }

  // Case 2: Different dates by more than 1 day and no meeting ID match
  if (!datesValid || dayDiff > 1) {
    return {
      isMatch: false,
      confidence: 0.0,
      reason: 'Tanggal pelaksanaan agenda berbeda.',
      details: {
        dateMatch: false,
        timeDiffMinutes,
        titleScore,
        meetingIdMatch: false,
        locationMatch
      }
    };
  }

  // Case 3: Same day comparison
  if (sameDay) {
    // Sub-case 3A: Title is almost identical (titleScore >= 0.82)
    if (titleScore >= 0.82) {
      const conf = Math.min(0.99, 0.85 + (timeDiffMinutes <= 60 ? 0.12 : 0.05));
      return {
        isMatch: true,
        confidence: conf,
        reason: `Judul agenda sangat mirip (${Math.round(titleScore * 100)}%) dan tanggal pelaksanaan sama (${newDt.dateStr}).`,
        details: {
          dateMatch: true,
          timeDiffMinutes,
          titleScore,
          meetingIdMatch,
          locationMatch
        }
      };
    }

    // Sub-case 3B: High title score (titleScore >= 0.65) and same / near start time (within 90 mins)
    if (titleScore >= 0.65 && timeDiffMinutes <= 90) {
      const conf = Math.min(0.95, 0.75 + (locationMatch ? 0.15 : 0.05));
      return {
        isMatch: true,
        confidence: conf,
        reason: `Kegiatan memiliki topik yang mirip (${Math.round(titleScore * 100)}%) dengan waktu mulai yang bersamaan pada tanggal ${newDt.dateStr}.`,
        details: {
          dateMatch: true,
          timeDiffMinutes,
          titleScore,
          meetingIdMatch,
          locationMatch
        }
      };
    }

    // Sub-case 3C: Moderate title score (titleScore >= 0.50) + exact same start time + matching location
    if (titleScore >= 0.50 && timeDiffMinutes <= 30 && locationMatch) {
      return {
        isMatch: true,
        confidence: 0.85,
        reason: `Agenda memiliki kemiripan kata kunci (${Math.round(titleScore * 100)}%), waktu yang sama, dan lokasi yang sama.`,
        details: {
          dateMatch: true,
          timeDiffMinutes,
          titleScore,
          meetingIdMatch,
          locationMatch: true
        }
      };
    }

    // Sub-case 3D: High containment (e.g. 0.80+) when one title is short abbreviation and start time is identical
    if (containment >= 0.80 && timeDiffMinutes <= 60) {
      return {
        isMatch: true,
        confidence: 0.88,
        reason: `Isi pokok kegiatan terkandung penuh dalam agenda yang sudah ada (${Math.round(containment * 100)}%) pada tanggal yang sama.`,
        details: {
          dateMatch: true,
          timeDiffMinutes,
          titleScore,
          meetingIdMatch,
          locationMatch
        }
      };
    }
  }

  // Case 4: Adjacent day (dayDiff === 1) e.g. multi-day workshop or timezone edge case
  if (dayDiff === 1 && titleScore >= 0.85) {
    return {
      isMatch: true,
      confidence: 0.82,
      reason: `Judul kegiatan identik (${Math.round(titleScore * 100)}%) pada rentang tanggal yang berdekatan (kemungkinan agenda multi-hari).`,
      details: {
        dateMatch: false,
        timeDiffMinutes,
        titleScore,
        meetingIdMatch,
        locationMatch
      }
    };
  }

  return {
    isMatch: false,
    confidence: Math.round(titleScore * 100) / 100,
    reason: 'Tidak terdeteksi kemiripan yang cukup signifikan.',
    details: {
      dateMatch: sameDay,
      timeDiffMinutes,
      titleScore,
      meetingIdMatch,
      locationMatch
    }
  };
}

/**
 * Searches through user's existing events to find any matching duplicate
 */
export function findDuplicateEvent(
  newEvent: CalendarEvent,
  existingEvents: ExtractedEventRecord[]
): DuplicateDetectionResult {
  if (!existingEvents || existingEvents.length === 0) {
    return {
      isDuplicate: false,
      confidence: 0,
      reason: 'Belum ada riwayat agenda tersimpan.'
    };
  }

  let bestMatch: ExtractedEventRecord | undefined;
  let maxConfidence = 0;
  let bestReason = '';
  let bestDetails: any = null;

  for (const record of existingEvents) {
    const sim = evaluateEventPairSimilarity(newEvent, record);
    if (sim.isMatch && sim.confidence > maxConfidence) {
      maxConfidence = sim.confidence;
      bestMatch = record;
      bestReason = sim.reason;
      bestDetails = sim.details;
    }
  }

  if (bestMatch && maxConfidence >= 0.70) {
    return {
      isDuplicate: true,
      confidence: maxConfidence,
      reason: bestReason,
      matchedEvent: bestMatch,
      matchedDetails: bestDetails
    };
  }

  return {
    isDuplicate: false,
    confidence: maxConfidence,
    reason: 'Tidak ada agenda sebelumnya yang sama.'
  };
}
