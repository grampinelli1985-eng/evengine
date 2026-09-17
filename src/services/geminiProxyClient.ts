/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared client for the `gemini-proxy` Supabase Edge Function. GEMINI_API_KEY
 * never leaves the Edge Function environment — this module only forwards an
 * authenticated user's session token so the proxy can validate the caller.
 *
 * Used by geminiService.ts and scoutingService.ts (kept in its own module,
 * not inside either of those, to avoid a circular import between them).
 */
import { supabase } from './supabaseClient';

const GEMINI_PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-proxy`;

export interface GeminiProxyOptions {
  responseFormat?: 'json' | 'text';
  schema?: object;
  model?: string;
  fallbackModel?: string;
  useGoogleSearch?: boolean;
  disableThinking?: boolean;
}

export async function callGeminiProxy(
  systemInstruction: string,
  userMessage: string,
  options: GeminiProxyOptions = {}
): Promise<string> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) {
    throw new Error('[Gemini Proxy] Usuário não autenticado — impossível chamar Edge Function.');
  }

  const resp = await fetch(GEMINI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      systemInstruction,
      userMessage,
      responseFormat: options.responseFormat ?? 'json',
      schema: options.schema,
      model: options.model,
      fallbackModel: options.fallbackModel,
      useGoogleSearch: options.useGoogleSearch,
      disableThinking: options.disableThinking,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`[Gemini Proxy] HTTP ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data.text ?? '';
}
