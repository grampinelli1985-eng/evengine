/**
 * scoresCache.ts
 * Acesso único e cacheado a /sports/{sport}/scores da Odds API.
 *
 * CUSTO: /scores?daysFrom=3 custa 2 créditos por chamada (medido:
 * x-requests-last: 2). Antes, calibrationService e scoutingService tinham cada um
 * seu cache (um com chave por usuário, outro sem), então a mesma liga era paga duas
 * vezes, e uma resposta VAZIA (liga sem jogos nos últimos dias) nunca era cacheada —
 * cada análise/ciclo refazia a chamada. Placares são dados públicos, não do
 * usuário: uma chave só, e o vazio também é cacheado.
 */
import { fetchViaOddsProxy } from './oddsProxyClient';

export const SCORES_CACHE_TTL_MS = 30 * 60 * 1000;
/** /scores?daysFrom=3 só devolve jogos das últimas 72h. */
export const SCORES_LOOKBACK_MS = 72 * 60 * 60 * 1000;

export type ScoresStatus = 'cache' | 'ok' | 'unauthorized' | 'rate_limited' | 'unprocessable' | 'error';

export interface ScoresResult {
  games: any[];
  status: ScoresStatus;
}

const cacheKey = (sportKey: string) => `scores_cache_${sportKey}`;
const inflight = new Map<string, Promise<ScoresResult>>();

function readCache(sportKey: string): any[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(sportKey));
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Array.isArray(data) && Date.now() - timestamp < SCORES_CACHE_TTL_MS) return data;
  } catch { /* cache corrompido: trata como miss */ }
  return null;
}

function writeCache(sportKey: string, data: any[]): void {
  try {
    localStorage.setItem(cacheKey(sportKey), JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* storage cheio/indisponível */ }
}

/**
 * Placares recentes da liga, do cache quando fresco (inclusive cache vazio).
 * Só erros (401/429/422/rede) não são cacheados. Nunca lança.
 */
export function fetchScoresCached(sportKey: string): Promise<ScoresResult> {
  const cached = readCache(sportKey);
  if (cached) return Promise.resolve({ games: cached, status: 'cache' });

  const pending = inflight.get(sportKey);
  if (pending) return pending;

  const run = (async (): Promise<ScoresResult> => {
    try {
      const res = await fetchViaOddsProxy(`/sports/${sportKey}/scores/?daysFrom=3`);
      if (res.status === 401) return { games: [], status: 'unauthorized' };
      if (res.status === 429) return { games: [], status: 'rate_limited' };
      if (res.status === 422) return { games: [], status: 'unprocessable' };
      if (!res.ok) return { games: [], status: 'error' };

      const data = await res.json();
      if (!Array.isArray(data)) return { games: [], status: 'error' };

      writeCache(sportKey, data);
      return { games: data, status: 'ok' };
    } catch {
      return { games: [], status: 'error' };
    } finally {
      inflight.delete(sportKey);
    }
  })();

  inflight.set(sportKey, run);
  return run;
}

/** Só para testes. */
export function __resetScoresCacheState(): void {
  inflight.clear();
}
