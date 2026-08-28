/**
 * clvService.ts — Closing Line Value (CLV) Tracker
 *
 * CLV% = (Odd Utilizada / Odd de Fechamento - 1) × 100
 *
 * [M-01 FIX] Todas as chaves localStorage agora são prefixadas com userId,
 * impedindo que dados de CLV de um usuário vazem para outro no mesmo dispositivo.
 */

import { Match } from '../types';
import { getCachedProfile } from './planService';
import { supabase } from './supabaseClient';

export interface CLVEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  sportKey: string;
  commenceTime: string;
  mercado: string;
  oddUtilizada: number;
  oddFechamento: number | null;
  clvPct: number | null;
  resultado: 'GREEN' | 'RED' | 'VOID' | 'PENDENTE';
  analyzedAt: string;
  closedAt: string | null;
}

export interface CLVSummary {
  totalEntradas: number;
  comCLV: number;
  clvMedioGeral: number;
  clvMedioAprovadas: number;
  positivoCLVRate: number;
  isSharp: boolean;
}

// ─── Chaves userId-prefixadas ───────────────────────────────────────────────

function getCLVStorageKey(): string {
  const profile = getCachedProfile();
  return `evengine_clv_entries${profile?.id ? `_${profile.id}` : ''}`;
}

function getCLVClosingCacheKey(): string {
  const profile = getCachedProfile();
  return `evengine_clv_closing_odds${profile?.id ? `_${profile.id}` : ''}`;
}

// ─── Persistência ──────────────────────────────────────────────────────────

