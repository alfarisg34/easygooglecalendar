import { OCRServiceResponse } from './types';

const DEFAULT_OCR_URL = 'https://ocr.alfarighilmana.my.id/api/ocr';

/**
 * Calls the public OCR service at https://ocr.alfarighilmana.my.id/api/ocr
 */
export async function callCustomOcrService(params: {
  apiKey: string;
  base64Data?: string;
  mimeType?: string;
  model?: string;
  ocrEndpointUrl?: string;
}): Promise<OCRServiceResponse> {
  const endpoint = params.ocrEndpointUrl || process.env.NEXT_PUBLIC_OCR_SERVICE_URL || DEFAULT_OCR_URL;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': params.apiKey
      },
      body: JSON.stringify({
        base64Data: params.base64Data,
        mimeType: params.mimeType || 'application/pdf',
        model: params.model || 'gemini-2.5-flash'
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || `OCR Service error (${response.status}): ${response.statusText}`
      };
    }

    return {
      success: true,
      text: data.text || '',
      model: data.model
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal menghubungi layanan OCR (${endpoint}): ${err.message}`
    };
  }
}
