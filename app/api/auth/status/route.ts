import { NextRequest, NextResponse } from 'next/server';
import { getUserGoogleAuth, deleteUserGoogleAuth } from '@/lib/token-store';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id') || 'web_anonymous';

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
  const userId = searchParams.get('user_id') || 'web_anonymous';

  await deleteUserGoogleAuth(userId);

  return NextResponse.json({
    success: true,
    message: 'Koneksi Google Calendar berhasil diputus.'
  });
}
