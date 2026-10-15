import { createHash, randomBytes } from 'crypto';
import { readBotState, writeBotState } from './telegram-state';
import { safeEqual } from './telegram-security';

interface QueueWake {
  jobId: string; token: string; consumed: boolean; notBefore: number; validUntil: number; attempt: number; hops: number;
}
const wakeId = (jobId: string) => 'queue-wake:' + createHash('sha256').update(jobId).digest('hex');
const validJobId = (jobId: unknown): jobId is string => typeof jobId === 'string' && /^job:[a-f0-9]{24}:[\w:-]{1,180}$/.test(jobId);
const MAX_WAIT_MS = 10000;
const MAX_HOPS_PER_ATTEMPT = 40;

/** Capability is one-use, short-lived and scoped to an existing job; never sent in a URL. */
export async function scheduleTelegramQueueWake(jobId: string, due: number, attempt: number, resumeToken?: string): Promise<boolean> {
  if (!validJobId(jobId)) return false;
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) { console.warn('Telegram queue wake unavailable: NEXT_PUBLIC_APP_URL missing.'); return false; }
  let endpoint: URL;
  try {
    const app = new URL(configured);
    if (app.username || app.password || (app.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && app.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(app.hostname)))) return false;
    endpoint = new URL('/api/telegram/worker', app.origin);
  } catch { return false; }
  const id = wakeId(jobId);
  for (let race = 0; race < 4; race++) {
    const now = Date.now();
    const previous = await readBotState<QueueWake>(id);
    if (previous && previous.value.validUntil > now &&
      !(previous.value.consumed && resumeToken && safeEqual(previous.value.token, resumeToken))) return true;
    const hops = previous?.value.attempt === attempt ? previous.value.hops + 1 : 1;
    if (hops > MAX_HOPS_PER_ATTEMPT) { console.warn('Telegram queue wake limit reached; scheduler recovery required.'); return false; }
    const value: QueueWake = {jobId, token: randomBytes(32).toString('hex'), consumed: false,
      notBefore: now + Math.min(MAX_WAIT_MS, Math.max(0, due - now)), validUntil: now + 60000, attempt, hops};
    if (!await writeBotState(id, 'queue-wake', value, previous?.version || 0, now, now + 7 * 86400000)) continue;
    for (let send = 0; send < 2; send++) {
      try {
        const response = await fetch(endpoint, {method:'POST', redirect:'error', headers:{'content-type':'application/json'},
          body:JSON.stringify({jobId, wakeToken:value.token}), signal:AbortSignal.timeout(5000)});
        if (response.status === 202) return true;
      } catch { /* Keep capability/job durable; retry the same token on an ambiguous response. */ }
    }
    console.warn('Telegram queue handoff failed; scheduler recovery required.');
    // Reopen an unconsumed wake immediately, rather than suppressing another valid trigger for a minute.
    const latest = await readBotState<QueueWake>(id);
    if (latest && !latest.value.consumed && safeEqual(latest.value.token, value.token))
      await writeBotState(id, 'queue-wake', {...latest.value,validUntil:0}, latest.version, now, latest.expires);
    return false;
  }
  return false;
}

export async function consumeTelegramQueueWake(body: unknown): Promise<{jobId:string;delayMs:number;duplicate:boolean;token:string} | null> {
  if (!body || typeof body !== 'object') return null;
  const {jobId, wakeToken} = body as Record<string,unknown>;
  if (!validJobId(jobId) || typeof wakeToken !== 'string' || !/^[a-f0-9]{64}$/.test(wakeToken)) return null;
  const row = await readBotState<QueueWake>(wakeId(jobId));
  if (!row || row.value.jobId !== jobId || row.value.validUntil <= Date.now() || !safeEqual(row.value.token, wakeToken)) return null;
  if (row.value.consumed) return {jobId, delayMs:0, duplicate:true,token:wakeToken};
  if (!await writeBotState(row.id,row.kind,{...row.value,consumed:true},row.version,Date.now(),row.expires))
    return {jobId,delayMs:0,duplicate:true,token:wakeToken};
  return {jobId,delayMs:Math.min(MAX_WAIT_MS,Math.max(0,row.value.notBefore-Date.now())),duplicate:false,token:wakeToken};
}
