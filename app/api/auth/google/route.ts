import { NextRequest, NextResponse } from 'next/server';
import { generateGoogleAuthUrl, getEffectiveRedirectUri } from '@/lib/google-auth';
import { createOAuthState } from '@/lib/telegram-security';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const redirectUri = getEffectiveRedirectUri(req);

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      error: 'Google OAuth Client ID & Secret belum dikonfigurasi di environment variable (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET).'
    }, { status: 500 });
  }

  const { state, cookie } = await createOAuthState(searchParams.get('binding'));
  const authUrl = generateGoogleAuthUrl({
    state,
    redirectUri
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('easycal_oauth',cookie,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:600,path:'/api/auth'});
  return response;
}
