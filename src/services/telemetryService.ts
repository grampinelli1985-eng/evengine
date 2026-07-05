import { supabase } from './supabaseClient';
import type { TipsterEngineResult } from '../types';

function sanitizarNumerico(valor: any, max = 999.99, casas = 2): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  if (!isFinite(n) || isNaN(n)) return null;
  const clamped = Math.max(-max, Math.min(max, n));
  return Number(clamped.toFixed(casas));
}


function sanitizarPayload(p: any): any {
  return {
    match_id: p.match_id,
    home_team: p.home_team,
    away_team: p.away_team,
    league: p.league,
    tier: p.tier ?? null,
    market: p.market ?? 'h2h',
    odd_manual: p.odd_manual ?? p.odd_bet365_manual ?? null,
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
 * Grava uma análise no Supabase. Falhas NÃO propagam —
 * apenas são logadas via console.warn. A app continua funcionando
 * normalmente mesmo se o Supabase estiver fora do ar.
 * 
 * @returns o ID gerado pela inserção, ou null se falhou
 */
export async function logAnalysis(
  matchData: any,
  engineResult: TipsterEngineResult,
  oddManual: number | null,
  poissonSource?: string
): Promise<string | null> {

  if (!supabase) return null;
  
  // Ignorar gravação se for um jogo em modo MOCK para não poluir os dados
  if (matchData.id && matchData.id.startsWith('mock_match_')) {
    return null;
  }
  
  try {
    const payload = {
      match_id: matchData.id,
      home_team: matchData.home_team,
      away_team: matchData.away_team,
      league: matchData.sport_title || matchData.sport_key,
      tier: engineResult.tier || null,
      market: engineResult.market || engineResult.mercado?.nome || 'h2h',
      odd_manual: sanitizarNumerico(oddManual),
      odd_pinnacle: engineResult.marketReference?.sharpBookmaker === 'pinnacle' 
        ? sanitizarNumerico(engineResult.marketReference.rawOdds[0]) : null,
      odd_betfair: engineResult.marketReference?.sharpBookmaker === 'betfair_ex_eu'
        ? sanitizarNumerico(engineResult.marketReference.rawOdds[0]) : null,
      prob_fair: sanitizarNumerico(engineResult.marketReference?.fairProbs?.[0], 100, 2),
      prob_ia: sanitizarNumerico(engineResult.probIA || engineResult.mercado?.probabilidade_ia, 100, 2),
      sharp_bookmaker: engineResult.marketReference?.sharpBookmaker || null,
      has_reference: engineResult.marketReference?.hasReference || false,
      ev_execution: sanitizarNumerico(engineResult.evExecution, 999.99, 2),
      ev_market_deviation: sanitizarNumerico(engineResult.evMarketDeviation, 999.99, 2),
      kelly_calculated: sanitizarNumerico(engineResult.stake?.kelly_base, 100, 2),
      ia_confidence: sanitizarNumerico(engineResult.iaConfidence || engineResult.score, 100, 2),
      composite_score: sanitizarNumerico(engineResult.compositeScore || engineResult.score, 100, 2),
      gate_status: engineResult.status,
      block_reasons: engineResult.blockReasons || (engineResult.bloqueio ? [engineResult.bloqueio.codigo] : []),
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
 * Retorna as últimas N análises gravadas (mais recentes primeiro)
 */
export async function fetchRecentAnalyses(limit = 50): Promise<any[]> {
  if (!supabase) return [];
  
  try {
    const { data, error } = await supabase
      .from('analyses')
      .select('*')
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
 * Retorna estatísticas agregadas do período (default: últimos 7 dias)
 */
export async function fetchStats(daysBack = 7): Promise<{
  total: number;
  aprovados: number;
  bloqueados: number;
  taxaBloqueio: number;
  motivosTop: { reason: string; count: number }[];
  ligasTop: { league: string; count: number }[];
}> {
  if (!supabase) {
    return { total: 0, aprovados: 0, bloqueados: 0, taxaBloqueio: 0, motivosTop: [], ligasTop: [] };
  }
  
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('analyses')
      .select('gate_status, block_reasons, league')
      .gte('created_at', since);
    
    if (error || !data) {
      console.warn('[Telemetry] Falha ao buscar stats:', error?.message);
      return { total: 0, aprovados: 0, bloqueados: 0, taxaBloqueio: 0, motivosTop: [], ligasTop: [] };
    }
    
    const total = data.length;
    const aprovados = data.filter(d => d.gate_status === 'APROVADO').length;
    const bloqueados = total - aprovados;
    const taxaBloqueio = total > 0 ? (bloqueados / total) * 100 : 0;
    
    // Contagem de motivos de bloqueio
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
    
    // Contagem de ligas
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
    return { total: 0, aprovados: 0, bloqueados: 0, taxaBloqueio: 0, motivosTop: [], ligasTop: [] };
  }
}

/**
 * Atualiza o resultado de uma partida no Supabase.
 */
export async function updateMatchResultInSupabase(
  matchId: string,
  placar: string,
  ignorado = false
): Promise<boolean> {
  if (!supabase) return false;
  
  try {
    const { error } = await supabase
      .from('analyses')
      .update({
        resultado_registrado: !ignorado,
        resultado_placar: placar,
        resultado_data: new Date().toISOString(),
        resultado_ignorado: ignorado
      })
      .eq('match_id', matchId);
      
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

