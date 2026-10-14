import { safeError } from './safe-error';
import { createHash } from 'crypto';
import { telegramContext } from './telegram-context';
import { telegramCall } from './telegram-api';
import { createTelegramBinding } from './telegram-security';
import { currentSource, handleWorkflowInput, offerCreateConfirmation, offerPhotoSelection, offerUpdateConfirmation, registerArchiveRecovery } from './telegram-workflows';
import { readBotState, writeBotState, botIdentity } from './telegram-state';
import { bindVerifiedTelegramAccount } from './db';
import { telegramDiagnostics } from './telegram-diagnostics';
import { matchUpdateEvent } from './event-update';
import { findOwnedEvent } from './event-lifecycle-store';
import { readAgendaSession } from './event-lifecycle-store';
import { TelegramUpdate, CalendarEvent } from './types';
import { extractEventFromSource } from './gemini';
import { DateTime } from 'luxon';
import { handleTelegramAgenda } from './telegram-agenda';
import { getUserGoogleAuth, deleteUserGoogleAuth } from './token-store';
import { syncGoogleCalendarEventWithSource } from './google-calendar-api';
import { getUserByTelegram, getBotAdminSettings, disconnectTelegramUser, saveExtractedEvent, linkTelegramUserByPhone, getRecentExtractedEventsForUser, updateUserSettings, saveEventDocumentation, updateEventGdriveFolder } from './db';
import { findDuplicateEvent, DuplicateDetectionResult } from './duplicate-detector';
import { createEventFolderAndUpload, parseGoogleDriveFolderId, uploadDocumentationPhotoToDrive } from './google-drive-api';
import { extractPhotoMetadata, detectWatermarkTimestamp, matchPhotoToUserEvents, classifyImageIntent, parseWatermarkTimestamp, resolvePhotoTimestamp } from './photo-matcher';

const TELEGRAM_API_URL = 'https://api.telegram.org';

/**
 * Shared usage guide for /help and the Panduan & Status keyboard button.
 */
