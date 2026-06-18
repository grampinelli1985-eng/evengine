import { supabase } from './supabaseClient';
import { registrarResultadoDiario, registrarResultado } from './bancaService';

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
}

/**
 * Cria um novo registro de aposta.
 */
export async function createBet(input: BetInput): Promise<Bet | null> {
  if (!supabase) {
    console.warn('[BetService] Supabase não inicializado. Não foi possível registrar aposta.');
    return null;
  }

  try {
    const payload = {
      analysis_id: input.analysis_id,
      market: input.market,
      odd_taken: Number(input.odd_taken),
      stake_amount: Number(input.stake_amount),
      bookmaker: input.bookmaker || 'bet365',
      status: input.status || 'pending'
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
    let query = supabase
      .from('bets')
      .select('*, analyses(home_team, away_team, league, created_at)')
      .order('created_at', { ascending: false });

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
    // 1. Obter a aposta atual para saber o valor da stake
    const { data: currentBet, error: fetchErr } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .single();

    if (fetchErr || !currentBet) {
      console.warn('[BetService] Aposta não encontrada para resolução:', fetchErr?.message);
      return null;
    }

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

    const updatePayload = {
      status: params.status,
      result_amount: Number(resultAmount.toFixed(2)),
      settled_at: new Date().toISOString(),
      match_score: params.match_score || null,
      closing_odd: params.closing_odd ? Number(params.closing_odd) : null,
      notes: params.notes || null
    };

    const { data, error } = await supabase
      .from('bets')
      .update(updatePayload)
      .eq('id', betId)
      .select('*, analyses(home_team, away_team, league, created_at)')
      .single();

    if (error) {
      console.warn('[BetService] Falha ao atualizar status da aposta:', error.message);
      return null;
    }

    // 2. Atualizar a banca local e persistente
    registrarResultadoDiario(Number(netPnL.toFixed(2)));
    registrarResultado({ resultado: params.status });

    return data as Bet;
  } catch (err) {
    console.warn('[BetService] Erro inesperado ao resolver aposta:', err);
    return null;
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
} {
  const settledBets = bets.filter((b) => b.status !== 'pending');
  
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let totalStake = 0;
  let netResult = 0;
  let clvSum = 0;
  let clvCount = 0;

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

    if (b.closing_odd && b.closing_odd > 0) {
      // CLV = (odd_taken / closing_no_vig - 1) * 100
      // Aproximação: multiplica a closing odd por 1.03 para estimar o preço
      // vig-free (equivale a assumir ~3% de overround na Pinnacle). Preciso
      // apenas para mercados binários; em mercados 3-way usa removeOverround.
      const closingNoVig = b.closing_odd * 1.03;
      const clv = ((b.odd_taken / closingNoVig) - 1) * 100;
      clvSum += clv;
      clvCount++;
    }
  });

  const totalSettled = settledBets.length;
  // Hit rate considera apenas apostas que não foram neutras/void
  const deciders = wins + losses;
  const hitRate = deciders > 0 ? (wins / deciders) * 100 : 0;
  
  const roi = totalStake > 0 ? (netResult / totalStake) * 100 : 0;
  const avgCLV = clvCount > 0 ? clvSum / clvCount : 0;

  return {
    wins,
    losses,
    voids,
    totalSettled,
    hitRate: parseFloat(hitRate.toFixed(1)),
    roi: parseFloat(roi.toFixed(1)),
    totalStake: parseFloat(totalStake.toFixed(2)),
    netResult: parseFloat(netResult.toFixed(2)),
    avgCLV: parseFloat(avgCLV.toFixed(1))
  };
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
    const { error } = await supabase
      .from('bets')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

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
