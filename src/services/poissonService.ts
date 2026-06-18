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


  // Fallback de xG caso os valores sejam inválidos ou ausentes
  let homeXg = homeExpected;
  let awayXg = awayExpected;
  let fonte = 'ia_gemini';


  if (!homeXg || homeXg <= 0 || !awayXg || awayXg <= 0) {
    // Tentativa 2: fallback por liga
    const leagueKey = Object.keys(MEDIAS_XG_LIGA).find(k => league?.includes(k));
    const media = MEDIAS_XG_LIGA[leagueKey || ''] || { home: 1.40, away: 1.15 };
    
    homeXg = media.home;
    awayXg = media.away;
    fonte = leagueKey ? 'media_liga' : 'media_global';
  }


  const lambdaHome = homeXg;
  const lambdaAway = awayXg;


  const poisson = (k: number, lambda: number) => {
    const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  };

  const scores: Array<{ score: string; prob: number }> = [];
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let probCasa = 0;
  let probEmpate = 0;
  let probFora = 0;

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      let prob = poisson(h, lambdaHome) * poisson(a, lambdaAway) * 100;
      
      // Dixon-Coles simplified bivariate adjustment (rho = -0.12)
      const rho = -0.12;
      let tau = 1.0;
      if (h === 0 && a === 0) {
        tau = 1 - lambdaHome * lambdaAway * rho;
      } else if (h === 1 && a === 0) {
        tau = 1 + lambdaAway * rho;
      } else if (h === 0 && a === 1) {
        tau = 1 + lambdaHome * rho;
      } else if (h === 1 && a === 1) {
        tau = 1 - rho;
      }
      
      prob = prob * Math.max(0, tau);
      
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

  // Obter top 5 placares matemáticos reais sem deflação artificial
  const topScores = scores
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 5);

  topScores.forEach(s => {
    s.prob = parseFloat(s.prob.toFixed(1));
  });

  // Normalizar probs_1x2 para evitar drift de arredondamento (soma ≠ 100)
  const rawCasa = Math.round(probCasa);
  const rawEmpate = Math.round(probEmpate);
  const rawFora = Math.round(probFora);
  const drift = rawCasa + rawEmpate + rawFora - 100;

  return {
    home_expected: homeExpected,
    away_expected: awayExpected,
    top_scores: topScores,
    btts_prob: parseFloat(Math.min(btts, 95).toFixed(1)),
    over_1_5: parseFloat(Math.min(over15, 95).toFixed(1)),
    over_2_5: parseFloat(Math.min(over25, 95).toFixed(1)),
    over_3_5: parseFloat(Math.min(over35, 95).toFixed(1)),
    probs_1x2: {
      casa: rawCasa - (drift > 0 ? drift : 0),
      empate: rawEmpate + (drift < 0 ? Math.abs(drift) : 0),
      fora: rawFora
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
