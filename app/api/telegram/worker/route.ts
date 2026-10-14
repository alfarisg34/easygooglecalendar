import { NextRequest,NextResponse } from 'next/server';
import { drainTelegramQueue } from '@/lib/telegram-queue';
import { safeEqual } from '@/lib/telegram-security';
export const maxDuration=60;
export async function GET(req:NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret || !safeEqual(req.headers.get('authorization')||'',`Bearer ${secret}`))return NextResponse.json({ok:false},{status:403});
  try{return NextResponse.json({ok:true,processed:await drainTelegramQueue()});}
  catch{return NextResponse.json({ok:false},{status:503});}
}
export const POST=GET;
