const { parseGoogleDriveFolderId, buildEventFolderName } = require('../lib/google-drive-api');

console.log('=== TEST INTEGRASI GOOGLE DRIVE API ===\n');

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

// 1. Test parsing Google Drive Folder URL
const url1 = 'https://drive.google.com/drive/folders/1ABC_def-GHI123456789?usp=sharing';
const id1 = parseGoogleDriveFolderId(url1);
assert(id1 === '1ABC_def-GHI123456789', `Parse browser sharing link: got "${id1}"`);

const url2 = 'https://drive.google.com/drive/u/0/folders/1XYZ-789_abcdef';
const id2 = parseGoogleDriveFolderId(url2);
assert(id2 === '1XYZ-789_abcdef', `Parse account-indexed link (/u/0/): got "${id2}"`);

const rawId = '1FolderIdRaw1234567890';
const id3 = parseGoogleDriveFolderId(rawId);
assert(id3 === '1FolderIdRaw1234567890', `Parse raw folder ID: got "${id3}"`);

const empty = parseGoogleDriveFolderId('');
assert(empty === null, 'Parse empty string returns null');

// 2. Test event folder name builder (YYYY-MM-DD - Judul Kegiatan)
const event1 = {
  title: 'Bimbingan Teknis Implementasi Kurikulum Merdeka Jenjang SMA',
  start_time: '2026-09-15T09:00:00+07:00',
  end_time: '2026-09-15T12:00:00+07:00'
};
const folderName1 = buildEventFolderName(event1);
console.log(`Generated Folder Name 1: "${folderName1}"`);
assert(folderName1.startsWith('2026-09-15 - '), 'Folder name starts with ISO date YYYY-MM-DD');
assert(folderName1.includes('Kurikulum Merdeka'), 'Folder name contains event title');

// Test sanitization of illegal characters in folder name
const eventWithSpecialChars = {
  title: 'Rapat Koordinasi: Evaluasi/Monitoring "Q3" <Penting> & Roadmap*',
  start_time: '2026-10-01T08:30:00+07:00',
  end_time: '2026-10-01T11:00:00+07:00'
};
const folderName2 = buildEventFolderName(eventWithSpecialChars);
console.log(`Generated Folder Name 2 (Sanitized): "${folderName2}"`);
assert(!/[\\/:*?"<>|]/.test(folderName2), 'Illegal characters properly cleaned from folder name');
assert(folderName2.startsWith('2026-10-01 - '), 'Sanitized folder starts with ISO date 2026-10-01');

console.log(`\nHASIL: ${passed} / ${total} pengujian Google Drive berhasil lolos.`);
process.exit(passed === total ? 0 : 1);
