/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PoissonData } from '../types';

const MEDIAS_XG_LIGA: Record<string, { home: number; away: number }> = {
  'Bundesliga': { home: 1.55, away: 1.20 },
  'Premier League': { home: 1.60, away: 1.25 },
  'La Liga': { home: 1.45, away: 1.15 },
  'Serie A': { home: 1.40, away: 1.10 },
  'Ligue 1': { home: 1.50, away: 1.15 },
  'Campeonato Brasileiro': { home: 1.45, away: 1.10 },
  'Brasileirão': { home: 1.45, away: 1.10 },
  'Eredivisie': { home: 1.78, away: 1.42 },
  'Netherlands Eredivisie': { home: 1.78, away: 1.42 },
  'Primeira Liga': { home: 1.50, away: 1.20 },
};

export function calculatePoisson(homeExpected: number, awayExpected: number, league?: string): PoissonData {

  let homeXg = homeExpected;
  let awayXg = awayExpected;
  let fonte = 'ia_gemini';

  if (!homeXg || homeXg <= 0 || !awayXg || awayXg <= 0) {
    const leagueKey = Object.keys(MEDIAS_XG_LIGA).find(k => league?.includes(k));
    const media = MEDIAS_XG_LIGA[leagueKey || ''] || { home: 1.40, away: 1.15 };
    homeXg = media.home;
    awayXg = media.away;
    fonte = leagueKey ? 'media_liga' : 'media_global';
  }

  const lambdaHome = homeXg;
  const lambdaAway = awayXg;

  // PSN-04: Log-space Poisson calculation to avoid underflow for large k/lambda
  function poissonLogPMF(k: number, lambda: number): number {
    if (lambda <= 0) return k === 0 ? 0 : -Infinity;
    let logFactorial = 0;
    for (let i = 2; i <= k; i++) logFactorial += Math.log(i);
    return k * Math.log(lambda) - lambda - logFactorial;
  }
  const poisson = (k: number, lambda: number) => Math.exp(poissonLogPMF(k, lambda));

  // PSN-05: Build raw matrix first, then renormalize BEFORE applying cap
  // Dixon-Coles (1997) tau correction for low-score dependence — eq. 4 from original paper:
  //   tau(0,0) = 1 - λ_home * λ_away * ρ
  //   tau(1,0) = 1 + λ_away * ρ   ← uses AWAY lambda (team that did NOT score)
  //   tau(0,1) = 1 + λ_home * ρ   ← uses HOME lambda (team that did NOT score)
  //   tau(1,1) = 1 - ρ
  const rho = -0.12;
  const rawMatrix: number[][] = [];
  let matrixSum = 0;

  for (let h = 0; h <= 8; h++) {
    rawMatrix[h] = [];
    for (let a = 0; a <= 8; a++) {
      let tau = 1.0;
      if (h === 0 && a === 0) tau = 1 - lambdaHome * lambdaAway * rho;
      else if (h === 1 && a === 0) tau = 1 + lambdaAway * rho;
      else if (h === 0 && a === 1) tau = 1 + lambdaHome * rho;
      else if (h === 1 && a === 1) tau = 1 - rho;

      rawMatrix[h][a] = poisson(h, lambdaHome) * poisson(a, lambdaAway) * Math.max(0, tau);
      matrixSum += rawMatrix[h][a];
    }
  }

  // PSN-05: Renormalize matrix so all cells sum to 1 before deriving cumulative probabilities
  const normFactor = matrixSum > 0 ? 1 / matrixSum : 1;

  const scores: Array<{ score: string; prob: number }> = [];
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let probCasa = 0;
  let probEmpate = 0;
  let probFora = 0;

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const prob = rawMatrix[h][a] * normFactor * 100; // normalized, in %

      if (h + a > 0.5) over05 += prob;
      if (h + a > 1.5) over15 += prob;
      if (h + a > 2.5) over25 += prob;
      if (h + a > 3.5) over35 += prob;
      if (h > 0 && a > 0) btts += prob;

      if (h > a) probCasa += prob;
      else if (h === a) probEmpate += prob;
      else probFora += prob;

      if (h <= 4 && a <= 4) {
        scores.push({ score: `${h}-${a}`, prob });
      }
    }
  }

  const topScores = scores
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 5);

  topScores.forEach(s => {
    s.prob = parseFloat(s.prob.toFixed(1));
  });

  // PSN-03: Proportional float normalization for 1x2
  const total1x2 = probCasa + probEmpate + probFora;

  // PSN-05: Cap at 95% applied AFTER renormalization — values now reflect true normalized probs
  return {
    home_expected: homeExpected,
    away_expected: awayExpected,
    top_scores: topScores,
    btts_prob: parseFloat(Math.min(btts, 95).toFixed(1)),
    over_0_5: parseFloat(Math.min(over05, 95).toFixed(1)),
    over_1_5: parseFloat(Math.min(over15, 95).toFixed(1)),
    over_2_5: parseFloat(Math.min(over25, 95).toFixed(1)),
    over_3_5: parseFloat(Math.min(over35, 95).toFixed(1)),
    probs_1x2: {
      casa: parseFloat((probCasa / total1x2 * 100).toFixed(2)),
      empate: parseFloat((probEmpate / total1x2 * 100).toFixed(2)),
      fora: parseFloat((probFora / total1x2 * 100).toFixed(2)),
    },
    fonteXg: fonte
  };
}

export function debugPoisson(homeXg: number, awayXg: number, probPoisson: any, fonte: string) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[POISSON DEBUG]', {
      home_xg_input: homeXg,
      away_xg_input: awayXg,
      fonte_dados: fonte,
      calculado: !!probPoisson,
      probs: probPoisson?.probs_1x2
    });
  }
}
