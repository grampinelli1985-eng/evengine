import { supabase } from './supabaseClient';
import { registrarResultadoDiario, registrarResultado, getBancaAtual, setBancaAtual, getBancasFromSupabase, updateBancaBalance } from './bancaService';

async function adjustBancaBy(delta: number): Promise<void> {
  const current = getBancaAtual();
  const next = Math.max(0, current + delta);
  setBancaAtual(next);
  window.dispatchEvent(new CustomEvent('evengine_banca_changed'));
  // Persiste no Supabase se houver banca ativa
  try {
    const { data: { session } } = await supabase!.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    const bancas = await getBancasFromSupabase(userId);
    const storedActiveId = localStorage.getItem('evengine_active_banca_id');
    const active = (storedActiveId ? bancas.find(b => b.id === storedActiveId) : null) ?? bancas[0];
    if (active) await updateBancaBalance(active.id, next);
  } catch { /* non-critical */ }
}

async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export interface Bet {
  id: string;
  analysis_id: string | null;
  created_at: string;
  market: string;
  odd_taken: number;
  stake_amount: number;
  bookmaker: string;
  status: 'pending' | 'green' | 'red' | 'void' | 'cashout';
  result_amount: number | null;
  settled_at: string | null;
  match_score: string | null;
  closing_odd: number | null;
  notes: string | null;
  // Joined analysis fields
  analyses?: {
    home_team: string;
    away_team: string;
    league: string;
    created_at: string;
  } | null;
}

export interface BetInput {
  analysis_id: string | null;
  market: string;
  odd_taken: number;
  stake_amount: number;
  bookmaker?: string;
  status?: 'pending' | 'green' | 'red' | 'void' | 'cashout';
  notes?: string;
  // Team info — always pass these so team names are saved directly in notes,
  // independent of the Supabase analyses JOIN (which can fail silently).
  home_team?: string;
  away_team?: string;
  league?: string;
  opening_odd?: number;       // odd de abertura no momento do registro (para OLV)
  betfair_closing_odd?: number; // odd Betfair no momento do registro (para CLV vig-free)
}

/**
 * Cria um novo registro de aposta.
 */
export async function createBet(input: BetInput): Promise<Bet | null> {
  if (!supabase) {
    console.warn('[BetService] Supabase não inicializado. Não foi possível registrar aposta.');
    return null;
  }

  if (!input.odd_taken || input.odd_taken <= 1) {
    console.warn('[BetService] odd_taken inválida:', input.odd_taken);
    return null;
  }

  try {
    // Sempre prefixar notes com "HomeTeam × AwayTeam | League | matchId:..." para que
    // os nomes dos times fiquem gravados mesmo se o JOIN com analyses falhar.
    let notesValue = input.notes ?? '';

    const homeTeam = input.home_team?.trim() || '';
    const awayTeam = input.away_team?.trim() || '';
    const league   = input.league?.trim() || '';
    const matchId  = input.analysis_id || '';

    // Só injeta o prefixo de times se temos pelo menos um dos nomes E o notes ainda não
    // contém o separador × (evita duplicação se o caller já montou o prefixo).
    if ((homeTeam || awayTeam) && !notesValue.includes('×')) {
      const teamPrefix = `${homeTeam} × ${awayTeam}${league ? ' | ' + league : ''}${matchId ? ' | matchId:' + matchId : ''}`;
      notesValue = teamPrefix + (notesValue ? ' ' + notesValue : '');
    }

    // Embute opening_odd e betfair_closing_odd no campo notes como sufixo JSON
    const sharpMeta: Record<string, number> = {};
    if (input.opening_odd && input.opening_odd > 0) sharpMeta.opening_odd = input.opening_odd;
    if (input.betfair_closing_odd && input.betfair_closing_odd > 0) sharpMeta.betfair_odd = input.betfair_closing_odd;
    if (Object.keys(sharpMeta).length > 0) {
      notesValue = notesValue + (notesValue ? ' ' : '') + `##sharp##${JSON.stringify(sharpMeta)}`;
    }

    const payload = {
      analysis_id: input.analysis_id,
      market: input.market,
      odd_taken: Number(input.odd_taken),
      stake_amount: Number(input.stake_amount),
      bookmaker: input.bookmaker || 'bet365',
      status: input.status || 'pending',
      ...(notesValue ? { notes: notesValue } : {})
    };

    const { data, error } = await supabase
      .from('bets')
      .insert(payload)
      .select('*, analyses(home_team, away_team, league, created_at)')
      .single();

    if (error) {
      console.warn('[BetService] Falha ao inserir aposta:', error.message);
      return null;
    }

    // Deduz stake da banca imediatamente ao registrar a aposta
    await adjustBancaBy(-Number(input.stake_amount));

    return data as Bet;
  } catch (err) {
    console.warn('[BetService] Erro inesperado ao criar aposta:', err);
    return null;
  }
}

