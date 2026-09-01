import { NextRequest, NextResponse } from 'next/server';
import { getUserGoogleAuth, deleteUserGoogleAuth } from '@/lib/token-store';
import { getSessionFromRequest } from '@/lib/auth-session';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const session = await getSessionFromRequest(req);
  const userId = searchParams.get('user_id') || session?.userId || session?.email || 'web_user';

  const auth = await getUserGoogleAuth(userId);

  if (auth && auth.refreshToken) {
    return NextResponse.json({
      connected: true,
      email: auth.email,
      name: auth.name,
      picture: auth.picture,
      updatedAt: auth.updatedAt
    });
  }

  return NextResponse.json({
    connected: false
  });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const session = await getSessionFromRequest(req);
  const userId = searchParams.get('user_id') || session?.userId || session?.email || 'web_user';

  await deleteUserGoogleAuth(userId);

  return NextResponse.json({
    success: true,
    message: 'Koneksi Google Calendar berhasil diputus.'
  });
}
