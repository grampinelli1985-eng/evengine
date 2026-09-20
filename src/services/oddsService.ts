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
import { fetchViaOddsProxy } from './oddsProxyClient';
import { isOutOfCredits, OUT_OF_CREDITS_STATUS } from './oddsApiErrors';

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
const TTL_FAR_MS      = 6 * 60 * 60 * 1000;   // 6h — próximo jogo da liga a mais de 12h
const TTL_FAR_THRESHOLD_MS = 12 * 60 * 60 * 1000;

// [QUOTA-OPT] TTL calculado por liga individualmente — não mais global.
// Era: qualquer liga iminente → TODAS as ligas caíam para 20min.
// Agora: só a liga com jogo iminente cai para 30min.
function calcTTLForLeague(data: any[]): number {
  if (!Array.isArray(data) || data.length === 0) return TTL_NORMAL_MS;
  const now = Date.now();
  let nearest = Infinity;
  for (const m of data) {
    if (!m.commence_time) continue;
    const delta = new Date(m.commence_time).getTime() - now;
    if (delta > 0 && delta < nearest) nearest = delta;
  }
  if (nearest < 90 * 60 * 1000) return TTL_PREMATCH_MS;
  // Próximo jogo da liga a mais de 12h: a linha ainda vai andar bastante antes do kickoff,
  // então atualizar a cada 3h só gasta créditos (cada atualização = 2 a 3 por liga).
  if (nearest > TTL_FAR_THRESHOLD_MS) return TTL_FAR_MS;
  return TTL_NORMAL_MS;
}

// ── Agenda grátis (não gasta créditos) ───────────────────────────────────────
// /sports/{sport}/events NÃO conta na cota (medido: x-requests-last: 0). Serve para
// não pagar /odds de liga sem nenhum jogo no horizonte que a interface mostra (7 dias) —
// ex.: Champions/Libertadores/Sul-Americana em pausa custavam 9 créditos por atualização.
const SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000; // maior período do filtro da UI
const SCHEDULE_TTL_MS = 60 * 60 * 1000;

/**
 * true se a liga tem jogo dentro do horizonte, false se não tem. Em qualquer falha
 * (rede, cota, resposta inesperada) devolve true: sem certeza, mantém o comportamento
 * antigo de buscar as odds em vez de esconder jogos.
 */
async function leagueHasUpcomingGames(leagueKey: string): Promise<boolean> {
  const key = `odds_sched_${leagueKey}`;
  const raw = lsGet(key);
  if (raw) {
    try {
      const { hasGames, timestamp } = JSON.parse(raw);
      if (typeof hasGames === 'boolean' && Date.now() - timestamp < SCHEDULE_TTL_MS) return hasGames;
    } catch { /* cache corrompido: refaz */ }
  }

  try {
    const res = await fetchViaOddsProxy(`/sports/${leagueKey}/events?dateFormat=iso`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return true;
    const events = await res.json();
    if (!Array.isArray(events)) return true;

    const now = Date.now();
    const hasGames = events.some((e: any) => {
      const t = new Date(e?.commence_time).getTime();
      return t > now - 3 * 60 * 60 * 1000 && t - now <= SCHEDULE_HORIZON_MS; // inclui jogo em andamento
    });
    lsSet(key, JSON.stringify({ hasGames, timestamp: Date.now() }));
    return hasGames;
  } catch {
    return true;
  }
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

export async function fetchAllMatches(leagueKeys?: string[]): Promise<Match[]> {
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
      // Antes de pagar: liga sem jogo no horizonte de 7 dias não precisa de /odds. Checagem
      // grátis (não consome créditos). Guarda o "vazio" no cache local para não repetir.
      if (!(await leagueHasUpcomingGames(league.key))) {
        console.info(`[OddsAPI] ${league.key}: sem jogos nos próximos 7 dias — /odds não consultado (0 créditos)`);
        lsSet(localKey, JSON.stringify({ data: [], timestamp: Date.now() }));
        results.push({ status: 'fulfilled', value: [] });
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      // Só as referências sharp. A Odds API não devolve a bet365 (medido: 0 de 19 jogos da EPL,
      // com a chave pedida); a odd da bet365 no sistema é digitada pelo usuário (odd manual).
      const SHARP_BOOKMAKERS = 'pinnacle,betfair_ex_eu';
      // Custo do /odds em lote = 1 crédito POR MERCADO por chamada. h2h e totals alimentam a
      // análise; `spreads` (+1 crédito, +50%) só alimenta a linha de handicap real em
      // asianHandicapService.ts, que sem ele cai na aproximação "(estimado)". Fica desligado
      // por padrão enquanto a cota da Odds API for pequena (500 créditos); ligue trocando
      // INCLUDE_SPREADS para true.
      // ATENÇÃO: o lote só aceita h2h, totals e spreads. btts/draw_no_bet/alternate_totals
      // são mercados adicionais só do endpoint por evento (eventOddsService.ts) — pedi-los
      // aqui retorna HTTP 422 e derruba o carregamento de todas as partidas.
      const INCLUDE_SPREADS = false;
      const MINIMAL_MARKETS = 'h2h,totals';
      const MARKETS = INCLUDE_SPREADS ? 'h2h,totals,spreads' : MINIMAL_MARKETS;
      // (O antigo `daysFrom=2` aqui não existe em /odds — só em /scores — e era ignorado
      // pela API: a resposta trazia todos os jogos futuros da liga, não só 48h.)
      const path = `/sports/${league.key}/odds/?bookmakers=${SHARP_BOOKMAKERS}&markets=${MARKETS}&oddsFormat=decimal`;
      let response = await fetchViaOddsProxy(path, { signal: AbortSignal.timeout(6000) });

      // Rede de segurança (só faz sentido se o pedido tiver mais que o mínimo, ex.: spreads
      // ligado e indisponível no plano): refaz com h2h,totals em vez de deixar a liga sem
      // partidas. Com o pedido já mínimo, repetir seria uma chamada idêntica.
      if (response.status === 422 && MARKETS !== MINIMAL_MARKETS) {
        console.warn(`[OddsAPI] HTTP 422 para ${league.key} — repetindo com pedido mínimo (${MINIMAL_MARKETS})`);
        const fallbackPath = `/sports/${league.key}/odds/?bookmakers=${SHARP_BOOKMAKERS}&markets=${MINIMAL_MARKETS}&oddsFormat=decimal`;
        response = await fetchViaOddsProxy(fallbackPath, { signal: AbortSignal.timeout(6000) });
      }

      if (!response.ok) {
        if (response.status === 401) {
          // 401 da Odds API também significa "créditos esgotados": a chave é válida.
          const outOfCredits = await isOutOfCredits(response);
          lsSet('odds_api_error_status', outOfCredits ? OUT_OF_CREDITS_STATUS : '401');
          // Limpar valores stale de sessão anterior para que o banner apareça
          lsRemove('odds_api_remaining');
          lsRemove('odds_api_used');
          throw new Error(outOfCredits ? 'QUOTA_EXCEEDED' : 'API_KEY_INVALID');
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
