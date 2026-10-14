import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { ExtractedEventRecord } from '../lib/db';
import type { calendar_v3 } from 'googleapis';
import type { TelegramUpdate } from '../lib/types';

const nativeRequire = createRequire(import.meta.url);
function load<T>(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, require: (id: string) => id in mocks ? mocks[id] : nativeRequire(id),
    Buffer, URL, Error, AbortSignal, console, process: { env: {}, cwd: () => '/isolated' }, ...globals }, { filename: file });
  return sandboxModule.exports as T;
}

const files = new Map<string, string>();
const eventsPath = path.join('/isolated', '.user_events.json');
const localFs = { existsSync: (p: string) => files.has(p), readFileSync: (p: string) => files.get(p), writeFileSync: (p: string, content: string) => files.set(p, content) };
const store = load<typeof import('../lib/event-lifecycle-store')>('lib/event-lifecycle-store.ts', { fs: localFs, './db': { initDatabase: async () => true } });
const owner = { userId: 'google-owner', email: 'owner@example.com', telegramChatId: '123' };
const fixture = (id = 'one'): ExtractedEventRecord => ({ id, user_id: owner.userId, title: 'Rapat A', start_time: '2099-10-08T09:00:00+07:00',
  end_time: '2099-10-08T11:00:00+07:00', created_at: '2026-10-06T00:00:00Z', synced_to_calendar: true,
  google_event_id: 'event-a', google_calendar_id: 'team@example.com', gdrive_folder_id: 'keep-folder' });
const reset = (events = [fixture()]) => { files.clear(); files.set(eventsPath, JSON.stringify(events)); };
let calendarEvent: calendar_v3.Schema$Event = {};
let patches = 0;
let failure = 0;
const oauth = { setCredentials: () => {}, on: () => {} };
const service = load<typeof import('../lib/event-lifecycle')>('lib/event-lifecycle.ts', {
  './google-api-error': load('lib/google-api-error.ts', {}),
  './db': { updateUserGoogleTokens: async () => {} }, './event-lifecycle-store': store,
  './google-auth': { getGoogleOAuth2Client: () => oauth }, './token-store': { getUserGoogleAuth: async () => ({ refreshToken: 'test' }) },
  googleapis: { google: { calendar: () => ({ events: {
    get: async (args: { calendarId: string; eventId: string }) => {
      assert.equal(args.calendarId, 'team@example.com'); assert.equal(args.eventId, 'event-a');
      return { data: structuredClone(calendarEvent) };
    },
    patch: async (args: { requestBody: calendar_v3.Schema$Event }) => {
      if (failure) throw Object.assign(new Error('simulated failure'), { code: failure });
      patches++; Object.assign(calendarEvent, structuredClone(args.requestBody)); return { data: calendarEvent };
    }
  } }) } }
});
const change = (action: 'cancel' | 'restore' | 'retry', version: number, eventId = 'one') => service.changeEventLifecycle({ owner, eventId, action, expectedVersion: version, reason: 'Penyelenggara membatalkan', channel: 'web' });


const updateService = load<typeof import('../lib/event-update')>('lib/event-update.ts', {
  './event-lifecycle-store': store, './event-lifecycle': service,
  './duplicate-detector': load('lib/duplicate-detector.ts', {})
});

