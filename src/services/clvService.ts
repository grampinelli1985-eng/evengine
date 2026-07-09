/**
 * clvService.ts — Closing Line Value (CLV) Tracker
 *
 * CLV = o único indicador de longo prazo de que um apostador é sharp.
 * Se você consistentemente aposta ANTES de a Pinnacle fechar a linha no kickoff,
 * e suas odds são MELHORES que o fechamento, você está batendo o mercado.
 *
 * CLV% = (Odd Utilizada / Odd de Fechamento - 1) × 100
 *
 * CLV positivo = você apostou melhor que o mercado sharp → edge real
 * CLV negativo = você apostou pior que o mercado → sem edge sustentável
 */

import { Match } from '../types';
import { getLineMovement } from './lineMovementService';

export interface CLVEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  sportKey: string;
  commenceTime: string;          // ISO — momento do kickoff
  mercado: string;               // ex: "Vitória Casa", "Over 2.5"
  oddUtilizada: number;          // odd no momento da análise
  oddFechamento: number | null;  // odd da Pinnacle no kickoff (capturada automaticamente)
  clvPct: number | null;         // CLV calculado
  resultado: 'GREEN' | 'RED' | 'VOID' | 'PENDENTE';
  analyzedAt: string;            // ISO — quando foi analisado
  closedAt: string | null;       // ISO — quando o fechamento foi capturado
}

export interface CLVSummary {
  totalEntradas: number;
  comCLV: number;               // entradas com odd de fechamento capturada
  clvMedioGeral: number;        // média de todas as entradas com CLV
  clvMedioAprovadas: number;    // média só dos GREENs
  positivoCLVRate: number;      // % de entradas com CLV > 0
  isSharp: boolean;             // CLV médio >= +1.5% = sharp
}

const CLV_STORAGE_KEY = 'evengine_clv_entries';
const CLV_CLOSING_CACHE_KEY = 'evengine_clv_closing_odds';

// ─── Persistência ──────────────────────────────────────────────────────────

