/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [QUOTA-OPT] Reduções de consumo da Odds API:
 *
 * Antes:
 *   - TTL normal: 60 min → até 10 calls/hora com 10 ligas
 *   - TTL pré-jogo: 20 min aplicado a TODAS as ligas quando QUALQUER uma tem jogo iminente
 *   - daysFrom: 3
 *
 * Depois:
 *   - TTL normal: 3h (−66% de calls em idle)
 *   - TTL pré-jogo: 30 min, aplicado APENAS À LIGA com jogo <90min
 *   - daysFrom: 2 (jogos de amanhã ainda cobertos)
 *   - Economia estimada: 60-75% dos requests
 */

import { Match, LEAGUES } from '../types';
import { supabase } from './supabaseClient';

const ODDS_API_BASE_URL = 'https://api.the-odds-api.com/v4/sports';

const MOCK_MATCHES: Match[] = [
  {
    id: 'mock_match_1',
    sport_key: 'soccer_epl',
    sport_title: 'Premier League',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    home_team: 'Manchester City',
    away_team: 'Arsenal',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Manchester City', price: 2.45 },
              { name: 'Arsenal', price: 3.00 },
              { name: 'Draw', price: 3.45 }
            ]
          }
        ]
      },
      {
        key: 'betfair_ex_eu',
        title: 'Betfair',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Manchester City', price: 2.48 },
              { name: 'Arsenal', price: 3.05 },
              { name: 'Draw', price: 3.50 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'mock_match_2',
    sport_key: 'soccer_spain_la_liga',
    sport_title: 'La Liga',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
    home_team: 'Real Madrid',
    away_team: 'Espanyol',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Real Madrid', price: 1.24 },
              { name: 'Espanyol', price: 13.50 },
              { name: 'Draw', price: 6.30 }
            ]
          }
        ]
      },
      {
        key: 'betfair_ex_eu',
        title: 'Betfair',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Real Madrid', price: 1.25 },
              { name: 'Espanyol', price: 14.00 },
              { name: 'Draw', price: 6.40 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'mock_match_3',
    sport_key: 'soccer_italy_serie_a',
    sport_title: 'Serie A',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 36).toISOString(),
    home_team: 'Inter Milan',
    away_team: 'Juventus',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Inter Milan', price: 2.02 },
              { name: 'Juventus', price: 4.00 },
              { name: 'Draw', price: 3.35 }
            ]
          }
        ]
      },
      {
        key: 'betfair_ex_eu',
        title: 'Betfair',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Inter Milan', price: 2.05 },
              { name: 'Juventus', price: 4.10 },
              { name: 'Draw', price: 3.40 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'mock_match_4',
    sport_key: 'soccer_epl',
    sport_title: 'Premier League',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(),
    home_team: 'Liverpool',
    away_team: 'West Ham',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Liverpool', price: 1.39 },
              { name: 'West Ham', price: 8.20 },
              { name: 'Draw', price: 5.10 }
            ]
          }
        ]
      },
      {
        key: 'betfair_ex_eu',
        title: 'Betfair',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Liverpool', price: 1.40 },
              { name: 'West Ham', price: 8.50 },
              { name: 'Draw', price: 5.20 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'mock_match_5',
    sport_key: 'soccer_brazil_campeonato',
    sport_title: 'Brasileirão',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
    home_team: 'Flamengo',
    away_team: 'Palmeiras',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Flamengo', price: 2.25 },
              { name: 'Palmeiras', price: 3.40 },
              { name: 'Draw', price: 3.30 }
            ]
          }
        ]
      },
      {
        key: 'betfair_ex_eu',
        title: 'Betfair',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            last_update: new Date().toISOString(),
            outcomes: [
              { name: 'Flamengo', price: 2.30 },
              { name: 'Palmeiras', price: 3.45 },
              { name: 'Draw', price: 3.35 }
            ]
          }
        ]
      }
    ]
  }
];

// ── TTL Configuration ────────────────────────────────────────────────────────
// [QUOTA-OPT] Normal: 3h (era 1h). Pré-jogo: 30min (era 20min), só para a liga afetada.
const TTL_NORMAL_MS   = 3 * 60 * 60 * 1000;  // 3h — ligas sem jogo iminente
const TTL_PREMATCH_MS = 30 * 60 * 1000;       // 30min — liga com jogo <90min

// [QUOTA-OPT] TTL calculado por liga individualmente — não mais global.
// Era: qualquer liga iminente → TODAS as ligas caíam para 20min.
// Agora: só a liga com jogo iminente cai para 30min.
function calcTTLForLeague(data: any[]): number {
  if (!Array.isArray(data) || data.length === 0) return TTL_NORMAL_MS;
  const now = Date.now();
  const hasImminent = data.some((m: any) => {
    if (!m.commence_time) return false;
    const delta = new Date(m.commence_time).getTime() - now;
    return delta > 0 && delta < 90 * 60 * 1000;
  });
  return hasImminent ? TTL_PREMATCH_MS : TTL_NORMAL_MS;
}

// ── localStorage helpers ──────────────────────────────────────────────────────
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}
function lsRemove(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

// ── Shared Supabase odds cache ───────────────────────────────────────────────
async function getSharedOdds(sportKey: string): Promise<Match[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('shared_odds_cache')
      .select('odds_data, expires_at')
      .eq('sport_key', sportKey)
      .maybeSingle();

    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) return null;

    return data.odds_data as Match[];
  } catch {
    return null;
  }
}

