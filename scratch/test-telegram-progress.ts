import { createLoader } from './test-loader.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
function load<T>(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown>): T {
  return createLoader(mocks,globals).load<T>(file);
}

async function main() {
  const messages: Array<{ endpoint: string; text: string; message_id?: number }> = [];
  let tick: () => Promise<void> = async () => {};
  let cleared = false;
  let releaseProgress: (() => void) | undefined;
  let progressStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { progressStarted = resolve; });
  let simulateSlowProgress = true;
  let updateError = false;
  let historyError = false;
  let rejectFinalEdit = false;
  let updates = 0;
  const event = { title: 'Rapat A', start_time: '2026-10-12T12:30:00+07:00', location: 'Ruang B', update: { start_clock: '12:30' } };
  const handler = load<typeof import('../lib/telegram-handler')>('lib/telegram-handler.ts', {
    './event-update': { matchUpdateEvent: () => ({ id: 'existing', lifecycle_version: 0 }),
      updateExistingEvent: async () => { updates++; if (updateError) throw new Error('Kegiatan sudah berubah.');
        return { message: 'Waktu/tempat kegiatan diperbarui. Google Calendar sudah diperbarui.', event }; } },
    './event-lifecycle-store': {findOwnedEvent:async()=>({id:'existing',lifecycle_version:0})},
    './telegram-workflows': {handleWorkflowInput:async()=>false,currentSource:()=>[],offerUpdateConfirmation:async()=>{updates++;if(updateError)throw new Error('Kegiatan sudah berubah.');}}, './telegram-agenda': { handleTelegramAgenda: async () => false },
    './gemini': { extractEventFromSource: async () => { if (simulateSlowProgress) void tick(); return { success: true, event }; } },
    './token-store': { getUserGoogleAuth: async () => ({ userId: 'owner', email: 'owner@example.com' }) },
    './google-calendar-api': {}, './duplicate-detector': {}, './google-drive-api': {}, './photo-matcher': {},
    './db': { getUserByTelegram: async () => ({ id: 'owner' }), getBotAdminSettings: async () => null,
      getRecentExtractedEventsForUser: async () => { if (historyError) throw new Error('Database unavailable'); return []; } }
  }, {
    setInterval: (callback: () => Promise<void>) => { tick = callback; return 1; },
    clearInterval: () => { cleared = true; },
    fetch: async (url: string, args?: { body: string }) => {
      if (url.includes('/getFile')) return { ok: true, json: async () => ({ ok: true, result: { file_path: 'letter.pdf' } }) };
      if (url.includes('/file/')) return new Response('source');
      const body = JSON.parse(args!.body) as { text?: string; message_id?: number };
      messages.push({ endpoint: url.split('/').at(-1)!, text: body.text || '', message_id: body.message_id });
      if (url.endsWith('/editMessageText') && simulateSlowProgress && body.text?.includes('Menunggu hasil ekstraksi AI')) {
        progressStarted!();
        await new Promise<void>(resolve => { releaseProgress = resolve; });
      }
      if (url.endsWith('/editMessageText') && rejectFinalEdit) return { ok: false, json: async () => ({ ok: false }) };
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
    }
  });
  const sendPdf = () => handler.handleTelegramWebhook({ update_id: 1, message: {
    message_id: 1, from: { id: 123, is_bot: false, first_name: 'User' }, chat: { id: 123, type: 'private' }, date: 0,
    document: { file_id: 'letter', file_name: 'change.pdf', mime_type: 'application/pdf' }
  } }, 'test-bot', 'test-key', 'https://example.com');

  const work = sendPdf();
  await started;
  assert.equal(updates, 0, 'Final work waits for any in-flight progress edit');
  await tick();
  assert.equal(messages.filter(message => message.text.includes('Menunggu hasil ekstraksi AI')).length, 1, 'A second tick must not overlap the pending edit');
  releaseProgress!();
  await work;
  assert.equal(cleared, true);
  assert.equal(updates, 1);
  assert.equal(messages.at(-1)?.endpoint, 'editMessageText');
  assert.equal(messages.at(-1)?.message_id, 42);
  assert.match(messages.at(-1)!.text, /konfirmasi/);
  assert.equal(messages.filter(message => message.endpoint === 'sendMessage').length, 1, 'Success replaces the progress message');
  const finishedCount = messages.length;
  await tick();
  assert.equal(messages.length, finishedCount, 'Stopped animation cannot overwrite final output');

  simulateSlowProgress = false; updateError = true;
  await sendPdf();
  assert.equal(messages.at(-1)?.endpoint, 'editMessageText'); assert.equal(messages.at(-1)?.message_id, 42);
  assert.match(messages.at(-1)!.text, /Kegiatan sudah berubah/);
  updateError = false; historyError = true;
  await sendPdf();
  assert.equal(messages.at(-1)?.endpoint, 'editMessageText'); assert.match(messages.at(-1)!.text, /Riwayat kegiatan belum dapat dibaca/);
  historyError = false; rejectFinalEdit = true;
  await sendPdf();
  assert.equal(messages.at(-1)?.endpoint, 'sendMessage'); assert.match(messages.at(-1)!.text, /konfirmasi/);
  console.log('PASS: update preview/error completes original progress message, pending edits drain before completion, and failed edits fall back to a new message');
}
const deadline=setTimeout(()=>{console.error('FAIL: progress test stalled');process.exit(1);},15000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(()=>clearTimeout(deadline));
