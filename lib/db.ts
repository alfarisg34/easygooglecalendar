import { neon, neonConfig } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

export interface UserRecord {
  id: string; // e.g. "google_12345678" or email
  email: string;
  name?: string;
  picture?: string;
  phone_number?: string;
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

export interface ExtractedEventRecord {
  id: string;
  user_id: string;
  title: string;
  start_time: string;
  end_time: string;
  is_online?: boolean;
  location?: string;
  meeting_link?: string;
  meeting_id_pass?: string;
  jp?: string;
  speakers?: string;
  description?: string;
  google_calendar_url?: string;
  google_event_id?: string;
  synced_to_calendar?: boolean;
  source_type?: string; // 'pdf' | 'image' | 'text' | 'telegram'
  file_name?: string;
  created_at: string;
}

const LOCAL_STORE_FILE = path.join(process.cwd(), '.user_tokens.json');
const LOCAL_EVENTS_FILE = path.join(process.cwd(), '.user_events.json');
const memoryUserMap = new Map<string, UserRecord>();
const memoryEventsList: ExtractedEventRecord[] = [];

/**
 * Normalizes phone numbers to a consistent format (e.g. 0812... / +62812... -> 62812...)
 */
export function normalizePhoneNumber(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/[^\d+]/g, '').trim();
  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1);
  if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
  return cleaned;
}

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
        phone_number VARCHAR(50),
        google_refresh_token TEXT,
        google_access_token TEXT,
        google_token_expiry BIGINT,
        gemini_api_key TEXT,
        telegram_bot_token TEXT,
        telegram_chat_id TEXT,
        calendar_id VARCHAR(255) DEFAULT 'primary',
        ocr_engine VARCHAR(50) DEFAULT 'gemini',
        ocr_service_url TEXT,
        model_name VARCHAR(100) DEFAULT 'gemini-2.0-flash',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Ensure phone_number column exists if table was previously created
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);`;


    // Create extracted_events history table
    await sql`
      CREATE TABLE IF NOT EXISTS extracted_events (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        title TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        is_online BOOLEAN DEFAULT false,
        location TEXT,
        meeting_link TEXT,
        meeting_id_pass TEXT,
        jp TEXT,
        speakers TEXT,
        description TEXT,
        google_calendar_url TEXT,
        google_event_id TEXT,
        synced_to_calendar BOOLEAN DEFAULT false,
        source_type VARCHAR(50) DEFAULT 'web',
        file_name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_extracted_events_user ON extracted_events(user_id, created_at DESC);`;

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
 * Retrieves a user by their unique ID (e.g. google_id, email, user_id, or telegram ID)
 */
export async function getUserById(id: string): Promise<UserRecord | null> {
  const dbUrl = getDatabaseUrl();
  const cleanId = String(id).replace('tg_', '');
  const tgId = `tg_${cleanId}`;

  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const rows = await sql`
        SELECT * FROM users 
        WHERE id = ${id} 
           OR id = ${cleanId}
           OR id = ${tgId}
           OR email = ${id} 
           OR telegram_chat_id = ${cleanId}
           OR telegram_chat_id = ${tgId}
        LIMIT 1
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
  if (memoryUserMap.has(cleanId)) return memoryUserMap.get(cleanId) || null;
  const local = getLocalUsers();
  return local[id] || local[cleanId] || local[tgId] || null;
}

/**
 * Retrieves a user strictly by their Telegram User/Chat ID (Method B: Personal State Binding)
 */
export async function getUserByTelegram(params: {
  tgUserId: string | number;
}): Promise<UserRecord | null> {
  const dbUrl = getDatabaseUrl();
  const rawId = String(params.tgUserId).replace('tg_', '');
  const tgId = `tg_${rawId}`;

  if (dbUrl && rawId) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);

      // Search exclusively for the account linked to this specific Telegram User ID
      const rows = await sql`
        SELECT * FROM users 
        WHERE telegram_chat_id = ${rawId} 
           OR telegram_chat_id = ${tgId}
           OR id = ${rawId}
           OR id = ${tgId}
        LIMIT 1
      `;
      if (rows && rows.length > 0 && rows[0].google_refresh_token) {
        return rows[0] as UserRecord;
      }
    } catch (err) {
      console.error('Neon DB getUserByTelegram error:', err);
    }
  }

  // Local fallback
  if (rawId) {
    const byId = await getUserById(rawId);
    if (byId && byId.google_refresh_token) return byId;
  }

  return null;
}

/**
 * Retrieves a user by phone number
 */
