import { AsyncLocalStorage } from 'async_hooks';
import type { SourceMediaType } from './types';
export interface TelegramSource { fileId?:string; fileName?:string; mimeType?:string; sourceType:SourceMediaType; textContent?:string }
export const telegramContext = new AsyncLocalStorage<{ operationId: string; album?: boolean; notices?: string[]; source?:TelegramSource; retryableFailure?:boolean }>();
