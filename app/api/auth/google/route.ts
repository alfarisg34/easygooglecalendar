import { NextRequest, NextResponse } from 'next/server';
import { generateGoogleAuthUrl, getEffectiveRedirectUri } from '@/lib/google-auth';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id') || searchParams.get('tg_user_id') || 'web_user';
  const redirectUri = getEffectiveRedirectUri(req);

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      error: 'Google OAuth Client ID & Secret belum dikonfigurasi di environment variable (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET).'
    }, { status: 500 });
  }

  const authUrl = generateGoogleAuthUrl({
    userId,
    redirectUri
  });

  return NextResponse.redirect(authUrl);
}
