import { TelegramUpdate } from './types';
import { extractEventFromSource } from './gemini';
import { DateTime } from 'luxon';
import { getUserGoogleAuth, deleteUserGoogleAuth } from './token-store';
import { insertGoogleCalendarEvent } from './google-calendar-api';
import { getUserByTelegram, getBotAdminSettings, disconnectTelegramUser, saveExtractedEvent, linkTelegramUserByPhone } from './db';

const TELEGRAM_API_URL = 'https://api.telegram.org';

/**
 * Sends a Telegram chat message with optional inline keyboard buttons or reply keyboard
 */
export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: number;
  text: string;
  inlineButtons?: Array<{ text: string; url?: string; callback_data?: string }>;
  replyButtons?: Array<Array<{ text: string; request_contact?: boolean; request_location?: boolean }>>;
  removeKeyboard?: boolean;
}): Promise<{ ok: boolean; message_id?: number }> {
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
        params.inlineButtons.map(btn => ({ text: btn.text, url: btn.url, callback_data: btn.callback_data }))
      ]
    };
  } else if (params.replyButtons && params.replyButtons.length > 0) {
    bodyPayload.reply_markup = {
      keyboard: params.replyButtons,
      resize_keyboard: true,
      one_time_keyboard: false
    };
  } else if (params.removeKeyboard) {
    bodyPayload.reply_markup = {
      remove_keyboard: true
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    
    const data = await res.json();
    if (data.ok && data.result?.message_id) {
      return { ok: true, message_id: data.result.message_id };
    }

    if (!res.ok) {
      const errText = await res.text();
      console.warn('Telegram sendMessage Markdown failed, retrying plain text:', errText);
      // Fallback: Retry without parse_mode if Markdown parsing failed
      delete bodyPayload.parse_mode;
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const retryData = await retryRes.json();
      if (retryData.ok && retryData.result?.message_id) {
        return { ok: true, message_id: retryData.result.message_id };
      }
    }
  } catch (err) {
    console.error('Telegram sendMessage network error:', err);
  }

  return { ok: false };
}

/**
 * Edits an existing Telegram message in-place
 */
export async function editTelegramMessage(params: {
  botToken: string;
  chatId: number;
  messageId: number;
  text: string;
  inlineButtons?: Array<{ text: string; url?: string; callback_data?: string }>;
}): Promise<boolean> {
  const url = `${TELEGRAM_API_URL}/bot${params.botToken}/editMessageText`;
  const bodyPayload: any = {
    chat_id: params.chatId,
    message_id: params.messageId,
    text: params.text,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  };

  if (params.inlineButtons && params.inlineButtons.length > 0) {
    bodyPayload.reply_markup = {
      inline_keyboard: [
        params.inlineButtons.map(btn => ({ text: btn.text, url: btn.url, callback_data: btn.callback_data }))
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
      delete bodyPayload.parse_mode;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Sends a Telegram chat action (typing indicator)
 */
export async function sendTelegramChatAction(params: {
  botToken: string;
  chatId: number;
  action?: 'typing' | 'upload_document' | 'find_location';
}) {
  const url = `${TELEGRAM_API_URL}/bot${params.botToken}/sendChatAction`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        action: params.action || 'typing'
      })
    });
  } catch (e) {}
}

/**
 * Starts an animated, continuous Telegram progress bar with dynamic rotating emojis
 */
