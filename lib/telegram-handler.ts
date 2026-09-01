import { TelegramUpdate } from './types';
import { extractEventFromSource } from './gemini';
import { DateTime } from 'luxon';
import { getUserGoogleAuth, deleteUserGoogleAuth } from './token-store';
import { insertGoogleCalendarEvent } from './google-calendar-api';
import { getUserByTelegram, getBotAdminSettings, disconnectTelegramUser } from './db';

const TELEGRAM_API_URL = 'https://api.telegram.org';

/**
 * Sends a Telegram chat message with optional inline keyboard buttons
 */
export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: number;
  text: string;
  inlineButtons?: Array<{ text: string; url: string }>;
}) {
  const url = `${TELEGRAM_API_URL}/bot${params.botToken}/sendMessage`;
  
  const bodyPayload: any = {
    chat_id: params.chatId,
    text: params.text,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  };

  if (params.inlineButtons && params.inlineButtons.length > 0) {
    bodyPayload.reply_markup = {
      inline_keyboard: [
        params.inlineButtons.map(btn => ({ text: btn.text, url: btn.url }))
      ]
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.warn('Telegram sendMessage Markdown failed, retrying plain text:', errText);
      // Fallback: Retry without parse_mode if Markdown parsing failed
      delete bodyPayload.parse_mode;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
    }
  } catch (err) {
    console.error('Telegram sendMessage network error:', err);
  }
}

/**
 * Downloads a file from Telegram by file_id and returns its base64 buffer and mimeType
 */
export async function downloadTelegramFile(params: {
  botToken: string;
  fileId: string;
}): Promise<{ base64Data: string; mimeType: string }> {
  const getFileUrl = `${TELEGRAM_API_URL}/bot${params.botToken}/getFile?file_id=${encodeURIComponent(params.fileId)}`;
  const fileInfoRes = await fetch(getFileUrl);
  const fileInfo = await fileInfoRes.json();

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Gagal mengambil metadata berkas dari Telegram.');
  }

  const filePath = fileInfo.result.file_path;
  const downloadUrl = `${TELEGRAM_API_URL}/file/bot${params.botToken}/${filePath}`;

  const fileRes = await fetch(downloadUrl);
  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64Data = buffer.toString('base64');

  let mimeType = 'application/pdf';
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (lower.endsWith('.png')) {
    mimeType = 'image/png';
  } else if (lower.endsWith('.webp')) {
    mimeType = 'image/webp';
  }

  return { base64Data, mimeType };
}

/**
 * Handles Telegram Webhook incoming updates (Multi-User Aware)
 */
