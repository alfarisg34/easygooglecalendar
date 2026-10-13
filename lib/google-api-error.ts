/** Read OAuth failures without exposing request headers or credentials. */
export function isInvalidGoogleGrant(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { message?: string; response?: { data?: { error?: string } } };
  return value.response?.data?.error === 'invalid_grant' || Boolean(value.message?.includes('invalid_grant'));
}

export const GOOGLE_RECONNECT_MESSAGE = 'Otorisasi akun Google sudah kedaluwarsa atau dicabut. Ketik /connect di bot Telegram atau login ulang Google di web dengan akun yang sama, lalu kirim ulang berkas. Jika berulang setiap 7 hari, periksa apakah aplikasi OAuth masih berstatus Testing di Google Cloud.';
