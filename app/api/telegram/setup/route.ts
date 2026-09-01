import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { botToken, webhookUrl, action } = body;

    if (!botToken) {
      return NextResponse.json({ ok: false, error: 'Bot Token wajib diisi.' }, { status: 400 });
    }

    if (action === 'get_me') {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === 'get_webhook_info') {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === 'set_webhook') {
      if (!webhookUrl) {
        return NextResponse.json({ ok: false, error: 'Webhook URL wajib diisi.' }, { status: 400 });
      }

      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&allowed_updates=["message","edited_message"]`
      );
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === 'delete_webhook') {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenali.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
