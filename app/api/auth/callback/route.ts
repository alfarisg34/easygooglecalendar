import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/google-auth';
import { saveUserGoogleAuth } from '@/lib/token-store';
import { sendTelegramMessage } from '@/lib/telegram-handler';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state') || 'web_anonymous';
  const error = searchParams.get('error');
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/callback`;

  if (error) {
    return new NextResponse(`
      <html>
        <body style="font-family: sans-serif; background: #0B0D0F; color: #FFF; padding: 3rem; text-align: center;">
          <h2 style="color: #FF334B;">❌ Otorisasi Dibatalkan</h2>
          <p>${error}</p>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  if (!code) {
    return new NextResponse(`
      <html>
        <body style="font-family: sans-serif; background: #0B0D0F; color: #FFF; padding: 3rem; text-align: center;">
          <h2 style="color: #FF334B;">❌ Authorization Code Tidak Ditemukan</h2>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  try {
    const { tokens, user } = await exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refresh_token) {
      console.warn('Google did not return a new refresh_token (user might have previously authorized).');
    }

    const email = user.email || 'unknown@google.com';
    const name = user.name || 'Google User';

    // Save tokens mapped to userId (e.g. tg_123456789 or web session)
    await saveUserGoogleAuth({
      userId: state,
      email,
      name,
      picture: user.picture || undefined,
      refreshToken: tokens.refresh_token || '',
      accessToken: tokens.access_token || undefined,
      expiryDate: tokens.expiry_date || undefined,
      updatedAt: new Date().toISOString()
    });

    // If originated from Telegram, notify the user on Telegram
    if (state.startsWith('tg_') && process.env.TELEGRAM_BOT_TOKEN) {
      const tgChatId = parseInt(state.replace('tg_', ''), 10);
      if (!isNaN(tgChatId)) {
        sendTelegramMessage({
          botToken: process.env.TELEGRAM_BOT_TOKEN,
          chatId: tgChatId,
          text: `🎉 *Akun Google Calendar Anda Berhasil Terhubung!*

📧 *Akun*: ${email}
👤 *Nama*: ${name}

Sekarang, setiap kali Anda mengirim dokumen surat dinas PDF, poster flyer, atau teks chat undangan ke bot ini, agenda akan **otomatis langsung dijadwalkan ke Google Calendar Anda secara realtime (Zero-Click)!** 📅✨`
        }).catch(err => console.error('Failed to send Telegram connect confirmation:', err));
      }
    }

    // Return high-craft HTML confirmation
    return new NextResponse(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Google Calendar Terhubung // EasyCal</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background-color: #0B0D0F;
            color: #F0F4F8;
            font-family: 'Plus Jakarta Sans', sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
          }
          .card {
            background: #12161B;
            border: 1px solid #232C38;
            border-radius: 4px;
            max-width: 480px;
            width: 100%;
            padding: 2.5rem;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          }
          .icon-badge {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: rgba(0, 255, 102, 0.12);
            border: 1px solid rgba(0, 255, 102, 0.3);
            color: #00FF66;
            font-size: 1.75rem;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
          }
          h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.75rem; color: #FFF; }
          p { color: #8B98A9; font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.5rem; }
          .meta-box {
            background: #090B0D;
            border: 1px solid #1C232D;
            padding: 1rem;
            border-radius: 4px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
            color: #FF9E0B;
            margin-bottom: 2rem;
            word-break: break-all;
          }
          .btn {
            display: inline-block;
            background: #FF9E0B;
            color: #000;
            font-weight: 700;
            padding: 0.75rem 1.5rem;
            border-radius: 2px;
            text-decoration: none;
            font-size: 0.9rem;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-badge">✓</div>
          <h1>Google Calendar Terhubung!</h1>
          <p>Akun Google Anda telah berhasil diotorisasi untuk penjadwalan otomatis.</p>
          <div class="meta-box">
            ${email} &bull; ${name}
          </div>
          <p style="font-size: 0.8rem; color: #667688;">
            ${state.startsWith('tg_') ? 'Anda dapat menutup tab ini dan kembali ke aplikasi Telegram.' : 'Anda dapat kembali ke aplikasi EasyCal.'}
          </p>
          <a href="/" class="btn">Kembali ke Aplikasi</a>
        </div>
      </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  } catch (err: any) {
    return new NextResponse(`
      <html>
        <body style="font-family: sans-serif; background: #0B0D0F; color: #FFF; padding: 3rem; text-align: center;">
          <h2 style="color: #FF334B;">❌ Gagal Memproses Otorisasi Google</h2>
          <p>${err.message}</p>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }
}
