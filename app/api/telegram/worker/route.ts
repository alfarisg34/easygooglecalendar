import { after, NextRequest, NextResponse } from 'next/server';
import { continueTelegramJob, drainTelegramQueue } from '@/lib/telegram-queue';
import { consumeTelegramQueueWake } from '@/lib/telegram-queue-wake';
import { safeEqual } from '@/lib/telegram-security';
export const maxDuration=60;

// Existing external scheduler contract remains synchronous and CRON_SECRET protected.
export async function GET(req:NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret || !safeEqual(req.headers.get('authorization')||'',`Bearer ${secret}`))return NextResponse.json({ok:false},{status:403});
  try{return NextResponse.json({ok:true,processed:await drainTelegramQueue()});}
  catch{return NextResponse.json({ok:false},{status:503});}
}
export async function POST(req:NextRequest) {
  if(req.headers.get('authorization'))return GET(req);
  try {
    const text=await req.text();
    if(Buffer.byteLength(text)>2048)return NextResponse.json({ok:false},{status:413});
    let body: unknown;
    try { body=JSON.parse(text); } catch { return NextResponse.json({ok:false},{status:400}); }
    const wake=await consumeTelegramQueueWake(body);
    if(!wake)return NextResponse.json({ok:false},{status:403});
    if(!wake.duplicate)after(async()=>{
      if(wake.delayMs>0) {
        await new Promise(resolve=>setTimeout(resolve,wake.delayMs));
        // Waiting and AI processing use separate invocations, preserving the 60-second budget.
        await continueTelegramJob(wake.jobId,wake.token);
      } else await drainTelegramQueue(wake.jobId,wake.token);
    });
    return NextResponse.json({ok:true},{status:202});
  } catch {return NextResponse.json({ok:false},{status:503});}
}
