import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth-session';

export async function POST(req: NextRequest) {
  const response = NextResponse.json({
    success: true,
    message: 'Berhasil keluar dari akun.'
  });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    expires: new Date(0),
    path: '/'
  });

  return response;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const response = NextResponse.redirect(`${origin}/`);

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    expires: new Date(0),
    path: '/'
  });

  return response;
}
