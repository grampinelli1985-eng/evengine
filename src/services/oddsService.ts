/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match, LEAGUES } from '../types';

const ODDS_API_BASE_URL = 'https://api.the-odds-api.com/v4/sports';

// Cache keys
const ACTIVE_SPORTS_CACHE_KEY = 'evengine_active_sports_cache';
const ACTIVE_SPORTS_TTL = 60 * 60 * 1000; // 1 hora — lista de esportes ativos muda pouco
const ODDS_CACHE_PREFIX = 'evengine_odds_cache_';
const ODDS_CACHE_TTL_DEFAULT = 60 * 60 * 1000; // 60 min padrão (localStorage sobrevive reload)
const ODDS_CACHE_TTL_NEAR_KICKOFF = 30 * 60 * 1000; // 30 min se jogo < 2h

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

// ─── localStorage cache helpers ───────────────────────────────────────────────

function lsGet<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
    return data as T;
  } catch { return null; }
}

function lsSet(key: string, data: unknown): void {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch { /* quota */ }
}

// ─── Step 1: Busca lista de esportes ativos (GRATUITO — não consome cota) ────

async function fetchActiveSportKeys(apiKey: string): Promise<Set<string>> {
  const cached = lsGet<string[]>(ACTIVE_SPORTS_CACHE_KEY, ACTIVE_SPORTS_TTL);
  if (cached) {
    console.log(`[OddsAPI] Active sports from cache: ${cached.length} sports`);
    return new Set(cached);
  }

  try {
    const res = await fetch(
      `${ODDS_API_BASE_URL}?apiKey=${apiKey}&all=false`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) {
      console.warn(`[OddsAPI] /sports returned ${res.status} — using stale cache or empty filter`);
      const stale = localStorage.getItem(ACTIVE_SPORTS_CACHE_KEY);
      if (stale) {
        try {
          const { data } = JSON.parse(stale);
          if (Array.isArray(data)) return new Set(data);
        } catch {}
      }
      return new Set();
    }
    const sports: Array<{ key: string; active: boolean }> = await res.json();
    const activeKeys = sports.filter(s => s.active).map(s => s.key);
    lsSet(ACTIVE_SPORTS_CACHE_KEY, activeKeys);
    console.log(`[OddsAPI] Active sports: ${activeKeys.join(', ')}`);
    return new Set(activeKeys);
  } catch (err) {
    console.warn('[OddsAPI] Failed to fetch active sports — using stale cache or empty filter:', err);
    const stale = localStorage.getItem(ACTIVE_SPORTS_CACHE_KEY);
    if (stale) {
      try {
        const { data } = JSON.parse(stale);
        if (Array.isArray(data)) return new Set(data);
      } catch {}
    }
    return new Set();
  }
}

// ─── TTL dinâmico por proximidade de kickoff ──────────────────────────────────

function getTTLForData(data: Match[]): number {
  if (!Array.isArray(data) || data.length === 0) return ODDS_CACHE_TTL_DEFAULT;
  const now = Date.now();
  const twoH = 2 * 60 * 60 * 1000;
  const hasNearKickoff = data.some(m => {
    if (!m.commence_time) return false;
    const delta = new Date(m.commence_time).getTime() - now;
    return delta > -twoH && delta < twoH;
  });
  return hasNearKickoff ? ODDS_CACHE_TTL_NEAR_KICKOFF : ODDS_CACHE_TTL_DEFAULT;
}

// ─── fetchAllMatches ──────────────────────────────────────────────────────────