function buildTelegramUsageGuide(): string {
  return `📖 *PANDUAN EASYCAL*

*Mencatat kegiatan*
Kirim surat undangan PDF, poster JPG/PNG, atau teks lengkap undangan. Setelah berhasil diproses, agenda otomatis disimpan ke Google Calendar. Undangan yang terdeteksi duplikat tidak dibuat ulang.
Untuk gambar poster, tambahkan caption \`#poster\` agar diproses sebagai agenda.

*Memperbarui kegiatan*
Kirim surat perubahan/ralat atau pesan yang menyebut judul kegiatan dan waktu/tempat baru. Untuk memilih kegiatan secara pasti, ketik /agenda lalu /update 1 jam menjadi 13.00 atau /update 1 tempat menjadi Ruang B. Nomor berlaku 15 menit. Bot menampilkan semula ? menjadi dan meminta konfirmasi sebelum menerapkan perubahan; tombol undo tersedia sesudahnya.

*Foto dokumentasi*
Kirim foto kegiatan dengan caption \`#foto\`. Bot mencocokkan foto dengan kegiatan yang sudah tercatat dan menyimpannya ke Google Drive tanpa membuat agenda baru. Jika kegiatan belum bisa ditentukan, pilih kegiatan melalui tombol Telegram. Album memakai satu pilihan tujuan.

*Folder Google Drive*
\`/setdrive <link folder>\` — Atur folder induk untuk berkas kegiatan berikutnya.
\`/gdrive\` — Lihat folder induk yang sedang digunakan.
Contoh: \`/setdrive https://drive.google.com/drive/folders/ID_FOLDER\`

*Perintah akun & bantuan*
\`/start\` — Mulai menggunakan bot.
\`/connect\` — Hubungkan akun Google.
\`/status\` — Lihat panduan dan status konfigurasi akun.
\`/apikey\` — Panduan memasang Gemini API Key.
\`/disconnect\` — Putuskan koneksi akun dari bot.
\`/help\` — Tampilkan panduan dan status ini.

*Membatalkan & memulihkan kegiatan*
\`/agenda\` — Daftar bernomor kegiatan aktif mendatang.
\`batal 1\` — Pilih kegiatan nomor 1, lalu tekan Ya, batalkan.
Alasan opsional: \`batal 1 Penyelenggara membatalkan\`.
\`/dibatalkan\` — Daftar kegiatan yang dibatalkan.
\`aktifkan 1\` — Pilih kegiatan pada daftar terakhir, lalu konfirmasi pemulihan.
\`sinkron 1\` — Coba lagi jika perubahan kalender gagal.
Nomor mengikuti daftar terakhir di chat ini, berlaku 15 menit. Halaman berikutnya: \`/agenda 2\` atau \`/dibatalkan 2\`.
Pembatalan mempertahankan kegiatan dan berkas. Setelah sinkronisasi berhasil, kalender diberi tanda [DIBATALKAN], pengingat dimatikan, dan waktunya ditandai tersedia.

*Pencarian dan pemulihan*
/cari judul ? Cari kegiatan, termasuk yang sudah lewat.
/lampau ? Kegiatan yang sudah selesai.
/hariini, /besok, /minggu ? Ringkasan agenda WIB.
/agenda YYYY-MM-DD YYYY-MM-DD ? Rentang tanggal.
/arsip 1 ? Pasang sumber yang sudah ada ke Calendar.
/status cek ? Periksa akses layanan tanpa membuat event.
Tombol Coba arsip/lampiran lagi berlaku 24 jam.

*Riwayat kegiatan*
Buka web EasyCal dengan akun Google yang sama untuk melihat riwayat, berkas undangan, dan foto dokumentasi.`;
}

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
        ...Array.from({length:Math.ceil(params.inlineButtons.length/2)},(_,i)=>params.inlineButtons!.slice(i*2,i*2+2).map(btn=>({text:btn.text,url:btn.url,callback_data:btn.callback_data})))
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

  const result=await telegramCall(params.botToken,'sendMessage',bodyPayload);
  return {ok:result.ok,message_id:result.result?.message_id};
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
        ...Array.from({length:Math.ceil(params.inlineButtons.length/2)},(_,i)=>params.inlineButtons!.slice(i*2,i*2+2).map(btn=>({text:btn.text,url:btn.url,callback_data:btn.callback_data})))
      ]
    };
  }

  return (await telegramCall(params.botToken,'editMessageText',bodyPayload)).ok;
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
  let pendingEdit: Promise<boolean> | null = null;

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
    if (pendingEdit) return;

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

    pendingEdit = editTelegramMessage({
      botToken,
      chatId,
      messageId,
      text: updateText
    });
    await pendingEdit;
    pendingEdit = null;

    if (!isStopped) void sendTelegramChatAction({ botToken, chatId, action: 'typing' });
  }, 2200);

  return {
    stop: async () => {
      isStopped = true;
      clearInterval(intervalId);
      await pendingEdit;
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
  const fileInfoRes = await fetch(getFileUrl,{signal:AbortSignal.timeout(10000)});
  const fileInfo = await fileInfoRes.json();

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Gagal mengambil metadata berkas dari Telegram.');
  }
  const limit=Math.min(20*1024*1024,Math.max(1024,Number(process.env.TELEGRAM_MAX_FILE_BYTES)||8*1024*1024));
  if(Number(fileInfo.result.file_size)>limit)throw new Error(`Ukuran berkas melampaui batas ${Math.floor(limit/1024/1024)} MB.`);

  const filePath = fileInfo.result.file_path;
  const downloadUrl = `${TELEGRAM_API_URL}/file/bot${params.botToken}/${filePath}`;

  const fileRes = await fetch(downloadUrl,{signal:AbortSignal.timeout(15000)});
  if(!fileRes.ok || !fileRes.body)throw new Error('Unduhan Telegram gagal.');
  const reader=fileRes.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try {while(true) {const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>limit)throw new Error('Ukuran berkas melampaui batas unggahan.');chunks.push(item.value);}}
  finally {await reader.cancel();}
  const buffer = Buffer.concat(chunks);
  const base64Data = buffer.toString('base64');

  let mimeType = 'application/pdf';
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (lower.endsWith('.png')) {
    mimeType = 'image/png';
  } else if (lower.endsWith('.webp')) {
    mimeType = 'image/webp';
  } else if (lower.endsWith('.txt')) {
    mimeType = 'text/plain';
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
  hostOrigin: string = process.env.NEXT_PUBLIC_APP_URL || 'https://easycal.alfarighilmana.my.id'
): Promise<{ok:boolean}> {
  if(!telegramContext.getStore())return telegramContext.run({operationId:`direct:${botIdentity(botToken)}:${update.update_id}`},()=>handleTelegramWebhook(update,botToken,geminiKey,hostOrigin));
  const incoming = update.callback_query?.message
    ? { ...update.callback_query.message, from: update.callback_query.from, text: '' }
    : update.message;
  const msg=incoming?structuredClone(incoming):undefined;
  if (!msg || !msg.chat || !msg.from) return { ok: true };

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if(msg.chat.type!=='private') {await sendTelegramMessage({botToken,chatId,text:'Gunakan chat pribadi dengan bot untuk menjaga undangan dan akun Anda.'});return {ok:true};}
  const context=telegramContext.getStore()!;
  context.source=msg.document?{fileId:msg.document.file_id,fileName:msg.document.file_name,mimeType:msg.document.mime_type,sourceType:/image\//i.test(msg.document.mime_type||'')||/\.(jpe?g|png|webp)$/i.test(msg.document.file_name||'')?'image':/\.txt$/i.test(msg.document.file_name||'')||msg.document.mime_type==='text/plain'?'text':'pdf'}
    :msg.photo?.length?{fileId:msg.photo[msg.photo.length-1].file_id,fileName:'gambar_telegram.jpg',mimeType:'image/jpeg',sourceType:'image'}
    :{textContent:msg.text||'',fileName:'salinan_undangan.txt',mimeType:'text/plain',sourceType:'text'};
  const fileSize=msg.document?.file_size||msg.photo?.[msg.photo.length-1]?.file_size||0;
  const fileLimit=Math.min(20*1024*1024,Number(process.env.TELEGRAM_MAX_FILE_BYTES)||8*1024*1024);
  if(fileSize>fileLimit) {await sendTelegramMessage({botToken,chatId,text:`Berkas terlalu besar. Batas bot ${Math.floor(fileLimit/1024/1024)} MB.`});return {ok:true};}
  if(msg.document && context.source.sourceType==='image') {msg.photo=[{...msg.document,file_unique_id:msg.document.file_id,width:0,height:0}];delete msg.document;}
  else if(msg.document && context.source.sourceType==='text') {
    const downloaded=await downloadTelegramFile({botToken,fileId:msg.document.file_id});
    const content=Buffer.from(downloaded.base64Data,'base64').toString('utf8');
    if(content.length>50000) {await sendTelegramMessage({botToken,chatId,text:'Berkas TXT maksimal 50.000 karakter.'});return {ok:true};}
    msg.text=content;delete msg.document;context.source.textContent=content;
  }
  const text = (msg.text || msg.caption || '').trim();
  const cleanText = text.toLowerCase();

  // 0. Handle Shared Contact (Instant Phone Number Verification & Auto-Binding)
  if (msg.contact && msg.contact.phone_number) {
    if(msg.contact.user_id!==userId) {await sendTelegramMessage({botToken,chatId,text:'Bagikan kontak Anda sendiri melalui tombol Bagikan Kontak Saya. Kontak orang lain tidak dapat digunakan untuk menautkan akun.'});return {ok:true};}
    const contactPhone = msg.contact.phone_number;
    const linkedUser = await linkTelegramUserByPhone({
      tgUserId: userId,
      phoneNumber: contactPhone
    });

    if (linkedUser && (linkedUser.google_refresh_token || linkedUser.email)) {
      await bindVerifiedTelegramAccount(linkedUser.id,String(userId));
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
      const authUrl = `${hostOrigin}/api/auth/google?binding=${await createTelegramBinding(userId)}`;
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
  const rawAuth = dbUser ? await getUserGoogleAuth(dbUser.id)
    :process.env.NODE_ENV==='production'?null:await getUserGoogleAuth(userId);
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
  const owner={userId:String(dbUser?.id||userAuth?.userId||`tg_${userId}`),email:dbUser?.email||userAuth?.email,telegramChatId:String(userId)};
  if(await handleWorkflowInput({botToken,chatId,userId,owner,update,user:dbUser,hostOrigin}))return {ok:true};
  if(/^\/status(?:\s+cek)?$/.test(cleanText)) {
    if(cleanText==='/status cek') {await sendTelegramMessage({botToken,chatId,text:await telegramDiagnostics(owner.userId,dbUser?.calendar_id||'primary',effectiveGeminiKey)});return {ok:true};}
    const hour=Math.floor(Date.now()/3600000);
    const usage=await readBotState<{count:number}>(`quota:${botIdentity(botToken)}:${userId}:${hour}`);
    const last=await readBotState<{status:string;attempts:number}>(`last-job:${botIdentity(botToken)}:${userId}`);
    await sendTelegramMessage({botToken,chatId,text:`Status EasyCal\nGoogle: ${userAuth?.refreshToken?'Terhubung (izin belum diuji langsung)':'Belum terhubung; gunakan /connect'}\nGemini: ${effectiveGeminiKey?'Kunci tersedia (kuota belum diuji langsung)':'Belum dikonfigurasi'}\nKalender: ${dbUser?.calendar_id||'primary'}\nPemrosesan jam ini: ${usage?.value.count||0}/${Number(process.env.TELEGRAM_HOURLY_LIMIT)||60}\nBatas berkas: ${Math.floor(fileLimit/1024/1024)} MB\nPekerjaan terakhir: ${last?.value.status||'Belum tercatat'}${last?` (${last.value.attempts} percobaan)`:''}\nJika akses Google ditolak/invalid_grant, ketik /connect dan hubungkan ulang.\nPanduan: /help`});return {ok:true};
  }

  if (await handleTelegramAgenda({ update, botToken, chatId, userId, chatType: msg.chat.type,
    owner: dbUser ? { userId: dbUser.id, email: dbUser.email, telegramChatId: dbUser.telegram_chat_id }
      : userAuth?.email ? { userId: String(userAuth.userId || `tg_${userId}`), email: userAuth.email, telegramChatId: String(userId) } : null,
    calendarId: dbUser?.calendar_id, hostOrigin, send: sendTelegramMessage })) return { ok: true };

  // Command: /connect or /login
  if (cleanText.startsWith('/connect') || cleanText.startsWith('/login') || cleanText.startsWith('/auth')) {
    const isConnected = Boolean(userAuth && userAuth.email);
    const authUrl = `${hostOrigin}/api/auth/google?binding=${await createTelegramBinding(userId)}`;

    if (isConnected) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `✅ *Akun Anda Sudah Terhubung!* 🚀\n\n📧 *Email*: ${userAuth?.email}\n📱 *No. HP*: ${dbUser?.phone_number || '-'}\n📅 *Kalender*: ${dbUser?.calendar_id || 'primary'}\n\nJika unggah Drive atau sinkronisasi gagal karena otorisasi, tekan Hubungkan Ulang Google dan pilih akun yang sama. Setelah itu kirim ulang berkas.`,
        inlineButtons: [{ text: 'Hubungkan Ulang Google', url: authUrl }, { text: 'Buka Pengaturan Web', url: hostOrigin }]
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

  // Match complete commands so ordinary invitation text is not intercepted.
  const command = cleanText.split(/\s+/, 1)[0].split('@', 1)[0];
  const isGuideCommand = ['/help', '/bantuan', '/status', '/cek'].includes(command);
  const isGuideButton = cleanText === '❓ panduan & status' || cleanText === 'panduan & status';
  if (isGuideCommand || isGuideButton || cleanText === 'help') {
    const isConnected = Boolean(userAuth?.refreshToken && userAuth.email);
    const authUrl = `${hostOrigin}/api/auth/google?binding=${await createTelegramBinding(userId)}`;
    const statusText = isConnected
      ? `✅ *Akun Google terhubung*\n📧 Email: ${userAuth?.email}\n👤 Nama: ${userAuth?.name || '-'}\n📱 No. HP: ${dbUser?.phone_number || '(Belum diisi di web)'}\n📅 Target kalender: ${dbUser?.calendar_id || 'primary'}`
      : `⚠️ *Akun Google belum terhubung*\nKetik /connect atau tekan Hubungkan Google Calendar. Anda juga bisa login di web, mengisi nomor HP, lalu menekan Bagikan Kontak Saya.`;
    const readinessText = `🤖 Gemini API Key: ${effectiveGeminiKey ? '✅ Tersedia' : '⚠️ Belum diatur — lihat /apikey'}\n📁 Folder induk Drive: ${dbUser?.gdrive_root_folder_url ? 'Sudah diatur — lihat /gdrive' : 'Belum diatur — menggunakan root Google Drive'}\n🔄 Auto-sync: ${isConnected && effectiveGeminiKey ? 'Siap digunakan' : 'Lengkapi koneksi Google dan Gemini API Key'}\n\nStatus ini berdasarkan konfigurasi tersimpan; akses Google Calendar dan validitas API Key diperiksa saat digunakan.`;

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `${statusText}\n${readinessText}\n\n${buildTelegramUsageGuide()}`,
      inlineButtons: [
        ...(!isConnected ? [{ text: '🔑 Hubungkan Google Calendar', url: authUrl }] : []),
        { text: '🌐 Buka Web EasyCal', url: hostOrigin },
        ...(dbUser?.gdrive_root_folder_url ? [{ text: '📁 Buka Folder Drive', url: dbUser.gdrive_root_folder_url }] : [])
      ],
      replyButtons: [
        ...(!isConnected ? [[{ text: '📱 Bagikan Kontak Saya (Verifikasi No. HP)', request_contact: true }]] : []),
        [{ text: '❓ Panduan & Status' }]
      ]
    });
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

  // Command: /setdrive (Atur folder rumah Google Drive)
  if (cleanText.startsWith('/setdrive') || cleanText.startsWith('/folder')) {
    const rawInput = text.replace(/^\/(?:setdrive|folder)\s*/i, '').trim();
    if (!rawInput) {
      const activeFolderUrl = dbUser?.gdrive_root_folder_url;
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `📁 *PANDUAN PENGATURAN FOLDER RUMAH GOOGLE DRIVE*\n\n` +
          `Setiap berkas kegiatan baru yang bukan duplikat akan otomatis dibuatkan folder kegiatan di dalam *folder rumah* ini, lalu dokumen aslinya (PDF, foto flyer, atau teks sebagai \`.txt\`) akan otomatis diunggah ke situ!\n\n` +
          `💡 *Cara Mengatur:*\nKetik perintah diikuti link folder Google Drive Anda, contoh:\n` +
          `\`/setdrive https://drive.google.com/drive/folders/1ABCxyz-12345\`\n\n` +
          `📌 *Folder Saat Ini*: ${activeFolderUrl ? `[Buka Folder Rumah](${activeFolderUrl})` : '_(Belum diatur. Sistem otomatis menyimpannya di root Google Drive)_'}`,
        inlineButtons: activeFolderUrl ? [{ text: '📁 Buka Folder Rumah', url: activeFolderUrl }] : undefined
      });
      return { ok: true };
    }

    const folderId = parseGoogleDriveFolderId(rawInput);
    if (!folderId) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `❌ *Format Link Folder Tidak Dikenali*\nMohon kirimkan link folder Google Drive yang valid, contoh:\n\`/setdrive https://drive.google.com/drive/folders/1ABCxyz-12345\``
      });
      return { ok: true };
    }

    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    const targetUserId = String(userAuth?.userId || dbUser?.id || `tg_${userId}`);
    await updateUserSettings(targetUserId, {
      gdrive_root_folder_id: folderId,
      gdrive_root_folder_url: folderUrl
    });

    await sendTelegramMessage({
      botToken,
      chatId,
      text: `✅ *FOLDER RUMAH GOOGLE DRIVE BERHASIL DIATUR!* 📁\n\n` +
        `🆔 *ID Folder*: \`${folderId}\`\n\n` +
        `Sekarang setiap Anda mengirim surat PDF, foto poster, atau teks undangan ke sini:\n` +
        `1. Sistem mengekstrak agenda & menjadwalkan ke Google Calendar.\n` +
        `2. Sistem membuat sub-folder baru berformat \`YYYY-MM-DD - Judul Kegiatan\` di dalam folder ini.\n` +
        `3. Berkas (PDF / Foto / Catatan Teks .txt) otomatis diunggah ke dalam sub-folder tersebut! 🚀`,
      inlineButtons: [{ text: '📁 Buka Folder Rumah di Google Drive', url: folderUrl }]
    });
    return { ok: true };
  }

  // Command: /gdrive (Cek status folder rumah)
  if (cleanText.startsWith('/gdrive')) {
    const rootUrl = dbUser?.gdrive_root_folder_url;
    if (rootUrl) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `📁 *Folder Rumah Google Drive Aktif:*\n[${rootUrl}](${rootUrl})\n\nSetiap berkas kegiatan akan otomatis diorganisir ke dalam sub-folder di sini.\n\nKetik \`/setdrive <link_baru>\` untuk mengubah folder.`,
        inlineButtons: [{ text: '📁 Buka Folder Drive', url: rootUrl }]
      });
    } else {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: `📁 *Folder Rumah Google Drive Belum Diatur*\n\nSistem saat ini menggunakan root Google Drive akun Anda sebagai lokasi pembuatan folder kegiatan.\n\nAnda dapat menentukan folder induk spesifik kapan saja dengan perintah:\n\`/setdrive https://drive.google.com/drive/folders/ID_FOLDER\``
      });
    }
    return { ok: true };
  }

  // Command: /start
  if (cleanText.startsWith('/start') || cleanText === 'start' || cleanText === 'halo' || cleanText === 'hai') {
    const isConnected = Boolean(userAuth && userAuth.email);
    const authUrl = `${hostOrigin}/api/auth/google?binding=${await createTelegramBinding(userId)}`;

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

      if (progressTracker) await progressTracker.stop();

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

      await processAndDispatchEvent({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        dbUser,
        progressMessageId: initRes.message_id,
        sourceType: 'pdf',
        fileName: doc.file_name || 'surat_undangan.pdf',
        fileData: {
          base64Data,
          fileName: doc.file_name || 'surat_undangan.pdf',
          mimeType,
          sourceType: 'pdf'
        }
      });
    } catch (err: any) {
      if (progressTracker) await progressTracker.stop();
      if (initRes.message_id) {
        await editTelegramMessage({
          botToken,
          chatId,
          messageId: initRes.message_id,
          text: `❌ Terjadi kesalahan saat memproses dokumen: ${safeError(err)}`
        });
      } else {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ Terjadi kesalahan saat memproses dokumen: ${safeError(err)}`
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
    const caption = (msg.caption || '').toLowerCase();
    const isExplicitDoc = 
      caption.includes('#foto') || 
      caption.includes('#dok') || 
      caption.includes('#dokumentasi') || 
      caption.includes('#kegiatan') ||
      caption.includes('dokumentasi') ||
      caption.includes('foto kegiatan') ||
      caption.includes('presensi') ||
      caption.includes('monev') ||
      caption.includes('laporan kegiatan');

    const isExplicitPoster = 
      caption.includes('#poster') || 
      caption.includes('#agenda') || 
      caption.includes('#jadwal') || 
      caption.includes('#kalender') || 
      caption.includes('#flyer');

    const isMultiPhoto = Boolean(msg.media_group_id);

    const initRes = await sendTelegramMessage({
      botToken,
      chatId,
      text: `⏳ *[■□□□□□□□□□] 10%* Menerima gambar & menginisialisasi AI Vision...\n\n🖼️ *Berkas*: Berkas Gambar\n💡 *Status*: _Mengunduh gambar dari Telegram..._`
    });

    const progressTracker = initRes.message_id ? startTelegramProgressBar({
      botToken,
      chatId,
      messageId: initRes.message_id,
      fileName: 'gambar_kegiatan.jpg',
      fileType: 'image'
    }) : null;

    try {
      const downloaded=await downloadTelegramFile({botToken,fileId:bestPhoto.file_id});
      const base64Data=downloaded.base64Data;const mimeType=context.source?.mimeType||downloaded.mimeType;
      const buffer = Buffer.from(base64Data, 'base64');
      const photoMeta = await extractPhotoMetadata(buffer);

      // Check classification: Is this an activity documentation photo or a flyer?
      let isDocPhoto = !isExplicitPoster && (isExplicitDoc || isMultiPhoto);
      let classificationResult: any = null;

      if (!isDocPhoto && !isExplicitPoster) {
        classificationResult = await classifyImageIntent({
          buffer,
          base64Data,
          mimeType,
          apiKey: effectiveGeminiKey,
          hasCameraExif: photoMeta.hasCameraExif
        });
        isDocPhoto = classificationResult.isActivityPhoto || Boolean(classificationResult.hasTimestampWatermark);
      }

      // BRANCH A: Activity Documentation Photo (Auto-File to Google Drive)
      if (isDocPhoto) {
        if (progressTracker) await progressTracker.stop();

        const candidateUserIds = [userId, `tg_${userId}`, dbUser?.id, dbUser?.email, userAuth?.userId, userAuth?.email];
        const recentEvents = await getRecentExtractedEventsForUser(candidateUserIds, 50);

        const photoNotice = async (text: string) => {
          if(initRes.message_id)await editTelegramMessage({botToken,chatId,messageId:initRes.message_id,text:'Foto memerlukan pemilihan kegiatan. Lihat pilihan di bawah.'});
          await offerPhotoSelection({botToken,chatId,userId,owner,sources:currentSource().map(source=>({...source,takenAt:effectiveTakenAt||undefined,method:effectiveTakenAt?(photoMeta.takenAt?'exif_timestamp':'ocr_watermark'):'manual_selection'})),
            reason:text.replace(/Buka menu Foto Dokumentasi[\s\S]*|Pilih kegiatan yang benar melalui[\s\S]*/, 'Pilih kegiatan langsung di bawah.')});
        };
        let watermarkResult = parseWatermarkTimestamp(classificationResult?.watermarkData);
        if (!photoMeta.takenAt && !watermarkResult.detected) {
          watermarkResult = await detectWatermarkTimestamp({ base64Data, mimeType, apiKey: effectiveGeminiKey,
            model: dbUser?.model_name || botAdmin?.model_name });
        }
        const effectiveTakenAt = resolvePhotoTimestamp(photoMeta, watermarkResult);
        if (!effectiveTakenAt) {
          await photoNotice('Waktu pengambilan foto belum dapat dibaca dari EXIF atau watermark. Foto belum diunggah agar tidak masuk ke kegiatan yang salah. Buka menu Foto Dokumentasi di web, unggah foto dan pilih kegiatan yang benar secara manual.');
          return { ok: true };
        }
        const matchResult = matchPhotoToUserEvents({
          photoTimeIso: effectiveTakenAt,
          events: recentEvents,
          locationHint: watermarkResult?.locationText
        });

        if (matchResult.ambiguous) {
          await photoNotice('Ada beberapa kegiatan pada waktu foto yang sama. Foto belum diunggah. Pilih kegiatan yang benar melalui menu Foto Dokumentasi di web.');
          return { ok: true };
        }
        const targetUserId = String(userAuth?.userId || dbUser?.id || `tg_${userId}`);
        const matchedEvent = matchResult.bestMatch;
        if (!matchedEvent) {
          const takenAt = DateTime.fromISO(effectiveTakenAt).setZone('Asia/Jakarta').toFormat('dd LLL yyyy, HH:mm');
          await photoNotice(`Tidak ditemukan kegiatan dalam rentang waktu foto (${takenAt} WIB). Foto belum diunggah. Pilih kegiatan yang benar melalui menu Foto Dokumentasi di web.`);
          return { ok: true };
        }
        const uploadRes = await uploadDocumentationPhotoToDrive({
          userId: targetUserId,
          event: matchedEvent!,
          parentFolderId: dbUser?.gdrive_root_folder_id,
          buffer,
          originalFileName: 'foto_dokumentasi_telegram.jpg',
          mimeType:context.source?.mimeType||mimeType,
          takenAtIso: effectiveTakenAt
        });

        if (!uploadRes.success) {
          const errText = `❌ *Gagal mengunggah foto ke Google Drive:* ${uploadRes.error}`;
          if (initRes.message_id) {
            await editTelegramMessage({ botToken, chatId, messageId: initRes.message_id, text: errText });
          } else {
            await sendTelegramMessage({ botToken, chatId, text: errText });
          }
          return { ok: true };
        }

        // If a new folder was created for this event, persist folder ID to event record if event exists in DB
        if (uploadRes.folderId && matchedEvent!.id && !matchedEvent!.gdrive_folder_id) {
          await updateEventGdriveFolder({
            eventId: matchedEvent!.id,
            folderId: uploadRes.folderId,
            folderUrl: uploadRes.folderUrl || `https://drive.google.com/drive/folders/${uploadRes.folderId}`
          });
        }

        // Save record into event_documentations table
        await saveEventDocumentation({
          event_id: matchedEvent!.id || '',
          user_id: String(targetUserId),
          gdrive_file_id: uploadRes.fileId || '',
          gdrive_file_url: uploadRes.fileUrl || uploadRes.folderUrl || '',
          file_name: uploadRes.fileName || 'foto_dokumentasi_telegram.jpg',
          file_size: buffer.length,
          mime_type: mimeType,
          taken_at: effectiveTakenAt,
          match_method: photoMeta.takenAt ? 'exif_timestamp' : 'ocr_watermark'
        });

        const startDt = DateTime.fromISO(matchedEvent!.start_time).setZone('Asia/Jakarta');
        const startFormatted = startDt.isValid ? startDt.toFormat('dd LLLL yyyy, HH:mm') : matchedEvent!.start_time;

        const successText = `📸 *FOTO DOKUMENTASI BERHASIL DIARSIPKAN!* ✅\n\n` +
            `📌 *Kegiatan*: ${matchedEvent!.title}\n` +
            `🕒 *Waktu Acara*: ${startFormatted} WIB\n` +
            `*Waktu Foto*: ${DateTime.fromISO(effectiveTakenAt).setZone('Asia/Jakarta').toFormat('dd LLL yyyy, HH:mm')} WIB\n` +
            `*Sumber Waktu*: ${photoMeta.takenAt ? 'EXIF kamera' : 'Watermark kamera'}\n` +
            `💡 *Pencocokan*: _${matchResult.matchReason}_\n` +
            `📁 *Folder Google Drive*: [Buka Folder Kegiatan](${uploadRes.folderUrl || matchedEvent!.gdrive_folder_url || 'https://drive.google.com'})\n\n` +
            `✨ _Foto otomatis disimpan ke folder kegiatan tanpa membuat agenda kalender baru!_`;

        const inlineButtons = [
          { text: '📁 Buka Folder Drive', url: uploadRes.folderUrl || matchedEvent!.gdrive_folder_url || 'https://drive.google.com' },
          { text: '🌐 Buka Web EasyCal', url: hostOrigin }
        ];

        if (initRes.message_id) {
          await editTelegramMessage({ botToken, chatId, messageId: initRes.message_id, text: successText, inlineButtons });
        } else {
          await sendTelegramMessage({ botToken, chatId, text: successText, inlineButtons });
        }
        return { ok: true };
      }

      // BRANCH B: Poster Flyer (Standard Extraction & Calendar Sync)
      const result = await extractEventFromSource({
        apiKey: effectiveGeminiKey,
        model: dbUser?.model_name || botAdmin?.model_name || 'gemini-2.0-flash',
        sourceType: 'image',
        base64Data,
        mimeType
      });

      if (progressTracker) await progressTracker.stop();

      if (!result.success || !result.event) {
        const errMsg = result.error || 'Poster tidak dapat dibaca oleh AI.';
        
        // If the AI flagged this image as a documentation photo instead of a poster
        if (errMsg.includes('foto dokumentasi') || errMsg.includes('bukan poster')) {
          const docNoticeText = `📸 *FOTO DOKUMENTASI TERDETEKSI*\n\n` +
            `AI mendeteksi gambar ini sebagai **foto dokumentasi kegiatan fisik**, bukan poster undangan kegiatan.\n\n` +
            `💡 *Info*: Sistem tidak membuat agenda kalender baru untuk foto dokumentasi. Anda dapat mengunggahnya ke Google Drive melalui menu **Foto Dokumentasi** di website atau sertakan caption \`#foto\` saat mengirim ke bot!`;
          if (initRes.message_id) {
            await editTelegramMessage({ botToken, chatId, messageId: initRes.message_id, text: docNoticeText, inlineButtons: [{ text: '🌐 Buka Web EasyCal', url: hostOrigin }] });
          } else {
            await sendTelegramMessage({ botToken, chatId, text: docNoticeText, inlineButtons: [{ text: '🌐 Buka Web EasyCal', url: hostOrigin }] });
          }
          return { ok: true };
        }

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

      await processAndDispatchEvent({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        dbUser,
        progressMessageId: initRes.message_id,
        sourceType: 'image',
        fileName: context.source?.fileName||'poster_kegiatan.jpg',
        fileData: {
          base64Data,
          fileName: context.source?.fileName||'poster_kegiatan.jpg',
          mimeType,
          sourceType: 'image'
        }
      });
    } catch (err: any) {
      if (progressTracker) await progressTracker.stop();
      if (initRes.message_id) {
        await editTelegramMessage({
          botToken,
          chatId,
          messageId: initRes.message_id,
          text: `❌ Terjadi kesalahan saat memproses poster: ${safeError(err)}`
        });
      } else {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ Terjadi kesalahan saat memproses poster: ${safeError(err)}`
        });
      }
    }
    return { ok: true };
  }

  // Process Text Chat
  if (text.length >= 20 || /^\/update\b/i.test(text)) {
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

      if (progressTracker) await progressTracker.stop();

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

      await processAndDispatchEvent({ 
        botToken, 
        chatId, 
        userId, 
        event: result.event, 
        hostOrigin,
        userAuth,
        dbUser,
        progressMessageId: initRes.message_id,
        updateNumber: /^\/update\s+(\d+)\b/i.exec(text)?.[1],
        forceUpdate: /^\/update\b|\bsemula\b[\s\S]*\bmenjadi\b|\b(?:perubahan|ralat|revisi)\s+(?:waktu|tempat|jadwal)\b/i.test(text),
        sourceType: 'text',
        fileName: 'salinan_undangan.txt',
        fileData: {
          textContent: text,
          fileName: 'salinan_undangan.txt',
          mimeType: 'text/plain',
          sourceType: 'text'
        }
      });
    } catch (err: any) {
      if (progressTracker) await progressTracker.stop();
      if (initRes.message_id) {
        await editTelegramMessage({
          botToken,
          chatId,
          messageId: initRes.message_id,
          text: `❌ Terjadi kesalahan saat memproses teks: ${safeError(err)}`
        });
      } else {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: `❌ Terjadi kesalahan saat memproses teks: ${safeError(err)}`
        });
      }
    }
    return { ok: true };
  } else if (text.length > 0) {
    // Friendly response for short messages like 'halo', 'tes', 'hai'
    const authUrl = `${hostOrigin}/api/auth/google?binding=${await createTelegramBinding(userId)}`;
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
 * Sends a helpful and clear notification when a duplicate event is detected
 */
async function handleDuplicateNoticeTelegram(params: {
  botToken: string;
  chatId: number;
  progressMessageId?: number;
  duplicateResult: DuplicateDetectionResult;
  hostOrigin: string;
}) {
  const { botToken, chatId, progressMessageId, duplicateResult, hostOrigin } = params;
  const matched = duplicateResult.matchedEvent;
  if (!matched) return;

  const startDt = DateTime.fromISO(matched.start_time).setZone('Asia/Jakarta');
  const endDt = DateTime.fromISO(matched.end_time).setZone('Asia/Jakarta');
  const startFormatted = startDt.isValid ? startDt.toFormat('dd LLLL yyyy, HH:mm') : matched.start_time;
  const endFormatted = endDt.isValid ? endDt.toFormat('HH:mm') : matched.end_time;

  const createdDt = DateTime.fromISO(matched.created_at).setZone('Asia/Jakarta');
  const createdFormatted = createdDt.isValid ? createdDt.toFormat('dd LLL yyyy, HH:mm') : matched.created_at;

  const sourceTypeLabel = 
    matched.source_type === 'pdf' ? 'Surat PDF' :
    matched.source_type === 'image' ? 'Poster Flyer' :
    matched.source_type === 'telegram' ? 'Bot Telegram' : 'Teks Undangan';

  let replyText = `⚠️ *DATA KEGIATAN SUDAH PERNAH DIPROSES!* ⚠️\n\n` +
    `Sistem mendeteksi bahwa berkas / teks yang Anda kirimkan merujuk pada kegiatan yang **sudah pernah diproses sebelumnya** di akun Anda.\n\n` +
    `📋 *Detail Agenda Terdaftar:*\n` +
    `📌 *Agenda*: ${matched.title}\n` +
    `🕒 *Waktu*: ${startFormatted} s.d. ${endFormatted} WIB\n` +
    `📍 *Lokasi*: ${matched.location || (matched.is_online ? 'Daring (Zoom)' : 'Sesuai Undangan')}\n`;

  if (matched.meeting_id_pass) replyText += `🔑 *Kredensial*: ${matched.meeting_id_pass}\n`;
  if (matched.jp) replyText += `📚 *Bobot*: ${matched.jp}\n`;

  replyText += `\n🕒 *Riwayat Input*: ${createdFormatted} WIB (${sourceTypeLabel})\n` +
    `💡 *Alasan Deteksi*: _${duplicateResult.reason}_\n\n` +
    `🛡️ *Status Google Calendar*: Agenda ini sudah tercatat sebelumnya. Sistem **tidak membuat jadwal duplikat** di kalender Anda.`;

  const inlineButtons: Array<{ text: string; url?: string }> = [];

  if (matched.activity_status === 'cancelled') {
    replyText += '\n\n🚫 Kegiatan ini sudah dibatalkan. Ketik /dibatalkan, lalu aktifkan sesuai nomor daftar untuk memulihkan kegiatan yang sama.';
  }

  if (matched.google_calendar_url) {
    inlineButtons.push({
      text: '📅 Lihat di Google Calendar',
      url: matched.google_calendar_url
    });
  }

  inlineButtons.push({
    text: '🌐 Riwayat Web EasyCal',
    url: hostOrigin
  });

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
    await sendTelegramMessage({ botToken, chatId, text: replyText, inlineButtons });
  }
}

/**
 * Checks for cross-modality duplicate event before dispatching to calendar
 */
export async function processAndDispatchEvent(params: {
  ownerConfirmed?:boolean;
  botToken: string;
  chatId: number;
  userId: number;
  event: CalendarEvent;
  updateNumber?: string;
  forceUpdate?: boolean;
  hostOrigin: string;
  userAuth?: any;
  dbUser?: any;
  progressMessageId?: number;
  sourceType: 'pdf' | 'image' | 'text';
  fileName?: string;
  fileData?: {
    buffer?: Buffer;
    base64Data?: string;
    textContent?: string;
    fileName?: string;
    mimeType?: string;
    sourceType: 'pdf' | 'image' | 'text';
  };
}) {
  if(!params.event.update && !params.forceUpdate) {
    const operation=telegramContext.getStore()?.operationId;
    if(operation) {
      const key=`extraction:${operation}:${params.userId}`;
      const cached=await readBotState<CalendarEvent>(key);
      if(cached)params.event=cached.value;
      else await writeBotState(key,'extraction',params.event,0,Date.now(),Date.now()+7*86400000);
    }
  }
  const { botToken, chatId, userId, event, hostOrigin, userAuth, dbUser, progressMessageId, sourceType, fileName, fileData } = params;

  const finishUpdateNotice = async (text: string) => {
    if (progressMessageId && await editTelegramMessage({ botToken, chatId, messageId: progressMessageId, text })) return;
    await sendTelegramMessage({ botToken, chatId, text });
  };
  if(!params.ownerConfirmed && !event.update && !params.forceUpdate && event.needs_confirmation) {
    await offerCreateConfirmation({botToken,chatId,userId,owner:{userId:String(dbUser?.id||userAuth?.userId||`tg_${userId}`),email:dbUser?.email||userAuth?.email,telegramChatId:String(userId)},
      event,sources:currentSource(params.fileData)});
    if(progressMessageId)await editTelegramMessage({botToken,chatId,messageId:progressMessageId,text:'Hasil perlu diperiksa. Lengkapi atau konfirmasi pada pesan berikutnya.'});
    return;
  }

  // 1. Cross-modality Duplicate Detection Check
  try {
    const candidateUserIds = [
      userId,
      `tg_${userId}`,
      dbUser?.id,
      dbUser?.email,
      userAuth?.userId,
      userAuth?.email
    ];
    const recentEvents = await getRecentExtractedEventsForUser(candidateUserIds, 50);
    if (event.update || params.forceUpdate) {
      try {
        if (!event.update) throw new Error('Perubahan belum terbaca. Gunakan /update 1 jam menjadi 13.00 atau /update 1 tempat menjadi Ruang B setelah /agenda.');
        const owner = { userId: String(dbUser?.id || userAuth?.userId || userId), email: dbUser?.email || userAuth?.email, telegramChatId: String(userId) };
        let matched = matchUpdateEvent(event, recentEvents);
        let version = matched?.lifecycle_version || 0;
        if (params.updateNumber) {
          const session = await readAgendaSession(`${createHash('sha256').update(botToken).digest('hex').slice(0, 16)}:${chatId}:${userId}:${owner.userId}`);
          const index = Number(params.updateNumber) - 1;
          if (!session || session.status !== 'active' || !Number.isSafeInteger(index) || index < 0 || !session.ids[index]) throw new Error('Ketik /agenda terlebih dahulu, lalu /update <nomor> <perubahan>.');
          matched = { id: session.ids[index] } as typeof matched;
          version = session.versions[index];
        }
        if (!matched) throw new Error('Kegiatan lama belum dapat ditentukan secara pasti. Ketik /agenda lalu /update <nomor> <waktu/tempat baru>.');
        const record=await findOwnedEvent(owner,matched.id);
        if(!record || (record.lifecycle_version||0)!==version)throw new Error('Kegiatan berubah. Ketik /agenda dan pilih kembali.');
        await offerUpdateConfirmation({botToken,chatId,userId,owner,record,update:event.update,sources:currentSource(params.fileData)});
        await finishUpdateNotice('Perubahan terbaca. Periksa semula → menjadi dan konfirmasi pada pesan berikutnya.');
      } catch (error) {
        await finishUpdateNotice(error instanceof Error ? error.message : 'Perubahan belum dapat diproses.');
      }
      return;
    }
    const dupResult = findDuplicateEvent(event, recentEvents);

    if (dupResult.isDuplicate && dupResult.matchedEvent) {
      const isConnectedNow = Boolean(userAuth && (userAuth.refreshToken || userAuth.google_refresh_token));
      // SMART RECOVERY: If previous event was extracted while unlinked/un-synced, and user is now connected:
      // Don't block with duplicate error! Proceed to sync it to Google Calendar!
      if (dupResult.matchedEvent.activity_status !== 'cancelled' && !dupResult.matchedEvent.synced_to_calendar && isConnectedNow) {
        console.log(`[Telegram] Bypassing duplicate block for un-synced event "${dupResult.matchedEvent.title}" because user is now connected.`);
      } else {
        await handleDuplicateNoticeTelegram({
          botToken,
          chatId,
          progressMessageId,
          duplicateResult: dupResult,
          hostOrigin
        });
        return;
      }
    }
  } catch (err) {
    console.error('Telegram history lookup failed');
    if (event.update || params.forceUpdate) {
      await finishUpdateNotice('Riwayat kegiatan belum dapat dibaca. Coba kirim perubahan lagi.');
      return;
    }
  }

  // 2. Dispatch to calendar and Google Drive if not duplicate
  await dispatchCalendarResult({
    botToken,
    chatId,
    userId,
    event,
    hostOrigin,
    userAuth,
    dbUser,
    calendarId: dbUser?.calendar_id || 'primary',
    progressMessageId,
    sourceType,
    fileName,
    fileData
  });
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
  event: CalendarEvent;
  hostOrigin: string;
  userAuth?: any;
  dbUser?: any;
  calendarId?: string;
  progressMessageId?: number;
  sourceType?: 'pdf' | 'image' | 'text';
  fileName?: string;
  fileData?: {
    buffer?: Buffer;
    base64Data?: string;
    textContent?: string;
    fileName?: string;
    mimeType?: string;
    sourceType: 'pdf' | 'image' | 'text';
  };
}) {
  const { botToken, chatId, userId, event, hostOrigin, userAuth, dbUser, calendarId, progressMessageId, sourceType, fileName, fileData } = params;

  const startDt = DateTime.fromISO(event.start_time).setZone('Asia/Jakarta');
  const endDt = DateTime.fromISO(event.end_time).setZone('Asia/Jakarta');
  const startFormatted = startDt.isValid ? startDt.toFormat('dd LLLL yyyy, HH:mm') : event.start_time;
  const endFormatted = endDt.isValid ? endDt.toFormat('HH:mm') : event.end_time;

  // Case A: User has connected Google Calendar (Direct Auto-Sync!)
  if (userAuth && (userAuth.refreshToken || userAuth.google_refresh_token)) {
    const targetUserId = userAuth.userId || userAuth.id || userId;
    const { insertResult, gdriveResult, attachmentResult } = await syncGoogleCalendarEventWithSource({
      userId: targetUserId, event, calendarId: calendarId || dbUser?.calendar_id || 'primary', parentFolderId: dbUser?.gdrive_root_folder_id, fileData
    });

    // Persist a stable history identity for retries of the same Telegram job.
    let savedRecord;
    try {
      savedRecord=await saveExtractedEvent({
        id:createHash('sha256').update(`${targetUserId}:${telegramContext.getStore()!.operationId}`).digest('hex'),
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
        google_event_id: insertResult.eventId,
        google_calendar_id: calendarId || dbUser?.calendar_id || 'primary',
        synced_to_calendar: Boolean(insertResult.success),
        gdrive_folder_id: gdriveResult?.folderId,
        gdrive_folder_url: gdriveResult?.folderUrl,
        gdrive_file_id: gdriveResult?.fileId,
        gdrive_file_url: gdriveResult?.fileUrl,
        source_type: sourceType || 'telegram',
        file_name: fileName || 'Telegram Bot'
      });
    } catch (e) {
      throw new Error('Riwayat kegiatan belum tersimpan.');
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
      if (gdriveResult?.folderUrl) {
        replyText += `📁 *Google Drive*: [Buka Folder Kegiatan](${gdriveResult.folderUrl})\n`;
      } else if (gdriveResult?.error) {
        replyText += `\n⚠️ *Google Drive*: ${gdriveResult.error}\n`;
      }

      replyText += attachmentResult.attached
        ? '\nBerkas undangan terlampir di event Google Calendar.\n'
        : '\nLampiran belum terpasang di event: ' + attachmentResult.error + '\n';

      const inlineButtons: Array<{ text: string; url?: string; callback_data?:string }> = [
        {
          text: '📅 Lihat di Google Calendar',
          url: insertResult.htmlLink || event.google_calendar_url || 'https://calendar.google.com'
        }
      ];

      if (gdriveResult?.folderUrl) {
        inlineButtons.push({
          text: '📁 Buka Folder Drive',
          url: gdriveResult.folderUrl
        });
      } else if (gdriveResult?.error) {
        inlineButtons.push({
          text: '🔑 Otorisasi Google Drive',
          url: `${hostOrigin}/api/auth/google?binding=${await createTelegramBinding(userId)}`
        });
      }

      if(!attachmentResult.attached && savedRecord && currentSource()[0])inlineButtons.push(await registerArchiveRecovery({botToken,chatId,userId,owner:{userId:String(targetUserId),email:dbUser?.email||userAuth?.email,telegramChatId:String(userId)},record:savedRecord,source:currentSource()[0],
        uploaded:gdriveResult.fileId&&gdriveResult.fileUrl?{fileId:gdriveResult.fileId,fileUrl:gdriveResult.fileUrl,fileName:gdriveResult.fileName,mimeType:gdriveResult.mimeType}:undefined}));

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

  if(userAuth && (userAuth.refreshToken||userAuth.google_refresh_token)) {await sendTelegramMessage({botToken,chatId,text:'Agenda belum tersimpan di Google Calendar. Periksa /status atau hubungkan ulang dengan /connect. Riwayat kegagalan tersedia di web.'});return;}

  // Case B: User has NOT connected Google Calendar yet (Fallback to 1-Click URL + Connect Link)
  try {
    await saveExtractedEvent({
      id:createHash('sha256').update(`tg_${userId}:${telegramContext.getStore()!.operationId}`).digest('hex'),
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
      source_type: sourceType || 'telegram',
      file_name: fileName || 'Telegram Bot'
    });
  } catch (e) {}
  const authUrl = `${hostOrigin}/api/auth/google?binding=${await createTelegramBinding(userId)}`;
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
