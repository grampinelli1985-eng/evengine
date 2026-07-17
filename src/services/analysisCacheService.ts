/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cache compartilhado de análises no Supabase.
 * Independente de usuário — qualquer sessão autenticada lê e escreve o mesmo cache.
 *
 * TTL:
 *   - Análise normal (>60min pré-jogo): 4 horas
 *   - Pré-jogo (<60min): 20 minutos
 *   - Line movement ≥8% detectado: invalida imediatamente
 *   - Jogo ao vivo / passado: não cacheia
 *
 * Economia:
 *   - Evita 3-8 chamadas Gemini por análise repetida
 *   - Preserva quota API-Football e The Odds API
 */

import { supabase } from './supabaseClient';

// ─── Tipos ───────────────────────────────────────────────────

export interface CacheEntry {
  id: string;
  fixture_key: string;
  data: any;
  opening_odds: any | null;
  created_at: string;
  expires_at: string;
  invalidated: boolean;
  invalidation_reason: string | null;
}

export type InvalidationReason = 'line_movement' | 'manual' | 'ttl';

// ─── TTL ─────────────────────────────────────────────────────

const TTL_NORMAL_MIN   = 240;  // 4h — análise padrão
const TTL_PREMATCH_MIN = 20;   // 20min — <1h para o jogo
const LINE_MOVEMENT_THRESHOLD = 0.05; // 5% de variação de odd (Gate B7)

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Gera a chave canônica do fixture.
 * Formato: "homeSlug-awaySlug-YYYYMMDD"
 * Ex: "arsenal-chelsea-20260315"
 */
export function buildFixtureKey(homeTeam: string, awayTeam: string, matchDate?: string): string {
  const slug = (s: string) =>
    s.toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  const dateStr = matchDate
    ? matchDate.replace(/\D/g, '').slice(0, 8)
    : new Date().toISOString().slice(0, 10).replace(/-/g, '');

  return `${slug(homeTeam)}-${slug(awayTeam)}-${dateStr}`;
}

/**
 * Calcula TTL baseado no tempo restante para o jogo.
 * @param matchDatetime ISO string da partida (ex: "2026-03-15T20:00:00Z")
 */
function calcTTL(matchDatetime?: string): number {
  if (!matchDatetime) return TTL_NORMAL_MIN;
  const minutesUntilMatch = (new Date(matchDatetime).getTime() - Date.now()) / 60000;
  if (minutesUntilMatch < 0) return 0;       // jogo passado — não cacheia
  if (minutesUntilMatch < 60) return TTL_PREMATCH_MIN;
  return TTL_NORMAL_MIN;
}

/**
 * Detecta line movement comparando odds atuais com odds salvas no cache.
 * Retorna true se qualquer odd principal caiu ≥8%.
 */
export function detectLineMovement(
  savedOdds: Record<string, number> | null,
  currentOdds: Record<string, number>
): boolean {
  if (!savedOdds) return false;

  for (const key of Object.keys(currentOdds)) {
    const saved  = savedOdds[key];
    const current = currentOdds[key];
    if (!saved || !current || saved <= 1) continue;

    const drop = (saved - current) / saved;
    if (drop >= LINE_MOVEMENT_THRESHOLD) {
      console.info(`[Cache] Line movement detectado em "${key}": ${saved} → ${current} (${(drop * 100).toFixed(1)}%)`);
      return true;
    }
  }
  return false;
}

// ─── API Pública ─────────────────────────────────────────────

/**
 * Busca análise cacheada no Supabase.
 * Retorna null se:
 *   - Cache miss
 *   - Expirado
 *   - Invalidado
 *   - Line movement detectado nas odds atuais
 */
export async function getCachedAnalysis(
  fixtureKey: string,
  currentOdds?: Record<string, number>
): Promise<any | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('analysis_cache')
      .select('*')
      .eq('fixture_key', fixtureKey)
      .eq('invalidated', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;

    const entry = data as CacheEntry;

    // Verifica line movement se odds atuais foram fornecidas
    if (currentOdds && detectLineMovement(entry.opening_odds, currentOdds)) {
      await invalidateCacheEntry(fixtureKey, 'line_movement');
      return null;
    }

    console.info(`[Cache] HIT para "${fixtureKey}" (expira ${entry.expires_at})`);
    return entry.data;
  } catch (err) {
    console.warn('[Cache] Erro ao buscar cache:', err);
    return null;
  }
}

