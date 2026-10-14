export function safeError(error:unknown):string {
  const text=error instanceof Error?error.message:typeof error==='string'?error:'Layanan belum dapat diakses.';
  return text.replace(/https?:\/\/\S+/gi,'[URL disamarkan]').replace(/AIza[\w-]+/g,'[API key disamarkan]').replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}/g,'[token disamarkan]').slice(0,500);
}