/**
 * Busca apostas com filtros dinâmicos.
 */
export async function fetchBets(filters: {
  status?: string;
  league?: string;
  market?: string;
  bookmaker?: string;
  period?: 'hoje' | '7d' | '30d' | 'todas';
}): Promise<Bet[]> {
  if (!supabase) return [];

  try {
    const userId = await getCurrentUserId();
    if (!userId) return [];

    let query = supabase
      .from('bets')
      .select('*, analyses(home_team, away_team, league, created_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500);

    // Filtro por Status
    if (filters.status && filters.status !== 'all') {
      if (filters.status === 'pending') {
        query = query.eq('status', 'pending');
      } else if (filters.status === 'resolved') {
        query = query.neq('status', 'pending');
      } else {
        query = query.eq('status', filters.status);
      }
    }

    // Filtro por Bookmaker
    if (filters.bookmaker && filters.bookmaker !== 'all') {
      query = query.eq('bookmaker', filters.bookmaker);
    }

    // Filtro por Período
    if (filters.period && filters.period !== 'todas') {
      const now = new Date();
      let sinceDate: Date;

      if (filters.period === 'hoje') {
        sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (filters.period === '7d') {
        sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else {
        // 30d
        sinceDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      query = query.gte('created_at', sinceDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[BetService] Falha ao buscar apostas:', error.message);
      return [];
    }

    let results = (data || []) as Bet[];

    // Enriquece apostas sem times visíveis a partir do cache local de análises (apostas antigas).
    // Guarda: só pula se o JOIN retornou home_team OU se notes já contém o separador ×.
    try {
      const analyzed: Record<string, any> = JSON.parse(localStorage.getItem('evengine_analyzed_matches') || '{}');
      results = results.map(bet => {
        // Se o JOIN funcionou e trouxe o nome do time, não precisamos enriquecer.
        if (bet.analyses?.home_team) return bet;

        // Se notes já tem o padrão "Time A × Time B", os nomes estão embutidos.
        if (bet.notes && /[^×]+\s*×\s*[^|]+/.test(bet.notes)) return bet;

        // Tenta enriquecer a partir do cache localStorage.
        const matchId = bet.analysis_id;
        if (matchId && analyzed[matchId]) {
          const m = analyzed[matchId];
          const teamNote = `${m.home_team || ''} × ${m.away_team || ''} | ${m.sport_title || ''} | matchId:${matchId}`;
          return {
            ...bet,
            notes: teamNote + (bet.notes ? ' ' + bet.notes : '')
          };
        }
        return bet;
      });
    } catch {}

    // Como as informações da liga e do mercado estão na tabela analyses ou bets, filtramos em JS se necessário
    if (filters.league && filters.league !== 'all') {
      results = results.filter(
        (b) => b.analyses?.league?.toLowerCase() === filters.league?.toLowerCase()
      );
    }

    if (filters.market && filters.market !== 'all') {
      results = results.filter(
        (b) => b.market?.toLowerCase().includes(filters.market?.toLowerCase() || '')
      );
    }

    return results;
  } catch (err) {
    console.warn('[BetService] Erro inesperado ao buscar apostas:', err);
    return [];
  }
}

/**
 * Resolve uma aposta pendente, calculando o PnL e atualizando a banca.
 */
export async function resolveBet(
  betId: string,
  params: {
    status: 'green' | 'red' | 'void' | 'cashout';
    result_amount?: number;
    match_score?: string;
    closing_odd?: number;
    notes?: string;
  }
): Promise<Bet | null> {
  if (!supabase) return null;

  try {
    const userId = await getCurrentUserId();
    if (!userId) return null;

    // 1. Obter a aposta atual para saber o valor da stake (com ownership check)
    const { data: currentBet, error: fetchErr } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .eq('user_id', userId)
      .single();

    if (fetchErr || !currentBet) {
      console.warn('[BetService] Aposta não encontrada para resolução:', fetchErr?.message);
      return null;
    }

    if (currentBet.status !== 'pending') return currentBet as Bet;

    const stake = Number(currentBet.stake_amount);
    const odd = Number(currentBet.odd_taken);
    let resultAmount = 0;
    let netPnL = 0;

    // Calcular valores de acordo com o status
    if (params.status === 'green') {
      resultAmount = stake * odd;
      netPnL = stake * (odd - 1);
    } else if (params.status === 'red') {
      resultAmount = 0;
      netPnL = -stake;
    } else if (params.status === 'void') {
      resultAmount = stake;
      netPnL = 0;
    } else if (params.status === 'cashout') {
      resultAmount = Number(params.result_amount ?? stake);
      netPnL = resultAmount - stake;
    }

    // Preservar notes existentes (que contêm os nomes dos times e metadados sharp).
    // Só sobrescreve se o usuário digitou uma nota nova.
    const existingNotes = currentBet.notes || null;
    const newNotes = params.notes
      ? (existingNotes ? existingNotes + ' | ' + params.notes : params.notes)
      : existingNotes;

    const updatePayload = {
      status: params.status,
      result_amount: Number(resultAmount.toFixed(2)),
      settled_at: new Date().toISOString(),
      match_score: params.match_score || null,
      closing_odd: params.closing_odd ? Number(params.closing_odd) : null,
      notes: newNotes
    };

    // 2. UPDATE atômico: só atualiza se ainda estiver 'pending' (guard contra race condition)
    const { data: updatedRows, error } = await supabase
      .from('bets')
      .update(updatePayload)
      .eq('id', betId)
      .eq('status', 'pending')
      .eq('user_id', userId)
      .select('*, analyses(home_team, away_team, league, created_at)');

    if (error) {
      console.warn('[BetService] Falha ao atualizar status da aposta:', error.message);
      return null;
    }

    // Se nenhuma linha foi atualizada, outra chamada concorrente venceu — não ajustar banca
    if (!updatedRows || updatedRows.length === 0) {
      return currentBet as Bet;
    }

    const data = updatedRows[0];

    // 3. Creditar resultado na banca (stake já foi deduzida no createBet)
    // green: devolve stake + lucro; void/cashout: devolve result_amount; red: nada (já descontado)
    if (params.status === 'green' || params.status === 'void' || params.status === 'cashout') {
      await adjustBancaBy(resultAmount);
    }
    registrarResultadoDiario(netPnL);
    registrarResultado({ resultado: params.status });

    return data as Bet;
  } catch (err) {
    console.warn('[BetService] Erro inesperado ao resolver aposta:', err);
    return null;
  }
}

/**
 * Extrai metadados sharp embutidos no campo notes da aposta.
 */
export function extractSharpMeta(notes: string | null): { opening_odd?: number; betfair_odd?: number } {
  if (!notes) return {};
  const idx = notes.indexOf('##sharp##');
  if (idx === -1) return {};
  try {
    return JSON.parse(notes.slice(idx + 9));
  } catch {
    return {};
  }
}

/**
 * Calcula métricas agregadas das últimas N apostas resolvidas.
 */
export function calculatePerformanceMetrics(bets: Bet[]): {
  wins: number;
  losses: number;
  voids: number;
  totalSettled: number;
  hitRate: number;
  roi: number;
  totalStake: number;
  netResult: number;
  avgCLV: number;
  avgCLV_betfair: number;   // CLV usando Betfair como benchmark (vig-free real)
  avgOLV: number;           // Opening Line Value — timing de entrada vs abertura
  clvSource: 'betfair' | 'pinnacle_estimated'; // indica qual benchmark foi usado
} {
  const settledBets = bets.filter((b) => b.status !== 'pending');

  let wins = 0;
  let losses = 0;
  let voids = 0;
  let totalStake = 0;
  let netResult = 0;
  let clvSum = 0;
  let clvCount = 0;
  let clvBetfairSum = 0;
  let clvBetfairCount = 0;
  let olvSum = 0;
  let olvCount = 0;

  settledBets.forEach((b) => {
    const stake = b.stake_amount;
    const result = b.result_amount ?? 0;
    const profit = result - stake;

    totalStake += stake;
    netResult += profit;

    if (b.status === 'green') wins++;
    else if (b.status === 'red') losses++;
    else if (b.status === 'void') voids++;
    else if (b.status === 'cashout') {
      if (profit > 0) wins++;
      else if (profit < 0) losses++;
      else voids++;
    }

    const sharpMeta = extractSharpMeta(b.notes);

    // CLV via Betfair (benchmark vig-free real — prioridade)
    if (sharpMeta.betfair_odd && sharpMeta.betfair_odd > 0) {
      const betfairFairOdd = sharpMeta.betfair_odd / 0.95;
      const clvBetfair = ((b.odd_taken / betfairFairOdd) - 1) * 100;
      clvBetfairSum += clvBetfair;
      clvBetfairCount++;
    }

    // CLV via Pinnacle estimada (fallback quando Betfair não disponível)
    if (b.closing_odd && b.closing_odd > 0) {
      const odd = b.closing_odd;
      const vigFactor = odd < 1.5 ? 1.015 : odd < 2.5 ? 1.025 : odd < 5.0 ? 1.030 : 1.035;
      const closingNoVig = odd * vigFactor;
      const clv = ((b.odd_taken / closingNoVig) - 1) * 100;
      clvSum += clv;
      clvCount++;
    }

    // OLV — Opening Line Value
    if (sharpMeta.opening_odd && sharpMeta.opening_odd > 0 && b.odd_taken > 0) {
      const olv = ((b.odd_taken / sharpMeta.opening_odd) - 1) * 100;
      olvSum += olv;
      olvCount++;
    }
  });

  const totalSettled = settledBets.length;
  const deciders = wins + losses;
  const hitRate = deciders > 0 ? (wins / deciders) * 100 : 0;
  const roi = totalStake > 0 ? (netResult / totalStake) * 100 : 0;
  const avgCLV = clvCount > 0 ? clvSum / clvCount : 0;
  const avgCLV_betfair = clvBetfairCount > 0 ? clvBetfairSum / clvBetfairCount : 0;
  const avgOLV = olvCount > 0 ? olvSum / olvCount : 0;
  const clvSource = clvBetfairCount > clvCount / 2 ? 'betfair' : 'pinnacle_estimated';

  return {
    wins,
    losses,
    voids,
    totalSettled,
    hitRate: parseFloat(hitRate.toFixed(1)),
    roi: parseFloat(roi.toFixed(1)),
    totalStake: parseFloat(totalStake.toFixed(2)),
    netResult: parseFloat(netResult.toFixed(2)),
    avgCLV: parseFloat((avgCLV_betfair !== 0 ? avgCLV_betfair : avgCLV).toFixed(1)),
    avgCLV_betfair: parseFloat(avgCLV_betfair.toFixed(1)),
    avgOLV: parseFloat(avgOLV.toFixed(1)),
    clvSource
  };
}

// ─── Auto-resolve helpers ────────────────────────────────────────────────────

function determineOutcome(
  market: string,
  homeGoals: number,
  awayGoals: number
): 'green' | 'red' | null {
  const m = market.toLowerCase();
  const total = homeGoals + awayGoals;

  if (m.includes('vitória casa') || m === 'home' || m === 'casa') {
    return homeGoals > awayGoals ? 'green' : 'red';
  }
  if (m.includes('vitória fora') || m.includes('visitante') || m === 'away') {
    return awayGoals > homeGoals ? 'green' : 'red';
  }
  if (m.includes('empate') || m === 'draw') {
    return homeGoals === awayGoals ? 'green' : 'red';
  }
  if (m.includes('dupla chance 1x')) {
    return homeGoals >= awayGoals ? 'green' : 'red';
  }
  if (m.includes('dupla chance x2')) {
    return awayGoals >= homeGoals ? 'green' : 'red';
  }
  if (m.includes('dupla chance 12')) {
    return homeGoals !== awayGoals ? 'green' : 'red';
  }

  const overMatch = m.match(/over\s+(\d+[.,]?\d*)/);
  if (overMatch) {
    const line = parseFloat(overMatch[1].replace(',', '.'));
    return total > line ? 'green' : 'red';
  }
  const underMatch = m.match(/under\s+(\d+[.,]?\d*)/);
  if (underMatch) {
    const line = parseFloat(underMatch[1].replace(',', '.'));
    return total < line ? 'green' : 'red';
  }

  if (m.includes('ambos marcam') || m.includes('btts') || m.includes('both teams')) {
    if (m.includes('sim') || m.includes('yes')) {
      return homeGoals > 0 && awayGoals > 0 ? 'green' : 'red';
    }
    if (m.includes('não') || m.includes('no')) {
      return homeGoals === 0 || awayGoals === 0 ? 'green' : 'red';
    }
  }

  return null;
}

/**
 * Resolve automaticamente apostas pendentes quando um resultado ao vivo chega.
 * Retorna quantas apostas foram resolvidas automaticamente.
 */
export async function autoResolveBetFromLiveResult(params: {
  matchId: string;
  homeGoals: number;
  awayGoals: number;
  placar: string;
}): Promise<number> {
  if (!supabase) return 0;

  try {
    const userId = await getCurrentUserId();
    if (!userId) return 0;

    const { data: bets, error } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (error || !bets) return 0;

    const matching = bets.filter((b: any) =>
      b.notes?.includes(`matchId:${params.matchId}`)
    );

    let resolved = 0;
    for (const bet of matching) {
      const outcome = determineOutcome(bet.market, params.homeGoals, params.awayGoals);
      if (!outcome) continue;

      const result = await resolveBet(bet.id, {
        status: outcome,
        match_score: params.placar,
      });

      if (result) resolved++;
    }

    return resolved;
  } catch (e) {
    console.warn('[BetService] Erro ao auto-resolver apostas:', e);
    return 0;
  }
}

/**
 * Remove todas as apostas registradas no banco de dados.
 * Requer `confirmed = true` para evitar reset acidental — o caller deve
 * exibir confirmação explícita ao usuário antes de chamar esta função.
 */
export async function resetBets(confirmed = false): Promise<boolean> {
  if (!confirmed) {
    console.warn('[BetService] resetBets chamado sem confirmação explícita. Passe confirmed=true após prompt ao usuário.');
    return false;
  }
  if (!supabase) return false;
  try {
    const userId = await getCurrentUserId();
    if (!userId) return false;

    const { error } = await supabase
      .from('bets')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.warn('[BetService] Falha ao deletar apostas:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[BetService] Erro inesperado ao resetar apostas:', err);
    return false;
  }
}
