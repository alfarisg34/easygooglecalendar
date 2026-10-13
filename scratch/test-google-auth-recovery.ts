import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
function load<T>(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require: (id: string) => id in mocks ? mocks[id] : nativeRequire(id), Buffer, console,
    process: { env: {}, cwd: () => '/isolated' }, ...globals }, { filename: file });
  return module.exports as T;
}

async function main() {
  const files = new Map<string, string>();
  let refreshToken = 'old-token';
  const user = () => ({ id: 'google-owner', email: 'owner@example.com', telegram_chat_id: '123', google_refresh_token: refreshToken });
  const tokenStore = load<typeof import('../lib/token-store')>('lib/token-store.ts', {
    fs: { existsSync: (p: string) => files.has(p), readFileSync: (p: string) => files.get(p),
      writeFileSync: (p: string, content: string) => files.set(p, content) },
    './db': { getUserById: async () => user(), getUserByEmail: async () => user(), getUserByTelegram: async () => user() }
  });
  assert.equal((await tokenStore.getUserGoogleAuth('tg_123'))?.refreshToken, 'old-token');
  refreshToken = 'reconnected-token';
  assert.equal((await tokenStore.getUserGoogleAuth('tg_123'))?.refreshToken, 'reconnected-token');
  assert.equal((await tokenStore.getUserGoogleAuth('google-owner'))?.userId, 'google-owner');

  const errors = load<typeof import('../lib/google-api-error')>('lib/google-api-error.ts', {});
  assert.equal(errors.isInvalidGoogleGrant({ response: { data: { error: 'invalid_grant' } } }), true);
  assert.equal(errors.isInvalidGoogleGrant(new Error('invalid_grant')), true);
  assert.equal(errors.isInvalidGoogleGrant(new Error('quota exceeded')), false);
  let creates = 0;
  const drive = load<typeof import('../lib/google-drive-api')>('lib/google-drive-api.ts', {
    './google-api-error': errors, './token-store': tokenStore, './db': { updateUserGoogleTokens: async () => true },
    './google-auth': { getGoogleOAuth2Client: () => ({ setCredentials: () => {}, on: () => {} }) },
    googleapis: { google: { drive: () => ({ files: { create: async () => {
      creates++;
      throw Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } });
    } } }) } }
  });
  const folder = await drive.createDriveFolder({ userId: 'google-owner', folderName: 'Test', parentFolderId: '12345678901234567890' });
  assert.equal(creates, 1, 'Revoked tokens must not trigger root-folder retry');
  assert.equal(folder.error, errors.GOOGLE_RECONNECT_MESSAGE);
  const upload = await drive.uploadFileToDrive({ userId: 'google-owner', folderId: 'folder', buffer: Buffer.from('photo'), fileName: 'photo.jpg', mimeType: 'image/jpeg' });
  assert.equal(upload.success, false);
  assert.equal(upload.error, errors.GOOGLE_RECONNECT_MESSAGE);

  const messages: Array<{ text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> } }> = [];
  let extracted = { title: 'Agenda', update: { start_clock: '13:00' } };
  let selected = '';
  let updates = 0;
  let inserts = 0;
  const handler = load<typeof import('../lib/telegram-handler')>('lib/telegram-handler.ts', {
    './event-update': { matchUpdateEvent: () => undefined, updateExistingEvent: async (args: { eventId: string; expectedVersion: number }) => {
      assert.equal(args.expectedVersion, 7); selected = args.eventId; updates++;
      return { message: 'Updated', event: { title: 'Rapat', start_time: '2099-10-08T13:00:00+07:00', location: 'Ruang A' } };
    } },
    './event-lifecycle-store': { readAgendaSession: async (key: string) => {
      const { createHash } = nativeRequire('node:crypto') as typeof import('node:crypto');
      assert.equal(key, createHash('sha256').update('test-bot').digest('hex').slice(0, 16) + ':123:123:google-owner');
      return { ids: ['older-event-outside-recent-history'], versions: [7], status: 'active' };
    } },
    './telegram-agenda': { handleTelegramAgenda: async () => false },
    './gemini': { extractEventFromSource: async () => ({ success: true, event: extracted }) },
    './token-store': tokenStore,
    './google-calendar-api': { insertGoogleCalendarEvent: async () => { inserts++; } },
    './db': { getUserByTelegram: async () => user(), getBotAdminSettings: async () => null, getRecentExtractedEventsForUser: async () => [] },
    './duplicate-detector': {}, './google-drive-api': {}, './photo-matcher': {}
  }, { fetch: async (_url: string, args: { body: string }) => {
    messages.push(JSON.parse(args.body)); return { ok: true, json: async () => ({ ok: true }) };
  } });
  const send = async (text: string) => handler.handleTelegramWebhook({ update_id: 1, message: {
    message_id: 1, from: { id: 123, is_bot: false, first_name: 'User' }, chat: { id: 123, type: 'private' }, date: 0, text
  } }, 'test-bot', 'test-key', 'https://example.com');
  await send('/update 1 jam 13.00');
  assert.equal(updates, 1); assert.equal(selected, 'older-event-outside-recent-history'); assert.equal(inserts, 0);
  extracted = { title: 'Agenda' } as typeof extracted;
  await send('/update 1 jam 13.00');
  assert.equal(updates, 1); assert.equal(inserts, 0);
  assert.match(messages.at(-1)!.text, /Perubahan belum terbaca/);
  await send('/connect');
  assert.equal(messages.at(-1)?.reply_markup?.inline_keyboard[0][0].url, 'https://example.com/api/auth/google?user_id=tg_123');
  console.log('PASS: numbered Telegram update, exact agenda session key/version, no new event on extraction failure, and reconnect button for connected users');

  console.log('PASS: fresh token after reconnect, canonical identity, structured invalid_grant, actionable upload error, and no folder retry on invalid authorization');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