export async function getUserByPhone(phoneNumber: string): Promise<UserRecord | null> {
  const normPhone = normalizePhoneNumber(phoneNumber);
  if (!normPhone) return null;

  const dbUrl = getDatabaseUrl();
  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const rows = await sql`
        SELECT * FROM users 
        WHERE phone_number = ${normPhone}
           OR phone_number = ${'+' + normPhone}
           OR phone_number = ${'0' + normPhone.replace(/^62/, '')}
           OR REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') = ${normPhone}
        LIMIT 1
      `;
      if (rows && rows.length > 0) return rows[0] as UserRecord;
    } catch (err) {
      console.error('Neon DB getUserByPhone error:', err);
    }
  }

  // Local fallback
  const local = getLocalUsers();
  for (const key of Object.keys(local)) {
    const user = local[key];
    if (user.phone_number && normalizePhoneNumber(user.phone_number) === normPhone) {
      return user;
    }
  }
  for (const user of Array.from(memoryUserMap.values())) {
    if (user.phone_number && normalizePhoneNumber(user.phone_number) === normPhone) {
      return user;
    }
  }

  return null;
}

/**
 * Links a Telegram User ID to an account by Phone Number
 */
export async function linkTelegramUserByPhone(params: {
  tgUserId: string | number;
  phoneNumber: string;
}): Promise<UserRecord | null> {
  const normPhone = normalizePhoneNumber(params.phoneNumber);
  const rawId = String(params.tgUserId).replace('tg_', '');
  const tgId = `tg_${rawId}`;
  const now = new Date().toISOString();

  if (!normPhone || !rawId) return null;

  const dbUrl = getDatabaseUrl();
  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const updated = await sql`
        UPDATE users 
        SET telegram_chat_id = ${rawId},
            updated_at = ${now}
        WHERE (
          phone_number = ${normPhone}
          OR phone_number = ${'+' + normPhone}
          OR phone_number = ${'0' + normPhone.replace(/^62/, '')}
          OR REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') = ${normPhone}
        )
        RETURNING *;
      `;
      if (updated && updated.length > 0) return updated[0] as UserRecord;
    } catch (err) {
      console.error('Neon DB linkTelegramUserByPhone error:', err);
    }
  }

  // Local fallback
  const user = await getUserByPhone(normPhone);
  if (user) {
    user.telegram_chat_id = rawId;
    user.updated_at = now;
    const local = getLocalUsers();
    local[user.id] = user;
    local[user.email] = user;
    saveLocalUsers(local);
    memoryUserMap.set(user.id, user);
    memoryUserMap.set(user.email, user);
    return user;
  }

  return null;
}

/**
 * Retrieves the Bot Owner / Admin settings by Bot Token for AI key fallback
 */
export async function getBotAdminSettings(botToken?: string): Promise<UserRecord | null> {
  const dbUrl = getDatabaseUrl();
  const cleanToken = (botToken || '').trim();
  if (dbUrl && cleanToken) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const rows = await sql`
        SELECT * FROM users 
        WHERE telegram_bot_token = ${cleanToken} 
           OR TRIM(telegram_bot_token) = ${cleanToken}
        LIMIT 1
      `;
      if (rows && rows.length > 0) return rows[0] as UserRecord;
    } catch (err) {
      console.error('Neon DB getBotAdminSettings error:', err);
    }
  }

  // Memory & Local fallback
  if (cleanToken) {
    for (const user of Array.from(memoryUserMap.values())) {
      if (user.telegram_bot_token?.trim() === cleanToken) return user;
    }
    const local = getLocalUsers();
    for (const key of Object.keys(local)) {
      if (local[key].telegram_bot_token?.trim() === cleanToken) return local[key];
    }
  }

  return null;
}

/**
 * Disconnects a specific Telegram User from their linked Google Account
 */
export async function disconnectTelegramUser(tgUserId: string | number): Promise<boolean> {
  const rawId = String(tgUserId).replace('tg_', '');
  const tgId = `tg_${rawId}`;
  const dbUrl = getDatabaseUrl();

  if (dbUrl && rawId) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      await sql`
        UPDATE users 
        SET telegram_chat_id = NULL 
        WHERE telegram_chat_id = ${rawId} 
           OR telegram_chat_id = ${tgId}
           OR id = ${rawId}
           OR id = ${tgId}
      `;
      return true;
    } catch (err) {
      console.error('Neon DB disconnectTelegramUser error:', err);
    }
  }

  return false;
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
    phone_number?: string;
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
          phone_number = COALESCE(${settings.phone_number !== undefined ? settings.phone_number : null}, phone_number),
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
    if (settings.phone_number !== undefined) existing.phone_number = settings.phone_number;
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

