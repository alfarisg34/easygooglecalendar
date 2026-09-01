import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'easycal_session';
const SECRET_KEY = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'easycal-secure-secret-key-change-in-env-2026'
);

export interface SessionPayload {
  userId: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Creates a signed JWT session token (valid for 30 days)
 */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET_KEY);
}

/**
 * Verifies a JWT session token and extracts the payload
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined
    };
  } catch (err) {
    return null;
  }
}

/**
 * Retrieves the currently authenticated session from Next.js request or cookies
 */
export async function getSessionFromRequest(req?: NextRequest): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
  } else {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch (e) {
      // Cookies might not be accessible outside server component context
    }
  }

  if (!token) return null;
  return await verifySessionToken(token);
}

export { SESSION_COOKIE_NAME };
