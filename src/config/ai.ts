/**
 * ai.ts — Configuração dos modelos de IA
 */

// Modelo principal — Gemini 2.5 Flash
export const GEMINI_MODEL = 'gemini-2.5-flash';

// Fallback — gemini-2.5-flash-lite descontinuado; substituído por gemini-3.5-flash-lite
export const GEMINI_MODEL_FALLBACK = 'gemini-3.5-flash-lite';

// Timeout padrão para chamadas ao Gemini (ms)
export const GEMINI_TIMEOUT_MS = 30000;
