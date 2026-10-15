import { after, NextRequest, NextResponse } from 'next/server';
import { safeEqual, webhookSecret } from './telegram-security';
import { botIdentity, readBotState, writeBotState } from './telegram-state';
import { drainTelegramQueue, enqueueTelegramUpdate, telegramJobId } from './telegram-queue';
import { TelegramUpdate } from './types';

export async function telegramWebhook(req:NextRequest) {
  try {
    const id=new URL(req.url).searchParams.get('bot');
    const configured=process.env.TELEGRAM_BOT_TOKEN;
    const stored=id?await readBotState<{token:string}>(`bot:${id}`):null;
    const token=stored?.value.token || (!id || (configured && botIdentity(configured)===id) ? configured : undefined);
    if(!token || !safeEqual(req.headers.get('x-telegram-bot-api-secret-token')||'',webhookSecret(token)))return NextResponse.json({ok:false},{status:403});
    const raw=await req.text();
    if(Buffer.byteLength(raw)>128*1024)return NextResponse.json({ok:false},{status:413});
    const update=JSON.parse(raw) as TelegramUpdate;
    if(!Number.isSafeInteger(update.update_id) || (!update.message && !update.callback_query))return NextResponse.json({ok:true});
    const result=await enqueueTelegramUpdate(update,token,new URL(req.url).origin);
    if(result==='limited') {
      const msg=update.callback_query?.message||update.message;
      const notice=await writeBotState(`limit-notice:${botIdentity(token)}:${msg?.from.id}:${Math.floor(Date.now()/3600000)}`,'notice',{},0,Date.now(),Date.now()+7200000);
      if(notice)after(async()=>{const {sendTelegramMessage}=await import('./telegram-handler');
        const msg=update.callback_query?.message||update.message;
        if(msg)await sendTelegramMessage({botToken:token,chatId:msg.chat.id,text:'Batas pemrosesan per jam tercapai. Coba kembali pada jam berikutnya.'});});
    } else after(async()=>{
      await drainTelegramQueue(telegramJobId(update,token));
    });
    return NextResponse.json({ok:true});
  } catch { return NextResponse.json({ok:false,error:'Antrean belum tersedia. Telegram dapat mencoba kembali.'},{status:503}); }
}
