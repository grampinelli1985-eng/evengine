/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { callGeminiAPI } from './geminiService';
import { calculatePoisson } from './poissonService';
import { getFixtureStatsById } from './sportmonksService';

export interface GoalsAnalysis {
  market: 'over_0.5' | 'over_1.5' | 'over_2.5' | 'over_3.5' | 'btb';
  totalGoalsExpected: number;

  probabilities: {
    over0_5: number;
    over1_5: number;
    over2_5: number;
    over3_5: number;
    btb: number;
  };
  ev: Record<string, number>;
  selectedMarket: string;
  confidence: number;
  models: {
    poissonEstimate: number;
    geminiEstimate: number;
  };
  convergence: number;
  markets?: any[];
  geminiProbs?: {
    over0_5: number;
    over1_5: number;
    over2_5: number;
    over3_5: number;
    btb: number;
  };
  sportmonks_xg?: { home: number | null; away: number | null; fonte: 'sportmonks' | 'estimado' };
}

/**
 * Poisson Distribution para gols
 * λ (lambda) = total goals esperado
 *
 * Exemplo: λ = 2.16
 * - P(0 gols) = 11.5%
 * - P(1 gol) = 24.8%
 * - P(2 gols) = 26.8%
 * - P(3 gols) = 19.2%
 * - P(4+ gols) = 17.7%
 *
 * Over 2.5 = P(3+) = ~39% (conforme teste)
 */
export function poissonDistribution(
  lambda: number
): {
  prob0: number;
  prob1: number;
  prob2: number;
  prob3: number;
  prob4plus: number;
  over0_5: number;
  over1_5: number;
  over2_5: number;
  over3_5: number;
} {
  if (lambda < 0) lambda = 0;

  const prob0 = Math.exp(-lambda);
  const prob1 = lambda * prob0;
  const prob2 = (Math.pow(lambda, 2) * prob0) / 2;
  const prob3 = (Math.pow(lambda, 3) * prob0) / 6;
  const prob4plus = Math.max(0, 1 - (prob0 + prob1 + prob2 + prob3));

  let over0_5 = 1 - prob0;
  let over1_5 = 1 - prob0 - prob1;
  let over2_5 = 1 - prob0 - prob1 - prob2;
  let over3_5 = 1 - prob0 - prob1 - prob2 - prob3;

  over0_5 = Math.max(0, Math.min(1, over0_5));
  over1_5 = Math.max(0, Math.min(1, over1_5));
  over2_5 = Math.max(0, Math.min(1, over2_5));
  over3_5 = Math.max(0, Math.min(1, over3_5));

  return {
    prob0: parseFloat(prob0.toFixed(4)),
    prob1: parseFloat(prob1.toFixed(4)),
    prob2: parseFloat(prob2.toFixed(4)),
    prob3: parseFloat(prob3.toFixed(4)),
    prob4plus: parseFloat(prob4plus.toFixed(4)),
    over0_5: parseFloat(over0_5.toFixed(4)),
    over1_5: parseFloat(over1_5.toFixed(4)),
    over2_5: parseFloat(over2_5.toFixed(4)),
    over3_5: parseFloat(over3_5.toFixed(4)),
  };
}

/**
 * Calcular Attack/Defense Power de um time
 */
export function calculateTeamPower(
  team: {
    lastGoalsFor?: number[];
    lastGoalsAgainst?: number[];
    jogos?: { gols_for: number; gols_against: number }[];
  }
): {
  attackPower: number;
  defensePower: number;
} {
  const lastFor = team?.jogos ? team.jogos.map(j => j.gols_for) : (team?.lastGoalsFor || []);
  const lastAgainst = team?.jogos ? team.jogos.map(j => j.gols_against) : (team?.lastGoalsAgainst || []);

  const attackPower = lastFor.length > 0
    ? parseFloat((lastFor.reduce((sum, g) => sum + g, 0) / lastFor.length).toFixed(2))
    : 1.5;
  const defensePower = lastAgainst.length > 0
    ? parseFloat((lastAgainst.reduce((sum, g) => sum + g, 0) / lastAgainst.length).toFixed(2))
    : 1.2;

  return { attackPower, defensePower };
}