async function main() {
  reset();
  calendarEvent = { summary: 'Rapat A (judul kalender)', description: 'Original description', transparency: 'opaque', reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] }, etag: 'v1', status: 'confirmed' };
  const original = structuredClone(calendarEvent);
  const cancelled = await change('cancel', 0);
  assert.equal(cancelled.event.activity_status, 'cancelled'); assert.equal(cancelled.event.lifecycle_sync, 'synced');
  assert.equal(calendarEvent.summary, '[DIBATALKAN] Rapat A (judul kalender)'); assert.equal(calendarEvent.transparency, 'transparent');
  assert.equal(calendarEvent.reminders?.overrides?.length, 0); assert.equal(cancelled.event.gdrive_folder_id, 'keep-folder');
  assert.equal(patches, 1);
  await assert.rejects(() => change('cancel', 0), /sudah berubah/);
  await change('cancel', 1); assert.equal(patches, 1, 'Repeated cancellation must not patch again');
  await change('restore', 1);
  assert.equal(calendarEvent.summary, original.summary); assert.equal(calendarEvent.description, original.description);
  assert.equal(calendarEvent.transparency, original.transparency); assert.equal(calendarEvent.reminders?.overrides?.[0].minutes, 60);
  assert.equal((await store.findOwnedEvent(owner, 'one'))?.calendar_backup, null);
  assert.equal((await store.findOwnedEvent({ userId: 'other' }, 'one')), null);
  const legacy = { ...fixture(), google_event_id: '', google_calendar_id: '', google_calendar_url: `https://calendar.google.com/calendar/event?eid=${Buffer.from('event-a team@example.com').toString('base64')}` };
  assert.equal(service.resolveCalendarIdentity(legacy, 'wrong-calendar').calendarId, 'team@example.com');
  assert.equal(service.resolveCalendarIdentity(legacy, 'wrong-calendar').eventId, 'event-a');
  assert.throws(() => service.resolveCalendarIdentity({ ...legacy, google_calendar_url: 'https://calendar.google.com/calendar/render?action=TEMPLATE' }, 'primary'), /ID kegiatan/);

  failure = 403;
  const failed = await change('cancel', 2);
  assert.equal(failed.event.lifecycle_sync, 'error'); assert.match(failed.message, /Pengingat mungkin masih aktif/);
  failure = 0;
  await change('retry', 3); assert.equal(calendarEvent.reminders?.overrides?.length, 0);
  await change('restore', 4); assert.equal(calendarEvent.reminders?.overrides?.[0].minutes, 60);
  const current = await store.findOwnedEvent(owner, 'one'); assert.ok(current);
  const claims = await Promise.all([store.claimEventChange(owner, current, 'cancelled', '', 'web'), store.claimEventChange(owner, current, 'cancelled', '', 'telegram')]);
  assert.equal(claims.filter(Boolean).length, 1, 'Only one concurrent action may claim the event');
  reset([{ ...fixture(), synced_to_calendar: false }]);
  const patchCount = patches;
  assert.equal((await change('cancel', 0)).event.lifecycle_sync, 'local'); assert.equal(patches, patchCount);
  await change('restore', 1);

  reset([fixture(), { ...fixture('two'), title: 'Rapat B' }]);
  const messages: Array<{ text: string; inlineButtons?: Array<{ callback_data?: string }> }> = [];
  let allowedUpdates = ['message', 'edited_message'];
  let webhookUpgrades = 0;
  const telegram = load<typeof import('../lib/telegram-agenda')>('lib/telegram-agenda.ts', { './event-lifecycle-store': store, './event-lifecycle': service }, { fetch: async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/setWebhook')) {
      const body = JSON.parse(options?.body || '{}') as { url: string; allowed_updates: string[] };
      assert.equal(body.url, 'https://example.com/api/telegram');
      assert.ok(body.allowed_updates.includes('callback_query')); allowedUpdates = body.allowed_updates; webhookUpgrades++;
    }
    return { ok: true, json: async () => ({ ok: true, result: { url: 'https://example.com/api/telegram', allowed_updates: allowedUpdates } }) };
  } });
  const request = async (text: string, extra: Partial<TelegramUpdate> = {}, userId = 123) => telegram.handleTelegramAgenda({
    update: { update_id: 1, message: { message_id: 1, from: { id: userId, is_bot: false, first_name: 'Test' }, chat: { id: userId, type: 'private' }, date: 1, text }, ...extra },
    botToken: 'test-bot', chatId: userId, userId, chatType: 'private', owner, hostOrigin: 'https://example.com', send: async m => { messages.push(m); }
  });
  await request('/agenda'); assert.match(messages.at(-1)?.text || '', /1\. Rapat A/);
  assert.equal(webhookUpgrades, 0, 'Agenda browsing cannot mutate secured webhook configuration');
  await request('batal 0'); assert.match(messages.at(-1)?.text || '', /Nomor tidak tersedia/);
  await request('batal 1 Ada perubahan');
  const firstToken = messages.at(-1)?.inlineButtons?.[0].callback_data;
  assert.ok(firstToken); assert.equal((await store.findOwnedEvent(owner, 'one'))?.activity_status, undefined, 'Selection must not cancel without confirmation');
  await request('batal 2');
  await request('', { callback_query: { id: 'tap', from: { id: 123, first_name: 'Test', is_bot: false }, data: firstToken } });
  assert.match(messages.at(-1)?.text || '', /tidak berlaku/);
  await request('batal 1');
  const confirmation = messages.at(-1)?.inlineButtons?.[0].callback_data;
  await request('', { callback_query: { id: 'tap', from: { id: 123, first_name: 'Test', is_bot: false }, data: confirmation } });
  assert.equal((await store.findOwnedEvent(owner, 'one'))?.activity_status, 'cancelled');
  assert.equal((await store.findOwnedEvent(owner, 'two'))?.activity_status, undefined);
  await request('/dibatalkan'); await request('aktifkan 1');
  const restore = messages.at(-1)?.inlineButtons?.[0].callback_data;
  await request('', { callback_query: { id: 'tap', from: { id: 123, first_name: 'Test', is_bot: false }, data: restore } });
  assert.equal((await store.findOwnedEvent(owner, 'one'))?.activity_status, 'active');
  await request('/agenda'); await request('batal 1');
  const old = messages.at(-1)?.inlineButtons?.[0].callback_data;
  await request('/agenda');
  await request('', { callback_query: { id: 'tap', from: { id: 123, first_name: 'Test', is_bot: false }, data: old } });
  assert.match(messages.at(-1)?.text || '', /tidak berlaku/);
  assert.equal(await request('Undangan panduan kegiatan besok'), false);
  await request('batal 1', {}, 999);
  assert.match(messages.at(-2)?.text || '', /kedaluwarsa/, 'Another chat must not reuse the numbered selection');
  const sessionsPath = path.join('/isolated', '.telegram_agenda_sessions.json');
  const sessions = JSON.parse(files.get(sessionsPath) || '{}') as Record<string, { expiresAt: number }>;
  for (const session of Object.values(sessions)) session.expiresAt = 0;
  files.set(sessionsPath, JSON.stringify(sessions));
  await request('batal 1');
  assert.match(messages.at(-2)?.text || '', /kedaluwarsa/);
  await request('batal 1');
  const stale = messages.at(-1)?.inlineButtons?.[0].callback_data;
  const listedEvent = await store.findOwnedEvent(owner, 'one'); assert.ok(listedEvent);
  await change('cancel', listedEvent.lifecycle_version || 0);
  await request('', { callback_query: { id: 'tap', from: { id: 123, first_name: 'Test', is_bot: false }, data: stale } });
  assert.match(messages.at(-1)?.text || '', /sudah berubah/);
  const matcher = load<typeof import('../lib/photo-matcher')>('lib/photo-matcher.ts', { './gemini': {} });
  const match = matcher.matchPhotoToUserEvents({ photoTimeIso: fixture().start_time, events: [{ ...fixture(), activity_status: 'cancelled' }] });
  assert.equal(match.bestMatch, null);
  reset();
  calendarEvent = { summary: 'Default reminders', description: '', reminders: { useDefault: true }, status: 'confirmed' };
  await change('cancel', 0); await change('restore', 1);
  assert.equal(calendarEvent.reminders?.useDefault, true);

  reset();
  calendarEvent = { summary: 'Rapat A', status: 'confirmed', etag: 'v1' };
  const originalEvent = fixture();
  const moved = updateService.mergeEventUpdate(originalEvent, { start_clock: '13:00' });
  assert.equal(moved.start_time, '2099-10-08T13:00:00.000+07:00');
  assert.equal(moved.end_time, '2099-10-08T15:00:00.000+07:00');
  assert.equal(moved.gdrive_folder_id, 'keep-folder');
  const venue = updateService.mergeEventUpdate(originalEvent, { location: 'Ruang B' });
  assert.equal(Date.parse(venue.start_time), Date.parse(originalEvent.start_time));
  assert.equal(venue.location, 'Ruang B');
  const rescheduled = updateService.mergeEventUpdate(originalEvent, { date: '2099-10-15', start_clock: '14:00', end_clock: '16:00' });
  assert.equal(rescheduled.start_time, '2099-10-15T14:00:00.000+07:00');
  assert.throws(() => updateService.mergeEventUpdate(originalEvent, { start_clock: '25:00' }));
  assert.throws(() => updateService.mergeEventUpdate(originalEvent, { date: '2099-02-30' }));
  assert.throws(() => updateService.mergeEventUpdate(originalEvent, {}));
  const query = { title: 'Rapat Koordinasi Data Ketenagakerjaan', update: { original_date: '2099-10-08' } } as import('../lib/types').CalendarEvent;
  const candidate = { ...fixture(), title: query.title };
  assert.equal(updateService.matchUpdateEvent(query, [candidate])?.id, 'one');
  assert.equal(updateService.matchUpdateEvent(query, [candidate, { ...candidate, id: 'two' }]), undefined);
  const changed = await updateService.updateExistingEvent({ owner, eventId: 'one', expectedVersion: 0, update: { start_clock: '13:00', location: 'Ruang B' } });
  assert.equal(changed.event.lifecycle_sync, 'synced');
  assert.equal(calendarEvent.start?.dateTime, changed.event.start_time);
  assert.equal(calendarEvent.location, 'Ruang B');
  assert.equal(changed.event.google_event_id, 'event-a');
  assert.equal(changed.event.gdrive_folder_id, 'keep-folder');
  assert.equal(JSON.parse(files.get(eventsPath)!).length, 1);
  reset(); failure = 503;
  const failedUpdate = await updateService.updateExistingEvent({ owner, eventId: 'one', expectedVersion: 0, update: { location: 'Ruang C' } });
  assert.equal(failedUpdate.event.lifecycle_sync, 'error');
  failure = 0;
  const recoveredUpdate = await change('retry', failedUpdate.event.lifecycle_version!);
  assert.equal(recoveredUpdate.event.lifecycle_sync, 'synced');
  assert.equal(calendarEvent.location, 'Ruang C');
  assert.equal(updateService.matchUpdateEvent(query, [{ ...candidate, activity_status: 'cancelled' }]), undefined);
  console.log('PASS: schedule/venue changes, partial fields, date validation, ambiguous matching, existing Calendar/Drive identity, and failed update retry');

  console.log('PASS: lifecycle, restoration, retries, ownership, concurrency, legacy identity, Telegram numbered selection/confirmation, and cancelled photo exclusion');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
