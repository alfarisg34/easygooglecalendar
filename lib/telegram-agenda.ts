import { createHash, randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { TelegramUpdate } from './types';
import { EventOwner, AgendaSession, listOwnedAgenda, findOwnedEvent, readAgendaSession, writeAgendaSession } from './event-lifecycle-store';
import { changeEventLifecycle } from './event-lifecycle';

interface AgendaMessage {
  botToken: string; chatId: number; text: string;
  inlineButtons?: Array<{ text: string; url?: string; callback_data?: string }>;
}

const schedule = (start: string, end: string) => `${DateTime.fromISO(start).setZone('Asia/Jakarta').toFormat('dd MMM yyyy, HH:mm')}–${DateTime.fromISO(end).setZone('Asia/Jakarta').toFormat('HH:mm')} WIB`;

/** Upgrade existing EasyCal webhooks that previously accepted only message updates. */
async function enableConfirmationCallbacks(botToken: string, origin: string): Promise<boolean> {
  try {
    const endpoint = `https://api.telegram.org/bot${botToken}`;
    const response = await fetch(`${endpoint}/getWebhookInfo`, { signal: AbortSignal.timeout(5000) });
    const data: { ok?: boolean; result?: { url?: string; allowed_updates?: string[]; has_custom_certificate?: boolean; max_connections?: number } } = await response.json();
    if (!data.ok || !data.result?.url) return false;
    const info = data.result;
    if (!info.allowed_updates?.length || info.allowed_updates.includes('callback_query')) return true;
    const url = new URL(info.url!);
    if (url.origin !== new URL(origin).origin || !['/api/telegram', '/api/telegram/webhook'].includes(url.pathname) || info.has_custom_certificate) return false;
    const result = await fetch(`${endpoint}/setWebhook`, { method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: info.url,
        allowed_updates: [...info.allowed_updates, 'callback_query'], max_connections: info.max_connections }) });
    const body: { ok?: boolean } = await result.json();
    return Boolean(body.ok);
  } catch { return false; }
}

