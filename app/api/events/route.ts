import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, getUserExtractedEvents, deleteExtractedEvent } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '5', 10);

  let user = await getUserById(session.userId);
  if (!user && session.email) user = await getUserByEmail(session.email);

  const result = await getUserExtractedEvents({
    userId: session.userId,
    email: session.email,
    telegramChatId: user?.telegram_chat_id,
    page,
    limit
  });

  return NextResponse.json({
    success: true,
    ...result
  });
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

  const success = await deleteExtractedEvent({
    userId: session.userId,
    email: session.email,
    eventId
  });

  return NextResponse.json({ success });
}
