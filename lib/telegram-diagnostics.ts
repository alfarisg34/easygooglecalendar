import { google } from 'googleapis';
import { getGoogleOAuth2Client } from './google-auth';
import { getUserGoogleAuth, saveUserGoogleAuth } from './token-store';
import { updateUserGoogleTokens, getDbStatus } from './db';
import { isInvalidGoogleGrant } from './google-api-error';

/** Read-only probes run only on the user's explicit /status cek command. */
export async function telegramDiagnostics(userId:string,calendarId:string,apiKey:string):Promise<string> {
  const auth=await getUserGoogleAuth(userId);
  const oauth=getGoogleOAuth2Client();
  if(auth) {
    oauth.setCredentials({refresh_token:auth.refreshToken,access_token:auth.accessToken,expiry_date:auth.expiryDate});
    oauth.on('tokens',tokens=>{
      if(!tokens.access_token)return;
      void Promise.allSettled([saveUserGoogleAuth({...auth,accessToken:tokens.access_token,refreshToken:tokens.refresh_token||auth.refreshToken,expiryDate:tokens.expiry_date||auth.expiryDate,updatedAt:new Date().toISOString()}),
        updateUserGoogleTokens({userId,accessToken:tokens.access_token,refreshToken:tokens.refresh_token||undefined,expiryDate:tokens.expiry_date||undefined})]);
    });
  }
  const results=await Promise.allSettled([
    auth?.refreshToken?google.calendar({version:'v3',auth:oauth}).calendars.get({calendarId},{timeout:8000,retry:false}):Promise.reject(new Error('not_connected')),
    auth?.refreshToken?google.drive({version:'v3',auth:oauth}).about.get({fields:'user'},{timeout:8000,retry:false}):Promise.reject(new Error('not_connected')),
    apiKey?fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':apiKey},signal:AbortSignal.timeout(8000)}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return true;}):Promise.reject(new Error('no_key')),
    getDbStatus()
  ]);
  const label=(index:number)=>{
    const result=results[index];
    if(result.status==='fulfilled')return 'Dapat diakses';
    if(isInvalidGoogleGrant(result.reason))return 'Otorisasi kedaluwarsa/dicabut; gunakan /connect';
    return 'Belum dapat diakses; periksa izin, koneksi, atau kuota';
  };
  const database=results[3];
  return `Pemeriksaan akses saat ini:\nCalendar: ${label(0)}\nDrive: ${label(1)}\nGemini: ${label(2)} (pemeriksaan akses API, bukan uji ekstraksi/model)\nDatabase: ${database.status==='fulfilled'&&database.value&&typeof database.value==='object'&&'connected' in database.value&&database.value.connected?'Terhubung':'Tidak terhubung / mode lokal'}`;
}
