import { createLoader } from './test-loader.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { ExtractedEventRecord } from '../lib/db';

const nativeRequire = createRequire(import.meta.url);
function load<T>(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  return createLoader(mocks,globals).load<T>(file);
}

async function main() {
  const gemini = load<typeof import('../lib/gemini')>('lib/gemini.ts', { './calendar-builder': {}, './ocr-service': {} });
  const requestedModels: string[] = [];
  let status = 404;
  const matcher = load<typeof import('../lib/photo-matcher')>('lib/photo-matcher.ts', { './gemini': gemini }, {
    fetch: async (url: string) => {
      requestedModels.push(/models\/([^:]+)/.exec(url)![1]);
      if (requestedModels.length === 1 || status === 403) return { ok: false, status };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        detected: true, date: '2026-10-12', time: '10:18', timezone: '+07:00', location: 'Jl. Gatot Subroto Kav. 51'
      }) }] } }] }) };
    }
  });
  const watermark = await matcher.detectWatermarkTimestamp({ apiKey: 'test', model: 'gemini-2.0-flash', base64Data: 'test' });
  assert.equal(watermark.detectedDateTime, '2026-10-12T10:18:00.000+07:00');
  assert.deepEqual(requestedModels, ['gemini-2.0-flash', 'gemini-3.6-flash']);
  requestedModels.length = 0; status = 403;
  assert.equal((await matcher.detectWatermarkTimestamp({ apiKey: 'test', base64Data: 'test' })).detected, false);
  assert.equal(requestedModels.length, 1, 'Authorization failures must not repeat on other models');
  for (const raw of [{ detected: true, date: '2026-10-12' }, { detected: true, date: '2026-02-30', time: '10:18' },
    { detected: true, date: '2026-10-12', time: '25:00' }]) assert.equal(matcher.parseWatermarkTimestamp(raw).detected, false);
  assert.equal(matcher.resolvePhotoTimestamp({ hasCameraExif: false }, { detected: false }), null);
  assert.equal(matcher.resolvePhotoTimestamp({ hasCameraExif: false }, watermark), watermark.detectedDateTime);
  const events: ExtractedEventRecord[] = [
    { id: 'meeting-12', user_id: 'owner', title: 'Rapat 12 Oktober', start_time: '2026-10-12T10:00:00+07:00', end_time: '2026-10-12T12:00:00+07:00', created_at: '' },
    { id: 'webinar-13', user_id: 'owner', title: 'Learning Series 13 Oktober', start_time: '2026-10-13T14:00:00+07:00', end_time: '2026-10-13T16:00:00+07:00', created_at: '' }
  ];
  assert.equal(matcher.matchPhotoToUserEvents({ photoTimeIso: watermark.detectedDateTime!, events }).bestMatch?.id, 'meeting-12');
  assert.equal(matcher.matchPhotoToUserEvents({ photoTimeIso: watermark.detectedDateTime!, events: [events[1]] }).bestMatch, null);
  assert.equal(matcher.matchPhotoToUserEvents({ photoTimeIso: '2026-10-12T20:00:00+07:00', events }).bestMatch, null);
  const ambiguous = matcher.matchPhotoToUserEvents({ photoTimeIso: watermark.detectedDateTime!, events: [events[0], { ...events[0], id: 'meeting-other' }] });
  assert.equal(ambiguous.ambiguous, true); assert.equal(ambiguous.bestMatch, null);

  let capture = { detected: false } as typeof watermark;
  let uploads = 0;
  let history = events;
  const messages: string[] = [];
  const handler = load<typeof import('../lib/telegram-handler')>('lib/telegram-handler.ts', {
    './event-update': {}, './event-lifecycle-store': {}, './telegram-workflows':{handleWorkflowInput:async()=>false,currentSource:()=>[],offerPhotoSelection:async(args:{reason:string})=>messages.push(args.reason)},
    './telegram-agenda': { handleTelegramAgenda: async () => false },
    './gemini': {}, './google-calendar-api': {}, './duplicate-detector': {},
    './token-store': { getUserGoogleAuth: async () => ({ userId: 'owner', email: 'owner@example.com' }) },
    './db': { getUserByTelegram: async () => ({ id: 'owner' }), getBotAdminSettings: async () => null,
      getRecentExtractedEventsForUser: async () => history, updateEventGdriveFolder: async () => {}, saveEventDocumentation: async () => {} },
    './photo-matcher': { ...matcher, extractPhotoMetadata: async () => ({ hasCameraExif: false }), detectWatermarkTimestamp: async () => capture },
    './google-drive-api': { uploadDocumentationPhotoToDrive: async (args: { event: ExtractedEventRecord; takenAtIso: string }) => {
      uploads++; assert.equal(args.event.id, 'meeting-12'); assert.equal(args.takenAtIso, watermark.detectedDateTime);
      return { success: true, folderId: 'folder', folderUrl: 'https://example.com/folder' };
    } }
  }, { fetch: async (url: string, args?: { body: string }) => {
    if (url.includes('/getFile')) return { ok: true, json: async () => ({ ok: true, result: { file_path: 'photo.jpg' } }) };
    if (url.includes('/file/')) return new Response('source');
    messages.push(JSON.parse(args!.body).text); return { ok: true, json: async () => ({ ok: true }) };
  } });
  const sendPhoto = () => handler.handleTelegramWebhook({ update_id: 1, message: {
    message_id: 1, from: { id: 123, is_bot: false, first_name: 'User' }, chat: { id: 123, type: 'private' }, date: 0,
    media_group_id: 'album', photo: [{ file_id: 'photo', file_unique_id: 'unique', width: 100, height: 100 }]
  } }, 'test-bot', 'test-key', 'https://example.com');
  await sendPhoto(); assert.equal(uploads, 0); assert.match(messages.at(-1)!, /Waktu pengambilan foto belum/);
  capture = watermark; history = [events[1]];
  await sendPhoto(); assert.equal(uploads, 0); assert.match(messages.at(-1)!, /Tidak ditemukan kegiatan/);
  history = [events[0], { ...events[0], id: 'meeting-other' }];
  await sendPhoto(); assert.equal(uploads, 0); assert.match(messages.at(-1)!, /beberapa kegiatan/);
  history = events;
  await sendPhoto(); assert.equal(uploads, 1); assert.match(messages.at(-1)!, /Waktu Foto/); assert.match(messages.at(-1)!, /Watermark kamera/);

  let manualEventId = '';
  let savedCaptureTime: string | undefined;
  const route = load<typeof import('../app/api/documentation/route')>('app/api/documentation/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown) => body } },
    '@/lib/auth-session': { getSessionFromRequest: async () => ({ userId: 'owner', email: 'owner@example.com' }) },
    '@/lib/db': { getUserById: async () => ({ id: 'owner', gemini_api_key: 'test' }), getRecentExtractedEventsForUser: async () => events,
      updateEventGdriveFolder: async () => {}, saveEventDocumentation: async (record: { taken_at?: string }) => { savedCaptureTime = record.taken_at; return record; } },
    '@/lib/token-store': { getUserGoogleAuth: async () => ({ refreshToken: 'test' }) },
    '@/lib/photo-matcher': { ...matcher, extractPhotoMetadata: async () => ({ hasCameraExif: false }),
      classifyImageIntent: async () => ({ isActivityPhoto: true }), detectWatermarkTimestamp: async () => ({ detected: false }) },
    '@/lib/google-drive-api': { uploadDocumentationPhotoToDrive: async () => { uploads++; return { success: true, folderId: 'folder' }; } }
  });
  const request = { headers: { get: () => null }, formData: async () => ({ get: (key: string) => key === 'file'
    ? { name: 'photo.jpg', type: 'image/jpeg', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }
    : key === 'eventId' ? manualEventId : null }) } as unknown as Parameters<typeof route.POST>[0];
  const noTime = await route.POST(request) as unknown as { timeMissing: boolean; noMatchFound: boolean };
  assert.equal(noTime.timeMissing, true); assert.equal(noTime.noMatchFound, true); assert.equal(uploads, 1);
  manualEventId = 'meeting-12';
  const manual = await route.POST(request) as unknown as { success: boolean; captureTime: string | null };
  assert.equal(manual.success, true); assert.equal(manual.captureTime, null); assert.equal(savedCaptureTime, undefined);
  assert.equal(uploads, 2);

  const records = new Map<string, string>();
  const db = load<typeof import('../lib/db')>('lib/db.ts', {
    fs: { existsSync: (path: string) => records.has(path), readFileSync: (path: string) => records.get(path),
      writeFileSync: (path: string, value: string) => records.set(path, value) },
    '@neondatabase/serverless': { neonConfig: {}, neon: () => { throw new Error('Unexpected database call'); } }
  });
  const unknownTime = await db.saveEventDocumentation({ event_id: 'meeting-12', user_id: 'owner',
    gdrive_file_id: 'file', gdrive_file_url: 'https://example.com/file', match_method: 'manual_selection' });
  assert.equal(unknownTime.taken_at, undefined);
  assert.equal(Number.isNaN(Date.parse(unknownTime.created_at)), false);
  console.log('PASS: web auto-selection blocked without capture time; explicit manual upload preserves unknown capture time');
  console.log('PASS: watermark validation/fallback, 12 October capture time, no upload-time matching, ambiguous/no-match selection, and Telegram album routing');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