/**
 * Salva análise no Supabase.
 * Faz upsert — se já existir entrada para o fixture_key, atualiza.
 *
 * @param fixtureKey  Chave gerada por buildFixtureKey()
 * @param result      Objeto completo da análise
 * @param currentOdds Odds no momento da análise (para detecção futura de line movement)
 * @param matchDatetime ISO datetime da partida (para calcular TTL)
 */
export async function setCachedAnalysis(
  fixtureKey: string,
  result: any,
  currentOdds?: Record<string, number>,
  matchDatetime?: string
): Promise<void> {
  if (!supabase) return;

  const ttlMin = calcTTL(matchDatetime);
  if (ttlMin === 0) {
    console.info(`[Cache] Jogo passado — não cacheando "${fixtureKey}"`);
    return;
  }

  const expires_at = new Date(Date.now() + ttlMin * 60000).toISOString();

  try {
    const { error } = await supabase
      .from('analysis_cache')
      .upsert(
        {
          fixture_key: fixtureKey,
          data: result,
          opening_odds: currentOdds ?? null,
          expires_at,
          invalidated: false,
          invalidation_reason: null,
        },
        { onConflict: 'fixture_key' }
      );

    if (error) {
      console.warn('[Cache] Erro ao salvar cache:', error);
    } else {
      console.info(`[Cache] SALVO "${fixtureKey}" — TTL ${ttlMin}min (expira ${expires_at})`);
    }
  } catch (err) {
    console.warn('[Cache] Exceção ao salvar cache:', err);
  }
}

/**
 * Invalida uma entrada de cache.
 * Chamado quando line movement é detectado ou manualmente.
 */
export async function invalidateCacheEntry(
  fixtureKey: string,
  reason: InvalidationReason = 'manual'
): Promise<void> {
  if (!supabase) return;

  try {
    await supabase
      .from('analysis_cache')
      .update({ invalidated: true, invalidation_reason: reason })
      .eq('fixture_key', fixtureKey);

    console.info(`[Cache] INVALIDADO "${fixtureKey}" — motivo: ${reason}`);
  } catch (err) {
    console.warn('[Cache] Erro ao invalidar cache:', err);
  }
}

/**
 * Limpa entradas expiradas do cache.
 * Chamar periodicamente (ex: 1x por dia no mount do app).
 */
export async function cleanExpiredCache(): Promise<void> {
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('analysis_cache')
      .delete()
      .lt('expires_at', new Date().toISOString());

    if (!error) {
      console.info('[Cache] Entradas expiradas removidas.');
    }
  } catch (err) {
    console.warn('[Cache] Erro ao limpar cache expirado:', err);
  }
}

/**
 * Verifica se existe cache válido para um fixture (sem retornar os dados).
 * Útil para mostrar indicador de "análise cacheada" na UI.
 */
export async function hasCachedAnalysis(fixtureKey: string): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { data } = await supabase
      .from('analysis_cache')
      .select('id')
      .eq('fixture_key', fixtureKey)
      .eq('invalidated', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    return !!data;
  } catch {
    return false;
  }
}

/**
 * Retorna metadados do cache para um fixture (sem os dados da análise).
 * Útil para mostrar "última análise há X min" na UI.
 */
export async function getCacheMetadata(fixtureKey: string): Promise<{
  cached: boolean;
  created_at: string | null;
  expires_at: string | null;
  invalidated: boolean;
} | null> {
  if (!supabase) return null;

  try {
    const { data } = await supabase
      .from('analysis_cache')
      .select('cached:id, created_at, expires_at, invalidated')
      .eq('fixture_key', fixtureKey)
      .maybeSingle();

    if (!data) return { cached: false, created_at: null, expires_at: null, invalidated: false };

    return {
      cached: !data.invalidated && new Date(data.expires_at) > new Date(),
      created_at: data.created_at,
      expires_at: data.expires_at,
      invalidated: data.invalidated,
    };
  } catch {
    return null;
  }
}
