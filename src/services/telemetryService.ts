import { supabase } from './supabaseClient';
import type { TipsterEngineResult } from '../types';

let geminiCallCountThisAnalysis = 0;

export function resetGeminiCallCounter(): void {
  geminiCallCountThisAnalysis = 0;
}

export function trackGeminiCall(origem: string): void {
  geminiCallCountThisAnalysis++;
  console.info(`[Gemini Telemetry] Chamada #${geminiCallCountThisAnalysis} — origem: ${origem}`);
}

export function getGeminiCallCount(): number {
  return geminiCallCountThisAnalysis;
}

export function trackPrecheckSkip(motivo: string): void {
  console.info(`[Telemetry] Fallback Gemini evitado via pre-check: ${motivo}`);
}

// ─── Helper: retorna user_id autenticado ────────────────────────────────────
async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function sanitizarNumerico(valor: any, max = 999.99, casas = 2): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  if (!isFinite(n) || isNaN(n)) return null;
  const clamped = Math.max(-max, Math.min(max, n));
  return Number(clamped.toFixed(casas));
}

function sanitizarPayload(p: any): any {
  return {
    user_id: p.user_id,           // [SEC-FIX] obrigatório para RLS
    match_id: p.match_id,
    home_team: p.home_team,
    away_team: p.away_team,
    league: p.league,
    tier: p.tier ?? null,
    market: p.market ?? 'h2h',
    odd_bet365_manual: p.odd_bet365_manual ?? null,
    odd_pinnacle: p.odd_pinnacle ?? null,
    odd_betfair: p.odd_betfair ?? null,
    prob_fair: p.prob_fair ?? null,
    prob_ia: p.prob_ia ?? 0,
    sharp_bookmaker: p.sharp_bookmaker ?? null,
    has_reference: p.has_reference ?? false,
    ev_execution: p.ev_execution ?? null,
    ev_market_deviation: p.ev_market_deviation ?? null,
    kelly_calculated: p.kelly_calculated ?? 0,
    ia_confidence: p.ia_confidence ?? 0,
    composite_score: p.composite_score ?? 0,
    gate_status: p.gate_status ?? 'BLOQUEADO',
    block_reasons: p.block_reasons ?? [],
    raw_engine_input: p.raw_engine_input ?? {},
    poisson_data_source: p.poisson_data_source ?? 'unknown',
    match_datetime: p.match_datetime ?? null
  };
}

/**
 * Grava uma análise no Supabase vinculada ao usuário autenticado.
 * [SEC-FIX] Adicionado user_id ao payload — sem ele, a inserção falha por RLS.
 */
