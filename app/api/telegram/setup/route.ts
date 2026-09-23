import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveOrigin } from '@/lib/google-auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { botToken, webhookUrl, action } = body;
    const effectiveToken = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();

    if (!effectiveToken) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Bot Token wajib diisi atau dikonfigurasi di Environment Variable (TELEGRAM_BOT_TOKEN).' 
      }, { status: 400 });
    }

    if (action === 'get_me') {
      const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/getMe`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === 'get_webhook_info') {
      const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/getWebhookInfo`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === 'set_webhook') {
      const origin = getEffectiveOrigin(req);
      const targetWebhookUrl = webhookUrl || `${origin}/api/telegram?bot_token=${encodeURIComponent(effectiveToken)}${process.env.GEMINI_API_KEY ? `&gemini_key=${encodeURIComponent(process.env.GEMINI_API_KEY)}` : ''}`;

      const res = await fetch(
        `https://api.telegram.org/bot${effectiveToken}/setWebhook?url=${encodeURIComponent(targetWebhookUrl)}&allowed_updates=["message","edited_message"]`
      );
      const data = await res.json();
      return NextResponse.json({
        ...data,
        configuredWebhookUrl: targetWebhookUrl
      });
    }

    if (action === 'delete_webhook') {
      const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/deleteWebhook`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenali.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const origin = getEffectiveOrigin(req);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'info';
    const effectiveToken = (searchParams.get('bot_token') || searchParams.get('token') || process.env.TELEGRAM_BOT_TOKEN || '').trim();

    if (!effectiveToken) {
      return NextResponse.json({ 
        ok: false, 
        error: 'TELEGRAM_BOT_TOKEN belum disetel di Vercel Environment Variables atau parameter bot_token.' 
      }, { status: 400 });
    }

    if (action === 'set' || action === 'sync') {
      const targetWebhookUrl = `${origin}/api/telegram?bot_token=${encodeURIComponent(effectiveToken)}${process.env.GEMINI_API_KEY ? `&gemini_key=${encodeURIComponent(process.env.GEMINI_API_KEY)}` : ''}`;
      const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/setWebhook?url=${encodeURIComponent(targetWebhookUrl)}&allowed_updates=["message","edited_message"]`);
      const data = await res.json();
      return NextResponse.json({
        ok: data.ok,
        message: data.ok ? 'Webhook Telegram berhasil disinkronkan ke domain aktif!' : data.description,
        configuredWebhookUrl: targetWebhookUrl,
        telegramResponse: data
      });
    }

    const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/getWebhookInfo`);
    const data = await res.json();
    return NextResponse.json({
      ...data,
      currentOrigin: origin
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
