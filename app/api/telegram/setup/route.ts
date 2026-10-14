import { NextRequest, NextResponse } from 'next/server';
import { authorizeBotSetup, registerBot, webhookSecret } from '@/lib/telegram-security';

async function telegram(token: string, method: string, body?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body || {}),signal:AbortSignal.timeout(10000) });
  return await response.json() as {ok:boolean;description?:string;result?:Record<string,unknown>};
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { botToken?:string; action?:string };
    const token = await authorizeBotSetup(req,body.botToken?.trim());
    if (!token) return NextResponse.json({ok:false,error:'Login sebagai pemilik bot tersimpan atau admin yang diizinkan.'},{status:403});
    if (body.action === 'set_webhook') {
      const id = await registerBot(token);
      const configuredWebhookUrl = `${new URL(req.url).origin}/api/telegram?bot=${id}`;
      const result = await telegram(token,'setWebhook',{url:configuredWebhookUrl,secret_token:webhookSecret(token),
        allowed_updates:['message','callback_query']});
      return NextResponse.json({...result,configuredWebhookUrl});
    }
    const method = ({get_me:'getMe',get_webhook_info:'getWebhookInfo',delete_webhook:'deleteWebhook'} as Record<string,string>)[body.action || ''];
    if (!method) return NextResponse.json({ok:false,error:'Aksi tidak dikenali.'},{status:400});
    const result = await telegram(token,method);
    if (method==='getWebhookInfo' && result.result?.url) {
      const url = new URL(String(result.result.url)); url.search=''; result.result.url=url.toString();
    }
    return NextResponse.json(result);
  } catch { return NextResponse.json({ok:false,error:'Pengaturan bot gagal. Periksa konfigurasi server.'},{status:503}); }
}
export async function GET(req:NextRequest) {
  const token = await authorizeBotSetup(req);
  if (!token) return NextResponse.json({ok:false,error:'Akses ditolak.'},{status:403});
  return NextResponse.json({ok:true,service:'EasyCal',instruction:'Gunakan POST untuk pengaturan webhook.'});
}