// Fallback Local Events file store
function getLocalEvents(): ExtractedEventRecord[] {
  try {
    if (fs.existsSync(LOCAL_EVENTS_FILE)) {
      const data = fs.readFileSync(LOCAL_EVENTS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {}
  return [];
}

function saveLocalEvents(data: ExtractedEventRecord[]) {
  try {
    fs.writeFileSync(LOCAL_EVENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

/**
 * Saves an extracted event record into Neon PostgreSQL
 */
export async function saveExtractedEvent(
  event: Omit<ExtractedEventRecord, 'id' | 'created_at'> & { id?: string }
): Promise<ExtractedEventRecord> {
  const eventId = event.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
  const now = new Date().toISOString();
  const dbUrl = getDatabaseUrl();

  const record: ExtractedEventRecord = {
    id: eventId,
    user_id: event.user_id,
    title: event.title || 'Agenda Kegiatan / Rapat',
    start_time: event.start_time,
    end_time: event.end_time,
    is_online: Boolean(event.is_online),
    location: event.location || '',
    meeting_link: event.meeting_link || '',
    meeting_id_pass: event.meeting_id_pass || '',
    jp: event.jp || '',
    speakers: event.speakers || '',
    description: event.description || '',
    google_calendar_url: event.google_calendar_url || '',
    google_event_id: event.google_event_id || '',
    synced_to_calendar: Boolean(event.synced_to_calendar),
    source_type: event.source_type || 'web',
    file_name: event.file_name || '',
    created_at: now
  };

  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      const inserted = await sql`
        INSERT INTO extracted_events (
          id, user_id, title, start_time, end_time,
          is_online, location, meeting_link, meeting_id_pass,
          jp, speakers, description, google_calendar_url,
          google_event_id, synced_to_calendar, source_type,
          file_name, created_at
        ) VALUES (
          ${record.id}, ${record.user_id}, ${record.title}, ${record.start_time}, ${record.end_time},
          ${record.is_online}, ${record.location}, ${record.meeting_link}, ${record.meeting_id_pass},
          ${record.jp}, ${record.speakers}, ${record.description}, ${record.google_calendar_url},
          ${record.google_event_id}, ${record.synced_to_calendar}, ${record.source_type},
          ${record.file_name}, ${record.created_at}
        )
        RETURNING *;
      `;
      if (inserted && inserted.length > 0) {
        return inserted[0] as ExtractedEventRecord;
      }
    } catch (err) {
      console.error('Neon DB saveExtractedEvent error:', err);
    }
  }

  // Fallback to local file / memory
  const local = getLocalEvents();
  local.unshift(record);
  saveLocalEvents(local);
  memoryEventsList.unshift(record);
  return record;
}

/**
 * Retrieves paginated extracted events for a user, sorted by created_at DESC
 */
export async function getUserExtractedEvents(params: {
  userId: string;
  email?: string;
  telegramChatId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  events: ExtractedEventRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(50, params.limit || 5));
  const offset = (page - 1) * limit;

  const dbUrl = getDatabaseUrl();
  const rawTg = params.telegramChatId ? String(params.telegramChatId).replace('tg_', '') : '';
  const tgId = `tg_${rawTg}`;
  const userId = params.userId;
  const userEmail = params.email || params.userId;

  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);

      // Count query
      const countRes = await sql`
        SELECT COUNT(*) as count FROM extracted_events
        WHERE user_id = ${userId}
           OR user_id = ${userEmail}
           OR user_id = ${rawTg}
           OR user_id = ${tgId}
      `;
      const total = countRes && countRes.length > 0 ? Number(countRes[0].count) : 0;

      // Paginated items query sorted by created_at DESC
      const rows = await sql`
        SELECT * FROM extracted_events
        WHERE user_id = ${userId}
           OR user_id = ${userEmail}
           OR user_id = ${rawTg}
           OR user_id = ${tgId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      return {
        events: rows as ExtractedEventRecord[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      };
    } catch (err) {
      console.error('Neon DB getUserExtractedEvents error:', err);
    }
  }

  // Fallback to local
  const local = getLocalEvents();
  const filtered = local.filter(
    e => e.user_id === userId || e.user_id === userEmail || (rawTg && (e.user_id === rawTg || e.user_id === tgId))
  );
  const total = filtered.length;
  const sliced = filtered.slice(offset, offset + limit);

  return {
    events: sliced,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  };
}

/**
 * Deletes an extracted event record
 */
export async function deleteExtractedEvent(params: {
  userId: string;
  email?: string;
  eventId: string;
}): Promise<boolean> {
  const dbUrl = getDatabaseUrl();
  const userId = params.userId;
  const userEmail = params.email || params.userId;

  if (dbUrl) {
    try {
      await initDatabase();
      const sql = neon(dbUrl);
      await sql`
        DELETE FROM extracted_events
        WHERE id = ${params.eventId}
          AND (user_id = ${userId} OR user_id = ${userEmail})
      `;
      return true;
    } catch (err) {
      console.error('Neon DB deleteExtractedEvent error:', err);
    }
  }

  // Fallback local
  const local = getLocalEvents();
  const updated = local.filter(
    e => !(e.id === params.eventId && (e.user_id === userId || e.user_id === userEmail))
  );
  saveLocalEvents(updated);
  return true;
}