export function startTelegramProgressBar(params: {
  botToken: string;
  chatId: number;
  messageId: number;
  fileName: string;
  fileType: 'pdf' | 'image' | 'text';
}) {
  const { botToken, chatId, messageId, fileName, fileType } = params;

  let elapsedTicks = 0;
  let isStopped = false;

  const dynamicStages = [
    { emote: '⏳', action: 'Mengunduh & memverifikasi dokumen surat', detail: 'Memeriksa format berkas & membaca dokumen...' },
    { emote: '🔍', action: 'Memindai tata letak visual & kop instansi', detail: 'Mendeteksi nomor surat, sifat & perihal agenda...' },
    { emote: '🧠', action: 'Menganalisis isi surat dengan Google Gemini AI', detail: 'Mengekstrak tanggal pelaksanaan & jam rapat (WIB)...' },
    { emote: '📝', action: 'Mengekstrak narasumber, ruang rapat & lokasi', detail: 'Mengidentifikasi ruangan gedung / link platform Zoom...' },
    { emote: '⚡', action: 'Mendeteksi kredensial Zoom & link meeting', detail: 'Mencari ID Zoom, Passcode, link registrasi & materi...' },
    { emote: '🔗', action: 'Mengekstrak bobot Jam Pelajaran (JP)', detail: 'Memeriksa jumlah JP sertifikat & daftar peserta...' },
    { emote: '🤖', action: 'Menjalankan penalaran AI & parsing format', detail: 'Standardisasi format ISO 8601 & zona waktu Asia/Jakarta...' },
    { emote: '📅', action: 'Menyiapkan event Google Calendar', detail: 'Memvalidasi tautan & deskripsi lengkap agenda rapat...' },
    { emote: '✨', action: 'Memproses sinkronisasi 0-Click Calendar', detail: 'Menghubungkan langsung ke kalender akun Google Anda...' }
  ];

  const intervalId = setInterval(async () => {
    if (isStopped) {
      clearInterval(intervalId);
      return;
    }

    elapsedTicks++;
    const stageIndex = Math.min(elapsedTicks - 1, dynamicStages.length - 1);
    const stage = dynamicStages[stageIndex];
    
    // Smooth asymptotic progress calculation (15% -> 32% -> 48% -> 62% -> 74% -> 83% -> 89% -> 93% -> 96%)
    const progress = Math.min(96, Math.round(15 + (81 * (1 - Math.exp(-elapsedTicks / 3.8)))));
    const filledBlocks = Math.min(10, Math.max(1, Math.round(progress / 10)));
    const bar = '■'.repeat(filledBlocks) + '□'.repeat(10 - filledBlocks);

    const typeLabel = fileType === 'pdf' ? 'Surat PDF' : fileType === 'image' ? 'Poster Flyer' : 'Teks Undangan';
    const dots = '.'.repeat((elapsedTicks % 3) + 1);

    const updateText = 
      `${stage.emote} *[${bar}] ${progress}%* ${stage.action}${dots}\n\n` +
      `📄 *Berkas*: \`${fileName}\` (${typeLabel})\n` +
      `💡 *Status*: _${stage.detail}_`;

    await editTelegramMessage({
      botToken,
      chatId,
      messageId,
      text: updateText
    });

    sendTelegramChatAction({ botToken, chatId, action: 'typing' });
  }, 2200);

  return {
    stop: () => {
      isStopped = true;
      clearInterval(intervalId);
    }
  };
}

/**
 * Sends a helpful and friendly tutorial on how to get and set a Google Gemini API Key
 */
