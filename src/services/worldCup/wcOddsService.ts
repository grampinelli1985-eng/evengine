/**
 * wcOddsService.ts — Busca de odds para torneios internacionais
 * Isolado do oddsService principal. Retorna WCMatch[] compatível.
 */

import { WCMatch, WCTournament, WC_TOURNAMENTS } from './wcTypes';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports';

// Mock matches para validação quando não há jogos ativos
const WC_MOCK_MATCHES: WCMatch[] = [
  {
    id: 'wc_mock_1',
    sport_key: 'soccer_fifa_world_cup',
    sport_title: 'Copa do Mundo FIFA 2026',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    home_team: 'Brazil',
    away_team: 'Argentina',
    phase: 'grupos',
    group: 'C',
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
              { name: 'Brazil', price: 2.10 },
              { name: 'Argentina', price: 3.20 },
              { name: 'Draw', price: 3.40 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'wc_mock_2',
    sport_key: 'soccer_fifa_world_cup',
    sport_title: 'Copa do Mundo FIFA 2026',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 36).toISOString(),
    home_team: 'France',
    away_team: 'England',
    phase: 'grupos',
    group: 'A',
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
              { name: 'France', price: 2.25 },
              { name: 'England', price: 3.10 },
              { name: 'Draw', price: 3.30 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'wc_mock_3',
    sport_key: 'soccer_fifa_world_cup',
    sport_title: 'Copa do Mundo FIFA 2026',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
    home_team: 'Spain',
    away_team: 'Germany',
    phase: 'grupos',
    group: 'B',
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
              { name: 'Spain', price: 2.40 },
              { name: 'Germany', price: 2.90 },
              { name: 'Draw', price: 3.35 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'wc_mock_4',
    sport_key: 'soccer_conmebol_copa_america',
    sport_title: 'Copa América',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 60).toISOString(),
    home_team: 'Colombia',
    away_team: 'Uruguay',
    phase: 'grupos',
    group: 'D',
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
              { name: 'Colombia', price: 2.55 },
              { name: 'Uruguay', price: 2.85 },
              { name: 'Draw', price: 3.20 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'wc_mock_5',
    sport_key: 'soccer_fifa_world_cup_qualifiers_south_america',
    sport_title: 'Eliminatórias CONMEBOL',
    commence_time: new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(),
    home_team: 'Portugal',
    away_team: 'Netherlands',
    phase: 'eliminatorias',
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
              { name: 'Portugal', price: 2.30 },
              { name: 'Netherlands', price: 3.05 },
              { name: 'Draw', price: 3.25 },
            ],
          },
        ],
      },
    ],
  },
];

export async function fetchWCMatches(
  apiKey: string,
  tournaments?: WCTournament[]
): Promise<WCMatch[]> {
  if (!apiKey || apiKey.length < 10) {
    console.log('[WC] API key inválida — usando mock matches para calibração');
    return WC_MOCK_MATCHES;
  }

  const keys = tournaments ?? WC_TOURNAMENTS.map(t => t.key);
  const results: WCMatch[] = [];

  for (const key of keys) {
    const cacheKey = `wc_odds_cache_${key}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { data, ts, inactive } = JSON.parse(cached);
        const ttl = inactive ? 12 * 60 * 60 * 1000 : 30 * 60 * 1000; // 12h para inativo, 30min para ativo
        if (Date.now() - ts < ttl) {
          if (inactive) {
            console.log(`[WC] Torneio ${key} inativo (cache hit) — pulando API call.`);
            continue;
          }
          results.push(...data);
          continue;
        }
      } catch { /* ignore */ }
    }

    try {
      const url = `${ODDS_API_BASE}/${key}/odds/?apiKey=${apiKey}&bookmakers=pinnacle,betfair_ex_eu&markets=h2h,totals&oddsFormat=decimal&daysFrom=7`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });

      if (!response.ok) {
        if (response.status === 404) {
          // Torneio inativo: cachear como inativo para poupar créditos da API
          console.log(`[WC] Torneio ${key} inativo (404) — salvando cache de inatividade.`);
          localStorage.setItem(cacheKey, JSON.stringify({ data: [], ts: Date.now(), inactive: true }));
          continue;
        }
        console.warn(`[WC] HTTP ${response.status} para ${key}`);
        continue;
      }

      const data: WCMatch[] = await response.json();

      // Inferir fase pelo sport_key
      const enriched = data.map(m => ({
        ...m,
        phase: inferPhase(m),
      }));

      localStorage.setItem(cacheKey, JSON.stringify({ data: enriched, ts: Date.now(), inactive: false }));
      results.push(...enriched);
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        console.warn(`[WC] Timeout ao buscar ${key}`);
      }
    }
  }

  // Se API não retornou nada (torneios fora de temporada), usa mocks
  return results.length > 0 ? results : WC_MOCK_MATCHES;
}

function inferPhase(match: WCMatch): WCMatch['phase'] {
  const key = match.sport_key;
  if (key.includes('qualifier')) return 'eliminatorias';
  if (key.includes('world_cup')) return 'grupos';
  return 'grupos';
}

export function getWCQuotaInfo(): { remaining: number | null; used: number | null } {
  const remaining = sessionStorage.getItem('wc_odds_api_remaining');
  const used = sessionStorage.getItem('wc_odds_api_used');
  return {
    remaining: remaining !== null ? parseInt(remaining, 10) : null,
    used: used !== null ? parseInt(used, 10) : null,
  };
}
