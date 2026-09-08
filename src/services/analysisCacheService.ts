/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cache compartilhado de análises no Supabase, isolado por plan_tier.
 *
 * [C-01 FIX] Adicionada coluna plan_tier: uma análise cacheada para um plano
 * superior NÃO é retornada para usuários de planos inferiores.
 * Hierarquia: free < pro < sharp
 *
 * TTL:
 *   - Análise normal (>60min pré-jogo): 4 horas
 *   - Pré-jogo (<60min): 20 minutos
 *   - Line movement ≥3pp detectado: invalida imediatamente
 *   - Jogo ao vivo / passado: não cacheia
 */

import { supabase } from './supabaseClient';

export interface CacheEntry {
  id: string;
  fixture_key: string;
  plan_tier: string;
  data: any;
  opening_odds: any | null;
  created_at: string;
  expires_at: string;
  invalidated: boolean;
  invalidation_reason: string | null;
}

export type InvalidationReason = 'line_movement' | 'manual' | 'ttl';
export type PlanTier = 'free' | 'pro' | 'sharp';

const TTL_NORMAL_MIN   = 240;
const TTL_PREMATCH_MIN = 20;
const LINE_MOVEMENT_THRESHOLD = 0.03;

// [C-01] Plans a given tier is allowed to access (own tier + lower tiers' cache)
const ACCESSIBLE_TIERS: Record<PlanTier, PlanTier[]> = {
  free:  ['free'],
  pro:   ['free', 'pro'],
  sharp: ['free', 'pro', 'sharp'],
};

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

function calcTTL(matchDatetime?: string): number {
  if (!matchDatetime) return TTL_NORMAL_MIN;
  const minutesUntilMatch = (new Date(matchDatetime).getTime() - Date.now()) / 60000;
  if (minutesUntilMatch < 0) return 0;
  if (minutesUntilMatch < 60) return TTL_PREMATCH_MIN;
  return TTL_NORMAL_MIN;
}

export function detectLineMovement(
  savedOdds: Record<string, number> | null,
  currentOdds: Record<string, number>
): boolean {
  if (!savedOdds) return false;

  for (const key of Object.keys(currentOdds)) {
    const saved   = savedOdds[key];
    const current = currentOdds[key];
    if (!saved || !current || saved <= 1 || current <= 1) continue;

    const probDelta = Math.abs(1 / current - 1 / saved);
    if (probDelta >= LINE_MOVEMENT_THRESHOLD) {
      const direction = (1 / current) > (1 / saved) ? '↑' : '↓';
      console.info(`[Cache] Line movement em "${key}": ${saved}→${current} (${direction}${(probDelta * 100).toFixed(1)}pp)`);
      return true;
    }
  }
  return false;
}

/**
 * [C-01 FIX] planTier param required — filters cache to entries accessible
 * by the user's current plan. Free users never see pro/sharp cached analyses.
 */
export async function getCachedAnalysis(
  fixtureKey: string,
  planTier: PlanTier = 'free',
  currentOdds?: Record<string, number>
): Promise<any | null> {
  // Local cache check (no plan isolation at localStorage level — data is same device)
  try {
    const localRaw = localStorage.getItem(`ev_cache_${fixtureKey}_${planTier}`);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() > Date.now()) {
        console.info(`[Cache Local] HIT para "${fixtureKey}" (${planTier})`);
        return parsed.data;
      } else {
        localStorage.removeItem(`ev_cache_${fixtureKey}_${planTier}`);
      }
    }
  } catch {}

  if (!supabase) return null;

  try {
    const allowedTiers = ACCESSIBLE_TIERS[planTier];

    const { data, error } = await supabase
      .from('analysis_cache')
      .select('*')
      .eq('fixture_key', fixtureKey)
      .eq('invalidated', false)
      .gt('expires_at', new Date().toISOString())
      .in('plan_tier', allowedTiers)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[Cache Supabase] Erro ao consultar cache:', error.message);
      return null;
    }

    if (!data) return null;

    const entry = data as CacheEntry;

    if (currentOdds && detectLineMovement(entry.opening_odds, currentOdds)) {
      await invalidateCacheEntry(fixtureKey, 'line_movement');
      return null;
    }

    try {
      localStorage.setItem(`ev_cache_${fixtureKey}_${planTier}`, JSON.stringify({
        data: entry.data,
        expiresAt: entry.expires_at
      }));
    } catch {}

    console.info(`[Cache Supabase] HIT para "${fixtureKey}" (plan: ${entry.plan_tier}, expira ${entry.expires_at})`);
    return entry.data;
  } catch (err) {
    console.warn('[Cache Supabase] Exceção ao buscar cache:', err);
    return null;
  }
}

/**
 * [C-01 FIX] planTier param required — tags cache entry with the plan tier
 * that generated it, so lower-tier users cannot consume it.
 */
