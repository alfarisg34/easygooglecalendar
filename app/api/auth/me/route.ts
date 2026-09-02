import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, getDbStatus } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const dbStatus = await getDbStatus();

    if (!session) {
      return NextResponse.json({
        authenticated: false,
        dbStatus
      });
    }

    // Fetch full user profile & settings from Neon DB
    let user = await getUserById(session.userId);
    if (!user && session.email) {
      user = await getUserByEmail(session.email);
    }

    if (!user) {
      return NextResponse.json({
        authenticated: false,
        dbStatus
      });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        hasGoogleCalendar: Boolean(user.google_refresh_token),
        settings: {
          phoneNumber: user.phone_number || '',
          geminiApiKey: user.gemini_api_key || '',
          modelName: user.model_name === 'gemini-3.6-flash' ? 'gemini-2.0-flash' : (user.model_name || 'gemini-2.0-flash'),
          ocrEngine: user.ocr_engine || 'gemini',
          ocrServiceUrl: user.ocr_service_url || '',
          calendarId: user.calendar_id || 'primary',
          telegramBotToken: user.telegram_bot_token || '',
          telegramChatId: user.telegram_chat_id || ''
        },
        createdAt: user.created_at,
        updatedAt: user.updated_at
      },
      dbStatus
    });
  } catch (err: any) {
    console.error('Error fetching session in /api/auth/me:', err);
    return NextResponse.json({
      authenticated: false,
      error: err.message
    }, { status: 500 });
  }
}
