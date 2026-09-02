import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, updateUserSettings } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized. Silakan login terlebih dahulu.' }, { status: 401 });
  }

  let user = await getUserById(session.userId);
  if (!user && session.email) user = await getUserByEmail(session.email);

  if (!user) {
    return NextResponse.json({ error: 'User tidak ditemukan.' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    settings: {
      phoneNumber: user.phone_number || '',
      geminiApiKey: user.gemini_api_key || '',
      modelName: user.model_name || 'gemini-3.6-flash',
      ocrEngine: user.ocr_engine || 'gemini',
      ocrServiceUrl: user.ocr_service_url || '',
      calendarId: user.calendar_id || 'primary',
      telegramBotToken: user.telegram_bot_token || '',
      telegramChatId: user.telegram_chat_id || ''
    }
  });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized. Silakan login terlebih dahulu.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      phoneNumber,
      geminiApiKey,
      modelName,
      ocrEngine,
      ocrServiceUrl,
      calendarId,
      telegramBotToken,
      telegramChatId
    } = body;

    const updatedUser = await updateUserSettings(session.userId, {
      phone_number: typeof phoneNumber === 'string' ? phoneNumber.trim() : phoneNumber,
      gemini_api_key: typeof geminiApiKey === 'string' ? geminiApiKey.replace(/^["']|["']$/g, '').trim() : geminiApiKey,
      model_name: modelName,
      ocr_engine: ocrEngine,
      ocr_service_url: ocrServiceUrl,
      calendar_id: typeof calendarId === 'string' ? calendarId.trim() : calendarId,
      telegram_bot_token: typeof telegramBotToken === 'string' ? telegramBotToken.trim() : telegramBotToken,
      telegram_chat_id: typeof telegramChatId === 'string' ? telegramChatId.trim() : telegramChatId
    });

    if (!updatedUser) {
      return NextResponse.json({ error: 'Gagal memperbarui pengaturan user.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Pengaturan berhasil disimpan ke database Neon PostgreSQL!',
      settings: {
        phoneNumber: updatedUser.phone_number || '',
        geminiApiKey: updatedUser.gemini_api_key || '',
        modelName: updatedUser.model_name || 'gemini-3.6-flash',
        ocrEngine: updatedUser.ocr_engine || 'gemini',
        ocrServiceUrl: updatedUser.ocr_service_url || '',
        calendarId: updatedUser.calendar_id || 'primary',
        telegramBotToken: updatedUser.telegram_bot_token || '',
        telegramChatId: updatedUser.telegram_chat_id || ''
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Gagal menyimpan: ${err.message}` }, { status: 500 });
  }
}