/**
 * Calcular EV: (prob × odd) - 1
 */
export function calculateGoalsEV(
  goalsProbability: number,
  oddOffered: number
): number {
  if (goalsProbability == null || oddOffered == null) return 0;
  const ev = (goalsProbability * oddOffered) - 1;
  return parseFloat(ev.toFixed(4));
}

/**
 * Estimar com Gemini IA
 */
export async function estimateGoalsWithGemini(
  homeTeam: string,
  awayTeam: string,
  homeStats: {
    goalsFor: number;
    goalsAgainst: number;
    form: string;
  },
  awayStats: {
    goalsFor: number;
    goalsAgainst: number;
    form: string;
  }
): Promise<{
  totalGoals: number;
  confidence: number;
  over2_5_prob: number;
}> {
  const systemPrompt = `Você é o analista especialista em estatísticas de gols da IA do EVEngine.`;
  const userMessage = `Por favor, estime os gols para a partida entre ${homeTeam} e ${awayTeam}.
Dados do Mandante (${homeTeam}): Gols Pró/Jogo: ${homeStats.goalsFor}, Gols Contra/Jogo: ${homeStats.goalsAgainst}, Forma Recente: ${homeStats.form}.
Dados do Visitante (${awayTeam}): Gols Pró/Jogo: ${awayStats.goalsFor}, Gols Contra/Jogo: ${awayStats.goalsAgainst}, Forma Recente: ${awayStats.form}.

Retorne um objeto JSON exatamente no seguinte formato, sem formatações adicionais ou Markdown:
{
  "totalGoals": 2.5,
  "confidence": 85,
  "over2_5_prob": 58
}`;

  try {
    const { text } = await callGeminiAPI(systemPrompt, userMessage, "json");
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const over2_5_prob = parsed.over2_5_prob > 1 ? parsed.over2_5_prob / 100 : parsed.over2_5_prob;
    const confidence = parsed.confidence > 1 ? parsed.confidence / 100 : parsed.confidence;

    return {
      totalGoals: parsed.totalGoals || 2.4,
      confidence: confidence || 0.75,
      over2_5_prob: over2_5_prob || 0.50,
    };
  } catch (error) {
    console.warn("[Gemini Goals Estimate] Falha ao estimar gols, usando fallback estatístico local.", error);
    return {
      totalGoals: 2.3,
      confidence: 0.65,
      over2_5_prob: 0.45,
    };
  }
}

/**
 * Análise completa de mercado de gols
 */
