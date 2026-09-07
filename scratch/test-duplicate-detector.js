const { findDuplicateEvent, evaluateEventPairSimilarity } = require('../lib/duplicate-detector');

console.log('=== TEST DETEKSI DUPLIKASI AGENDA KEGIATAN ===\n');

// Existing event in DB (e.g. from PDF official letter)
const existingEvents = [
  {
    id: 'evt_1',
    user_id: 'user_123',
    title: 'Bimbingan Teknis Implementasi Kurikulum Merdeka Jenjang SMA',
    start_time: '2026-09-15T09:00:00+07:00',
    end_time: '2026-09-15T12:00:00+07:00',
    location: 'Hotel Aston Priority Simatupang',
    meeting_link: '',
    meeting_id_pass: '',
    source_type: 'pdf',
    file_name: 'Surat_Undangan_Bimtek.pdf',
    created_at: '2026-09-01T10:00:00.000Z'
  },
  {
    id: 'evt_2',
    user_id: 'user_123',
    title: 'Sosialisasi Juknis Pelaksanaan BOKB Tahun 2026',
    start_time: '2026-09-20T08:30:00+07:00',
    end_time: '2026-09-20T11:30:00+07:00',
    location: 'Zoom Meeting',
    meeting_link: 'https://us02web.zoom.us/j/81229132801?pwd=abc',
    meeting_id_pass: 'Meeting ID: 812 2913 2801 | Pass: BOKB',
    source_type: 'pdf',
    file_name: 'Juknis_BOKB.pdf',
    created_at: '2026-09-02T14:00:00.000Z'
  },
  {
    id: 'evt_3',
    user_id: 'user_123',
    title: 'Apel Pagi Rutin ASN',
    start_time: '2026-09-01T07:30:00+07:00',
    end_time: '2026-09-01T08:00:00+07:00',
    location: 'Halaman Kantor Pemda',
    source_type: 'text',
    created_at: '2026-08-30T10:00:00.000Z'
  }
];

let passedCount = 0;
let totalCount = 0;

function runTest(testName, newEvent, expectedDuplicate, expectedConfidenceMin = 0.70) {
  totalCount++;
  console.log(`[TEST ${totalCount}] ${testName}`);
  const result = findDuplicateEvent(newEvent, existingEvents);

  const pass = result.isDuplicate === expectedDuplicate && 
    (!expectedDuplicate || result.confidence >= expectedConfidenceMin);

  if (pass) {
    passedCount++;
    console.log(`✅ BERHASIL: isDuplicate=${result.isDuplicate} (Confidence: ${(result.confidence * 100).toFixed(1)}%)`);
    if (result.isDuplicate) {
      console.log(`   Matched: "${result.matchedEvent?.title}"`);
      console.log(`   Reason : ${result.reason}`);
    }
  } else {
    console.error(`❌ GAGAL: Harusnya isDuplicate=${expectedDuplicate}, tapi didapat isDuplicate=${result.isDuplicate} (Confidence: ${(result.confidence * 100).toFixed(1)}%)`);
    console.error(`   Reason: ${result.reason}`);
  }
  console.log('----------------------------------------------------');
}

// 1. Poster Flyer with slight title variation and acronym on same day
runTest(
  'Poster Flyer vs Surat PDF (Bimtek vs Bimbingan Teknis pada tgl yang sama)',
  {
    title: 'Bimtek Kurikulum Merdeka 2026',
    start_time: '2026-09-15T09:00:00+07:00',
    end_time: '2026-09-15T12:00:00+07:00',
    location: 'Aston Hotel Simatupang'
  },
  true,
  0.75
);

// 2. WhatsApp chat text with same Zoom Meeting ID
runTest(
  'Pesan WhatsApp vs Surat PDF (Zoom ID sama persis pada tgl yang sama)',
  {
    title: 'Webinar Sosialisasi Petunjuk Teknis BOKB',
    start_time: '2026-09-20T08:30:00+07:00',
    end_time: '2026-09-20T11:00:00+07:00',
    location: 'Zoom',
    meeting_link: 'https://zoom.us/j/81229132801',
    meeting_id_pass: '81229132801'
  },
  true,
  0.90
);

// 3. Exact re-submission of the same event
runTest(
  'Pengiriman ulang dokumen persis sama',
  {
    title: 'Bimbingan Teknis Implementasi Kurikulum Merdeka Jenjang SMA',
    start_time: '2026-09-15T09:00:00+07:00',
    end_time: '2026-09-15T12:00:00+07:00',
    location: 'Hotel Aston Priority Simatupang'
  },
  true,
  0.90
);

// 4. Negative Test: Different activity on the same date (Prevent False Positives!)
runTest(
  'Kegiatan berbeda di hari yang sama (Rapat Anggaran vs Bimtek Kurikulum)',
  {
    title: 'Rapat Koordinasi Pembahasan Anggaran Keuangan Daerah',
    start_time: '2026-09-15T13:30:00+07:00',
    end_time: '2026-09-15T16:00:00+07:00',
    location: 'Ruang Rapat Bappeda Lt. 2'
  },
  false
);

// 5. Negative Test: Same routine title on different date (Weekly recurring)
runTest(
  'Judul rutin sama tapi tanggal berbeda pekan depan (Apel Pagi)',
  {
    title: 'Apel Pagi Rutin ASN',
    start_time: '2026-09-08T07:30:00+07:00',
    end_time: '2026-09-08T08:00:00+07:00',
    location: 'Halaman Kantor Pemda'
  },
  false
);

console.log(`\nHASIL AKHIR: ${passedCount} / ${totalCount} tes berhasil lolos.`);
process.exit(passedCount === totalCount ? 0 : 1);
