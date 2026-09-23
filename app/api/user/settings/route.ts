import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth-session';
import { getUserById, getUserByEmail, updateUserSettings } from '@/lib/db';
import { parseGoogleDriveFolderId } from '@/lib/google-drive-api';

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
      gdriveRootFolderId: user.gdrive_root_folder_id || '',
      gdriveRootFolderUrl: user.gdrive_root_folder_url || '',
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
      gdriveRootFolderUrl,
      telegramBotToken,
      telegramChatId
    } = body;

    let parsedDriveId = undefined;
    let cleanDriveUrl = undefined;
    if (gdriveRootFolderUrl !== undefined) {
      const rawUrl = String(gdriveRootFolderUrl).trim();
      parsedDriveId = parseGoogleDriveFolderId(rawUrl) || rawUrl;
      cleanDriveUrl = parsedDriveId ? `https://drive.google.com/drive/folders/${parsedDriveId}` : rawUrl;
    }

    const updatedUser = await updateUserSettings(session.userId, {
      phone_number: typeof phoneNumber === 'string' && phoneNumber.trim() !== '' ? phoneNumber.trim() : undefined,
      gemini_api_key: typeof geminiApiKey === 'string' && geminiApiKey.trim() !== '' ? geminiApiKey.replace(/^["']|["']$/g, '').trim() : undefined,
      model_name: modelName,
      ocr_engine: ocrEngine,
      ocr_service_url: ocrServiceUrl,
      calendar_id: typeof calendarId === 'string' && calendarId.trim() !== '' ? calendarId.trim() : undefined,
      gdrive_root_folder_id: parsedDriveId,
      gdrive_root_folder_url: cleanDriveUrl,
      telegram_bot_token: typeof telegramBotToken === 'string' && telegramBotToken.trim() !== '' ? telegramBotToken.trim() : undefined,
      telegram_chat_id: typeof telegramChatId === 'string' && telegramChatId.trim() !== '' ? telegramChatId.trim() : undefined
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
        gdriveRootFolderId: updatedUser.gdrive_root_folder_id || '',
        gdriveRootFolderUrl: updatedUser.gdrive_root_folder_url || '',
        telegramBotToken: updatedUser.telegram_bot_token || '',
        telegramChatId: updatedUser.telegram_chat_id || ''
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Gagal menyimpan: ${err.message}` }, { status: 500 });
  }
}
