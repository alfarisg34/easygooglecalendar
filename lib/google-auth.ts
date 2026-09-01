import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid'
];

/**
 * Creates and returns a Google OAuth2 client instance
 */
export function getGoogleOAuth2Client(customRedirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = customRedirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

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