export async function handleTelegramWebhook(
  update: TelegramUpdate, 
  botToken: string, 
  geminiKey: string,
  hostOrigin: string = 'https://easygooglecalendar.alfarighilmana.my.id'
) {
  const msg = update.message;
  if (!msg || !msg.chat || !msg.from) return { ok: true };

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || msg.caption || '').trim();
  const cleanText = text.toLowerCase();

  // 1. Resolve this specific Telegram user's Google Calendar from Neon DB & Token Store (Method B: Personal State Binding)
  const dbUser = await getUserByTelegram({ tgUserId: userId });
  const rawAuth = await getUserGoogleAuth(userId);
  const userAuth = rawAuth || (dbUser?.google_refresh_token ? {
    userId: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    picture: dbUser.picture,
    refreshToken: dbUser.google_refresh_token,
    accessToken: dbUser.google_access_token,
    expiryDate: dbUser.google_token_expiry ? Number(dbUser.google_token_expiry) : undefined,
    updatedAt: dbUser.updated_at || new Date().toISOString()
  } : null);

  // 2. Resolve AI key: user's personal key -> bot owner key -> global GEMINI_API_KEY
  const botAdmin = await getBotAdminSettings(botToken);
  const effectiveGeminiKey = geminiKey || dbUser?.gemini_api_key || botAdmin?.gemini_api_key || process.env.GEMINI_API_KEY || '';

  // Command: /connect or /login
  if (cleanText.startsWith('/connect') || cleanText.startsWith('/login') || cleanText.startsWith('/auth')) {
    const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `🔗 *Hubungkan Google Calendar Anda*\n\nKlik tombol di bawah ini untuk menghubungkan akun Google Anda. Setiap surat dinas atau poster yang Anda kirim akan **otomatis langsung tersimpan ke Google Calendar pribadi Anda tanpa perlu klik lagi (0-Click Sync)!**`,
      inlineButtons: [
        { text: '🔑 Hubungkan Akun Google', url: authUrl }
      ]
    });
    return { ok: true };
  }

  // Command: /status
  if (cleanText.startsWith('/status') || cleanText.startsWith('/cek')) {
    if (userAuth && userAuth.email) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `✅ *Status Akun Terhubung:*\n\n📧 *Email*: ${userAuth.email}\n👤 *Nama*: ${userAuth.name || '-'}\n🔄 *Mode*: Direct 0-Click Auto-Sync Aktif\n📅 *Target Kalender*: ${dbUser?.calendar_id || 'primary'}\n\n💡 Ketik \`/disconnect\` jika ingin mengganti atau memutuskan akun Google.`
      });
    } else {
      const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ *Akun Google Belum Terhubung*\n\nSaat ini Anda menggunakan mode manual. Hubungkan akun Google Anda agar agenda tersimpan otomatis ke kalender Anda:`,
        inlineButtons: [
          { text: '🔑 Hubungkan Google Calendar', url: authUrl }
        ]
      });
    }
    return { ok: true };
  }

  // Command: /disconnect or /logout
  if (cleanText.startsWith('/disconnect') || cleanText.startsWith('/logout')) {
    await deleteUserGoogleAuth(userId);
    await disconnectTelegramUser(userId);
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `🔌 *Koneksi Google Calendar Berhasil Diputus*\n\nAkun Google Calendar Anda telah diputus dari bot ini. Anda dapat menghubungkan kembali kapan saja dengan mengetik \`/connect\`.`
    });
    return { ok: true };
  }

  // Command: /start
  if (cleanText.startsWith('/start') || cleanText === 'start' || cleanText === 'halo' || cleanText === 'hai') {
    const isConnected = Boolean(userAuth && userAuth.email);
    const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `👋 *Selamat datang di Bot Agenda Dinas & Bimtek!*

Saya siap membantu Anda mencatat jadwal rapat, bimtek, webinar, dan agenda dinas langsung ke *Google Calendar*.

📌 *Status Anda*: ${isConnected ? `✅ Terhubung (${userAuth?.email})` : '⚠️ Belum Terhubung ke Google Calendar'}

*Format yang didukung:*
1. 📄 Kirimkan berkas *Surat PDF* (\`.pdf\`)
2. 🖼️ Kirimkan *Poster / Flyer* (JPG/PNG)
3. 💬 Salin & tempel teks pesan chat / broadcast

${!isConnected ? '💡 *Tips*: Ketik `/connect` atau klik tombol di bawah untuk menghubungkan akun Google Calendar Anda agar agenda otomatis tersimpan secara instan (0-Click)!' : '✨ *Anda sudah siap*: Cukup kirimkan dokumen surat atau poster ke sini!'}`,
      inlineButtons: !isConnected ? [{ text: '🔑 Hubungkan Google Calendar', url: authUrl }] : undefined
    });
    return { ok: true };
  }

  // Command: /help
  if (cleanText.startsWith('/help') || cleanText === 'help' || cleanText.startsWith('/bantuan')) {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `📖 *PANDUAN & PERINTAH BOT*

• \`/connect\` - Hubungkan akun Google Calendar pribadi Anda (0-Click Auto-Sync)
• \`/status\` - Periksa akun Google yang terhubung
• \`/disconnect\` - Putuskan akun Google Calendar
• \`/help\` - Tampilkan bantuan ini

*Kirimkan surat PDF, poster flyer, atau teks chat undangan kapan saja untuk menjadwalkan agenda!* ✨`
    });
    return { ok: true };
  }

  // Process Document PDF
  if (msg.document) {
    const doc = msg.document;
    const isPdf = (doc.mime_type || '').includes('pdf') || (doc.file_name || '').toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ *Format Berkas Belum Didukung*\nMohon kirimkan surat dinas dalam format *PDF* (\`.pdf\`) atau gambar poster (*JPG/PNG*).`
      });
      return { ok: true };
    }

    if (!geminiKey && !process.env.GEMINI_API_KEY) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ *Google Gemini API Key Belum Dikonfigurasi*\n\nBot membutuhkan API Key Gemini untuk membaca berkas. Silakan pasang \`GEMINI_API_KEY\` di Vercel Environment Variables atau masukkan Gemini API Key di website EasyCal sebelum menyetel webhook.`
      });
      return { ok: true };
    }

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `⏳ *Dokumen surat ${doc.file_name || 'undangan.pdf'} diterima.* Sedang menganalisis isi surat & jadwal dengan Google Gemini AI...`
    });

    try {
      const { base64Data, mimeType } = await downloadTelegramFile({ botToken, fileId: doc.file_id });
      const result = await extractEventFromSource({
        apiKey: geminiKey,
        sourceType: 'pdf',
        base64Data,
        mimeType
      });

      if (!result.success || !result.event) {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ *Gagal mengekstrak jadwal:* ${result.error || 'Dokumen tidak dapat dibaca.'}`
        });
        return { ok: true };
      }

      await dispatchCalendarResult({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        calendarId: dbUser?.calendar_id || 'primary'
      });
    } catch (err: any) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `❌ Terjadi kesalahan saat memproses dokumen: ${err.message}`
      });
    }
    return { ok: true };
  }

  // Process Photo / Poster
  if (msg.photo && msg.photo.length > 0) {
    if (!effectiveGeminiKey) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ *Google Gemini API Key Belum Dikonfigurasi*\n\nBot membutuhkan API Key Gemini untuk membaca poster. Silakan pasang \`GEMINI_API_KEY\` di Vercel Environment Variables atau masukkan Gemini API Key di website EasyCal.`
      });
      return { ok: true };
    }

    const bestPhoto = msg.photo[msg.photo.length - 1];

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `⏳ *Poster kegiatan diterima.* Sedang menganalisis teks & informasi visual menggunakan Gemini AI Vision...`
    });

    try {
      const { base64Data, mimeType } = await downloadTelegramFile({ botToken, fileId: bestPhoto.file_id });
      const result = await extractEventFromSource({
        apiKey: effectiveGeminiKey,
        sourceType: 'image',
        base64Data,
        mimeType
      });

      if (!result.success || !result.event) {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ *Gagal mengekstrak jadwal poster:* ${result.error || 'Poster tidak dapat dibaca.'}`
        });
        return { ok: true };
      }

      await dispatchCalendarResult({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        calendarId: dbUser?.calendar_id || 'primary'
      });
    } catch (err: any) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `❌ Terjadi kesalahan saat memproses poster: ${err.message}`
      });
    }
    return { ok: true };
  }

  // Process Text Chat
  if (text.length >= 20) {
    if (!effectiveGeminiKey) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ *Google Gemini API Key Belum Dikonfigurasi*\n\nBot membutuhkan API Key Gemini untuk membaca teks undangan. Silakan pasang \`GEMINI_API_KEY\` di Vercel Environment Variables atau masukkan Gemini API Key di website EasyCal.`
      });
      return { ok: true };
    }

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `⏳ *Menganalisis teks undangan rapat/kegiatan...*`
    });

    try {
      const result = await extractEventFromSource({
        apiKey: effectiveGeminiKey,
        sourceType: 'text',
        text
      });

      if (!result.success || !result.event) {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ *Gagal mengekstrak jadwal teks:* ${result.error || 'Teks tidak memuat informasi agenda.'}`
        });
        return { ok: true };
      }

      await dispatchCalendarResult({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        calendarId: dbUser?.calendar_id || 'primary'
      });
    } catch (err: any) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `❌ Terjadi kesalahan saat memproses teks: ${err.message}`
      });
    }
    return { ok: true };
  } else if (text.length > 0) {
    // Friendly response for short messages like 'halo', 'tes', 'hai'
    const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;
    const isConnected = Boolean(userAuth && userAuth.email);

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `👋 *Halo! Saya Bot Penjadwalan Agenda Google Calendar.*

Silakan kirimkan:
1. 📄 Berkas *Surat Dinas PDF* (\`.pdf\`)
2. 🖼️ Berkas *Poster / Flyer Kegiatan* (JPG/PNG)
3. 💬 Salinan teks lengkap undangan rapat

📌 *Status Akun*: ${isConnected ? `✅ Terhubung (${userAuth?.email})` : '⚠️ Belum Terhubung'}
💡 Ketik \`/help\` untuk melihat panduan lengkap atau \`/connect\` untuk menghubungkan kalender.`,
      inlineButtons: !isConnected ? [{ text: '🔑 Hubungkan Google Calendar', url: authUrl }] : undefined
    });
    return { ok: true };
  }

  return { ok: true };
}