/** Numbered selections persist per bot/user/chat across serverless webhook invocations. */
export async function handleTelegramAgenda(params: {
  update: TelegramUpdate; botToken: string; chatId: number; userId: number; chatType: string;
  owner: EventOwner | null; calendarId?: string; hostOrigin: string;
  send: (message: AgendaMessage) => Promise<unknown>;
}): Promise<boolean> {
  const callback = params.update.callback_query;
  const text = (params.update.message?.text || '').trim();
  const command = text.toLowerCase().split(/\s+/, 1)[0].split('@', 1)[0];
  const isList = command === '/agenda' || command === '/dibatalkan';
  const selection = /^\/?(batal|aktifkan|sinkron)\s+(\d+)(?:\s+([\s\S]+))?$/i.exec(text);
  const isAction = /^\/?(batal|aktifkan|sinkron)(?:\s|$)/i.test(text);
  const isCallback = Boolean(callback?.data?.startsWith('agenda:'));
  if (!isList && !isAction && !isCallback) return false;
  const send = (message: string, buttons?: AgendaMessage['inlineButtons']) => params.send({ botToken: params.botToken, chatId: params.chatId, text: message, inlineButtons: buttons });
  if (isCallback && callback) {
    try {
      await fetch(`https://api.telegram.org/bot${params.botToken}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callback.id })
      });
    } catch { console.error('Could not acknowledge Telegram agenda callback'); }
  }
  if (params.chatType !== 'private') {
    await send('Kelola kegiatan melalui chat pribadi dengan bot agar daftar dan konfirmasi hanya terlihat oleh Anda.');
    return true;
  }
  const owner = params.owner;
  if (!owner) {
    await send('Hubungkan akun terlebih dahulu dengan /connect untuk melihat dan mengelola kegiatan Anda.');
    return true;
  }
  const key = `${createHash('sha256').update(params.botToken).digest('hex').slice(0, 16)}:${params.chatId}:${params.userId}:${owner.userId}`;
  const showList = async (status: 'active' | 'cancelled', page: number = 1) => {
    const result = await listOwnedAgenda(owner, status, page);
    const session: AgendaSession = { status, ids: result.events.map(e => e.id), versions: result.events.map(e => e.lifecycle_version || 0), expiresAt: Date.now() + 15 * 60000 };
    await writeAgendaSession(key, session);
    if (!result.events.length) {
      await send(page > 1 ? 'Halaman kosong. Ketik /agenda atau /dibatalkan untuk kembali ke halaman pertama.'
        : status === 'active' ? 'Tidak ada kegiatan aktif mendatang. Kegiatan lama tetap tersedia di web. Ketik /dibatalkan untuk melihat kegiatan yang dibatalkan.' : 'Belum ada kegiatan yang dibatalkan. Ketik /agenda untuk melihat kegiatan aktif.');
      return;
    }
    const rows = result.events.map((event, i) => `${i + 1}. ${event.title.length > 180 ? event.title.slice(0, 177) + '…' : event.title}\n   ${schedule(event.start_time, event.end_time)}${event.lifecycle_sync === 'error' ? '\n   ⚠️ Kalender belum diperbarui' : ''}`);
    const next = page * 10 < result.total ? `\nHalaman berikutnya: ${status === 'active' ? '/agenda' : '/dibatalkan'} ${page + 1}` : '';
    await send(`📅 *${status === 'active' ? 'Kegiatan aktif mendatang' : 'Kegiatan dibatalkan'}* — halaman ${page}\n\n${rows.join('\n\n')}\n\n${status === 'active'
      ? 'Untuk membatalkan, ketik: batal 1\nAlasan opsional: batal 1 Penyelenggara membatalkan'
      : 'Untuk memulihkan, ketik: aktifkan 1'}\nJika sinkronisasi gagal, ketik: sinkron 1\nNomor mengikuti daftar terakhir di chat ini dan berlaku 15 menit.${next}`, [{ text: '🌐 Riwayat Web', url: params.hostOrigin }]);
  };
  try {
    if (isList) {
      if (!await enableConfirmationCallbacks(params.botToken, params.hostOrigin)) {
        await send('Tombol konfirmasi belum dapat diaktifkan. Buka Pengaturan Web EasyCal dan sinkronkan webhook Telegram, lalu tampilkan daftar kembali.');
      }
      const argument = text.split(/\s+/)[1];
      const page = argument ? Number(argument) : 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) await send('Gunakan /agenda atau /agenda 2 untuk memilih halaman. Untuk kegiatan dibatalkan, gunakan /dibatalkan.');
      else await showList(command === '/agenda' ? 'active' : 'cancelled', page);
      return true;
    }
    const session = await readAgendaSession(key);
    if (!session) {
      await send('Daftar belum tersedia atau kedaluwarsa. Saya tampilkan daftar terbaru; pilih nomor kembali.');
      await showList(selection?.[1].toLowerCase() === 'aktifkan' ? 'cancelled' : 'active');
      return true;
    }
    if (isCallback) {
      const [, action, token] = callback?.data?.split(':') || [];
      if (!session.pending || token !== session.pending.token) {
        await send('Konfirmasi ini tidak berlaku lagi. Ketik /agenda atau /dibatalkan dan pilih kegiatan kembali.');
        return true;
      }
      const pending = session.pending;
      if (action === 'back') {
        delete session.pending;
        await writeAgendaSession(key, session);
        await send('Tidak ada perubahan kegiatan. Pilih nomor lain atau ketik /agenda.');
        return true;
      }
      if (action !== 'confirm') return true;
      const result = await changeEventLifecycle({ owner, eventId: pending.id, action: pending.action,
        expectedVersion: pending.version, reason: pending.reason, channel: 'telegram', calendarId: params.calendarId });
      delete session.pending;
      session.expiresAt = Date.now();
      await writeAgendaSession(key, session);
      await send(`${result.event.lifecycle_sync === 'error' ? '⚠️' : result.event.activity_status === 'cancelled' ? '🚫' : '✅'} ${result.event.title}\n\n${result.message}\n\n${result.event.activity_status === 'cancelled' ? 'Ketik /dibatalkan, lalu aktifkan sesuai nomor daftar untuk memulihkan.' : 'Ketik /agenda untuk melihat kegiatan aktif.'}\nJika sinkronisasi gagal, buka daftar terbaru dan ketik sinkron sesuai nomor.`, [{ text: '🌐 Buka Web EasyCal', url: params.hostOrigin }]);
      return true;
    }
    if (!selection) {
      await send('Gunakan batal 1 (alasan opsional), aktifkan 1, atau sinkron 1 sesuai nomor pada daftar terakhir.');
      return true;
    }
    const verb = selection[1].toLowerCase();
    const index = Number(selection[2]) - 1;
    const id = session.ids[index];
    if (!Number.isSafeInteger(index) || index < 0 || !id) {
      await send(`Nomor tidak tersedia. Pilih nomor 1–${session.ids.length}, atau tampilkan daftar baru dengan /agenda atau /dibatalkan.`);
      return true;
    }
    const event = await findOwnedEvent(owner, id);
    if (!event || (event.lifecycle_version || 0) !== session.versions[index]) {
      await send('Kegiatan pada daftar sudah berubah. Saya tampilkan daftar terbaru; pilih nomor kembali.');
      await showList(session.status);
      return true;
    }
    if (verb === 'sinkron') {
      const result = await changeEventLifecycle({ owner, eventId: id, action: 'retry', expectedVersion: event.lifecycle_version || 0, channel: 'telegram', calendarId: params.calendarId });
      await send(result.message);
      await showList(session.status);
      return true;
    }
    const action = verb === 'batal' ? 'cancel' : 'restore';
    if ((event.activity_status || 'active') !== (action === 'cancel' ? 'active' : 'cancelled')) {
      await send(action === 'cancel' ? 'Kegiatan sudah dibatalkan. Gunakan aktifkan untuk memulihkan.' : 'Kegiatan sudah aktif. Gunakan batal untuk membatalkan.');
      return true;
    }
    const reason = (selection[3] || '').trim().slice(0, 500);
    const token = randomUUID().slice(0, 12);
    session.pending = { id, version: event.lifecycle_version || 0, action, reason, token };
    await writeAgendaSession(key, session);
    await send(`*${action === 'cancel' ? 'Batalkan' : 'Aktifkan kembali'} kegiatan ini?*\n\n${event.title}\n${schedule(event.start_time, event.end_time)}\nKalender: ${event.google_calendar_id || params.calendarId || 'primary'}\n\n${action === 'cancel'
      ? 'Kegiatan dan berkas tetap tersimpan. Pengingat kalender dimatikan dan waktunya ditandai tersedia setelah sinkronisasi berhasil.'
      : 'Judul, pengingat, dan ketersediaan kalender sebelum pembatalan akan dipulihkan.'}${reason && action === 'cancel' ? `\nAlasan: ${reason}` : ''}${action === 'restore' && Date.parse(event.end_time) < Date.now() ? '\n⚠️ Jadwal kegiatan sudah lewat.' : ''}`, [
      { text: action === 'cancel' ? 'Ya, batalkan' : 'Ya, aktifkan kembali', callback_data: `agenda:confirm:${token}` },
      { text: 'Kembali', callback_data: `agenda:back:${token}` }
    ]);
  } catch (error) {
    await send(error instanceof Error && !('config' in error) ? error.message : 'Kegiatan belum dapat diproses. Coba lagi setelah beberapa saat.');
  }
  return true;
}