function loadEntries(): CLVEntry[] {
  try {
    const raw = localStorage.getItem(CLV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveEntries(entries: CLVEntry[]): void {
  try { localStorage.setItem(CLV_STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
}

// Cache de odds de fechamento buscadas (evita re-fetch)
function loadClosingCache(): Record<string, { odd: number; ts: number }> {
  try {
    const raw = localStorage.getItem(CLV_CLOSING_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveClosingCache(data: Record<string, { odd: number; ts: number }>): void {
  try { localStorage.setItem(CLV_CLOSING_CACHE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function calcCLV(oddUtilizada: number, oddFechamento: number): number {
  return parseFloat(((oddUtilizada / oddFechamento - 1) * 100).toFixed(2));
}

function getPinnacleOdd(match: Match, mercado: string): number | null {
  const bk = match.bookmakers?.find(b => b.key === 'pinnacle') ?? match.bookmakers?.[0];
  if (!bk) return null;
  const h2h = bk.markets?.find(m => m.key === 'h2h');
  if (!h2h) return null;

  const m = mercado.toLowerCase();
  if (m.includes('casa') || m.includes('home') || m.includes('vitória ' + match.home_team.toLowerCase())) {
    return h2h.outcomes.find(o => o.name === match.home_team)?.price ?? null;
  }
  if (m.includes('visitante') || m.includes('away') || m.includes('vitória ' + match.away_team.toLowerCase())) {
    return h2h.outcomes.find(o => o.name === match.away_team)?.price ?? null;
  }
  if (m.includes('empate') || m.includes('draw')) {
    return h2h.outcomes.find(o => o.name === 'Draw')?.price ?? null;
  }

  // Totais
  const totals = bk.markets?.find(m => m.key === 'totals');
  if (totals) {
    if (m.includes('over')) return totals.outcomes.find(o => o.name === 'Over')?.price ?? null;
    if (m.includes('under')) return totals.outcomes.find(o => o.name === 'Under')?.price ?? null;
  }

  return null;
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Registra uma nova entrada no tracker de CLV.
 * Chamado no momento da análise (antes do kickoff).
 */
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

  // Não duplicar
  if (entries.find(e => e.matchId === params.matchId && e.mercado === params.mercado)) return;

  entries.push({
    ...params,
    oddFechamento: null,
    clvPct: null,
    resultado: 'PENDENTE',
    analyzedAt: new Date().toISOString(),
    closedAt: null
  });

  saveEntries(entries);
}

/**
 * Tenta capturar a odd de fechamento para entradas pendentes cujo kickoff já passou.
 * Recebe o array de partidas atual (com odds da Pinnacle) para lookup.
 * 
 * Em produção, este método seria chamado periodicamente pelo live tracker.
 * As odds da Pinnacle no momento do kickoff são as mais próximas do "real" fechamento.
 */
function getPinnacleOddFromSnapshot(
  snap: { home: number; draw: number; away: number },
  mercado: string,
  homeTeam: string,
  awayTeam: string
): number | null {
  const m = mercado.toLowerCase();
  if (m.includes('casa') || m.includes('home') || m.includes('vitória ' + homeTeam.toLowerCase())) {
    return snap.home;
  }
  if (m.includes('visitante') || m.includes('away') || m.includes('vitória ' + awayTeam.toLowerCase())) {
    return snap.away;
  }
  if (m.includes('empate') || m.includes('draw')) {
    return snap.draw;
  }
  return null;
}

export function capturarOddsFechamento(matchesAtivos: Match[]): void {
  const entries = loadEntries();
  const closingCache = loadClosingCache();
  let changed = false;

  const now = Date.now();
  const KICKOFF_WINDOW_MS = 30 * 60 * 1000; // captura até 30min após kickoff

  entries.forEach(entry => {
    if (entry.oddFechamento !== null) return; // já capturado
    if (entry.resultado !== 'PENDENTE') return;

    const kickoff = new Date(entry.commenceTime).getTime();
    const afterKickoff = now >= kickoff;
    const withinWindow = now - kickoff <= KICKOFF_WINDOW_MS;

    if (!afterKickoff) return; // jogo ainda não começou

    // Verificar cache
    const cacheKey = `${entry.matchId}_${entry.mercado}`;
    if (closingCache[cacheKey]) {
      entry.oddFechamento = closingCache[cacheKey].odd;
      entry.clvPct = calcCLV(entry.oddUtilizada, entry.oddFechamento);
      entry.closedAt = new Date(closingCache[cacheKey].ts).toISOString();
      changed = true;
      return;
    }

    if (!withinWindow) {
      // Fallback: se passou da janela de captura nas partidas ativas, tentar obter do line movement service
      try {
        const lm = getLineMovement(entry.matchId);
        if (lm && lm.snapshots && lm.snapshots.length > 0) {
          const kickoffTime = kickoff;
          // Obter o snapshot mais próximo do kickoff (até 5 min pós-kickoff)
          const snapsBeforeKickoff = lm.snapshots.filter(s => s.ts <= kickoffTime + 5 * 60 * 1000);
          const targetSnap = snapsBeforeKickoff.length > 0
            ? snapsBeforeKickoff[snapsBeforeKickoff.length - 1]
            : lm.snapshots[lm.snapshots.length - 1];

          const odd = getPinnacleOddFromSnapshot(targetSnap, entry.mercado, entry.homeTeam, entry.awayTeam);
          if (odd) {
            entry.oddFechamento = odd;
            entry.clvPct = calcCLV(entry.oddUtilizada, odd);
            entry.closedAt = new Date(targetSnap.ts).toISOString();
            closingCache[cacheKey] = { odd, ts: targetSnap.ts };
            changed = true;
          }
        }
      } catch { /* silencioso */ }
      return;
    }

    // Buscar nas partidas ativas
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

/**
 * Atualiza o resultado (GREEN/RED/VOID) de uma entrada.
 * Chamado pelo ResultadoModal ao registrar resultado.
 */
export function atualizarResultadoCLV(matchId: string, resultado: 'GREEN' | 'RED' | 'VOID'): void {
  const entries = loadEntries();
  const entry = entries.find(e => e.matchId === matchId);
  if (entry) {
    entry.resultado = resultado;
    saveEntries(entries);
  }
}

/**
 * Retorna todas as entradas CLV.
 */
export function getEntradasCLV(): CLVEntry[] {
  return loadEntries();
}

/**
 * Retorna resumo estatístico do CLV.
 */
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

/**
 * Remove entradas com mais de 90 dias.
 */
export function limparEntradasAntigas(): void {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const entries = loadEntries().filter(e => new Date(e.analyzedAt).getTime() > cutoff);
  saveEntries(entries);
}

/**
 * Exporta as entradas como CSV para o plano Sharp.
 */
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