function loadEntries(): CLVEntry[] {
  try {
    const raw = localStorage.getItem(getCLVStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveEntries(entries: CLVEntry[]): void {
  try { localStorage.setItem(getCLVStorageKey(), JSON.stringify(entries)); } catch {}
}

function loadClosingCache(): Record<string, { odd: number; ts: number }> {
  try {
    const raw = localStorage.getItem(getCLVClosingCacheKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveClosingCache(data: Record<string, { odd: number; ts: number }>): void {
  try { localStorage.setItem(getCLVClosingCacheKey(), JSON.stringify(data)); } catch {}
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function calcCLV(oddUtilizada: number, oddFechamento: number): number {
  return parseFloat(((oddUtilizada / oddFechamento - 1) * 100).toFixed(2));
}

function getPinnacleOdd(match: Match, mercado: string): number | null {
  const bk = match.bookmakers?.find(b => b.key === 'pinnacle') ?? match.bookmakers?.[0];
  if (!bk) return null;

  const h2h = bk.markets?.find(m => m.key === 'h2h');
  const totals = bk.markets?.find(m => m.key === 'totals');
  const btts = bk.markets?.find(m => m.key === 'btts');
  const dcMarket = bk.markets?.find(m => m.key === 'double_chance');

  const m = mercado.toLowerCase();
  const imp = (odd: number) => odd > 1 ? 1 / odd : 0;

  if (m.startsWith('vitória casa') || m === 'home' || m === 'casa') {
    return h2h?.outcomes.find(o => o.name === match.home_team)?.price ?? null;
  }
  if (m.startsWith('vitória visitante') || m === 'away' || m === 'visitante') {
    return h2h?.outcomes.find(o => o.name === match.away_team)?.price ?? null;
  }
  if (m.startsWith('empate') || m === 'draw') {
    return h2h?.outcomes.find(o => o.name === 'Draw')?.price ?? null;
  }

  if (m.includes('dnb') || m.includes('draw no bet')) {
    if (!h2h) return null;
    const pHome = imp(h2h.outcomes.find(o => o.name === match.home_team)?.price ?? 0);
    const pAway = imp(h2h.outcomes.find(o => o.name === match.away_team)?.price ?? 0);
    if (pHome <= 0 || pAway <= 0) return null;
    if (m.includes('casa') || m.includes('home')) return parseFloat((1 / (pHome / (pHome + pAway))).toFixed(3));
    if (m.includes('visitante') || m.includes('away')) return parseFloat((1 / (pAway / (pHome + pAway))).toFixed(3));
    return null;
  }

  if (m.includes('dupla chance') || m.includes('double chance')) {
    if (dcMarket) {
      if (m.includes('1x')) return dcMarket.outcomes.find(o => o.name === '1X')?.price ?? null;
      if (m.includes('x2')) return dcMarket.outcomes.find(o => o.name === 'X2')?.price ?? null;
      if (m.includes('12')) return dcMarket.outcomes.find(o => o.name === '12')?.price ?? null;
    }
    if (!h2h) return null;
    const pH = imp(h2h.outcomes.find(o => o.name === match.home_team)?.price ?? 0);
    const pD = imp(h2h.outcomes.find(o => o.name === 'Draw')?.price ?? 0);
    const pA = imp(h2h.outcomes.find(o => o.name === match.away_team)?.price ?? 0);
    if (m.includes('1x')) return pH + pD > 0 ? parseFloat((1 / (pH + pD)).toFixed(3)) : null;
    if (m.includes('x2')) return pD + pA > 0 ? parseFloat((1 / (pD + pA)).toFixed(3)) : null;
    if (m.includes('12')) return pH + pA > 0 ? parseFloat((1 / (pH + pA)).toFixed(3)) : null;
    return null;
  }

  if (m.includes('over') || m.includes('under') || m.includes('mais de') || m.includes('menos de')) {
    if (totals) {
      const lineMatch = mercado.match(/(\d+[.,]\d+|\d+)/);
      const lineNum = lineMatch ? parseFloat(lineMatch[1].replace(',', '.')) : null;
      if (lineNum !== null) {
        const overOutcome = totals.outcomes.find(o =>
          o.name.toLowerCase().includes('over') && o.point !== undefined && o.point === lineNum
        ) ?? totals.outcomes.find(o => o.name === 'Over');
        const underOutcome = totals.outcomes.find(o =>
          o.name.toLowerCase().includes('under') && o.point !== undefined && o.point === lineNum
        ) ?? totals.outcomes.find(o => o.name === 'Under');
        if (m.includes('over') || m.includes('mais de')) return overOutcome?.price ?? null;
        if (m.includes('under') || m.includes('menos de')) return underOutcome?.price ?? null;
      }
      if (m.includes('over') || m.includes('mais de')) return totals.outcomes.find(o => o.name === 'Over')?.price ?? null;
      if (m.includes('under') || m.includes('menos de')) return totals.outcomes.find(o => o.name === 'Under')?.price ?? null;
    }
    return null;
  }

  if (m.includes('btts') || m.includes('ambas marcam') || m.includes('both teams')) {
    if (btts) {
      if (m.includes('sim') || m.includes('yes')) return btts.outcomes.find(o => o.name === 'Yes')?.price ?? null;
      if (m.includes('não') || m.includes('no')) return btts.outcomes.find(o => o.name === 'No')?.price ?? null;
    }
    return null;
  }

  return null;
}

// ─── API pública ───────────────────────────────────────────────────────────

export function registrarEntradaCLV(params: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  sportKey: string;
  commenceTime: string;
  mercado: string;
  oddUtilizada: number;
}): void {
  const entries = loadEntries();
  if (entries.find(e => e.matchId === params.matchId && e.mercado === params.mercado)) return;

  const now = new Date().toISOString();
  entries.push({
    ...params,
    oddFechamento: null,
    clvPct: null,
    resultado: 'PENDENTE',
    analyzedAt: now,
    closedAt: null
  });

  saveEntries(entries);

  // Sincronizar com Supabase para captura server-side de odds de fechamento
  if (supabase) {
    const profile = getCachedProfile();
    supabase.from('clv_entries').upsert({
      match_id: params.matchId,
      mercado: params.mercado,
      home_team: params.homeTeam,
      away_team: params.awayTeam,
      sport_key: params.sportKey,
      commence_time: params.commenceTime,
      odd_utilizada: params.oddUtilizada,
      resultado: 'PENDENTE',
      analyzed_at: now,
      user_id: profile?.id ?? null,
    }, { onConflict: 'match_id,mercado' }).then(({ error }) => {
      if (error) console.warn('[CLV] Falha ao sincronizar com Supabase:', error.message);
    });
  }
}

export function capturarOddsFechamento(matchesAtivos: Match[]): void {
  const entries = loadEntries();
  const closingCache = loadClosingCache();
  let changed = false;

  const now = Date.now();
  const KICKOFF_WINDOW_MS = 30 * 60 * 1000;

  entries.forEach(entry => {
    if (entry.oddFechamento !== null) return;
    if (entry.resultado !== 'PENDENTE') return;

    const kickoff = new Date(entry.commenceTime).getTime();
    const afterKickoff = now >= kickoff;
    const withinWindow = now - kickoff <= KICKOFF_WINDOW_MS;

    if (!afterKickoff) return;

    const cacheKey = `${entry.matchId}_${entry.mercado}`;
    if (closingCache[cacheKey]) {
      entry.oddFechamento = closingCache[cacheKey].odd;
      entry.clvPct = calcCLV(entry.oddUtilizada, entry.oddFechamento);
      entry.closedAt = new Date(closingCache[cacheKey].ts).toISOString();
      changed = true;
      return;
    }

    if (!withinWindow) return;

    const match = matchesAtivos.find(m => m.id === entry.matchId);
    if (!match) return;

    const odd = getPinnacleOdd(match, entry.mercado);
    if (!odd) return;

    entry.oddFechamento = odd;
    entry.clvPct = calcCLV(entry.oddUtilizada, odd);
    entry.closedAt = new Date().toISOString();

    closingCache[cacheKey] = { odd, ts: Date.now() };
    changed = true;
  });

  if (changed) {
    saveEntries(entries);
    saveClosingCache(closingCache);
  }
}

export function atualizarResultadoCLV(matchId: string, resultado: 'GREEN' | 'RED' | 'VOID'): void {
  const entries = loadEntries();
  const entry = entries.find(e => e.matchId === matchId);
  if (entry) {
    entry.resultado = resultado;
    saveEntries(entries);
  }
}

export function getEntradasCLV(): CLVEntry[] {
  return loadEntries();
}

export function getCLVSummary(): CLVSummary {
  const entries = loadEntries();
  const comCLV = entries.filter(e => e.clvPct !== null);

  const clvMedioGeral = comCLV.length > 0
    ? parseFloat((comCLV.reduce((s, e) => s + (e.clvPct ?? 0), 0) / comCLV.length).toFixed(2))
    : 0;

  const greens = comCLV.filter(e => e.resultado === 'GREEN');
  const clvMedioAprovadas = greens.length > 0
    ? parseFloat((greens.reduce((s, e) => s + (e.clvPct ?? 0), 0) / greens.length).toFixed(2))
    : 0;

  const positivoCLVRate = comCLV.length > 0
    ? parseFloat(((comCLV.filter(e => (e.clvPct ?? 0) > 0).length / comCLV.length) * 100).toFixed(1))
    : 0;

  return {
    totalEntradas: entries.length,
    comCLV: comCLV.length,
    clvMedioGeral,
    clvMedioAprovadas,
    positivoCLVRate,
    isSharp: clvMedioGeral >= 1.5 && comCLV.length >= 10
  };
}

export function limparEntradasAntigas(): void {
  const CUTOFF_90D = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const CUTOFF_24H = Date.now() - 24 * 60 * 60 * 1000;

  const entries = loadEntries().filter(e => {
    if (new Date(e.analyzedAt).getTime() <= CUTOFF_90D) return false;
    if (
      e.resultado === 'PENDENTE' &&
      e.oddFechamento === null &&
      new Date(e.commenceTime).getTime() < CUTOFF_24H
    ) {
      console.info(`[CLV] Entrada expirada removida: ${e.homeTeam} × ${e.awayTeam} (${e.commenceTime})`);
      return false;
    }
    return true;
  });

  saveEntries(entries);
}

export function exportarCLVcsv(): string {
  const entries = loadEntries();
  const header = 'Data,Casa,Visitante,Mercado,Odd Utilizada,Odd Fechamento,CLV%,Resultado';
  const rows = entries.map(e => [
    e.analyzedAt.split('T')[0],
    e.homeTeam,
    e.awayTeam,
    e.mercado,
    e.oddUtilizada,
    e.oddFechamento ?? '',
    e.clvPct ?? '',
    e.resultado
  ].join(','));
  return [header, ...rows].join('\n');
}

export function corrigirEntradaCLV(matchId: string, novoMercado: string, novaOdd: number): boolean {
  const entries = loadEntries();
  const entry = entries.find(e => e.matchId === matchId);
  if (!entry) return false;

  if (entry.mercado === novoMercado && entry.oddUtilizada === novaOdd) return false;

  entry.mercado = novoMercado;
  entry.oddUtilizada = novaOdd;

  if (entry.oddFechamento !== null) {
    entry.clvPct = calcCLV(novaOdd, entry.oddFechamento);
  }

  saveEntries(entries);
  return true;
}

/**
 * Sincroniza o resultado (GREEN/RED/VOID) de uma entrada CLV com o Supabase.
 * Chamado automaticamente após auto-resolve de apostas.
 */
export async function sincronizarResultadoCLV(
  matchId: string,
  resultado: 'GREEN' | 'RED' | 'VOID'
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from('clv_entries')
      .update({ resultado })
      .eq('match_id', matchId)
      .eq('resultado', 'PENDENTE');
  } catch (e) {
    console.warn('[CLV] Falha ao sincronizar resultado:', e);
  }

  const entries = loadEntries();
  const entry = entries.find(e => e.matchId === matchId);
  if (entry && entry.resultado === 'PENDENTE') {
    entry.resultado = resultado;
    saveEntries(entries);
  }
}

/**
 * [M-01 FIX] Limpa todas as chaves CLV do usuário no logout.
 * Chamar no handler SIGNED_OUT do supabaseClient.
 */
export function clearCLVOnSignOut(userId: string): void {
  localStorage.removeItem(`evengine_clv_entries_${userId}`);
  localStorage.removeItem(`evengine_clv_closing_odds_${userId}`);
}