export async function fetchAllMatches(apiKey: string, leagueKeys?: string[]): Promise<Match[]> {
  if (!apiKey || apiKey === 'MY_ODDS_API_KEY') {
    return MOCK_MATCHES;
  }

  // Step 1: Descobrir quais ligas estão ativas AGORA (grátis)
  const activeSports = await fetchActiveSportKeys(apiKey);
  
  // Se o set estiver vazio (falha na API /sports e sem cache local anterior),
  // aborta a busca em vez de tentar buscar às cegas (previne desperdício de créditos)
  if (activeSports.size === 0) {
    console.log('[OddsAPI] Lista de esportes ativos indisponível e sem cache. Abortando busca para proteger cota.');
    return [];
  }

  const leaguesToFetch = (leagueKeys
    ? LEAGUES.filter(l => leagueKeys.includes(l.key))
    : LEAGUES
  ).filter(league => {
    const isActive = activeSports.has(league.key);
    if (!isActive) {
      console.log(`[OddsAPI] Liga fora de temporada — pulando sem consumir cota: ${league.key}`);
    }
    return isActive;
  });

  if (leaguesToFetch.length === 0) {
    console.log('[OddsAPI] Nenhuma liga ativa no momento — zero requests consumidas.');
    return [];
  }

  console.log(`[OddsAPI] Ligas ativas para buscar: ${leaguesToFetch.map(l => l.key).join(', ')}`);

  const results: PromiseSettledResult<Match[]>[] = [];

  for (const league of leaguesToFetch) {
    const cacheKey = `${ODDS_CACHE_PREFIX}${league.key}`;

    // Step 2: Checar cache localStorage (sobrevive reload)
    const cached = lsGet<Match[]>(cacheKey, ODDS_CACHE_TTL_DEFAULT);
    if (cached !== null) {
      // Recalcular TTL baseado nos dados cacheados
      const dynamicTTL = getTTLForData(cached);
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        try {
          const { ts } = JSON.parse(raw);
          if (Date.now() - ts < dynamicTTL) {
            console.log(`[OddsAPI] Cache hit (localStorage): ${league.key}`);
            results.push({ status: 'fulfilled', value: cached });
            continue;
          }
        } catch { /* ignora, vai buscar */ }
      }
    }

    // Step 3: Buscar odds da liga ativa
    try {
      const SHARP_BOOKMAKERS = 'pinnacle,betfair_ex_eu';
      const url = `${ODDS_API_BASE_URL}/${league.key}/odds/?apiKey=${apiKey}&bookmakers=${SHARP_BOOKMAKERS}&markets=h2h,totals&oddsFormat=decimal&daysFrom=7`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.setItem('odds_api_error_status', '401');
          throw new Error('API_KEY_INVALID');
        }
        if (response.status === 429) {
          localStorage.setItem('odds_api_error_status', '429');
          throw new Error('RATE_LIMITED');
        }
        console.error(`[OddsAPI] HTTP ${response.status} for league ${league.key}`);
        results.push({ status: 'fulfilled', value: [] });
      } else {
        localStorage.removeItem('odds_api_error_status');

        const remaining = response.headers.get('x-requests-remaining');
        const used = response.headers.get('x-requests-used');
        if (remaining !== null) localStorage.setItem('odds_api_remaining', remaining);
        if (used !== null) localStorage.setItem('odds_api_used', used);

        if (response.bodyUsed === false) {
          const contentLength = response.headers.get('content-length');
          if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
            console.warn(`[OddsAPI] Payload muito grande para ${league.key} — pulando parse`);
            results.push({ status: 'fulfilled', value: [] });
            continue;
          }
        }

        const data: Match[] = await response.json();

        // Cachear resultado (mesmo vazio, para não repetir requests)
        lsSet(cacheKey, Array.isArray(data) ? data : []);
        results.push({ status: 'fulfilled', value: Array.isArray(data) ? data : [] });
      }
    } catch (err: any) {
      if (err.message === 'API_KEY_INVALID' || err.message === 'RATE_LIMITED' || err.message === 'QUOTA_EXCEEDED') {
        results.push({ status: 'rejected', reason: err });
      } else {
        results.push({ status: 'fulfilled', value: [] });
      }
    }

    // Delay anti-burst (The Odds API burst limit)
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  const hasQuotaIssue = results.some(
    r => r.status === 'rejected' &&
    ['QUOTA_EXCEEDED', 'RATE_LIMITED', 'API_KEY_INVALID'].includes(r.reason?.message)
  );
  if (hasQuotaIssue) return MOCK_MATCHES;

  const allMatches: Match[] = results
    .filter((r): r is PromiseFulfilledResult<Match[]> => r.status === 'fulfilled' && Array.isArray(r.value))
    .flatMap(r => r.value);

  // Deduplicação por ID
  const seen = new Map<string, Match>();
  allMatches.forEach(m => { if (!seen.has(m.id)) seen.set(m.id, m); });
  return Array.from(seen.values());
}

export function getOddsApiQuotaInfo() {
  return {
    remaining: localStorage.getItem('odds_api_remaining'),
    used: localStorage.getItem('odds_api_used'),
    errorStatus: localStorage.getItem('odds_api_error_status')
  };
}