export async function logAnalysis(
  matchData: any,
  engineResult: TipsterEngineResult,
  oddManual: number | null,
  poissonSource?: string
): Promise<string | null> {
  if (!supabase) return null;

  if (matchData.id && matchData.id.startsWith('mock_match_')) return null;

  // [SEC-FIX] Exige usuário autenticado para gravar análise
  const userId = await getCurrentUserId();
  if (!userId) {
    console.warn('[Telemetry] Usuário não autenticado — análise não gravada.');
    return null;
  }

  try {
    const payload = {
      user_id: userId,             // [SEC-FIX] vincula análise ao usuário
      match_id: matchData.id,
      home_team: matchData.home_team,
      away_team: matchData.away_team,
      league: matchData.sport_title || matchData.sport_key,
      tier: engineResult.tier || (engineResult.sharp_context ? 'A' : null),
      market: engineResult.market || engineResult.mercado_selecionado?.nome || engineResult.mercado?.nome || 'h2h',
      odd_bet365_manual: sanitizarNumerico(oddManual),
      odd_pinnacle: sanitizarNumerico(engineResult.mercado_selecionado?.odd_referencia || engineResult.marketReference?.rawOdds?.[0]),
      odd_betfair: engineResult.marketReference?.sharpBookmaker === 'betfair_ex_eu'
        ? sanitizarNumerico(engineResult.marketReference.rawOdds[0]) : null,
      prob_fair: sanitizarNumerico(engineResult.mercado_selecionado?.probabilidade_elo || engineResult.marketReference?.fairProbs?.[0], 100, 2),
      prob_ia: sanitizarNumerico(engineResult.mercado_selecionado?.probabilidade_final || engineResult.probIA || engineResult.mercado?.probabilidade_ia, 100, 2),
      sharp_bookmaker: engineResult.marketReference?.sharpBookmaker || 'pinnacle',
      has_reference: !!engineResult.mercado_selecionado?.odd_referencia || (engineResult.marketReference?.hasReference || false),
      ev_execution: sanitizarNumerico(engineResult.mercado_selecionado?.ev || engineResult.evExecution, 999.99, 2),
      ev_market_deviation: sanitizarNumerico(engineResult.evMarketDeviation, 999.99, 2),
      kelly_calculated: sanitizarNumerico(engineResult.stake?.percentual || engineResult.stake?.kelly_base, 100, 2),
      ia_confidence: sanitizarNumerico(engineResult.sharp_context?.confianca_ajustada || engineResult.iaConfidence || engineResult.score?.valor, 100, 2),
      composite_score: sanitizarNumerico(engineResult.sharp_context?.score_composto || engineResult.compositeScore || engineResult.score?.valor, 100, 2),
      gate_status: engineResult.decisao?.status || engineResult.status || 'BLOQUEADO',
      block_reasons: engineResult.score?.motivos_bloqueio || engineResult.blockReasons || (engineResult.bloqueio ? [engineResult.bloqueio.codigo] : []),
      poisson_data_source: poissonSource || 'ia_gemini',
      raw_engine_input: engineResult,
      match_datetime: matchData.commence_time || matchData.date || null
    };

    const payloadSeguro = sanitizarPayload(payload);

    const { data, error } = await supabase
      .from('analyses')
      .insert(payloadSeguro)
      .select('id')
      .single();

    if (error) {
      console.warn('[Telemetry] Falha ao gravar análise:', error.message);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.warn('[Telemetry] Erro inesperado:', err);
    return null;
  }
}

/**
 * Retorna as últimas N análises do usuário autenticado (mais recentes primeiro).
 * [SEC-FIX] Era sem filtro — retornava análises de TODOS os usuários.
 */
export async function fetchRecentAnalyses(limit = 50): Promise<any[]> {
  if (!supabase) return [];

  const userId = await getCurrentUserId();
  if (!userId) return [];

  try {
    const { data, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('user_id', userId)          // [SEC-FIX] filtro por usuário
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Telemetry] Falha ao buscar análises:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[Telemetry] Erro inesperado:', err);
    return [];
  }
}

/**
 * Retorna estatísticas agregadas do período (default: últimos 7 dias).
 * [SEC-FIX] Filtrado por user_id — antes agregava dados de todos os usuários.
 */
export async function fetchStats(daysBack = 7): Promise<{
  total: number;
  aprovados: number;
  bloqueados: number;
  taxaBloqueio: number;
  motivosTop: { reason: string; count: number }[];
  ligasTop: { league: string; count: number }[];
}> {
  const empty = { total: 0, aprovados: 0, bloqueados: 0, taxaBloqueio: 0, motivosTop: [], ligasTop: [] };
  if (!supabase) return empty;

  const userId = await getCurrentUserId();
  if (!userId) return empty;

  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('analyses')
      .select('gate_status, block_reasons, league')
      .eq('user_id', userId)          // [SEC-FIX] filtro por usuário
      .gte('created_at', since);

    if (error || !data) {
      console.warn('[Telemetry] Falha ao buscar stats:', error?.message);
      return empty;
    }

    const total = data.length;
    const aprovados = data.filter(d => d.gate_status === 'APROVADO').length;
    const bloqueados = total - aprovados;
    const taxaBloqueio = total > 0 ? (bloqueados / total) * 100 : 0;

    const motivosMap = new Map<string, number>();
    data.forEach(d => {
      (d.block_reasons || []).forEach((r: string) => {
        motivosMap.set(r, (motivosMap.get(r) || 0) + 1);
      });
    });
    const motivosTop = Array.from(motivosMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const ligasMap = new Map<string, number>();
    data.forEach(d => {
      ligasMap.set(d.league, (ligasMap.get(d.league) || 0) + 1);
    });
    const ligasTop = Array.from(ligasMap.entries())
      .map(([league, count]) => ({ league, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { total, aprovados, bloqueados, taxaBloqueio, motivosTop, ligasTop };
  } catch (err) {
    console.warn('[Telemetry] Erro inesperado:', err);
    return empty;
  }
}

/**
 * Atualiza o resultado de uma partida — restrito ao usuário autenticado.
 * [SEC-FIX] Era filtrado só por match_id — qualquer usuário podia sobrescrever resultado alheio.
 */
export async function updateMatchResultInSupabase(
  matchId: string,
  placar: string,
  ignorado = false
): Promise<boolean> {
  if (!supabase) return false;

  const userId = await getCurrentUserId();
  if (!userId) return false;

  try {
    const { error } = await supabase
      .from('analyses')
      .update({
        resultado_registrado: !ignorado,
        resultado_placar: placar,
        resultado_data: new Date().toISOString(),
        resultado_ignorado: ignorado
      })
      .eq('match_id', matchId)
      .eq('user_id', userId);         // [SEC-FIX] só atualiza análises do próprio usuário

    if (error) {
      console.warn('[Telemetry] Falha ao atualizar resultado no Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Telemetry] Erro ao atualizar resultado no Supabase:', err);
    return false;
  }
}
