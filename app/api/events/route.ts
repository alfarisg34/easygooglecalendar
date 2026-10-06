import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, getUserExtractedEvents, deleteExtractedEvent } from '@/lib/db';
import { changeEventLifecycle } from '@/lib/event-lifecycle';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '5', 10);
  const status = searchParams.get('status');

  let user = await getUserById(session.userId);
  if (!user && session.email) user = await getUserByEmail(session.email);

  const result = await getUserExtractedEvents({
    userId: session.userId,
    email: session.email,
    telegramChatId: user?.telegram_chat_id,
    page,
    limit,
    status: status === 'active' || status === 'cancelled' ? status : 'all',
    search: (searchParams.get('search') || '').slice(0, 200)
  });

  return NextResponse.json({
    success: true,
    ...result
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) {
    return NextResponse.json({ error: 'Origin tidak valid.' }, { status: 403 });
  }
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string'
      || !('action' in body) || !['cancel', 'restore', 'retry'].includes(String(body.action))
      || !('version' in body) || typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0
      || ('reason' in body && typeof body.reason !== 'string')) {
      return NextResponse.json({ error: 'Parameter pembatalan tidak valid.' }, { status: 400 });
    }
    const user = await getUserById(session.userId) || await getUserByEmail(session.email);
    const result = await changeEventLifecycle({
      owner: { userId: session.userId, email: session.email, telegramChatId: user?.telegram_chat_id },
      eventId: body.id, action: body.action as 'cancel' | 'restore' | 'retry', expectedVersion: body.version,
      reason: 'reason' in body ? body.reason as string : '', channel: 'web', calendarId: user?.calendar_id
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Kegiatan belum dapat diperbarui.' }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get('id');

  if (!eventId) {
    return NextResponse.json({ error: 'Parameter id diperlukan' }, { status: 400 });
  }

  let user = await getUserById(session.userId);
  if (!user && session.email) user = await getUserByEmail(session.email);

  const success = await deleteExtractedEvent({
    userId: session.userId,
    email: session.email,
    telegramChatId: user?.telegram_chat_id,
    eventId
  });

  return NextResponse.json({ success });
}
