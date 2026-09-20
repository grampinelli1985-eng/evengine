/**
 * Cliente da Edge Function `set-odds-key` (só admin): valida uma chave nova da Odds API
 * no servidor e, se ela funcionar e tiver créditos, passa a ser a chave da plataforma no
 * odds-proxy. A chave só trafega no envio; nunca volta para o navegador.
 */
import { supabase } from './supabaseClient';

const SET_ODDS_KEY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/set-odds-key`;

export type SetOddsKeyFailure =
  | 'NOT_AUTHENTICATED'
  | 'INVALID_FORMAT'
  | 'INVALID_KEY'
  | 'OUT_OF_CREDITS'
  | 'FORBIDDEN'
  | 'ERROR';

export type SetOddsKeyResult =
  | { ok: true; remaining: number | null }
  | { ok: false; reason: SetOddsKeyFailure };

export const SET_ODDS_KEY_MESSAGES: Record<SetOddsKeyFailure, string> = {
  NOT_AUTHENTICATED: 'Sessão expirada. Entre novamente.',
  INVALID_FORMAT: 'Formato inválido: use só letras e números (16 a 64 caracteres).',
  INVALID_KEY: 'A Odds API não aceitou essa chave.',
  OUT_OF_CREDITS: 'A chave é válida, mas está sem créditos. Use uma chave com cota disponível.',
  FORBIDDEN: 'Sua conta não tem permissão para trocar a chave.',
  ERROR: 'Não foi possível salvar a chave agora. Tente novamente.',
};

const KNOWN: readonly SetOddsKeyFailure[] = ['INVALID_FORMAT', 'INVALID_KEY', 'OUT_OF_CREDITS', 'FORBIDDEN'];

export async function submitPlatformOddsKey(apiKey: string): Promise<SetOddsKeyResult> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) return { ok: false, reason: 'NOT_AUTHENTICATED' };

  try {
    const res = await fetch(SET_ODDS_KEY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok && body?.ok === true) {
      return { ok: true, remaining: typeof body.remaining === 'number' ? body.remaining : null };
    }
    const code = body?.error as SetOddsKeyFailure | undefined;
    return { ok: false, reason: code && KNOWN.includes(code) ? code : 'ERROR' };
  } catch {
    return { ok: false, reason: 'ERROR' };
  }
}
