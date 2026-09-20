/**
 * Shared client for the `odds-proxy` Supabase Edge Function. The platform
 * ODDS_API_KEY (and, for Sharp-plan users, their own api_key_own) never
 * reach the browser — this module only forwards the caller's session token
 * so the proxy can resolve which key to use and validate the caller.
 */
import { supabase } from './supabaseClient';

const ODDS_PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/odds-proxy`;

export const ODDS_KEY_ID_STORAGE = 'odds_api_key_id';

/** Estado local que só vale para a chave que o produziu (cota e flag de erro). */
const PER_KEY_LOCAL_STATE = ['odds_api_error_status', 'odds_api_remaining', 'odds_api_used'];
const PER_KEY_SESSION_STATE = ['odds_api_remaining', 'odds_api_used'];

/**
 * O proxy devolve `x-odds-key-id` (hash truncado da chave usada). Quando ele difere do
 * último visto, a chave foi trocada: descarta o estado da chave antiga para que o banner
 * de 401/429 e o "REAL: N REQS" não mostrem dados dela. Retorna true se detectou troca.
 *
 * Roda antes de o chamador tratar a resposta, então um 401/429 da chave NOVA ainda grava
 * seu próprio flag depois. Caches de odds/placares são dados públicos, independentes da
 * chave, e ficam como estão.
 */
export function syncOddsKeyId(res: Response): boolean {
  const current = res.headers.get('x-odds-key-id');
  if (!current) return false; // resposta sem chave resolvida (ex.: NO_API_KEY) ou proxy antigo
  try {
    if (localStorage.getItem(ODDS_KEY_ID_STORAGE) === current) return false;
    PER_KEY_LOCAL_STATE.forEach(k => localStorage.removeItem(k));
    PER_KEY_SESSION_STATE.forEach(k => sessionStorage.removeItem(k));
    localStorage.setItem(ODDS_KEY_ID_STORAGE, current);
  } catch { /* storage indisponível: sem persistência, nada a invalidar */ }
  return true;
}

/**
 * Fetches a The Odds API path (e.g. `/sports/soccer_epl/odds/?bookmakers=...`)
 * through the server-side proxy. Returns a normal Response — status codes
 * (401/429/422) and the x-requests-remaining/x-requests-used headers are
 * forwarded unchanged from the upstream API.
 */
export async function fetchViaOddsProxy(path: string, init?: RequestInit): Promise<Response> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) {
    // No authenticated session — behave like an invalid/missing key so
    // callers fall back to their existing mock-data path.
    return new Response(JSON.stringify({ error: 'NOT_AUTHENTICATED' }), { status: 401 });
  }

  const res = await fetch(`${ODDS_PROXY_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Authorization': `Bearer ${session.access_token}`,
    },
  });
  syncOddsKeyId(res);
  return res;
}
