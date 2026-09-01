import { google } from 'googleapis';
import { NextRequest } from 'next/server';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid'
];

/**
 * Derives the exact public origin (domain) behind reverse proxies like Vercel / Cloudflare
 */
export function getEffectiveOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    const isLocal = forwardedHost.includes('localhost') || forwardedHost.includes('127.0.0.1');
    const proto = isLocal ? 'http' : forwardedProto;
    return `${proto}://${forwardedHost}`;
  }
  return req.nextUrl.origin;
}

/**
 * Resolves the matching OAuth redirect URI for both generateAuthUrl and exchangeCodeForTokens
 */
export function getEffectiveRedirectUri(req: NextRequest): string {
  const origin = getEffectiveOrigin(req);
  const envUri = process.env.GOOGLE_REDIRECT_URI?.trim();

  // If envUri is set to localhost but we are accessed via production domain, prefer actual domain
  if (envUri) {
    if (envUri.includes('localhost') && !origin.includes('localhost')) {
      return `${origin}/api/auth/callback`;
    }
    return envUri;
  }

  return `${origin}/api/auth/callback`;
}

/**
 * Creates and returns a Google OAuth2 client instance
 */
export function getGoogleOAuth2Client(customRedirectUri?: string) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = customRedirectUri || process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:3000/api/auth/callback';

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generates the Google OAuth authorization URL
 */
export function generateGoogleAuthUrl(params: {
  userId?: string; // e.g. "tg_123456789" or "web_user"
  redirectUri?: string;
  loginHint?: string;
}): string {
  const oauth2Client = getGoogleOAuth2Client(params.redirectUri);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Critical: requests refresh_token
    prompt: 'consent',     // Forces consent prompt to guarantee refresh_token
    scope: SCOPES,
    state: params.userId || 'web_user',
    login_hint: params.loginHint
  });
}

/**
 * Exchanges the authorization code for tokens and user profile
 */
export async function exchangeCodeForTokens(code: string, redirectUri?: string) {
  const oauth2Client = getGoogleOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch basic user profile (email & name)
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();

  return {
    tokens,
    user: userInfo.data
  };
}
