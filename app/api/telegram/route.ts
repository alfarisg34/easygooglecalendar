import { NextRequest,NextResponse } from 'next/server';
import { telegramWebhook } from '@/lib/telegram-webhook';
export const maxDuration=60;
export const POST=telegramWebhook;
export async function GET(_req:NextRequest) {return NextResponse.json({status:'online',service:'EasyCal Telegram'});}
