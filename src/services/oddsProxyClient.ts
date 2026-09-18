/**
 * Shared client for the `odds-proxy` Supabase Edge Function. The platform
 * ODDS_API_KEY (and, for Sharp-plan users, their own api_key_own) never
 * reach the browser — this module only forwards the caller's session token
 * so the proxy can resolve which key to use and validate the caller.
 */
import { supabase } from './supabaseClient';

const ODDS_PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/odds-proxy`;

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

  return fetch(`${ODDS_PROXY_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Authorization': `Bearer ${session.access_token}`,
    },
  });
}
