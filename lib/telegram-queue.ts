import { randomUUID } from 'crypto';
import { BotState, botIdentity, cleanBotStates, dueBotStates, readBotState, writeBotState } from './telegram-state';
import { TelegramUpdate } from './types';
import { telegramContext } from './telegram-context';

export interface TelegramJob {
  botToken:string; origin:string; updates:TelegramUpdate[]; status:'pending'|'processing'|'done'|'failed';
  attempts:number; leaseUntil:number; lastError?:string; receivedAt:number;
}
export const messageOf = (update:TelegramUpdate) => update.callback_query?.message || update.message;
export async function consumeQuota(botToken:string,userId:number):Promise<boolean> {
  const hour = Math.floor(Date.now()/3600000);
  const id = `quota:${botIdentity(botToken)}:${userId}:${hour}`;
  const max = Math.max(1,Number(process.env.TELEGRAM_HOURLY_LIMIT)||60);
  for(let i=0;i<8;i++) {
    const row=await readBotState<{count:number}>(id);
    const count=row?.value.count||0;
    if(count>=max)return false;
    if(await writeBotState(id,'quota',{count:count+1},row?.version||0,Date.now(),(hour+2)*3600000))return true;
  }
  return false;
}
async function admitJob(id:string,botToken:string,userId:number):Promise<boolean> {
  const key=`admission:${id}`;
  for(let i=0;i<10;i++) {
    const row=await readBotState<{allowed?:boolean;leaseUntil:number}>(key);
    if(typeof row?.value.allowed==='boolean')return row.value.allowed;
    if(row && row.value.leaseUntil>Date.now()) {await new Promise(resolve=>setTimeout(resolve,40));continue;}
    if(!await writeBotState(key,'admission',{leaseUntil:Date.now()+15000},row?.version||0,Date.now(),Date.now()+7*86400000))continue;
    const allowed=await consumeQuota(botToken,userId);
    await writeBotState(key,'admission',{allowed,leaseUntil:0},(row?.version||0)+1,Date.now(),Date.now()+7*86400000);
    return allowed;
  }
  throw new Error('Penerimaan pekerjaan masih diproses.');
}
export async function enqueueTelegramUpdate(update:TelegramUpdate,botToken:string,origin:string):Promise<'queued'|'duplicate'|'limited'> {
  const msg=messageOf(update);
  const album=update.message?.media_group_id;
  const freeCommand=Boolean(update.callback_query) || /^\/(?:status|help|connect|login|auth|start|disconnect|agenda|dibatalkan|cari|lampau|hariini|besok|minggu|gdrive|apikey|tutorial)(?:\s|$)/i.test(msg?.text||'');
  const id=`job:${botIdentity(botToken)}:${album ? `album:${msg?.chat.id}:${album}` : update.update_id}`;
  for(let i=0;i<10;i++) {
    const row=await readBotState<TelegramJob>(id);
    if(row?.value.updates.some(item=>item.update_id===update.update_id))return 'duplicate';
    if(row && row.value.status!=='pending') {
      // Late album members remain a new job, rather than being silently discarded.
      return enqueueTelegramUpdate({...update,message:update.message?{...update.message,media_group_id:undefined}:undefined},botToken,origin);
    }
    if(!row && !freeCommand && !await admitJob(id,botToken,update.callback_query?.from.id||msg?.from.id||0))return 'limited';
    const value:TelegramJob=row?.value || {botToken,origin,updates:[],status:'pending',attempts:0,leaseUntil:0,receivedAt:Date.now()};
    value.updates=[...value.updates,update].slice(0,10);
    if(await writeBotState(id,'job',value,row?.version||0,Date.now()+(album?4000:0),Date.now()+7*86400000))return 'queued';
  }
  throw new Error('Antrean sibuk.');
}
async function processJob(row:BotState<TelegramJob>):Promise<boolean> {
  const now=Date.now(); const job=row.value;
  if(job.status==='done'||job.status==='failed'||job.leaseUntil>now)return false;
  const chat=messageOf(job.updates[0])?.chat.id;
  const actor=job.updates[0].callback_query?.from.id||messageOf(job.updates[0])?.from.id;
  const lastId=`last-job:${botIdentity(job.botToken)}:${actor}`;
  const report=async(status:string,attempts:number)=>{
    if(messageOf(job.updates[0])?.text==='/status')return;
    const previous=await readBotState<{status:string;attempts:number}>(lastId);
    await writeBotState(lastId,'status',{status,attempts},previous?.version||0,Date.now(),Date.now()+7*86400000);
  };
  const lockId=`chat-lock:${botIdentity(job.botToken)}:${chat}`;
  const oldLock=await readBotState<{leaseUntil:number;owner:string}>(lockId);
  if(oldLock && oldLock.value.leaseUntil>now)return false;
  const owner=randomUUID();
  if(!await writeBotState(lockId,'lock',{leaseUntil:now+300000,owner},oldLock?.version||0,now,now+86400000))return false;
  try {
    if(job.attempts>=3) {
      if(await writeBotState(row.id,'job',{...job,status:'failed',leaseUntil:0,lastError:'Batas percobaan pekerjaan terputus tercapai.'},row.version,Number.MAX_SAFE_INTEGER,row.expires)) {
        await report('Terputus setelah batas percobaan',job.attempts);
        const {sendTelegramMessage}=await import('./telegram-handler');
        if(chat)await sendTelegramMessage({botToken:job.botToken,chatId:chat,text:'Pekerjaan terputus setelah batas 3 percobaan. Periksa /status sebelum mengirim ulang sumber.'});
      }
      return true;
    }
    const claimed={...job,status:'processing' as const,attempts:job.attempts+1,leaseUntil:now+300000};
    if(!await writeBotState(row.id,'job',claimed,row.version,claimed.leaseUntil,row.expires))return false;
    await report('Sedang diproses',claimed.attempts);
    try {
      const {handleTelegramWebhook,sendTelegramMessage}=await import('./telegram-handler');
      const {handleDocumentationAlbum}=await import('./telegram-workflows');
      const context={operationId:row.id,album:job.updates.length>1,notices:[] as string[],retryableFailure:false,attempt:claimed.attempts,managedRetry:true};
      await telegramContext.run(context,async()=>{
        if(job.updates.length>1 && !job.updates.some(u=>/#poster|#agenda|#jadwal|#kalender|#flyer/i.test(u.message?.caption||''))) {
          await handleDocumentationAlbum(job.updates,job.botToken,job.origin);
        } else {
          for(const update of job.updates) {
            const child={...context,operationId:`${row.id}:${update.update_id}`};
            await telegramContext.run(child,()=>handleTelegramWebhook(update,job.botToken,'',job.origin));
            if(child.retryableFailure)context.retryableFailure=true;
          }
        }
      });
      if(context.retryableFailure)throw new Error('Layanan sementara tidak tersedia.');
      await writeBotState(row.id,'job',{...claimed,status:'done',leaseUntil:0},row.version+1,Number.MAX_SAFE_INTEGER,row.expires);
      await report('Pemrosesan selesai; lihat hasil pada pesan bot',claimed.attempts);
    } catch {
      const failed=claimed.attempts>=3;
      await writeBotState(row.id,'job',{...claimed,status:failed?'failed':'pending',leaseUntil:0,lastError:'Pemrosesan terputus; periksa status layanan.'},row.version+1,
        failed?Number.MAX_SAFE_INTEGER:Date.now()+30000*claimed.attempts,row.expires);
      await report(failed?'Gagal setelah batas percobaan':'Menunggu percobaan ulang',claimed.attempts);
      if(failed) {
        const {sendTelegramMessage}=await import('./telegram-handler');
        if(chat)await sendTelegramMessage({botToken:job.botToken,chatId:chat,text:'Pekerjaan belum selesai setelah 3 percobaan. Ketik /status untuk memeriksa koneksi. Berkas tidak perlu dikirim berulang kali sebelum status diperiksa.'});
      }
    }
    return true;
  } finally {
    const current=await readBotState<{leaseUntil:number;owner:string}>(lockId);
    if(current?.value.owner===owner)await writeBotState(lockId,'lock',{leaseUntil:0,owner},current.version,now,current.expires);
  }
}
export async function drainTelegramQueue():Promise<number> {
  await cleanBotStates();
  const rows=await dueBotStates<TelegramJob>('job',30);
  for(const row of rows)if(await processJob(row))return 1;
  return 0;
}
