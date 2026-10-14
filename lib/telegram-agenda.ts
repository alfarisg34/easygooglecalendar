import { createHash, randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { TelegramUpdate } from './types';
import { EventOwner, AgendaSession, AgendaFilter, listOwnedAgenda, findOwnedEvent, readAgendaSession, writeAgendaSession } from './event-lifecycle-store';
import { changeEventLifecycle } from './event-lifecycle';

interface AgendaMessage {
  botToken: string; chatId: number; text: string;
  inlineButtons?: Array<{ text: string; url?: string; callback_data?: string }>;
}

const schedule = (start: string, end: string) => `${DateTime.fromISO(start).setZone('Asia/Jakarta').toFormat('dd MMM yyyy, HH:mm')}–${DateTime.fromISO(end).setZone('Asia/Jakarta').toFormat('HH:mm')} WIB`;

/** Numbered selections persist per bot/user/chat across serverless webhook invocations. */
export async function handleTelegramAgenda(params: {
  update: TelegramUpdate; botToken: string; chatId: number; userId: number; chatType: string;
  owner: EventOwner | null; calendarId?: string; hostOrigin: string;
  send: (message: AgendaMessage) => Promise<unknown>;
}): Promise<boolean> {
  const callback = params.update.callback_query;
  const text = (params.update.message?.text || '').trim();
  const command = text.toLowerCase().split(/\s+/, 1)[0].split('@', 1)[0];
  const isList = ['/agenda','/dibatalkan','/cari','/lampau','/hariini','/besok','/minggu'].includes(command);
  const filter:AgendaFilter={};
  let listPage=Number(/--halaman\s+(\d+)/.exec(text)?.[1]||(/^\/(agenda|dibatalkan)\s+(\d{1,4})(?:\s|$)/i.exec(text)?.[2])||1);
  if(command==='/cari')filter.search=text.replace(/^\/cari(?:@\S+)?\s*/i,'').replace(/\s+--halaman\s+\d+\s*$/,'').slice(0,150);
  if(command==='/lampau')filter.past=true;
  const dates=text.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  const day=DateTime.now().setZone('Asia/Jakarta').startOf('day');
  if(['/hariini','/besok','/minggu'].includes(command)) {
    const begin=command==='/besok'?day.plus({days:1}):day;
    filter.from=begin.toISO()!;filter.to=begin.plus({days:command==='/minggu'?7:1}).toISO()!;
  } else if(command==='/agenda' && dates?.length) {
    const begin=DateTime.fromISO(dates[0],{zone:'Asia/Jakarta'});const end=DateTime.fromISO(dates[1]||dates[0],{zone:'Asia/Jakarta'}).plus({days:1});
    if(!begin.isValid||!end.isValid||end<=begin)listPage=NaN;
    else {filter.from=begin.toISO()!;filter.to=end.toISO()!;}
  }
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
    const result = await listOwnedAgenda(owner, status, page, filter);
    const session: AgendaSession = { status, ids: result.events.map(e => e.id), versions: result.events.map(e => e.lifecycle_version || 0), expiresAt: Date.now() + 15 * 60000 };
    await writeAgendaSession(key, session);
    if (!result.events.length) {
      await send(page > 1 ? 'Halaman kosong. Ketik /agenda atau /dibatalkan untuk kembali ke halaman pertama.'
        : status === 'active' ? 'Tidak ada kegiatan pada pencarian ini. Coba /cari judul, /lampau, atau /agenda.' : 'Belum ada kegiatan yang dibatalkan. Ketik /agenda untuk melihat kegiatan aktif.');
      return;
    }
    const rows = result.events.map((event, i) => `${i + 1}. ${event.title.length > 180 ? event.title.slice(0, 177) + '…' : event.title}\n   ${schedule(event.start_time, event.end_time)}${event.lifecycle_sync === 'error' ? '\n   ⚠️ Kalender belum diperbarui' : ''}`);
    const next = page * 10 < result.total ? `\nHalaman berikutnya: ${text.replace(/\s+--halaman\s+\d+\s*$/,'').replace(/^\/(agenda|dibatalkan)\s+\d{1,4}(?=\s|$)/,'/$1')} --halaman ${page + 1}` : '';
    await send(`📅 *${status === 'active' ? (filter.past?'Kegiatan lampau':filter.search||filter.from?'Hasil pencarian kegiatan':'Kegiatan aktif mendatang') : 'Kegiatan dibatalkan'}* — halaman ${page}\n\n${rows.join('\n\n')}\n\n${status === 'active'
      ? 'Untuk membatalkan, ketik: batal 1\nAlasan opsional: batal 1 Penyelenggara membatalkan'
      : 'Untuk memulihkan, ketik: aktifkan 1'}\nJika sinkronisasi gagal, ketik: sinkron 1\nNomor mengikuti daftar terakhir di chat ini dan berlaku 15 menit.${next}`, [{ text: '🌐 Riwayat Web', url: params.hostOrigin }]);
  };
  try {
    if (isList) {
      if(command==='/cari'&&!filter.search)await send('Contoh: /cari learning series');
      else if (!Number.isSafeInteger(listPage) || listPage < 1 || listPage > 10000) await send('Gunakan /agenda, /agenda 2, atau /agenda YYYY-MM-DD YYYY-MM-DD.');
      else await showList(command === '/dibatalkan' ? 'cancelled' : 'active', listPage);
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