export async function analyzeGoalsMarket(
  homeTeam: string,
  awayTeam: string,
  homeAttackPower: number,
  homeDefensePower: number,
  awayAttackPower: number,
  awayDefensePower: number,
  odds: {
    over_0_5?: number;
    over_1_5?: number;
    over_2_5?: number;
    over_3_5?: number;
    btb?: number;
  },
  scoutingHome?: any,
  scoutingAway?: any,
  homeGeminiXg?: number,
  awayGeminiXg?: number,
  fixtureId?: number
): Promise<GoalsAnalysis> {
  const lambdaHome = homeAttackPower * awayDefensePower;
  const lambdaAway = awayAttackPower * homeDefensePower;
  const totalGoalsExpected = parseFloat((lambdaHome + lambdaAway).toFixed(2));

  let xgData: { home_xg: number | null; away_xg: number | null } | undefined = undefined;
  let sportmonksXgResult: { home: number | null; away: number | null; fonte: 'sportmonks' | 'estimado' } = {
    home: null,
    away: null,
    fonte: 'estimado'
  };

  const hasSportmonksToken = !!import.meta.env.VITE_SPORTMONKS_TOKEN;
  if (hasSportmonksToken && fixtureId) {
    try {
      const stats = await getFixtureStatsById(fixtureId);
      if (stats && (stats.home_xg !== null || stats.away_xg !== null)) {
        xgData = {
          home_xg: stats.home_xg,
          away_xg: stats.away_xg
        };
        sportmonksXgResult = {
          home: stats.home_xg,
          away: stats.away_xg,
          fonte: 'sportmonks'
        };
      }
    } catch (e) {
      console.warn('[Sportmonks] Failed to fetch fixture stats, using fallback:', e);
    }
  }

  let blendedHomeXg = lambdaHome;
  let blendedAwayXg = lambdaAway;
  const ALPHA_XG = 0.35;
  if (xgData) {
    if (xgData.home_xg !== null && xgData.home_xg !== undefined) {
      blendedHomeXg = (1 - ALPHA_XG) * lambdaHome + ALPHA_XG * xgData.home_xg;
    }
    if (xgData.away_xg !== null && xgData.away_xg !== undefined) {
      blendedAwayXg = (1 - ALPHA_XG) * lambdaAway + ALPHA_XG * xgData.away_xg;
    }
  }

  const poissonData = calculatePoisson(blendedHomeXg, blendedAwayXg, undefined);

  const finalPoissonProbs = {
    over0_5: (poissonData.over_0_5 ?? 0) / 100,
    over1_5: (poissonData.over_1_5 ?? 0) / 100,
    over2_5: (poissonData.over_2_5 ?? 0) / 100,
    over3_5: (poissonData.over_3_5 ?? 0) / 100,
    btb: (poissonData.btts_prob ?? 0) / 100,
  };

  let geminiEstimate;
  if (homeGeminiXg !== undefined && awayGeminiXg !== undefined) {
    const totalGoals = homeGeminiXg + awayGeminiXg;
    const geminiPoisson = calculatePoisson(homeGeminiXg, awayGeminiXg);
    geminiEstimate = {
      totalGoals,
      confidence: 0.85,
      over2_5_prob: (geminiPoisson.over_2_5 ?? 0) / 100
    };
  } else {
    const totalGoals = parseFloat((lambdaHome + lambdaAway).toFixed(2));
    geminiEstimate = {
      totalGoals,
      confidence: 0.80,
      over2_5_prob: parseFloat(((finalPoissonProbs.over2_5 ?? 50) / 100).toFixed(2))
    };
  }

  // B3: Divergência Poisson vs Gemini em Over 2.5
  const divergence = Math.abs(finalPoissonProbs.over2_5 - geminiEstimate.over2_5_prob) * 100;
  const convergence = parseFloat(divergence.toFixed(1));

  const totalPoissonLambda = lambdaHome + lambdaAway;
  const ratioHome = totalPoissonLambda > 0 ? lambdaHome / totalPoissonLambda : 0.5;
  const geminiLambdaHome = geminiEstimate.totalGoals * ratioHome;
  const geminiLambdaAway = geminiEstimate.totalGoals * (1 - ratioHome);
  const geminiPoissonLocal = calculatePoisson(geminiLambdaHome, geminiLambdaAway);

  const geminiProbs = {
    over0_5: parseFloat((geminiPoissonLocal.over_0_5 ?? 0).toFixed(1)),
    over1_5: parseFloat((geminiPoissonLocal.over_1_5 ?? 0).toFixed(1)),
    over2_5: parseFloat((geminiEstimate.over2_5_prob * 100).toFixed(1)),
    over3_5: parseFloat((geminiPoissonLocal.over_3_5 ?? 0).toFixed(1)),
    btb: parseFloat((geminiPoissonLocal.btts_prob ?? 0).toFixed(1)),
  };

  const evMap: Record<string, number> = {};
  if (odds.over_0_5) evMap['over_0.5'] = calculateGoalsEV(finalPoissonProbs.over0_5, odds.over_0_5);
  if (odds.over_1_5) evMap['over_1.5'] = calculateGoalsEV(finalPoissonProbs.over1_5, odds.over_1_5);
  if (odds.over_2_5) evMap['over_2.5'] = calculateGoalsEV(finalPoissonProbs.over2_5, odds.over_2_5);
  if (odds.over_3_5) evMap['over_3.5'] = calculateGoalsEV(finalPoissonProbs.over3_5, odds.over_3_5);
  if (odds.btb) evMap['btb'] = calculateGoalsEV(finalPoissonProbs.btb, odds.btb);

  const marketsList: any[] = [];
  const addMarket = (name: string, marketKey: string, prob: number, odd?: number) => {
    if (odd) {
      const edge = evMap[marketKey] ?? calculateGoalsEV(prob, odd);
      marketsList.push({
        market: name,
        marketKey,
        odd_api: odd,
        prob_ia: prob * 100,
        odd_fair: prob > 0 ? 1 / prob : 99,
        edge,
        is_value_bet: edge > 0.05,
        recomenda: edge > 0.05,
        odd_is_estimated: false,
      });
    }
  };

  addMarket('Over 0.5 Gols', 'over_0.5', finalPoissonProbs.over0_5, odds.over_0_5);
  addMarket('Over 1.5 Gols', 'over_1.5', finalPoissonProbs.over1_5, odds.over_1_5);
  addMarket('Over 2.5 Gols', 'over_2.5', finalPoissonProbs.over2_5, odds.over_2_5);
  addMarket('Over 3.5 Gols', 'over_3.5', finalPoissonProbs.over3_5, odds.over_3_5);
  addMarket('Ambos Times Marcam', 'btb', finalPoissonProbs.btb, odds.btb);

  let bestMarket: any = null;
  let maxEV = -999;
  marketsList.forEach(m => {
    if (m.edge > maxEV) {
      maxEV = m.edge;
      bestMarket = m;
    }
  });

  // [BUG-GS-1 FIX] Cast explícito para satisfazer o union type de GoalsAnalysis['market']
  const selectedMarketKey = (bestMarket ? bestMarket.marketKey : 'over_2.5') as GoalsAnalysis['market'];

  return {
    market: selectedMarketKey,
    totalGoalsExpected,
    probabilities: {
      over0_5: parseFloat((finalPoissonProbs.over0_5 * 100).toFixed(1)),
      over1_5: parseFloat((finalPoissonProbs.over1_5 * 100).toFixed(1)),
      over2_5: parseFloat((finalPoissonProbs.over2_5 * 100).toFixed(1)),
      over3_5: parseFloat((finalPoissonProbs.over3_5 * 100).toFixed(1)),
      btb: parseFloat((finalPoissonProbs.btb * 100).toFixed(1)),
    },
    ev: evMap,
    selectedMarket: bestMarket ? bestMarket.market : 'Over 2.5 Gols',
    confidence: parseFloat((geminiEstimate.confidence * 100).toFixed(1)),
    models: {
      poissonEstimate: totalGoalsExpected,
      geminiEstimate: geminiEstimate.totalGoals,
    },
    convergence,
    markets: marketsList,
    geminiProbs,
    sportmonks_xg: sportmonksXgResult,
  };
}

/**
 * Selecionar melhor mercado (maior Kelly-Adjusted Return)
 */
export function selectBestGoalsMarket(
  allMarketsAnalysis: GoalsAnalysis[]
): GoalsAnalysis {
  if (!allMarketsAnalysis || allMarketsAnalysis.length === 0) {
    throw new Error("Nenhuma análise de gols fornecida.");
  }
  return allMarketsAnalysis.sort((a, b) => {
    const aMaxEV = Math.max(...Object.values(a.ev));
    const bMaxEV = Math.max(...Object.values(b.ev));
    return bMaxEV - aMaxEV;
  })[0];
}
