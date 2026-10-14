import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth-session';
import { getUserById } from './db';
import { readBotState, writeBotState, botIdentity } from './telegram-state';

export function signingSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET wajib dikonfigurasi.');
  return secret || 'easycal-local-development-only';
}
export function safeEqual(a: string, b: string): boolean {
  const first = Buffer.from(a); const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first,second);
}
export const webhookSecret = (token: string) => createHmac('sha256', signingSecret()).update(`webhook:${token}`).digest('hex');
export const isConfiguredAdmin = (email: string) => (process.env.TELEGRAM_ADMIN_EMAILS || '').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
export async function authorizeBotSetup(req: NextRequest, requestedToken?: string): Promise<string | null> {
  const session = await getSessionFromRequest(req);
  if (!session || (req.method !== 'GET' && req.headers.get('origin') !== new URL(req.url).origin)) return null;
  const user = await getUserById(session.userId);
  if (isConfiguredAdmin(session.email)) return requestedToken || process.env.TELEGRAM_BOT_TOKEN || user?.telegram_bot_token || null;
  // A personal bot is usable only when it is already stored in the signed-in owner's settings.
  const owned = user?.telegram_bot_token;
  return owned && (!requestedToken || safeEqual(owned, requestedToken)) ? owned : null;
}
interface Binding { telegramId: string; consumed: boolean }
export async function createTelegramBinding(telegramId: number): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await writeBotState(`binding:${token}`, 'binding', { telegramId: String(telegramId), consumed: false }, 0, Date.now(), Date.now()+10*60000);
  return token;
}
export async function consumeTelegramBinding(token: string): Promise<string | null> {
  const state = await readBotState<Binding>(`binding:${token}`);
  if (!state || state.value.consumed) return null;
  return await writeBotState(state.id,state.kind,{...state.value,consumed:true},state.version,Date.now(),state.expires) ? state.value.telegramId : null;
}
export async function createOAuthState(binding: string | null): Promise<{ state: string; cookie: string }> {
  const nonce = randomBytes(24).toString('hex');
  await writeBotState(`oauth:${nonce}`, 'oauth', { binding, consumed:false }, 0, Date.now(), Date.now()+10*60000);
  return { state: nonce, cookie: nonce };
}
export async function consumeOAuthState(state: string, cookie: string): Promise<{ binding: string | null } | null> {
  if (!state || !safeEqual(state,cookie)) return null;
  const row = await readBotState<{binding:string|null;consumed:boolean}>(`oauth:${state}`);
  if (!row || row.value.consumed) return null;
  return await writeBotState(row.id,row.kind,{...row.value,consumed:true},row.version,Date.now(),row.expires) ? { binding:row.value.binding } : null;
}
export async function registerBot(token: string): Promise<string> {
  const id = botIdentity(token);
  const row = await readBotState<{ token:string }>(`bot:${id}`);
  await writeBotState(`bot:${id}`,'bot',{token},row?.version || 0,Date.now(),Date.now()+3650*86400000);
  return id;
}
