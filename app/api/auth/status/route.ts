import { NextRequest, NextResponse } from 'next/server';
import { getUserGoogleAuth, deleteUserGoogleAuth } from '@/lib/token-store';
import { getSessionFromRequest } from '@/lib/auth-session';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const session = await getSessionFromRequest(req);
  if(!session)return NextResponse.json({connected:false});
  const userId = session.userId;

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
  if(!session)return NextResponse.json({success:false,error:'Unauthorized'},{status:401});
  if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({success:false,error:'Origin ditolak.'},{status:403});
  const userId = session.userId;

  await deleteUserGoogleAuth(userId);

  return NextResponse.json({
    success: true,
    message: 'Koneksi Google Calendar berhasil diputus.'
  });
}
