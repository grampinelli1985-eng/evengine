/**
 * eventOddsService.ts
 * Mercados "adicionais" da Odds API (btts, draw_no_bet) — só existem no endpoint
 * por evento (/sports/{sport}/events/{id}/odds); o endpoint em lote usado por
 * oddsService.fetchAllMatches responde HTTP 422 se eles forem pedidos lá.
 *
 * Custo: 1 crédito por mercado por chamada (validado: btts+draw_no_bet = 2
 * créditos/evento). Por isso NÃO buscamos para a lista inteira — só para o jogo
 * que o usuário está analisando, uma vez por TTL, e cacheando também o "vazio"
 * (jogo sem esses mercados) para não gastar crédito repetido.
 *
 * Fluxo: `fetchEventMarkets(match)` (async, popula cache) →
 *        `mergeEventMarkets(match)` (síncrono, devolve o Match com os mercados
 *        anexados ao bookmaker correspondente). Nunca lança: qualquer falha
 *        devolve o Match original e a análise segue com odds estimadas.
 */
import { Match, Market } from '../types';
import { fetchViaOddsProxy } from './oddsProxyClient';

export const EVENT_MARKET_KEYS = ['btts', 'draw_no_bet'] as const;
// Mesma política sharp do lote. Validado ao vivo: Pinnacle devolve ambos;
// betfair_ex_eu não devolveu nenhum dos dois (ausente da resposta, sem erro).
const EVENT_BOOKMAKERS = 'pinnacle,betfair_ex_eu';

const TTL_NORMAL_MS   = 3 * 60 * 60 * 1000; // jogo distante
const TTL_PREMATCH_MS = 30 * 60 * 1000;     // jogo em <90min (linha se mexe)
const TTL_NEGATIVE_MS = 60 * 60 * 1000;     // 404/422 ou sem mercados: não insistir
const LS_PREFIX = 'event_odds_';

interface EventOddsEntry {
  /** bookmaker key → mercados adicionais devolvidos por ele */
  markets: Record<string, Market[]>;
  timestamp: number;
  ttl: number;
}

const memory = new Map<string, EventOddsEntry>();
const inflight = new Map<string, Promise<void>>();

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

function readEntry(eventId: string): EventOddsEntry | null {
  let entry = memory.get(eventId) ?? null;
  if (!entry) {
    const raw = lsGet(LS_PREFIX + eventId);
    if (raw) {
      try {
        entry = JSON.parse(raw) as EventOddsEntry;
        memory.set(eventId, entry);
      } catch { entry = null; }
    }
  }
  return entry;
}

function isFresh(entry: EventOddsEntry): boolean {
  return Date.now() - entry.timestamp < entry.ttl;
}

function storeEntry(eventId: string, entry: EventOddsEntry): void {
  memory.set(eventId, entry);
  lsSet(LS_PREFIX + eventId, JSON.stringify(entry));
}

function ttlFor(match: Match): number {
  const delta = new Date(match.commence_time).getTime() - Date.now();
  return delta > 0 && delta < 90 * 60 * 1000 ? TTL_PREMATCH_MS : TTL_NORMAL_MS;
}

function eligible(match: Match): boolean {
  if (!match?.id || !match.sport_key || match._isMockData) return false;
  // Jogo já iniciado/encerrado: linha pré-jogo não é mais apostável.
  return new Date(match.commence_time).getTime() > Date.now();
}

/**
 * Busca btts/draw_no_bet do evento e guarda em cache. No-op se o cache ainda é
 * válido, se o jogo não é elegível ou se já há uma busca em andamento.
 */
export async function fetchEventMarkets(match: Match): Promise<void> {
  if (!eligible(match)) return;

  const cached = readEntry(match.id);
  if (cached && isFresh(cached)) return;

  const pending = inflight.get(match.id);
  if (pending) return pending;

  const run = (async () => {
    try {
      const path =
        `/sports/${match.sport_key}/events/${match.id}/odds` +
        `?bookmakers=${EVENT_BOOKMAKERS}&markets=${EVENT_MARKET_KEYS.join(',')}&oddsFormat=decimal`;
      const res = await fetchViaOddsProxy(path, { signal: AbortSignal.timeout(6000) });

      if (res.status === 404 || res.status === 422) {
        // Evento sumiu da API ou mercado indisponível para essa liga.
        storeEntry(match.id, { markets: {}, timestamp: Date.now(), ttl: TTL_NEGATIVE_MS });
        return;
      }
      if (!res.ok) {
        // 401/429/5xx: cota ou rede — não cachear, tenta de novo na próxima análise.
        console.warn(`[EventOdds] HTTP ${res.status} para ${match.home_team} x ${match.away_team} — seguindo sem btts/dnb reais`);
        return;
      }

      const remaining = res.headers.get('x-requests-remaining');
      if (remaining) lsSet('odds_api_remaining', remaining);

      const data = await res.json();
      const markets: Record<string, Market[]> = {};
      for (const bk of Array.isArray(data?.bookmakers) ? data.bookmakers : []) {
        const extra = (bk.markets ?? []).filter((m: Market) =>
          (EVENT_MARKET_KEYS as readonly string[]).includes(m.key) && Array.isArray(m.outcomes) && m.outcomes.length > 0
        );
        if (extra.length) markets[bk.key] = extra;
      }

      const empty = Object.keys(markets).length === 0;
      if (empty) {
        console.info(`[EventOdds] ${match.home_team} x ${match.away_team}: nenhuma casa sharp cotou btts/draw_no_bet`);
      }
      storeEntry(match.id, {
        markets,
        timestamp: Date.now(),
        ttl: empty ? TTL_NEGATIVE_MS : ttlFor(match),
      });
    } catch (err) {
      console.warn('[EventOdds] Falha ao buscar mercados por evento:', err);
    } finally {
      inflight.delete(match.id);
    }
  })();

  inflight.set(match.id, run);
  return run;
}

/**
 * Síncrono. Devolve o Match com os mercados em cache anexados ao bookmaker de
 * mesma chave (sem duplicar mercados que o bookmaker já tenha). Sem cache
 * aplicável, devolve o próprio objeto recebido — sem mutar o original.
 */
export function mergeEventMarkets<T extends Match | undefined | null>(match: T): T {
  if (!match?.id || !Array.isArray(match.bookmakers)) return match;
  const entry = readEntry(match.id);
  if (!entry || !isFresh(entry) || Object.keys(entry.markets).length === 0) return match;

  let changed = false;
  const bookmakers = match.bookmakers.map(bk => {
    const extra = entry.markets[bk.key];
    if (!extra) return bk;
    const have = new Set((bk.markets ?? []).map(m => m.key));
    const toAdd = extra.filter(m => !have.has(m.key));
    if (toAdd.length === 0) return bk;
    changed = true;
    return { ...bk, markets: [...(bk.markets ?? []), ...toAdd] };
  });

  return changed ? ({ ...match, bookmakers } as T) : match;
}

/** Atalho: busca (se preciso) e já devolve o Match enriquecido. */
export async function enrichMatchWithEventMarkets(match: Match): Promise<Match> {
  await fetchEventMarkets(match);
  return mergeEventMarkets(match);
}

/** Só para testes. */
export function __resetEventOddsCache(): void {
  memory.clear();
  inflight.clear();
}
