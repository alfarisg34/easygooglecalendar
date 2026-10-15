import { createHash } from 'crypto';
import { extractEventFromSource } from './gemini';
import { telegramContext } from './telegram-context';
import { readBotState, writeBotState } from './telegram-state';
import type { ExtractionRequest, ExtractionResponse } from './types';

/** Persist successful AI results before dispatch, including partial schedule updates. */
export async function extractTelegramEvent(request: ExtractionRequest, ownerId: string): Promise<ExtractionResponse> {
  const context = telegramContext.getStore();
  if (!context) return extractEventFromSource(request);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    ownerId, sourceType: request.sourceType, text: request.text, base64Data: request.base64Data, mimeType: request.mimeType
  })).digest('hex');
  const id = `ai-result:${context.operationId}:${fingerprint}`;
  try {
    const cached = await readBotState<ExtractionResponse>(id);
    if (cached?.value.success && cached.value.event) {
      context.retryableFailure = false;
      return structuredClone(cached.value);
    }
    const result = await extractEventFromSource(request);
    if (result.success && result.event) {
      const persisted = { success: true, event: result.event, modelUsed: result.modelUsed, engineUsed: result.engineUsed };
      if (!await writeBotState(id, 'ai-result', persisted, 0, Date.now(), Date.now() + 7 * 86400000)) {
        const existing = await readBotState<ExtractionResponse>(id);
        if (!existing?.value.success || !existing.value.event) throw new Error('Hasil ekstraksi belum tersimpan.');
        return structuredClone(existing.value);
      }
    }
    return result;
  } catch {
    context.retryableFailure = true;
    return { success: false, error: 'Hasil ekstraksi belum tersimpan dengan aman. Periksa koneksi database.' };
  }
}

export function extractionFailureNotice(error: string): string {
  const context = telegramContext.getStore();
  if (context?.managedRetry && context.retryableFailure && (context.attempt || 1) < 3) {
    return `⏳ Ekstraksi belum selesai pada percobaan ${context.attempt || 1}/3. Layanan AI atau penyimpanan sementara belum merespons. Pekerjaan menunggu percobaan ulang melalui worker; waktu lanjut bergantung pada penjadwal. Tidak perlu mengirim ulang sumber. Ketik /status untuk memeriksa.`;
  }
  return `❌ Gagal mengekstrak jadwal: ${error}`;
}
