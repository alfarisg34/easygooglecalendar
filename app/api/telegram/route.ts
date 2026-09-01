import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramWebhook } from '@/lib/telegram-handler';
import { TelegramUpdate } from '@/lib/types';
import { getEffectiveOrigin } from '@/lib/google-auth';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const botToken = searchParams.get('bot_token') || searchParams.get('token') || process.env.TELEGRAM_BOT_TOKEN;
    const geminiKey = searchParams.get('gemini_key') || searchParams.get('key') || process.env.GEMINI_API_KEY;

    if (!botToken) {
      // Always return 200 to Telegram so it doesn't repeatedly retry failing webhooks
      return NextResponse.json({
        ok: false,
        error: 'Parameter bot_token diperlukan di URL webhook (?bot_token=...)'
      });
    }

    const update: TelegramUpdate = await req.json();
    const origin = getEffectiveOrigin(req);

    // Process update asynchronously (Multi-User Aware)
    await handleTelegramWebhook(update, botToken, geminiKey || '', origin);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Telegram Webhook error:', err);
    return NextResponse.json({ ok: false, error: err.message });
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'online',
    service: 'EasyGoogleCalendar Telegram Bot Webhook Endpoint',
    instruction: 'Set your Telegram webhook to POST https://<your-domain>/api/telegram?bot_token=YOUR_BOT_TOKEN'
  });
}
