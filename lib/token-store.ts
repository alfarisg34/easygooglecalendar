import fs from 'fs';
import path from 'path';

export interface UserGoogleAuth {
  userId: string; // e.g. "tg_123456789" or "web_uuid"
  email: string;
  name?: string;
  picture?: string;
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  updatedAt: string;
}

// In-memory cache for fast lookups
const memoryStore = new Map<string, UserGoogleAuth>();

// File fallback path for local development
const LOCAL_STORE_FILE = path.join(process.cwd(), '.user_tokens.json');

function getLocalFileStore(): Record<string, UserGoogleAuth> {
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const data = fs.readFileSync(LOCAL_STORE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    // Ignore local file read error
  }
  return {};
}

function saveLocalFileStore(data: Record<string, UserGoogleAuth>) {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    // Ignore local file write error in serverless read-only environment
  }
}

/**
 * Saves a user's Google OAuth refresh token and profile info
 */
export async function saveUserGoogleAuth(auth: UserGoogleAuth): Promise<void> {
  const key = `user_auth:${auth.userId}`;
  memoryStore.set(key, auth);

  // 1. Try Upstash / Vercel KV if configured in Environment Variables
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(auth))
      });
      return;
    } catch (err) {
      console.error('Failed to write to KV Store:', err);
    }
  }

  // 2. Fallback to local file in development
  const localData = getLocalFileStore();
  localData[key] = auth;
  saveLocalFileStore(localData);
}

/**
 * Retrieves a user's Google OAuth authentication data by userId
 */
export async function getUserGoogleAuth(userId: string | number): Promise<UserGoogleAuth | null> {
  const normalizedId = String(userId).startsWith('tg_') ? String(userId) : `tg_${userId}`;
  const key = `user_auth:${normalizedId}`;

  // 1. Check memory cache first
  if (memoryStore.has(key)) {
    return memoryStore.get(key) || null;
  }

  // 2. Try Upstash / Vercel KV
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
        headers: {
          Authorization: `Bearer ${kvToken}`
        }
      });
      const data = await res.json();
      if (data.result) {
        const parsed: UserGoogleAuth = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
        memoryStore.set(key, parsed);
        return parsed;
      }
    } catch (err) {
      console.error('Failed to read from KV Store:', err);
    }
  }

  // 3. Fallback to local file store
  const localData = getLocalFileStore();
  if (localData[key]) {
    memoryStore.set(key, localData[key]);
    return localData[key];
  }

  return null;
}

/**
 * Deletes a user's Google OAuth authentication data (disconnect)
 */
export async function deleteUserGoogleAuth(userId: string | number): Promise<boolean> {
  const normalizedId = String(userId).startsWith('tg_') ? String(userId) : `tg_${userId}`;
  const key = `user_auth:${normalizedId}`;

  memoryStore.delete(key);

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/del/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`
        }
      });
    } catch (err) {
      console.error('Failed to delete from KV Store:', err);
    }
  }

  const localData = getLocalFileStore();
  if (localData[key]) {
    delete localData[key];
    saveLocalFileStore(localData);
  }

  return true;
}
