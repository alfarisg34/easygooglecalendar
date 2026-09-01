export interface CalendarEvent {
  title: string;
  start_time: string; // ISO 8601 (e.g. 2026-09-03T09:00:00+07:00)
  end_time: string;   // ISO 8601
  is_online: boolean;
  location: string;
  meeting_link: string;
  meeting_id_pass: string;
  jp: string;
  speakers: string;
  description: string;
  google_calendar_url?: string;
}

export type ExtractionEngine = 'gemini' | 'ocr_service' | 'hybrid';
export type SourceMediaType = 'pdf' | 'image' | 'text';

export interface ExtractionRequest {
  apiKey?: string;
  model?: string;
  engine?: ExtractionEngine;
  sourceType: SourceMediaType;
  text?: string;
  base64Data?: string;
  mimeType?: string;
  fileName?: string;
}

export interface ExtractionResponse {
  success: boolean;
  event?: CalendarEvent;
  rawOcrText?: string;
  modelUsed?: string;
  engineUsed?: ExtractionEngine;
  error?: string;
  debugInfo?: string;
}

export interface OCRServiceResponse {
  success: boolean;
  text?: string;
  model?: string;
  error?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      first_name?: string;
      title?: string;
      type: string;
    };
    date: number;
    text?: string;
    caption?: string;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
  };
}
