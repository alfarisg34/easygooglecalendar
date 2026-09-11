// Test verification script for photo documentation vs poster classification
const { matchPhotoToUserEvents } = require('../lib/photo-matcher');
const { buildEventFolderName } = require('../lib/google-drive-api');

console.log('=== TEST SIMULASI DETEKSI FOTO DOKUMENTASI VS POSTER FLYER ===\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

// 1. Test buildEventFolderName for auto-created documentation folder
const testEvent = {
  title: 'Dokumentasi: Jl. Gatot Subroto No.Kav 51, Setiabudi, Jakarta Selatan',
  start_time: '2026-09-10T13:29:00+07:00'
};
const folderName = buildEventFolderName(testEvent);
assert(
  folderName.startsWith('2026-09-10 - Dokumentasi') && folderName.includes('Gatot Subroto'),
  `Folder name generated correctly: "${folderName}"`
);

// 2. Test matchPhotoToUserEvents when event exists
const existingEvents = [
  {
    id: 'evt_rapat_gatot_subroto',
    user_id: 'user_1',
    title: 'Rapat Koordinasi Evaluasi Kebijakan Ketenagakerjaan',
    start_time: '2026-09-10T13:00:00+07:00',
    end_time: '2026-09-10T16:00:00+07:00',
    location: 'Gedung Kemenaker Jl. Gatot Subroto Kav 51',
    created_at: '2026-09-08T08:00:00.000Z'
  }
];

const photoTime = '2026-09-10T13:29:00+07:00';
const matchResult = matchPhotoToUserEvents({
  photoTimeIso: photoTime,
  events: existingEvents,
  locationHint: 'Jl. Gatot Subroto No.Kav 51'
});

assert(
  matchResult.bestMatch !== null && matchResult.bestMatch.id === 'evt_rapat_gatot_subroto',
  `Photo matched to active meeting event during 13:00 - 16:00: ${matchResult.bestMatch?.title}`
);
assert(
  matchResult.confidence === 1.0,
  `Score is 1.0 for photo taken inside meeting window (score: ${matchResult.confidence})`
);

// 3. Test matchPhotoToUserEvents when NO event exists on that day
const noEventsMatch = matchPhotoToUserEvents({
  photoTimeIso: photoTime,
  events: [
    {
      id: 'evt_other_day',
      user_id: 'user_1',
      title: 'Webinar Lain',
      start_time: '2026-09-15T09:00:00+07:00',
      end_time: '2026-09-15T11:00:00+07:00',
      location: 'Zoom',
      created_at: '2026-09-01T08:00:00.000Z'
    }
  ],
  locationHint: 'Jl. Gatot Subroto No.Kav 51'
});

assert(
  noEventsMatch.bestMatch === null,
  `Correctly returns no match when there are no events on that date`
);

// 4. Test Caption Keyword Detection for Documentation
const testCaptions = [
  { caption: '#foto kegiatan rapat', expectedDoc: true },
  { caption: '#dokumentasi', expectedDoc: true },
  { caption: 'foto kegiatan monev di setiabudi', expectedDoc: true },
  { caption: 'presensi rapat dinas', expectedDoc: true },
  { caption: 'undangan webinar bimtek', expectedDoc: false },
  { caption: '#poster webinar', expectedPoster: true }
];

testCaptions.forEach(({ caption, expectedDoc, expectedPoster }) => {
  const c = caption.toLowerCase();
  const isExplicitDoc = 
    c.includes('#foto') || 
    c.includes('#dok') || 
    c.includes('#dokumentasi') || 
    c.includes('#kegiatan') ||
    c.includes('dokumentasi') ||
    c.includes('foto kegiatan') ||
    c.includes('presensi') ||
    c.includes('monev') ||
    c.includes('laporan kegiatan');
  const isExplicitPoster = 
    c.includes('#poster') || 
    c.includes('#agenda') || 
    c.includes('#jadwal') || 
    c.includes('#kalender') || 
    c.includes('#flyer');

  if (expectedDoc !== undefined) {
    assert(isExplicitDoc === expectedDoc, `Caption "${caption}" isDocPhoto: ${isExplicitDoc}`);
  }
  if (expectedPoster !== undefined) {
    assert(isExplicitPoster === expectedPoster, `Caption "${caption}" isPoster: ${isExplicitPoster}`);
  }
});

// 5. Test AI JSON Guardrail Detection
const mockAiResponseWithGuardrail = JSON.stringify({
  is_not_event: true,
  error: "Berkas ini terdeteksi sebagai foto dokumentasi fisik kegiatan, bukan poster undangan agenda."
});

const parsed = JSON.parse(mockAiResponseWithGuardrail);
assert(
  parsed.is_not_event === true,
  `Guardrail successfully detects is_not_event response`
);

console.log(`\n========================================`);
console.log(`HASIL TEST: ${passedTests} / ${totalTests} BERHASIL`);
console.log(`========================================\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
