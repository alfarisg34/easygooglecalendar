import { neon, neonConfig } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

export interface UserRecord {
  id: string; // e.g. "google_12345678" or email
  email: string;
  name?: string;
  picture?: string;
  google_refresh_token?: string;
  google_access_token?: string;
  google_token_expiry?: number;
  gemini_api_key?: string;
  telegram_bot_token?: string;
  telegram_chat_id?: string;
  calendar_id?: string;
  ocr_engine?: string;
  ocr_service_url?: string;
  model_name?: string;
  created_at?: string;
  updated_at?: string;
}

const LOCAL_STORE_FILE = path.join(process.cwd(), '.user_tokens.json');
const memoryUserMap = new Map<string, UserRecord>();

function getDatabaseUrl(): string | null {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
}

let dbInitialized = false;

/**
 * Initializes database schema on Neon PostgreSQL
 */
export async function initDatabase(): Promise<boolean> {
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) return false;

  if (dbInitialized) return true;

  try {
    const sql = neon(dbUrl);
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        picture TEXT,
        google_refresh_token TEXT,
        google_access_token TEXT,
        google_token_expiry BIGINT,
        gemini_api_key TEXT,
        telegram_bot_token TEXT,
        telegram_chat_id TEXT,
        calendar_id VARCHAR(255) DEFAULT 'primary',
        ocr_engine VARCHAR(50) DEFAULT 'gemini',
        ocr_service_url TEXT,
        model_name VARCHAR(100) DEFAULT 'gemini-3.6-flash',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Ensure all optional columns exist for seamless schema upgrades
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_id VARCHAR(255) DEFAULT 'primary';`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ocr_engine VARCHAR(50) DEFAULT 'gemini';`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ocr_service_url TEXT;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS model_name VARCHAR(100) DEFAULT 'gemini-3.6-flash';`;

    dbInitialized = true;
    return true;
  } catch (err) {
    console.error('Failed to initialize Neon PostgreSQL database:', err);
    return false;
  }
}

// Fallback Local File helpers
function getLocalUsers(): Record<string, UserRecord> {
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const data = fs.readFileSync(LOCAL_STORE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {}
  return {};
}

function saveLocalUsers(data: Record<string, UserRecord>) {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

/**
 * Retrieves a user by their unique ID (e.g. google_id, email, or user_id)
 */
export async function getUserById(id: string): Promise<UserRecord | null> {
  const dbUrl = getDatabaseUrl();
  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const rows = await sql`
        SELECT * FROM users WHERE id = ${id} OR email = ${id} LIMIT 1
      `;
      if (rows && rows.length > 0) {
        return rows[0] as UserRecord;
      }
      return null;
    } catch (err) {
      console.error('Neon DB getUserById error:', err);
    }
  }

  // Memory & Local fallback
  if (memoryUserMap.has(id)) return memoryUserMap.get(id) || null;
  const local = getLocalUsers();
  return local[id] || null;
}

/**
 * Retrieves a user by their email address
 */
export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const dbUrl = getDatabaseUrl();
  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const rows = await sql`
        SELECT * FROM users WHERE email = ${email} LIMIT 1
      `;
      if (rows && rows.length > 0) {
        return rows[0] as UserRecord;
      }
      return null;
    } catch (err) {
      console.error('Neon DB getUserByEmail error:', err);
    }
  }

  // Local fallback search by email
  const local = getLocalUsers();
  for (const key of Object.keys(local)) {
    if (local[key].email === email) return local[key];
  }
  for (const user of Array.from(memoryUserMap.values())) {
    if (user.email === email) return user;
  }
  return null;
}

/**
 * Upserts a Google OAuth User into Neon PostgreSQL
 */
export async function upsertGoogleUser(params: {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  refreshToken?: string;
  accessToken?: string;
  expiryDate?: number;
}): Promise<UserRecord> {
  const now = new Date().toISOString();
  const dbUrl = getDatabaseUrl();

  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);

      // Fetch existing user to preserve refresh_token if Google didn't resend one
      const existing = await sql`SELECT * FROM users WHERE id = ${params.id} OR email = ${params.email} LIMIT 1`;
      const prev = existing && existing.length > 0 ? (existing[0] as UserRecord) : null;

      const finalRefreshToken = params.refreshToken || prev?.google_refresh_token || '';
      const finalAccessToken = params.accessToken || prev?.google_access_token || '';
      const finalExpiry = params.expiryDate || prev?.google_token_expiry || null;
      const finalName = params.name || prev?.name || 'Google User';
      const finalPicture = params.picture || prev?.picture || '';

      const updated = await sql`
        INSERT INTO users (
          id, email, name, picture, 
          google_refresh_token, google_access_token, google_token_expiry, 
          updated_at
        ) VALUES (
          ${params.id}, ${params.email}, ${finalName}, ${finalPicture},
          ${finalRefreshToken}, ${finalAccessToken}, ${finalExpiry},
          ${now}
        )
        ON CONFLICT (email) DO UPDATE SET
          id = EXCLUDED.id,
          name = COALESCE(EXCLUDED.name, users.name),
          picture = COALESCE(EXCLUDED.picture, users.picture),
          google_refresh_token = CASE WHEN EXCLUDED.google_refresh_token != '' THEN EXCLUDED.google_refresh_token ELSE users.google_refresh_token END,
          google_access_token = COALESCE(EXCLUDED.google_access_token, users.google_access_token),
          google_token_expiry = COALESCE(EXCLUDED.google_token_expiry, users.google_token_expiry),
          updated_at = ${now}
        RETURNING *;
      `;

      return updated[0] as UserRecord;
    } catch (err) {
      console.error('Neon DB upsertGoogleUser error:', err);
    }
  }

  // Fallback to local / memory
  const local = getLocalUsers();
  const prev = local[params.id] || local[params.email];
  const userObj: UserRecord = {
    id: params.id,
    email: params.email,
    name: params.name || prev?.name || 'Google User',
    picture: params.picture || prev?.picture,
    google_refresh_token: params.refreshToken || prev?.google_refresh_token || '',
    google_access_token: params.accessToken || prev?.google_access_token,
    google_token_expiry: params.expiryDate || prev?.google_token_expiry,
    gemini_api_key: prev?.gemini_api_key,
    telegram_bot_token: prev?.telegram_bot_token,
    telegram_chat_id: prev?.telegram_chat_id,
    calendar_id: prev?.calendar_id || 'primary',
    ocr_engine: prev?.ocr_engine || 'gemini',
    ocr_service_url: prev?.ocr_service_url,
    model_name: prev?.model_name || 'gemini-3.6-flash',
    created_at: prev?.created_at || now,
    updated_at: now
  };

  local[params.id] = userObj;
  local[params.email] = userObj;
  saveLocalUsers(local);
  memoryUserMap.set(params.id, userObj);
  memoryUserMap.set(params.email, userObj);

  return userObj;
}

/**
 * Updates User Settings (Gemini API Key, Telegram Token, Calendar ID, etc.)
 */
export async function updateUserSettings(
  userId: string,
  settings: {
    gemini_api_key?: string;
    model_name?: string;
    ocr_engine?: string;
    ocr_service_url?: string;
    calendar_id?: string;
    telegram_bot_token?: string;
    telegram_chat_id?: string;
  }
): Promise<UserRecord | null> {
  const now = new Date().toISOString();
  const dbUrl = getDatabaseUrl();

  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);

      // Build dynamic update safely
      const updated = await sql`
        UPDATE users SET
          gemini_api_key = COALESCE(${settings.gemini_api_key !== undefined ? settings.gemini_api_key : null}, gemini_api_key),
          model_name = COALESCE(${settings.model_name !== undefined ? settings.model_name : null}, model_name),
          ocr_engine = COALESCE(${settings.ocr_engine !== undefined ? settings.ocr_engine : null}, ocr_engine),
          ocr_service_url = COALESCE(${settings.ocr_service_url !== undefined ? settings.ocr_service_url : null}, ocr_service_url),
          calendar_id = COALESCE(${settings.calendar_id !== undefined ? settings.calendar_id : null}, calendar_id),
          telegram_bot_token = COALESCE(${settings.telegram_bot_token !== undefined ? settings.telegram_bot_token : null}, telegram_bot_token),
          telegram_chat_id = COALESCE(${settings.telegram_chat_id !== undefined ? settings.telegram_chat_id : null}, telegram_chat_id),
          updated_at = ${now}
        WHERE id = ${userId} OR email = ${userId}
        RETURNING *;
      `;

      if (updated && updated.length > 0) {
        return updated[0] as UserRecord;
      }
    } catch (err) {
      console.error('Neon DB updateUserSettings error:', err);
    }
  }

  // Fallback to local
  const local = getLocalUsers();
  const existing = local[userId] || (await getUserById(userId));
  if (existing) {
    if (settings.gemini_api_key !== undefined) existing.gemini_api_key = settings.gemini_api_key;
    if (settings.model_name !== undefined) existing.model_name = settings.model_name;
    if (settings.ocr_engine !== undefined) existing.ocr_engine = settings.ocr_engine;
    if (settings.ocr_service_url !== undefined) existing.ocr_service_url = settings.ocr_service_url;
    if (settings.calendar_id !== undefined) existing.calendar_id = settings.calendar_id;
    if (settings.telegram_bot_token !== undefined) existing.telegram_bot_token = settings.telegram_bot_token;
    if (settings.telegram_chat_id !== undefined) existing.telegram_chat_id = settings.telegram_chat_id;
    existing.updated_at = now;

    local[existing.id] = existing;
    local[existing.email] = existing;
    saveLocalUsers(local);
    memoryUserMap.set(existing.id, existing);
    memoryUserMap.set(existing.email, existing);
    return existing;
  }

  return null;
}

/**
 * Returns database status
 */
export async function getDbStatus(): Promise<{
  connected: boolean;
  provider: 'neon' | 'local_fallback';
  message: string;
}> {
  const dbUrl = getDatabaseUrl();
  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const res = await sql`SELECT 1 as connected`;
      if (res && res.length > 0) {
        return {
          connected: true,
          provider: 'neon',
          message: 'Terhubung ke Neon PostgreSQL (Serverless Vercel)'
        };
      }
    } catch (err: any) {
      return {
        connected: false,
        provider: 'neon',
        message: `Koneksi Neon PostgreSQL Gagal: ${err.message}`
      };
    }
  }

  return {
    connected: false,
    provider: 'local_fallback',
    message: 'DATABASE_URL belum dikonfigurasi. Menggunakan penyimpanan lokal sementara.'
  };
}
