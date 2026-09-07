import { google } from 'googleapis';
import { Readable } from 'stream';
import { CalendarEvent } from './types';
import { getGoogleOAuth2Client } from './google-auth';
import { getUserGoogleAuth, saveUserGoogleAuth } from './token-store';
import { DateTime } from 'luxon';

/**
 * Extracts a Google Drive folder ID from a full sharing URL or returns the raw ID
 * Examples:
 * - https://drive.google.com/drive/folders/1aBcD-efGhIjKlMnOpQrStUvWxYz?usp=sharing -> 1aBcD-efGhIjKlMnOpQrStUvWxYz
 * - https://drive.google.com/drive/u/1/folders/1aBcD-efGhIjKlMnOpQrStUvWxYz -> 1aBcD-efGhIjKlMnOpQrStUvWxYz
 * - 1aBcD-efGhIjKlMnOpQrStUvWxYz -> 1aBcD-efGhIjKlMnOpQrStUvWxYz
 */
export function parseGoogleDriveFolderId(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Match folder ID in URL
  const match = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return match[1];
  }

  // If it's already an ID (alphanumeric, dashes, underscores, typically 20-40 chars)
  if (/^[a-zA-Z0-9_-]{15,60}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Builds standard folder name: "YYYY-MM-DD - {Judul Kegiatan}"
 * Chronologically sortable in Google Drive and easy to match with photos.
 */
export function buildEventFolderName(event: CalendarEvent): string {
  const dt = DateTime.fromISO(event.start_time).setZone('Asia/Jakarta');
  const datePrefix = dt.isValid ? dt.toFormat('yyyy-MM-dd') : 'Agenda';
  
  // Clean illegal characters for folder names
  const cleanTitle = (event.title || 'Kegiatan')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);

  return `${datePrefix} - ${cleanTitle}`;
}

/**
 * Authenticates with Google Drive API using stored user tokens
 */
async function getDriveClient(userId: string | number) {
  const userAuth = await getUserGoogleAuth(userId);
  if (!userAuth || !userAuth.refreshToken) {
    throw new Error('Akun Google belum terhubung atau tidak memiliki izin akses.');
  }

  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: userAuth.refreshToken,
    access_token: userAuth.accessToken,
    expiry_date: userAuth.expiryDate
  });

  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      userAuth.accessToken = newTokens.access_token;
      if (newTokens.refresh_token) userAuth.refreshToken = newTokens.refresh_token;
      if (newTokens.expiry_date) userAuth.expiryDate = newTokens.expiry_date;
      userAuth.updatedAt = new Date().toISOString();
      await saveUserGoogleAuth(userAuth);
    }
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Creates a new folder in Google Drive under a parent folder
 */
export async function createDriveFolder(params: {
  userId: string | number;
  folderName: string;
  parentFolderId?: string;
}): Promise<{
  success: boolean;
  folderId?: string;
  folderUrl?: string;
  error?: string;
}> {
  try {
    const drive = await getDriveClient(params.userId);
    const parentId = parseGoogleDriveFolderId(params.parentFolderId);

    const fileMetadata: any = {
      name: params.folderName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    if (parentId) {
      fileMetadata.parents = [parentId];
    }

    let res;
    try {
      res = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, webViewLink',
        supportsAllDrives: true
      });
    } catch (parentErr: any) {
      if (parentErr.message?.includes('insufficient') || parentErr.message?.includes('scope')) {
        throw parentErr;
      }
      // If creating inside specified parent folder failed (e.g. parent folder deleted or unshared),
      // fallback to creating folder at user's root Drive!
      console.warn(`Drive create in parent ${parentId} failed: ${parentErr.message}. Retrying at root...`);
      delete fileMetadata.parents;
      res = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, webViewLink',
        supportsAllDrives: true
      });
    }

    const folderId = res.data.id || undefined;
    const folderUrl = res.data.webViewLink || (folderId ? `https://drive.google.com/drive/folders/${folderId}` : undefined);

    return {
      success: true,
      folderId,
      folderUrl
    };
  } catch (err: any) {
    console.error('Failed to create Google Drive folder:', err);
    let errorMsg = `Gagal membuat folder Google Drive: ${err.message}`;
    if (err.message?.includes('insufficient') || err.message?.includes('scope') || err.status === 403) {
      errorMsg = 'Izin Google Drive belum disetujui pada akun Google Anda. Silakan lakukan Login Ulang dengan Google untuk menyetujui izin akses Google Drive.';
    }
    return {
      success: false,
      error: errorMsg
    };
  }
}

/**
 * Uploads a file (Buffer) into a specific Google Drive folder
 */