async function setSharedOdds(sportKey: string, matches: Match[], ttlMs: number): Promise<void> {
  if (!supabase) return;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  try {
    await supabase
      .from('shared_odds_cache')
      .upsert(
        { sport_key: sportKey, odds_data: matches, expires_at: expiresAt, updated_at: new Date().toISOString() },
        { onConflict: 'sport_key' }
      );
  } catch (e) {
    console.warn('[OddsCache] Erro ao salvar no Supabase:', e);
  }
}

// ────────────────────────────────────────────────────────────────────────────

export async function fetchAllMatches(apiKey: string, leagueKeys?: string[]): Promise<Match[]> {
  if (!apiKey || apiKey === 'MY_ODDS_API_KEY') {
    return MOCK_MATCHES;
  }

  if (!leagueKeys || leagueKeys.length === 0) return [];

  const leaguesToFetch = LEAGUES.filter(l => leagueKeys.includes(l.key));
  const results: PromiseSettledResult<Match[]>[] = [];

  for (const league of leaguesToFetch) {
    const localKey = `odds_cache_${league.key}`;

    // 1️⃣ localStorage (instantâneo, mesmo usuário)
    const localRaw = lsGet(localKey);
    if (localRaw) {
      try {
        const { data, timestamp } = JSON.parse(localRaw);
        // [QUOTA-OPT] TTL calculado individualmente para esta liga
        const ttl = calcTTLForLeague(data);
        if (Date.now() - timestamp < ttl) {
          results.push({ status: 'fulfilled', value: data as Match[] });
          continue;
        }
      } catch {
        lsRemove(localKey);
      }
    }

    // 2️⃣ Supabase compartilhado (zero chamadas à Odds API para outros usuários)
    const shared = await getSharedOdds(league.key);
    if (shared) {
      const ttl = calcTTLForLeague(shared);
      lsSet(localKey, JSON.stringify({ data: shared, timestamp: Date.now() }));
      results.push({ status: 'fulfilled', value: shared });
      continue;
    }

    // 3️⃣ Cache miss total: buscar da Odds API
    try {
      const SHARP_BOOKMAKERS = 'pinnacle,betfair_ex_eu';
      const MARKETS = 'h2h,totals';
      // [QUOTA-OPT] daysFrom: 3 → 2 (elimina jogos 3 dias adiante que raramente têm linhas sharp)
      const url = `${ODDS_API_BASE_URL}/${league.key}/odds/?apiKey=${apiKey}&bookmakers=${SHARP_BOOKMAKERS}&markets=${MARKETS}&oddsFormat=decimal&daysFrom=2`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });

      if (!response.ok) {
        if (response.status === 401) {
          lsSet('odds_api_error_status', '401');
          // Limpar valores stale de sessão anterior para que o banner apareça
          lsRemove('odds_api_remaining');
          lsRemove('odds_api_used');
          throw new Error('API_KEY_INVALID');
        }
        if (response.status === 429) {
          lsSet('odds_api_error_status', '429');
          lsRemove('odds_api_remaining');
          lsRemove('odds_api_used');
          throw new Error('RATE_LIMITED');
        }
        if (response.status === 422) {
          console.warn(`[OddsAPI] HTTP 422 para ${league.key} — mercado não suportado, ignorando`);
          results.push({ status: 'fulfilled', value: [] });
          continue;
        }
        console.error(`[OddsAPI] HTTP ${response.status} for league ${league.key}`);
        results.push({ status: 'fulfilled', value: [] });
      } else {
        lsRemove('odds_api_error_status');

        const remaining = response.headers.get('x-requests-remaining');
        const used = response.headers.get('x-requests-used');
        if (remaining !== null) lsSet('odds_api_remaining', remaining);
        if (used !== null) lsSet('odds_api_used', used);

        if (response.bodyUsed === false) {
          const contentLength = response.headers.get('content-length');
          if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
            console.warn(`[OddsAPI] Large response for ${league.key}: ${contentLength} bytes — skipping parse`);
            results.push({ status: 'fulfilled', value: [] });
            continue;
          }
        }

        const data = await response.json();

        if (Array.isArray(data)) {
          // [QUOTA-OPT] TTL calculado individualmente para esta liga
          const ttl = calcTTLForLeague(data);
          lsSet(localKey, JSON.stringify({ data, timestamp: Date.now() }));
          setSharedOdds(league.key, data, ttl).catch(console.warn);
        }

        results.push({ status: 'fulfilled', value: data as Match[] });
      }
    } catch (err: any) {
      if (err.message === 'API_KEY_INVALID' || err.message === 'RATE_LIMITED' || err.message === 'QUOTA_EXCEEDED') {
        results.push({ status: 'rejected', reason: err });
      } else {
        results.push({ status: 'fulfilled', value: [] });
      }
    }

    await new Promise(resolve => setTimeout(resolve, 350));
  }

  const hasQuotaIssue = results.some(r =>
    r.status === 'rejected' &&
    (r.reason.message === 'QUOTA_EXCEEDED' || r.reason.message === 'RATE_LIMITED' || r.reason.message === 'API_KEY_INVALID')
  );
  if (hasQuotaIssue) return MOCK_MATCHES;

  const allMatches: Match[] = results
    .filter((r): r is PromiseFulfilledResult<Match[]> => r.status === 'fulfilled' && Array.isArray(r.value))
    .flatMap(r => r.value);

  const uniqueMatchesMap = new Map<string, Match>();
  allMatches.forEach(m => {
    if (!uniqueMatchesMap.has(m.id)) uniqueMatchesMap.set(m.id, m);
  });

  return Array.from(uniqueMatchesMap.values());
}

export function getOddsApiQuotaInfo() {
  return {
    remaining: lsGet('odds_api_remaining'),
    used: lsGet('odds_api_used'),
    errorStatus: lsGet('odds_api_error_status'),
  };
}
