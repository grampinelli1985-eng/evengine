/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match, LEAGUES } from '../types';

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


export async function fetchAllMatches(apiKey: string, leagueKeys?: string[]): Promise<Match[]> {
  if (!apiKey || apiKey === 'MY_ODDS_API_KEY') {
    return MOCK_MATCHES;
  }

  const leaguesToFetch = leagueKeys 
    ? LEAGUES.filter(l => leagueKeys.includes(l.key))
    : LEAGUES;

  const results: PromiseSettledResult<Match[]>[] = [];

  for (const league of leaguesToFetch) {
    const cacheKey = `odds_cache_${league.key}`;
    const cached = sessionStorage.getItem(cacheKey);
    
    let isCached = false;
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        
        // TTL Dinâmico: 15 minutos padrão, reduzindo para 5 minutos se faltar < 2 horas para o kickoff (ou < 2 horas pós-kickoff)
        let currentTTL = 15 * 60 * 1000; // 15 minutos padrão
        if (Array.isArray(data) && data.length > 0) {
          const now = Date.now();
          const twoHoursMs = 2 * 60 * 60 * 1000;
          const temJogoProximo = data.some((m: any) => {
            if (!m.commence_time) return false;
            const kickoff = new Date(m.commence_time).getTime();
            const delta = kickoff - now;
            return delta > -twoHoursMs && delta < twoHoursMs;
          });
          if (temJogoProximo) {
            currentTTL = 5 * 60 * 1000; // 5 minutos se próximo do kickoff
          }
        }

        if (Date.now() - timestamp < currentTTL) {
          results.push({ status: 'fulfilled', value: data as Match[] });
          isCached = true;
        }
      } catch (e) {
        sessionStorage.removeItem(cacheKey);
      }
    }

    if (isCached) continue;

    try {
      const SHARP_BOOKMAKERS = 'pinnacle,betfair_ex_eu';
      const url = `${ODDS_API_BASE_URL}/${league.key}/odds/?apiKey=${apiKey}&bookmakers=${SHARP_BOOKMAKERS}&markets=h2h,totals&oddsFormat=decimal&daysFrom=7`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      
      if (!response.ok) {
        // API-01: Differentiate permanent (401) vs temporary (429) errors
        if (response.status === 401) {
          sessionStorage.setItem('odds_api_error_status', '401');
          throw new Error('API_KEY_INVALID'); // permanent error — stop all requests
        }
        if (response.status === 429) {
          sessionStorage.setItem('odds_api_error_status', '429');
          throw new Error('RATE_LIMITED'); // temporary — retry later
        }
        console.error(`[OddsAPI] HTTP ${response.status} for league ${league.key}`);
        results.push({ status: 'fulfilled', value: [] });
      } else {
        sessionStorage.removeItem('odds_api_error_status');
        const remaining = response.headers.get('x-requests-remaining');
        const used = response.headers.get('x-requests-used');
        if (remaining !== null) {
          sessionStorage.setItem('odds_api_remaining', remaining);
        }
        if (used !== null) {
          sessionStorage.setItem('odds_api_used', used);
        }

        // API-02: Check abort signal before JSON.parse — AbortSignal.timeout() cancels
        // the fetch but does NOT cancel the pending response.json() microtask, which
        // can throw an unhandled DOMException or block the event loop on large payloads.
        if (response.bodyUsed === false) {
          const contentLength = response.headers.get('content-length');
          if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
            console.warn(`[OddsAPI] Large response for ${league.key}: ${contentLength} bytes — skipping parse`);
            results.push({ status: 'fulfilled', value: [] });
            continue;
          }
        }

        const data = await response.json();

        // API-03: Cache even empty results (with shorter TTL) to avoid repeated API calls consuming quota
        if (Array.isArray(data) && data.length === 0) {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data: [], ts: Date.now(), empty: true, timestamp: Date.now() }));
        } else if (Array.isArray(data) && data.length > 0) {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
        }

        results.push({ status: 'fulfilled', value: data as Match[] });
      }
    } catch (err: any) {
      // API-01: API_KEY_INVALID is permanent — propagate to stop all requests
      // RATE_LIMITED is temporary — propagate to fall back to mock data
      if (err.message === 'API_KEY_INVALID' || err.message === 'RATE_LIMITED' || err.message === 'QUOTA_EXCEEDED') {
        results.push({ status: 'rejected', reason: err });
      } else {
        results.push({ status: 'fulfilled', value: [] });
      }
    }
    
    // Pequeno delay para evitar o "429 Too Many Requests" do Burst Rate Limit da The Odds API
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  const hasQuotaIssue = results.some(r => r.status === 'rejected' && (r.reason.message === 'QUOTA_EXCEEDED' || r.reason.message === 'RATE_LIMITED' || r.reason.message === 'API_KEY_INVALID'));
  if (hasQuotaIssue) {
    return MOCK_MATCHES;
  }

  const allMatches: Match[] = results
    .filter((r): r is PromiseFulfilledResult<Match[]> => r.status === 'fulfilled' && Array.isArray(r.value))
    .flatMap(r => r.value);

  // Deduplication by ID
  const uniqueMatchesMap = new Map();
  allMatches.forEach(m => {
    if (!uniqueMatchesMap.has(m.id)) {
      uniqueMatchesMap.set(m.id, m);
    }
  });

  return Array.from(uniqueMatchesMap.values());
}

export function getOddsApiQuotaInfo() {
  return {
    remaining: sessionStorage.getItem('odds_api_remaining'),
    used: sessionStorage.getItem('odds_api_used'),
    errorStatus: sessionStorage.getItem('odds_api_error_status')
  };
}