export async function uploadFileToDrive(params: {
  userId: string | number;
  folderId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<{
  success: boolean;
  fileId?: string;
  fileUrl?: string;
  error?: string;
}> {
  try {
    const drive = await getDriveClient(params.userId);
    const readableStream = Readable.from(params.buffer);

    const res = await drive.files.create({
      requestBody: {
        name: params.fileName,
        parents: [params.folderId]
      },
      media: {
        mimeType: params.mimeType,
        body: readableStream
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true
    });

    const fileId = res.data.id || undefined;
    const fileUrl = res.data.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : undefined);

    return {
      success: true,
      fileId,
      fileUrl
    };
  } catch (err: any) {
    console.error('Failed to upload file to Google Drive:', err);
    let errorMsg = `Gagal mengunggah berkas ke Google Drive: ${err.message}`;
    if (err.message?.includes('insufficient') || err.message?.includes('scope') || err.status === 403) {
      errorMsg = 'Izin Google Drive belum disetujui pada akun Google Anda. Silakan lakukan Login Ulang dengan Google untuk menyetujui izin akses Google Drive.';
    }
    return {
      success: false,
      error: errorMsg
    };
  }
}

/**
 * Unified helper:
 * 1. Creates a dedicated folder for the event: "YYYY-MM-DD - {Judul}"
 * 2. Uploads the source file:
 *    - PDF -> Uploads original PDF
 *    - Image -> Uploads original JPG/PNG
 *    - Text -> Generates and uploads a formatted .txt file
 */
export async function createEventFolderAndUpload(params: {
  userId: string | number;
  event: CalendarEvent;
  parentFolderId?: string;
  fileData?: {
    buffer?: Buffer;
    base64Data?: string;
    textContent?: string;
    fileName?: string;
    mimeType?: string;
    sourceType: 'pdf' | 'image' | 'text';
  };
}): Promise<{
  success: boolean;
  folderId?: string;
  folderUrl?: string;
  fileId?: string;
  fileUrl?: string;
  error?: string;
}> {
  const folderName = buildEventFolderName(params.event);

  // 1. Create Google Drive folder
  const folderRes = await createDriveFolder({
    userId: params.userId,
    folderName,
    parentFolderId: params.parentFolderId
  });

  if (!folderRes.success || !folderRes.folderId) {
    return {
      success: false,
      error: folderRes.error || 'Gagal membuat folder Google Drive.'
    };
  }

  const folderId = folderRes.folderId;
  const folderUrl = folderRes.folderUrl;

  // 2. Upload file into the created folder if fileData is present
  let fileId: string | undefined;
  let fileUrl: string | undefined;

  if (params.fileData) {
    const { sourceType, fileName, mimeType, base64Data, textContent } = params.fileData;
    let uploadBuffer: Buffer | null = null;
    let targetFileName = fileName || 'dokumen';
    let targetMimeType = mimeType || 'application/octet-stream';

    if (sourceType === 'pdf' || sourceType === 'image') {
      if (params.fileData.buffer) {
        uploadBuffer = params.fileData.buffer;
      } else if (base64Data) {
        uploadBuffer = Buffer.from(base64Data, 'base64');
      }

      if (sourceType === 'pdf') {
        if (!targetFileName.toLowerCase().endsWith('.pdf')) targetFileName += '.pdf';
        targetMimeType = 'application/pdf';
      } else {
        if (!targetFileName.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)) targetFileName += '.jpg';
        targetMimeType = targetMimeType.includes('image') ? targetMimeType : 'image/jpeg';
      }
    } else if (sourceType === 'text' || textContent) {
      // For Text input: save as clean .txt file as requested by the user
      const startDt = DateTime.fromISO(params.event.start_time).setZone('Asia/Jakarta');
      const endDt = DateTime.fromISO(params.event.end_time).setZone('Asia/Jakarta');
      const startFmt = startDt.isValid ? startDt.toFormat('dd LLLL yyyy, HH:mm') : params.event.start_time;
      const endFmt = endDt.isValid ? endDt.toFormat('HH:mm') : params.event.end_time;

      const txtContent = 
`=======================================================
RINGKASAN AGENDA KEGIATAN (EASYCAL)
=======================================================
Agenda     : ${params.event.title}
Waktu      : ${startFmt} s.d. ${endFmt} WIB
Lokasi     : ${params.event.location || '-'}
Meeting ID : ${params.event.meeting_id_pass || '-'}
Link Meet  : ${params.event.meeting_link || '-'}
Bobot JP   : ${params.event.jp || '-'}
Narasumber : ${params.event.speakers || '-'}

Deskripsi  :
${params.event.description || '-'}

=======================================================
SALINAN TEKS / PESAN UNDANGAN ASLI:
=======================================================
${textContent || params.event.description || ''}
`;
      uploadBuffer = Buffer.from(txtContent, 'utf8');
      targetFileName = 'salinan_undangan.txt';
      targetMimeType = 'text/plain; charset=utf-8';
    }

    if (uploadBuffer) {
      const uploadRes = await uploadFileToDrive({
        userId: params.userId,
        folderId,
        buffer: uploadBuffer,
        fileName: targetFileName,
        mimeType: targetMimeType
      });

      if (uploadRes.success) {
        fileId = uploadRes.fileId;
        fileUrl = uploadRes.fileUrl;
      }
    }
  }

  return {
    success: true,
    folderId,
    folderUrl,
    fileId,
    fileUrl
  };
}