/**
 * Dispatches calendar result:
 * - If user is connected via Google OAuth -> Direct 0-Click Auto-Insert into their Google Calendar
 * - If user is NOT connected -> Sends 1-Click URL button + [Hubungkan Akun Google] button
 */
async function dispatchCalendarResult(params: {
  botToken: string;
  chatId: number;
  userId: number;
  event: any;
  hostOrigin: string;
  userAuth?: any;
  calendarId?: string;
}) {
  const { botToken, chatId, userId, event, hostOrigin, userAuth, calendarId } = params;

  const startDt = DateTime.fromISO(event.start_time).setZone('Asia/Jakarta');
  const endDt = DateTime.fromISO(event.end_time).setZone('Asia/Jakarta');
  const startFormatted = startDt.isValid ? startDt.toFormat('dd LLLL yyyy, HH:mm') : event.start_time;
  const endFormatted = endDt.isValid ? endDt.toFormat('HH:mm') : event.end_time;

  // Case A: User has connected Google Calendar (Direct Auto-Sync!)
  if (userAuth && (userAuth.refreshToken || userAuth.google_refresh_token)) {
    const targetUserId = userAuth.userId || userAuth.id || userId;
    const insertResult = await insertGoogleCalendarEvent(targetUserId, event, calendarId || 'primary');

    if (insertResult.success) {
      let replyText = `✅ *AGENDA OTOMATIS TERSIMPAN KE GOOGLE CALENDAR!* 📅\n\n` +
        `👤 *Kalender*: ${userAuth.email}\n` +
        `📌 *Agenda*: ${event.title}\n` +
        `🕒 *Waktu*: ${startFormatted} s.d. ${endFormatted} WIB\n` +
        `📍 *Lokasi*: ${event.location || (event.is_online ? 'Daring (Zoom)' : 'Menyusul')}\n`;

      if (event.jp) replyText += `📚 *Bobot*: ${event.jp}\n`;
      if (event.meeting_id_pass) replyText += `🔑 *Kredensial*: ${event.meeting_id_pass}\n`;
      if (event.meeting_link) replyText += `🔗 *Link*: ${event.meeting_link}\n`;
      if (event.speakers) replyText += `👥 *Narasumber*: ${event.speakers}\n`;

      await sendTelegramMessage({
        botToken,
        chatId,
        text: replyText,
        inlineButtons: [
          {
            text: '📅 Lihat di Google Calendar',
            url: insertResult.htmlLink || event.google_calendar_url || 'https://calendar.google.com'
          }
        ]
      });
      return;
    }
  }

  // Case B: User has NOT connected Google Calendar yet (Fallback to 1-Click URL + Connect Link)
  const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;
  let replyText = `📋 *Hasil Ekstraksi Agenda Kegiatan:*\n\n` +
    `📌 *Agenda*: ${event.title}\n` +
    `🕒 *Waktu*: ${startFormatted} s.d. ${endFormatted} WIB\n` +
    `📍 *Lokasi*: ${event.location || (event.is_online ? 'Daring (Zoom)' : 'Menyusul')}\n`;

  if (event.jp) replyText += `📚 *Bobot*: ${event.jp}\n`;
  if (event.meeting_id_pass) replyText += `🔑 *Kredensial*: ${event.meeting_id_pass}\n`;
  if (event.meeting_link) replyText += `🔗 *Link*: ${event.meeting_link}\n`;
  if (event.speakers) replyText += `👥 *Narasumber*: ${event.speakers}\n`;

  replyText += `\n💡 *Pilih opsi di bawah untuk menyimpan ke kalender:*`;

  await sendTelegramMessage({
    botToken,
    chatId,
    text: replyText,
    inlineButtons: [
      {
        text: '📅 Tambahkan ke Google Calendar',
        url: event.google_calendar_url || 'https://calendar.google.com'
      },
      {
        text: '⚡ Hubungkan Akun (Auto-Sync)',
        url: authUrl
      }
    ]
  });
}
