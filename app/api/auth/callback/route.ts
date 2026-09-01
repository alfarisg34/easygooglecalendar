import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, getEffectiveOrigin, getEffectiveRedirectUri } from '@/lib/google-auth';
import { upsertGoogleUser, updateUserSettings } from '@/lib/db';
import { saveUserGoogleAuth } from '@/lib/token-store';
import { sendTelegramMessage } from '@/lib/telegram-handler';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-session';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state') || 'web_user';
  const error = searchParams.get('error');
  const origin = getEffectiveOrigin(req);
  const redirectUri = getEffectiveRedirectUri(req);

  if (error) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent('Kode otorisasi tidak ditemukan')}`);
  }

  try {
    const { tokens, user } = await exchangeCodeForTokens(code, redirectUri);

    const email = user.email || 'unknown@google.com';
    const name = user.name || 'Google User';
    const picture = user.picture || '';
    const userId = user.id || email;

    // 1. Save / Upsert in Neon PostgreSQL Database
    const dbUser = await upsertGoogleUser({
      id: userId,
      email,
      name,
      picture,
      refreshToken: tokens.refresh_token || '',
      accessToken: tokens.access_token || undefined,
      expiryDate: tokens.expiry_date || undefined
    });

    // 2. If originated from Telegram, link telegram_chat_id to user in DB
    if (state.startsWith('tg_')) {
      const rawTgId = state.replace('tg_', '');
      await updateUserSettings(dbUser.id, {
        telegram_chat_id: rawTgId
      });

      const effectiveBotToken = process.env.TELEGRAM_BOT_TOKEN || dbUser.telegram_bot_token;
      const tgChatIdNum = parseInt(rawTgId, 10);

      if (effectiveBotToken && !isNaN(tgChatIdNum)) {
        sendTelegramMessage({
          botToken: effectiveBotToken,
          chatId: tgChatIdNum,
          text: `🎉 *Akun Google Calendar Anda Berhasil Terhubung!*

📧 *Akun*: ${email}
👤 *Nama*: ${name}

Sekarang setiap dokumen surat dinas, poster, atau pesan broadcast yang Anda kirim ke bot ini akan otomatis langsung dijadwalkan ke Google Calendar Anda secara realtime (0-Click Sync)! 📅✨`
        }).catch(err => console.error('Failed to send Telegram connect confirmation:', err));
      }
    }

    // 3. Also sync to legacy/token-store for Telegram compatibility
    await saveUserGoogleAuth({
      userId: state,
      email,
      name,
      picture,
      refreshToken: tokens.refresh_token || '',
      accessToken: tokens.access_token || undefined,
      expiryDate: tokens.expiry_date || undefined,
      updatedAt: new Date().toISOString()
    });

    // 4. Generate JWT session token
    const sessionToken = await createSessionToken({
      userId: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      picture: dbUser.picture
    });

    // 5. Create redirect response and attach HttpOnly Session Cookie
    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.redirect(`${origin}/?auth=success`);

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 // 30 days
    });

    return response;
  } catch (err: any) {
    console.error('Google OAuth Callback error:', err);
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(err.message || 'Gagal memproses otorisasi Google')}`);
  }
}