export async function sendGeminiApiKeyMissingTutorial(params: {
  botToken: string;
  chatId: number;
  hostOrigin: string;
}) {
  const { botToken, chatId, hostOrigin } = params;
  const message = `⚠️ *Google Gemini API Key Belum Terpasang*

Bot ini menggunakan kecerdasan buatan (*Google Gemini AI*) untuk memindai berkas surat dinas PDF, poster flyer, dan teks undangan secara otomatis.

Untuk mulai menggunakan bot, silakan masukkan **Gemini API Key** Anda (100% Gratis dari Google):

━━━━━━━━━━━━━━━━━━━━
📖 *PANDUAN MENDAPATKAN API KEY (GRATIS):*
1️⃣ Buka link resmi: [Google AI Studio](https://aistudio.google.com/app/apikey)
2️⃣ Login menggunakan akun Google Anda.
3️⃣ Klik tombol biru **"Create API key"** lalu pilih project baru/default.
4️⃣ Salin (*Copy*) kunci API yang dihasilkan (diawali dengan \`AIzaSy...\`).
5️⃣ Buka website EasyCal Anda: [${hostOrigin}](${hostOrigin}), masuk ke tab **Pengaturan & Kredensial**, tempel API Key Anda pada kolom *Google Gemini API Key*, lalu klik **Simpan Pengaturan**.
━━━━━━━━━━━━━━━━━━━━

💡 *Setelah API Key tersimpan di website, kirimkan kembali dokumen surat PDF atau poster flyer Anda ke bot ini!* 🚀`;

  await sendTelegramMessage({
    botToken,
    chatId,
    text: message,
    inlineButtons: [
      { text: '🔑 Buat API Key Gratis (AI Studio)', url: 'https://aistudio.google.com/app/apikey' },
      { text: '⚙️ Buka Pengaturan EasyCal', url: hostOrigin }
    ]
  });
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

  // 0. Handle Shared Contact (Instant Phone Number Verification & Auto-Binding)
  if (msg.contact && msg.contact.phone_number) {
    const contactPhone = msg.contact.phone_number;
    const linkedUser = await linkTelegramUserByPhone({
      tgUserId: userId,
      phoneNumber: contactPhone
    });

    if (linkedUser && (linkedUser.google_refresh_token || linkedUser.email)) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `🎉 *AKUN BERHASIL TERHUBUNG DENGAN NOMOR HP!* ✅\n\n` +
          `👤 *Nama*: ${linkedUser.name || 'Pengguna EasyCal'}\n` +
          `📧 *Email*: ${linkedUser.email}\n` +
          `📱 *No. HP Terverifikasi*: \`${linkedUser.phone_number || contactPhone}\`\n` +
          `📅 *Target Kalender*: ${linkedUser.calendar_id || 'primary'}\n` +
          `🤖 *AI Gemini*: ${linkedUser.gemini_api_key ? '✅ Aktif (BYOK)' : '⚠️ Belum diisi di web'}\n\n` +
          `🚀 *Mode 0-Click Auto-Sync Aktif!*\nSekarang setiap Anda mengirim surat dinas PDF, foto poster bimtek, atau teks undangan ke sini, agenda kegiatan akan **langsung otomatis tersimpan ke Google Calendar Anda!**`,
        inlineButtons: [
          { text: '🌐 Buka Web EasyCal', url: hostOrigin }
        ],
        replyButtons: [
          [{ text: '❓ Panduan & Status' }]
        ]
      });
      return { ok: true };
    } else {
      const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ *Nomor HP Belum Terdaftar di Web EasyCal*\n\n` +
          `Nomor HP \`${contactPhone}\` belum ditemukan di database akun EasyCal.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📖 *Langkah Mudah Menghubungkan:*\n` +
          `1️⃣ Buka website EasyCal: [${hostOrigin}](${hostOrigin})\n` +
          `2️⃣ Masuk menggunakan akun Google Anda.\n` +
          `3️⃣ Buka tab **Pengaturan & Kredensial**, lalu masukkan No. HP Anda (\`${contactPhone}\`) dan Google Gemini API Key Anda.\n` +
          `4️⃣ Klik tombol **Simpan Konfigurasi** di website.\n` +
          `5️⃣ Setelah disimpan, klik tombol **📱 Bagikan Kontak Saya** di Telegram kembali!\n` +
          `━━━━━━━━━━━━━━━━━━━━`,
        inlineButtons: [
          { text: '🔑 Login Web EasyCal', url: hostOrigin },
          { text: '⚡ Otorisasi Google Langsung', url: authUrl }
        ],
        replyButtons: [
          [{ text: '📱 Bagikan Kontak Saya (Verifikasi No. HP)', request_contact: true }],
          [{ text: '❓ Panduan & Status' }]
        ]
      });
      return { ok: true };
    }
  }

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

  // 2. Resolve AI key: user's personal key -> bot owner key -> webhook param key -> global GEMINI_API_KEY
  const botAdmin = await getBotAdminSettings(botToken);
  const rawKey = dbUser?.gemini_api_key || botAdmin?.gemini_api_key || geminiKey || process.env.GEMINI_API_KEY || '';
  const effectiveGeminiKey = rawKey.replace(/^["']|["']$/g, '').trim();

  // Command: /connect or /login
  if (cleanText.startsWith('/connect') || cleanText.startsWith('/login') || cleanText.startsWith('/auth')) {
    const isConnected = Boolean(userAuth && userAuth.email);
    const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;

    if (isConnected) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `✅ *Akun Anda Sudah Terhubung!* 🚀\n\n📧 *Email*: ${userAuth?.email}\n📱 *No. HP*: ${dbUser?.phone_number || '-'}\n📅 *Kalender*: ${dbUser?.calendar_id || 'primary'}\n\nKirimkan berkas *Surat Dinas PDF* atau *Poster Flyer* untuk langsung menjadwalkan ke Google Calendar!`,
        inlineButtons: [{ text: '⚙️ Buka Pengaturan Web', url: hostOrigin }]
      });
      return { ok: true };
    }

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `🔗 *PANDUAN MENGHUBUNGKAN AKUN KE BOT TELEGRAM*\n\n` +
        `Untuk menggunakan fitur *0-Click Auto-Sync*, Anda dapat menghubungkan akun dengan salah satu metode berikut:\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🌟 *Metode 1: Verifikasi Cepat No. HP (1-Tap)*\n` +
        `1. Login ke website: [${hostOrigin}](${hostOrigin})\n` +
        `2. Buka tab **Pengaturan & Kredensial**, isi **Nomor WhatsApp / HP** dan **Gemini API Key**, lalu klik **Simpan Konfigurasi**.\n` +
        `3. Tekan tombol **[ 📱 Bagikan Kontak Saya ]** di bawah chat ini!\n\n` +
        `🔗 *Metode 2: Otorisasi Browser Langsung*\n` +
        `Klik tombol **"🔑 Hubungkan Akun Google"** di bawah untuk login langsung via browser HP Anda.\n` +
        `━━━━━━━━━━━━━━━━━━━━`,
      inlineButtons: [
        { text: '🔑 Hubungkan Akun Google', url: authUrl },
        { text: '🌐 Buka Website EasyCal', url: hostOrigin }
      ],
      replyButtons: [
        [{ text: '📱 Bagikan Kontak Saya (Verifikasi No. HP)', request_contact: true }],
        [{ text: '❓ Panduan & Status' }]
      ]
    });
    return { ok: true };
  }

  // Command: /status or /cek or "❓ Panduan & Status"
  if (cleanText.startsWith('/status') || cleanText.startsWith('/cek') || cleanText.includes('status') || cleanText.includes('panduan')) {
    if (userAuth && userAuth.email) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `✅ *Status Akun Terhubung:*\n\n📧 *Email*: ${userAuth.email}\n👤 *Nama*: ${userAuth.name || '-'}\n📱 *No. HP*: ${dbUser?.phone_number || '(Belum diisi di web)'}\n🤖 *AI Gemini*: ${effectiveGeminiKey ? '✅ Siap' : '⚠️ Belum Terpasang'}\n🔄 *Mode*: Direct 0-Click Auto-Sync Aktif\n📅 *Target Kalender*: ${dbUser?.calendar_id || 'primary'}\n\n💡 Ketik \`/disconnect\` jika ingin mengganti atau memutuskan akun Google.`
      });
    } else {
      const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `⚠️ *Akun Belum Terhubung ke Google Calendar*\n\n` +
          `Agar agenda otomatis tersimpan ke kalender, silakan login ke web dan isi No. HP & Gemini API Key Anda, lalu bagikan kontak atau hubungkan via link:`,
        inlineButtons: [
          { text: '🔑 Hubungkan Google Calendar', url: authUrl },
          { text: '🌐 Buka Web EasyCal', url: hostOrigin }
        ],
        replyButtons: [
          [{ text: '📱 Bagikan Kontak Saya (Verifikasi No. HP)', request_contact: true }],
          [{ text: '❓ Panduan & Status' }]
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
      text: `🔌 *Koneksi Google Calendar Berhasil Diputus*\n\nAkun Google Calendar Anda telah diputus dari bot ini. Anda dapat menghubungkan kembali kapan saja dengan mengetik \`/connect\` atau membagikan kontak.`,
      replyButtons: [
        [{ text: '📱 Bagikan Kontak Saya (Verifikasi No. HP)', request_contact: true }]
      ]
    });
    return { ok: true };
  }

  // Command: /start
  if (cleanText.startsWith('/start') || cleanText === 'start' || cleanText === 'halo' || cleanText === 'hai') {
    const isConnected = Boolean(userAuth && userAuth.email);
    const authUrl = `${hostOrigin}/api/auth/google?user_id=tg_${userId}`;

    if (isConnected) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `👋 *Halo! Selamat datang kembali di EasyCal Bot.* 📅\n\n` +
          `📌 *Status*: ✅ Terhubung (${userAuth?.email})\n` +
          `📱 *No. HP*: ${dbUser?.phone_number || '-'}\n\n` +
          `*Format berkas yang didukung:*\n` +
          `1. 📄 *Surat Dinas PDF* (\`.pdf\`)\n` +
          `2. 🖼️ *Poster / Flyer Bimtek / Webinar* (JPG/PNG)\n` +
          `3. 💬 *Teks Salinan Pesan Undangan Rapat*\n\n` +
          `✨ Cukup kirimkan dokumen atau teruskan (*forward*) pesan ke bot ini kapan saja!`,
        replyButtons: [
          [{ text: '❓ Panduan & Status' }]
        ]
      });
      return { ok: true };
    }

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `👋 *Selamat datang di Bot Penjadwalan Google Calendar (EasyCal)!*
 
Bot ini otomatis mengekstrak informasi kegiatan dari surat dinas PDF, poster flyer, dan broadcast rapat, lalu menyimpannya langsung ke Google Calendar Anda.

📌 *Status Anda*: ⚠️ Belum Terhubung

━━━━━━━━━━━━━━━━━━━━
💡 *CARA MENGHUBUNGKAN AKUN:*
1️⃣ Login ke website EasyCal: [${hostOrigin}](${hostOrigin})
2️⃣ Buka tab **Pengaturan & Kredensial**, isi **Nomor HP** dan **Gemini API Key**, lalu klik **Simpan Konfigurasi**.
3️⃣ Tekan tombol **[ 📱 Bagikan Kontak Saya ]** di bawah ini!
━━━━━━━━━━━━━━━━━━━━`,
      inlineButtons: [
        { text: '🔑 Login Web EasyCal', url: hostOrigin },
        { text: '⚡ Otorisasi Google Langsung', url: authUrl }
      ],
      replyButtons: [
        [{ text: '📱 Bagikan Kontak Saya (Verifikasi No. HP)', request_contact: true }],
        [{ text: '❓ Panduan & Status' }]
      ]
    });
    return { ok: true };
  }

  // Command: /apikey or /tutorial
  if (cleanText.startsWith('/apikey') || cleanText.startsWith('/key') || cleanText.startsWith('/tutorial') || cleanText.startsWith('/panduan_api')) {
    await sendGeminiApiKeyMissingTutorial({ botToken, chatId, hostOrigin });
    return { ok: true };
  }

  // Command: /help
  if (cleanText.startsWith('/help') || cleanText === 'help' || cleanText.startsWith('/bantuan')) {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: `📖 *PANDUAN & PERINTAH BOT AGENDA*

• \`/connect\` - Hubungkan akun Google Calendar pribadi Anda (0-Click Auto-Sync)
• \`/status\` - Periksa status koneksi Google Calendar Anda
• \`/apikey\` - Panduan langkah demi langkah memasang Google Gemini API Key
• \`/disconnect\` - Putuskan akun Google Calendar dari bot ini
• \`/help\` - Tampilkan bantuan ini

━━━━━━━━━━━━━━━━━━━━
💡 *CARA MENGGUNAKAN:*
Kirimkan berkas *Surat Dinas PDF*, *Poster Flyer (Gambar)*, atau *Salinan Teks Pesan Undangan* kapan saja ke bot ini. Jadwal akan otomatis diekstrak dan dijadwalkan ke Google Calendar Anda! ✨`
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

    if (!effectiveGeminiKey) {
      await sendGeminiApiKeyMissingTutorial({ botToken, chatId, hostOrigin });
      return { ok: true };
    }

    const initRes = await sendTelegramMessage({
      botToken,
      chatId,
      text: `⏳ *[■□□□□□□□□□] 10%* Menerima berkas & menginisialisasi AI...\n\n📄 *Berkas*: \`${doc.file_name || 'surat_undangan.pdf'}\`\n💡 *Status*: _Mengunduh berkas dari server Telegram..._`
    });

    const progressTracker = initRes.message_id ? startTelegramProgressBar({
      botToken,
      chatId,
      messageId: initRes.message_id,
      fileName: doc.file_name || 'surat_undangan.pdf',
      fileType: 'pdf'
    }) : null;

    try {
      const { base64Data, mimeType } = await downloadTelegramFile({ botToken, fileId: doc.file_id });
      const result = await extractEventFromSource({
        apiKey: effectiveGeminiKey,
        model: dbUser?.model_name || botAdmin?.model_name || 'gemini-2.0-flash',
        sourceType: 'pdf',
        base64Data,
        mimeType
      });

      if (progressTracker) progressTracker.stop();

      if (!result.success || !result.event) {
        const errMsg = result.error || 'Dokumen tidak dapat dibaca oleh AI.';
        if (initRes.message_id) {
          await editTelegramMessage({
            botToken,
            chatId,
            messageId: initRes.message_id,
            text: `❌ *Gagal mengekstrak jadwal:* ${errMsg}`
          });
        } else {
          await sendTelegramMessage({
            botToken,
            chatId,
            text: `❌ *Gagal mengekstrak jadwal:* ${errMsg}`
          });
        }
        return { ok: true };
      }

      await dispatchCalendarResult({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        calendarId: dbUser?.calendar_id || 'primary',
        progressMessageId: initRes.message_id
      });
    } catch (err: any) {
      if (progressTracker) progressTracker.stop();
      if (initRes.message_id) {
        await editTelegramMessage({
          botToken,
          chatId,
          messageId: initRes.message_id,
          text: `❌ Terjadi kesalahan saat memproses dokumen: ${err.message}`
        });
      } else {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ Terjadi kesalahan saat memproses dokumen: ${err.message}`
        });
      }
    }
    return { ok: true };
  }

  // Process Photo / Poster
  if (msg.photo && msg.photo.length > 0) {
    if (!effectiveGeminiKey) {
      await sendGeminiApiKeyMissingTutorial({ botToken, chatId, hostOrigin });
      return { ok: true };
    }

    const bestPhoto = msg.photo[msg.photo.length - 1];

    const initRes = await sendTelegramMessage({
      botToken,
      chatId,
      text: `⏳ *[■□□□□□□□□□] 10%* Menerima poster & menginisialisasi AI Vision...\n\n🖼️ *Berkas*: Poster / Flyer Kegiatan\n💡 *Status*: _Mengunduh gambar dari Telegram..._`
    });

    const progressTracker = initRes.message_id ? startTelegramProgressBar({
      botToken,
      chatId,
      messageId: initRes.message_id,
      fileName: 'poster_kegiatan.jpg',
      fileType: 'image'
    }) : null;

    try {
      const { base64Data, mimeType } = await downloadTelegramFile({ botToken, fileId: bestPhoto.file_id });
      const result = await extractEventFromSource({
        apiKey: effectiveGeminiKey,
        model: dbUser?.model_name || botAdmin?.model_name || 'gemini-2.0-flash',
        sourceType: 'image',
        base64Data,
        mimeType
      });

      if (progressTracker) progressTracker.stop();

      if (!result.success || !result.event) {
        const errMsg = result.error || 'Poster tidak dapat dibaca oleh AI.';
        if (initRes.message_id) {
          await editTelegramMessage({
            botToken,
            chatId,
            messageId: initRes.message_id,
            text: `❌ *Gagal mengekstrak jadwal poster:* ${errMsg}`
          });
        } else {
          await sendTelegramMessage({
            botToken,
            chatId,
            text: `❌ *Gagal mengekstrak jadwal poster:* ${errMsg}`
          });
        }
        return { ok: true };
      }

      await dispatchCalendarResult({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        calendarId: dbUser?.calendar_id || 'primary',
        progressMessageId: initRes.message_id
      });
    } catch (err: any) {
      if (progressTracker) progressTracker.stop();
      if (initRes.message_id) {
        await editTelegramMessage({
          botToken,
          chatId,
          messageId: initRes.message_id,
          text: `❌ Terjadi kesalahan saat memproses poster: ${err.message}`
        });
      } else {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ Terjadi kesalahan saat memproses poster: ${err.message}`
        });
      }
    }
    return { ok: true };
  }

  // Process Text Chat
  if (text.length >= 20) {
    if (!effectiveGeminiKey) {
      await sendGeminiApiKeyMissingTutorial({ botToken, chatId, hostOrigin });
      return { ok: true };
    }

    const initRes = await sendTelegramMessage({
      botToken,
      chatId,
      text: `⏳ *[■□□□□□□□□□] 15%* Menganalisis pesan undangan rapat...\n\n💬 *Teks*: "${text.substring(0, 50)}..."\n💡 *Status*: _Memindai struktur teks & tanggal..._`
    });

    const progressTracker = initRes.message_id ? startTelegramProgressBar({
      botToken,
      chatId,
      messageId: initRes.message_id,
      fileName: 'Pesan Undangan Chat',
      fileType: 'text'
    }) : null;

    try {
      const result = await extractEventFromSource({
        apiKey: effectiveGeminiKey,
        model: dbUser?.model_name || botAdmin?.model_name || 'gemini-2.0-flash',
        sourceType: 'text',
        text
      });

      if (progressTracker) progressTracker.stop();

      if (!result.success || !result.event) {
        const errMsg = result.error || 'Teks tidak memuat informasi agenda.';
        if (initRes.message_id) {
          await editTelegramMessage({
            botToken,
            chatId,
            messageId: initRes.message_id,
            text: `❌ *Gagal mengekstrak jadwal teks:* ${errMsg}`
          });
        } else {
          await sendTelegramMessage({
            botToken,
            chatId,
            text: `❌ *Gagal mengekstrak jadwal teks:* ${errMsg}`
          });
        }
        return { ok: true };
      }

      await dispatchCalendarResult({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        calendarId: dbUser?.calendar_id || 'primary',
        progressMessageId: initRes.message_id
      });
    } catch (err: any) {
      if (progressTracker) progressTracker.stop();
      if (initRes.message_id) {
        await editTelegramMessage({
          botToken,
          chatId,
          messageId: initRes.message_id,
          text: `❌ Terjadi kesalahan saat memproses teks: ${err.message}`
        });
      } else {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ Terjadi kesalahan saat memproses teks: ${err.message}`
        });
      }
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
  progressMessageId?: number;
}) {
  const { botToken, chatId, userId, event, hostOrigin, userAuth, calendarId, progressMessageId } = params;

  const startDt = DateTime.fromISO(event.start_time).setZone('Asia/Jakarta');
  const endDt = DateTime.fromISO(event.end_time).setZone('Asia/Jakarta');
  const startFormatted = startDt.isValid ? startDt.toFormat('dd LLLL yyyy, HH:mm') : event.start_time;
  const endFormatted = endDt.isValid ? endDt.toFormat('HH:mm') : event.end_time;

  // Case A: User has connected Google Calendar (Direct Auto-Sync!)
  if (userAuth && (userAuth.refreshToken || userAuth.google_refresh_token)) {
    const targetUserId = userAuth.userId || userAuth.id || userId;
    const insertResult = await insertGoogleCalendarEvent(targetUserId, event, calendarId || 'primary');

    // Save event history to Neon DB
    try {
      await saveExtractedEvent({
        user_id: String(targetUserId),
        title: event.title,
        start_time: event.start_time,
        end_time: event.end_time,
        is_online: event.is_online,
        location: event.location,
        meeting_link: event.meeting_link,
        meeting_id_pass: event.meeting_id_pass,
        jp: event.jp,
        speakers: event.speakers,
        description: event.description,
        google_calendar_url: insertResult.htmlLink || event.google_calendar_url,
        synced_to_calendar: Boolean(insertResult.success),
        source_type: 'telegram',
        file_name: 'Telegram Bot'
      });
    } catch (e) {
      console.error('Failed to save telegram event in Neon DB:', e);
    }

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

      const inlineButtons = [
        {
          text: '📅 Lihat di Google Calendar',
          url: insertResult.htmlLink || event.google_calendar_url || 'https://calendar.google.com'
        }
      ];

      if (progressMessageId) {
        const edited = await editTelegramMessage({
          botToken,
          chatId,
          messageId: progressMessageId,
          text: replyText,
          inlineButtons
        });
        if (!edited) {
          await sendTelegramMessage({ botToken, chatId, text: replyText, inlineButtons });
        }
      } else {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: replyText,
          inlineButtons
        });
      }
      return;
    }
  }

  // Case B: User has NOT connected Google Calendar yet (Fallback to 1-Click URL + Connect Link)
  try {
    await saveExtractedEvent({
      user_id: `tg_${userId}`,
      title: event.title,
      start_time: event.start_time,
      end_time: event.end_time,
      is_online: event.is_online,
      location: event.location,
      meeting_link: event.meeting_link,
      meeting_id_pass: event.meeting_id_pass,
      jp: event.jp,
      speakers: event.speakers,
      description: event.description,
      google_calendar_url: event.google_calendar_url,
      synced_to_calendar: false,
      source_type: 'telegram',
      file_name: 'Telegram Bot'
    });
  } catch (e) {}
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

  const inlineButtons = [
    {
      text: '📅 Tambahkan ke Google Calendar',
      url: event.google_calendar_url || 'https://calendar.google.com'
    },
    {
      text: '⚡ Hubungkan Akun (Auto-Sync)',
      url: authUrl
    }
  ];

  if (progressMessageId) {
    const edited = await editTelegramMessage({
      botToken,
      chatId,
      messageId: progressMessageId,
      text: replyText,
      inlineButtons
    });
    if (!edited) {
      await sendTelegramMessage({ botToken, chatId, text: replyText, inlineButtons });
    }
  } else {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: replyText,
      inlineButtons
    });
  }
}
