/**
 * wcPoissonService.ts — Modelo Poisson re-parametrizado para torneios internacionais
 *
 * Diferenças vs poissonService.ts de clubes:
 *  - λ médio menor: seleções jogam defensivo em torneios (1.05-1.25 vs 1.4-1.6 ligas)
 *  - Dixon-Coles ρ ajustado para baixo scoring (ρ = -0.10 vs -0.13 em clubes)
 *  - Normalização por fase: semifinais/finais tendem a menos gols (tensão)
 *  - Parâmetros de ataque/defesa baseados em média de 32 seleções participantes da Copa
 */

import { WCMatch, WCPoissonResult } from './wcTypes';
import { getWCTeamRating } from './wcEloService';

// Médias históricas Copa do Mundo (1998-2022)
const WC_LAMBDA_BASE = 1.15;       // média de gols por time por partida no WC
const WC_LAMBDA_QUALIFIER = 1.30;  // eliminatórias têm mais gols (nível mais variado)
const WC_LAMBDA_EURO = 1.18;       // Eurocopa / Copa América

// Fator Dixon-Coles para low-scoring em torneios
const DC_RHO = -0.09;

function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) result *= lambda / i;
  return result;
}

function dixonColesTau(x: number, y: number, lambdaH: number, lambdaA: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambdaH * lambdaA * rho;
  if (x === 0 && y === 1) return 1 + lambdaH * rho;
  if (x === 1 && y === 0) return 1 + lambdaA * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function buildScoreMatrix(lambdaH: number, lambdaA: number, maxGoals = 7): number[][] {
  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const tau = dixonColesTau(h, a, lambdaH, lambdaA, DC_RHO);
      matrix[h][a] = tau * poissonPMF(lambdaH, h) * poissonPMF(lambdaA, a);
    }
  }
  return matrix;
}

const WC_AVG_ELO = 1620; // média estimada dos 32 classificados

function lambdaFromElo(ownRating: number, oppRating: number, phase?: WCMatch['phase']): number {
  const base = phase === 'grupos' ? WC_LAMBDA_BASE :
               phase === 'eliminatorias' ? WC_LAMBDA_QUALIFIER :
               WC_LAMBDA_EURO;
  // Ataque próprio: cada 100pts acima da média WC = +0.07λ
  const attackBoost  = (ownRating - WC_AVG_ELO) / 100 * 0.14;
  // Bônus de defesa adversária fraca: adversário 100pts abaixo da média = +0.14λ
  const defenseBoost = (WC_AVG_ELO - oppRating) / 100 * 0.14;
  return Math.max(0.4, Math.min(3.2, base + attackBoost + defenseBoost));
}

export function calculateWCPoisson(match: WCMatch, phase?: WCMatch['phase']): WCPoissonResult {
  const homeRating = getWCTeamRating(match.home_team);
  const awayRating = getWCTeamRating(match.away_team);

  const lambdaHome = lambdaFromElo(homeRating, awayRating, phase);
  const lambdaAway = lambdaFromElo(awayRating, homeRating, phase);

  const matrix = buildScoreMatrix(lambdaHome, lambdaAway);
  const maxGoals = matrix.length - 1;

  let probOver15 = 0;
  let probOver25 = 0;
  let probOver35 = 0;
  let probBTTS = 0;

  let bestScore = '0-0';
  let bestProb = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];
      const totalGoals = h + a;

      if (totalGoals > 1.5) probOver15 += p;
      if (totalGoals > 2.5) probOver25 += p;
      if (totalGoals > 3.5) probOver35 += p;
      if (h > 0 && a > 0) probBTTS += p;

      if (p > bestProb) { bestProb = p; bestScore = `${h}-${a}`; }
    }
  }

  // Normalizar (sum pode ser ligeiramente < 1 por truncamento em maxGoals=7)
  const normalize = (p: number) => Math.min(99, Math.round(p * 100));

  return {
    lambda_home: parseFloat(lambdaHome.toFixed(2)),
    lambda_away: parseFloat(lambdaAway.toFixed(2)),
    over15: { probabilidade: normalize(probOver15) },
    over25: { probabilidade: normalize(probOver25) },
    over35: { probabilidade: normalize(probOver35) },
    btts: { probabilidade: normalize(probBTTS) },
    resultado_mais_provavel: bestScore,
    probabilidade_resultado_mais_provavel: parseFloat((bestProb * 100).toFixed(1)),
  };
}

export function calcularEVMercadoWC(
  probabilidade: number,
  odd: number
): number {
  if (odd <= 1) return -100;
  return parseFloat(((probabilidade / 100) * odd - 1).toFixed(4)) * 100;
}
