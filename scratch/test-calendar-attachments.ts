import { createLoader } from './test-loader.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { calendar_v3, drive_v3 } from 'googleapis';
import type { CalendarEvent } from '../lib/types';

const nativeRequire = createRequire(import.meta.url);
function load<T>(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  return createLoader(mocks,globals).load<T>(file);
}

async function main() {
  const auth = { userId: 'owner', email: 'owner@example.com', refreshToken: 'test' };
  const tokenStore = { getUserGoogleAuth: async () => auth, saveUserGoogleAuth: async () => {} };
  const authClient = { getGoogleOAuth2Client: () => ({ setCredentials: () => {}, on: () => {} }) };
  const db = { updateUserGoogleTokens: async () => true };
  const errors = load<typeof import('../lib/google-api-error')>('lib/google-api-error.ts', {});
  let insertCount = 0;
  let patches = 0;
  let driveFailure = false;
  let fileFailure = false;
  let insertFailure = false;
  let patchFailure = 0;
  let current: calendar_v3.Schema$Event = {};
  let uploaded = '';
  const google = { drive: () => ({ files: { list:async()=>({data:{files:[]}}), create: async (args: {
    requestBody: drive_v3.Schema$File; media?: { mimeType: string; body: AsyncIterable<Buffer> };
  }) => {
    if (driveFailure) throw new Error('Drive unavailable');
    if (!args.media) return { data: { id: 'folder', webViewLink: 'https://drive.google.com/drive/folders/folder' } };
    if (fileFailure) throw new Error('Upload unavailable');
    uploaded = '';
    for await (const chunk of args.media.body) uploaded += chunk.toString('utf8');
    return { data: { id: 'source-file', name: args.requestBody.name,
      mimeType: args.media.mimeType.split(';')[0], webViewLink: 'https://drive.google.com/file/d/source-file/view' } };
  } } }), calendar: () => ({ events: {
    insert: async () => { insertCount++; if (insertFailure) throw new Error('Calendar unavailable');
      return { data: { id: 'new-event', htmlLink: 'https://calendar.google.com/event/demo' } }; },
    get: async () => ({ data: current }),
    patch: async (args: calendar_v3.Params$Resource$Events$Patch, options: { headers?: Record<string, string> }) => {
      patches++;
      assert.equal(args.supportsAttachments, true); assert.equal(args.sendUpdates, 'none');
      assert.equal(args.eventId, 'new-event'); assert.equal(args.calendarId, 'team@example.com');
      assert.equal(options.headers?.['If-Match'], 'current-etag');
      assert.deepEqual(Object.keys(args.requestBody!), ['attachments']);
      if (patchFailure) throw Object.assign(new Error('simulated attachment failure'), { code: patchFailure });
      current = { ...current, attachments: args.requestBody!.attachments };
      return { data: current };
    }
  } }) };
  const mocks = { './google-api-error': errors, './google-auth': authClient, './token-store': tokenStore, './db': db, googleapis: { google } };
  const drive = load<typeof import('../lib/google-drive-api')>('lib/google-drive-api.ts', mocks);
  const service = load<typeof import('../lib/google-calendar-api')>('lib/google-calendar-api.ts', { ...mocks, './google-drive-api': drive });
  const event: CalendarEvent = { title: 'Rapat Dokumentasi', start_time: '2026-10-14T09:00:00+07:00', end_time: '2026-10-14T11:00:00+07:00',
    location: 'Ruang B', is_online: false, meeting_link: '', meeting_id_pass: '', jp: '', speakers: '', description: 'Undangan rapat' };
  const existing = { fileId: 'keep-file', fileUrl: 'https://drive.google.com/file/d/keep-file/view', title: 'Existing file', mimeType: 'application/pdf' };
  const reset = () => { current = { status: 'confirmed', etag: 'current-etag', attachments: [existing] }; };
  for (const sourceType of ['pdf', 'image', 'text'] as const) {
    reset(); const before = insertCount;
    const result = await service.syncGoogleCalendarEventWithSource({ userId: 'owner', event, calendarId: 'team@example.com',
      fileData: { sourceType, base64Data: Buffer.from('original-source').toString('base64'), textContent: 'Original invitation text',
        fileName: sourceType === 'pdf' ? 'undangan.pdf' : 'poster.png', mimeType: sourceType === 'image' ? 'image/png' : 'application/pdf' } });
    assert.equal(insertCount, before + 1);
    assert.equal(result.insertResult.success, true); assert.equal(result.attachmentResult.attached, true);
    assert.equal(current.attachments?.length, 2); assert.equal(current.attachments?.[0].fileUrl, existing.fileUrl);
    assert.equal(current.attachments?.[1].title, sourceType === 'text' ? 'salinan_undangan.txt' : sourceType === 'pdf' ? 'undangan.pdf' : 'poster.png');
    assert.equal(current.attachments?.[1].mimeType, sourceType === 'text' ? 'text/plain' : sourceType === 'pdf' ? 'application/pdf' : 'image/png');
    assert.equal(current.attachments?.[1].fileId, undefined, 'Read-only fileId must not be written');
    if (sourceType === 'text') assert.ok(uploaded.includes('Original invitation text'));
    else assert.equal(uploaded, 'original-source');
  }
  const file = { fileId: 'source-file', fileUrl: 'https://drive.google.com/file/d/source-file/view', fileName: 'undangan.pdf' };
  const beforeDuplicate = patches;
  assert.equal((await service.attachDriveFileToCalendarEvent({ userId: 'owner', calendarId: 'team@example.com', eventId: 'new-event', file })).attached, true);
  assert.equal(patches, beforeDuplicate, 'Same file must not be appended twice');
  current.attachments = Array.from({ length: 25 }, (_, i) => ({ ...existing, fileId: `old-${i}` }));
  assert.equal((await service.attachDriveFileToCalendarEvent({ userId: 'owner', eventId: 'new-event', file })).attached, false);
  assert.equal(patches, beforeDuplicate);
  reset(); patchFailure = 412;
  const beforeFailure = insertCount;
  const conflicted = await service.syncGoogleCalendarEventWithSource({ userId: 'owner', event, calendarId: 'team@example.com', fileData: { sourceType: 'text', textContent: 'Original' } });
  assert.equal(conflicted.insertResult.success, true); assert.equal(conflicted.attachmentResult.attached, false);
  assert.equal(insertCount, beforeFailure + 1, 'Attachment failure must not recreate a calendar event');
  assert.equal(conflicted.gdriveResult.fileId, 'source-file');
  patchFailure = 0; driveFailure = true;
  const beforeDriveFailure = patches;
  const failedDrive = await service.syncGoogleCalendarEventWithSource({ userId: 'owner', event, calendarId: 'team@example.com', fileData: { sourceType: 'text', textContent: 'Original' } });
  assert.equal(failedDrive.insertResult.success, true); assert.equal(failedDrive.attachmentResult.attached, false);
  assert.equal(patches, beforeDriveFailure);
  driveFailure = false;

  fileFailure = true;
  const partialDrive = await service.syncGoogleCalendarEventWithSource({ userId: 'owner', event, fileData: { sourceType: 'text', textContent: 'Original' } });
  assert.equal(partialDrive.insertResult.success, true);
  assert.equal(partialDrive.gdriveResult.success, false); assert.equal(partialDrive.gdriveResult.folderId, 'folder');
  assert.equal(partialDrive.attachmentResult.attached, false); assert.equal(patches, beforeDriveFailure);
  fileFailure = false; insertFailure = true;
  const failedCalendar = await service.syncGoogleCalendarEventWithSource({ userId: 'owner', event, fileData: { sourceType: 'text', textContent: 'Original' } });
  assert.equal(failedCalendar.insertResult.success, false); assert.equal(failedCalendar.gdriveResult.fileId, 'source-file');
  assert.equal(patches, beforeDriveFailure); assert.equal(failedCalendar.attachmentResult.attached, false);
  insertFailure = false;

  let savedEventId = '';
  const route = load<typeof import('../app/api/extract/route')>('app/api/extract/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown) => body } }, '@/lib/google-calendar-api': service,
    '@/lib/gemini': { extractEventFromSource: async () => ({ success: true, event }) }, '@/lib/calendar-builder': { generateICSContent: () => 'ics' },
    '@/lib/token-store': tokenStore, '@/lib/auth-session': { getSessionFromRequest: async () => ({ userId: 'owner', email: auth.email }) },
    '@/lib/db': { getUserById: async () => ({ id: 'owner', calendar_id: 'team@example.com' }), getRecentExtractedEventsForUser: async () => [],
      saveExtractedEvent: async (record: { google_event_id: string }) => { savedEventId = record.google_event_id; return record; } },
    '@/lib/duplicate-detector': { findDuplicateEvent: () => ({ isDuplicate: false }) }
  });
  reset();
  const response = await route.POST({ headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
    json: async () => ({ sourceType: 'text', text: 'Original invitation text', apiKey: 'test', calendarId: 'team@example.com' })
  } as unknown as Parameters<typeof route.POST>[0]) as unknown as { autoSyncResult: { attachmentResult: { attached: boolean } } };
  assert.equal(response.autoSyncResult.attachmentResult.attached, true); assert.equal(savedEventId, 'new-event');

  const messages: string[] = [];
  const handler = load<typeof import('../lib/telegram-handler')>('lib/telegram-handler.ts', {
    './google-calendar-api': service, './google-drive-api': drive, './event-update': {}, './event-lifecycle-store': {},
    './telegram-agenda': { handleTelegramAgenda: async () => false }, './token-store': tokenStore,
    './gemini': { extractEventFromSource: async () => ({ success: true, event }) },
    './db': { getUserByTelegram: async () => ({ id: 'owner', calendar_id: 'team@example.com' }), getBotAdminSettings: async () => null,
      getRecentExtractedEventsForUser: async () => [], saveExtractedEvent: async (record: { google_event_id: string }) => { savedEventId = record.google_event_id; return record; } },
    './duplicate-detector': { findDuplicateEvent: () => ({ isDuplicate: false }) }, './photo-matcher': {}
  }, { fetch: async (_url: string, args: { body: string }) => { messages.push(JSON.parse(args.body).text);
    return { ok: true, json: async () => ({ ok: true }) }; } });
  const send = () => handler.handleTelegramWebhook({ update_id: 1, message: { message_id: 1,
    from: { id: 123, is_bot: false, first_name: 'User' }, chat: { id: 123, type: 'private' }, date: 0,
    text: 'Undangan rapat dokumentasi pada 14 Oktober 2026 pukul 09.00 di Ruang B.'
  } }, 'test-bot', 'test-key', 'https://example.com');
  reset(); const beforeTelegram = insertCount;
  await send();
  assert.equal(insertCount, beforeTelegram + 1); assert.equal(savedEventId, 'new-event');
  assert.match(messages.at(-1)!, /Berkas undangan terlampir di event/);
  reset(); patchFailure = 403;
  const beforeTelegramFailure = insertCount;
  await send();
  assert.equal(insertCount, beforeTelegramFailure + 1);
  assert.match(messages.at(-1)!, /Lampiran belum terpasang di event/);
  assert.equal(savedEventId, 'new-event');
  console.log('PASS: Telegram attaches generated TXT and reports attachment failure while retaining the created event');
  console.log('PASS: original PDF/image/TXT attachment metadata, preserving attachments, duplicate/limit/concurrency guards, independent Calendar/Drive failures, and web integration');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