export async function setCachedAnalysis(
  fixtureKey: string,
  result: any,
  planTier: PlanTier = 'free',
  currentOdds?: Record<string, number>,
  matchDatetime?: string
): Promise<void> {
  const ttlMin = calcTTL(matchDatetime);
  if (ttlMin === 0) {
    console.info(`[Cache] Jogo passado — não cacheando "${fixtureKey}"`);
    return;
  }

  const expires_at = new Date(Date.now() + ttlMin * 60000).toISOString();

  try {
    localStorage.setItem(`ev_cache_${fixtureKey}_${planTier}`, JSON.stringify({
      data: result,
      expiresAt: expires_at
    }));
  } catch {}

  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('analysis_cache')
      .upsert(
        {
          fixture_key: fixtureKey,
          plan_tier: planTier,
          data: result,
          opening_odds: currentOdds ?? null,
          expires_at,
          invalidated: false,
          invalidation_reason: null,
        },
        { onConflict: 'fixture_key,plan_tier' }
      );

    if (error) {
      console.warn('[Cache Supabase] Erro ao salvar no Supabase:', error.message);
    } else {
      console.info(`[Cache Supabase] SALVO "${fixtureKey}" (plan: ${planTier}) — TTL ${ttlMin}min`);
    }
  } catch (err) {
    console.warn('[Cache Supabase] Exceção ao salvar cache:', err);
  }
}

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

export async function hasCachedAnalysis(fixtureKey: string, planTier: PlanTier = 'free'): Promise<boolean> {
  if (!supabase) return false;

  try {
    const allowedTiers = ACCESSIBLE_TIERS[planTier];
    const { data } = await supabase
      .from('analysis_cache')
      .select('id')
      .eq('fixture_key', fixtureKey)
      .eq('invalidated', false)
      .gt('expires_at', new Date().toISOString())
      .in('plan_tier', allowedTiers)
      .limit(1)
      .maybeSingle();

    return !!data;
  } catch {
    return false;
  }
}

export async function getCacheMetadata(fixtureKey: string, planTier: PlanTier = 'free'): Promise<{
  cached: boolean;
  created_at: string | null;
  expires_at: string | null;
  invalidated: boolean;
} | null> {
  if (!supabase) return null;

  try {
    const allowedTiers = ACCESSIBLE_TIERS[planTier];
    const { data } = await supabase
      .from('analysis_cache')
      .select('id, created_at, expires_at, invalidated')
      .eq('fixture_key', fixtureKey)
      .in('plan_tier', allowedTiers)
      .order('created_at', { ascending: false })
      .limit(1)
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

// ─── Registro persistente de análises feitas (TTL 24h) ──────────────────────
// Permite que o filtro "ANALISADAS" funcione mesmo após logout/login.

const ANALYZED_LOG_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

function getAnalyzedLogKey(userId?: string): string {
  return `evengine_analyzed_log${userId ? `_${userId}` : ''}`;
}

export interface AnalyzedLogEntry {
  fixtureKey: string;
  matchId: string;
  analyzedAt: string; // ISO
}

export function markMatchAsAnalyzed(matchId: string, fixtureKey: string, userId?: string): void {
  try {
    const key = getAnalyzedLogKey(userId);
    const raw = localStorage.getItem(key);
    const log: Record<string, AnalyzedLogEntry> = raw ? JSON.parse(raw) : {};
    log[matchId] = { fixtureKey, matchId, analyzedAt: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(log));
  } catch {}
}

export function getAnalyzedLog(userId?: string): Record<string, AnalyzedLogEntry> {
  try {
    const key = getAnalyzedLogKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const log: Record<string, AnalyzedLogEntry> = JSON.parse(raw);
    const now = Date.now();
    // Limpar entradas expiradas
    const cleaned: Record<string, AnalyzedLogEntry> = {};
    for (const [id, entry] of Object.entries(log)) {
      if (now - new Date(entry.analyzedAt).getTime() < ANALYZED_LOG_TTL_MS) {
        cleaned[id] = entry;
      }
    }
    if (Object.keys(cleaned).length !== Object.keys(log).length) {
      localStorage.setItem(key, JSON.stringify(cleaned));
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function wasAnalyzedWithin24h(matchId: string, userId?: string): boolean {
  const log = getAnalyzedLog(userId);
  const entry = log[matchId];
  if (!entry) return false;
  return Date.now() - new Date(entry.analyzedAt).getTime() < ANALYZED_LOG_TTL_MS;
}

export function clearAnalyzedLog(userId?: string): void {
  try {
    localStorage.removeItem(getAnalyzedLogKey(userId));
  } catch {}
}

/**
 * Busca do Supabase os match_ids que o usuário analisou nas últimas 24h.
 * Usado para sincronizar o filtro "ANALISADAS" entre dispositivos.
 */
export async function fetchAnalyzedMatchIdsLast24h(userId: string): Promise<Set<string>> {
  if (!supabase || !userId) return new Set();
  try {
    const since = new Date(Date.now() - ANALYZED_LOG_TTL_MS).toISOString();
    const { data, error } = await supabase
      .from('analyses')
      .select('match_id')
      .eq('user_id', userId)
      .gte('created_at', since);

    if (error || !data) return new Set();
    return new Set(data.map((r: any) => r.match_id).filter(Boolean));
  } catch {
    return new Set();
  }
}
