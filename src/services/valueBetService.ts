/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match, AnalysisResponse, ValueBetReport, MarketValueBet, LEAGUES, MarketReference } from '../types';

const MAX_EDGE_REALISTA = 0.12; // EV-04: edges above 12% vs Pinnacle are virtually impossible and indicate model error
export const MIN_PROB_THRESHOLD = 5;

export const KELLY_MAX_ABSOLUTO = 0.03; // 3% do bankroll — teto hard

// GATE-02: Min/max odd filter for clubs
const CLUB_MIN_ODD = 1.40;
const CLUB_MAX_ODD = 5.00;

export function aplicarKellyMax(kellyCalculado: number): number {
  return Math.min(kellyCalculado, KELLY_MAX_ABSOLUTO);
}

/**
 * Remove a margem da casa (overround/vig) das odds usando normalização proporcional simples.
 * Adequado para mercados de 2 outcomes; para H2H 3-way use removeOverroundShin.
 */
export function removeOverround(odds: number[]): number[] {
  if (!Array.isArray(odds) || odds.length === 0) {
    throw new Error('removeOverround: array de odds vazio ou inválido');
  }
  if (odds.some(o => o === null || o === undefined || isNaN(o) || !isFinite(o) || o <= 1.0)) {
    throw new Error(`removeOverround: odds inválidas detectadas: ${JSON.stringify(odds)}`);
  }
  const implied = odds.map(o => 1 / o);
  const overround = implied.reduce((sum, p) => sum + p, 0);
  return implied.map(p => p / overround);
}

/**
 * EV-02: Shin method for overround removal — more accurate than proportional normalization.
 *
 * The Shin (1993) model accounts for the favourite-longshot bias present in football markets:
 * bookmakers inflate longshot prices more than favourites, so simple proportional normalization
 * underestimates favourite true probability and overestimates longshot true probability.
 *
 * Use for 3-way H2H markets. For 2-way markets, proportional normalization is equivalent.
 */
export function removeOverroundShin(odds: number[]): number[] {
  if (!Array.isArray(odds) || odds.length === 0) {
    throw new Error('removeOverroundShin: array de odds vazio ou inválido');
  }
  if (odds.some(o => o === null || o === undefined || isNaN(o) || !isFinite(o) || o <= 1.0)) {
    throw new Error(`removeOverroundShin: odds inválidas: ${JSON.stringify(odds)}`);
  }

  // Only meaningful for 3+ way markets — fall back to proportional for 2-way
  if (odds.length < 3) return removeOverround(odds);

  const implied = odds.map(o => 1 / o);
  const S = implied.reduce((s, p) => s + p, 0);
  const n = odds.length;

  // Initial estimate of z (insider fraction parameter)
  let z = (S - 1) / (S - 1 / n);
  z = Math.max(0.001, Math.min(0.15, z));

  // Newton-Raphson iteration to find z where sum of Shin probs = 1
  for (let iter = 0; iter < 20; iter++) {
    const shinProbs = implied.map(q => {
      const discriminant = z * z + 4 * (1 - z) * (q / S);
      return (Math.sqrt(Math.max(0, discriminant)) - z) / (2 * (1 - z));
    });
    const shinSum = shinProbs.reduce((s, p) => s + p, 0);
    const residual = shinSum - 1;
    if (Math.abs(residual) < 1e-8) break;

    const dz = 1e-6;
    const zPlus = Math.max(0.001, z + dz);
    const shinProbsPlus = implied.map(q => {
      const d = zPlus * zPlus + 4 * (1 - zPlus) * (q / S);
      return (Math.sqrt(Math.max(0, d)) - zPlus) / (2 * (1 - zPlus));
    });
    const dSumdz = (shinProbsPlus.reduce((s, p) => s + p, 0) - shinSum) / dz;
    if (Math.abs(dSumdz) < 1e-12) break;
    z = Math.max(0.0001, Math.min(0.20, z - residual / dSumdz));
  }

  const fairProbs = implied.map(q => {
    const discriminant = z * z + 4 * (1 - z) * (q / S);
    return (Math.sqrt(Math.max(0, discriminant)) - z) / (2 * (1 - z));
  });

  // Normalize to exactly 1 to eliminate floating-point drift
  const total = fairProbs.reduce((s, p) => s + p, 0);
  return fairProbs.map(p => p / total);
}

export function calcularValueBets(match: Match, analysis: AnalysisResponse): ValueBetReport {
  // EV-01: Always use Pinnacle (or betfair_ex_eu as fallback) for reference bookmaker
  const refBookmaker = match.bookmakers?.find(b => b.key === 'pinnacle')
    ?? match.bookmakers?.find(b => b.key === 'betfair_ex_eu')
    ?? match.bookmakers?.[0];
  const bookmaker = refBookmaker;
  if (!bookmaker) return { mercados: [], total_value_bets: 0, tem_value: false, melhor_value: null };

  const league = LEAGUES.find(l => l.key === match.sport_key);
  const imprevisibilidade = league?.imprevisibilidade || 'media';

  const w = !league ? 0.85 :
            imprevisibilidade === 'muito_alta' ? 0.80 :
            imprevisibilidade === 'alta' ? 0.90 : 1.0;

  const ref = extractMarketReference(match);

  let fairHome = 0.3333;
  let fairDraw = 0.3333;
  let fairAway = 0.3333;

  const h2h = bookmaker.markets.find(m => m.key === 'h2h');

  if (ref.hasReference && ref.fairProbs.length >= 3) {
    fairHome = ref.fairProbs[0];
    fairDraw = ref.fairProbs[1];
    fairAway = ref.fairProbs[2];
  } else if (h2h) {
    try {
      const h2hOdds = orderOutcomes(h2h.outcomes, match.home_team, match.away_team);
      // EV-02: Use Shin method for 3-way markets
      const bookmakerFair = h2hOdds.length === 3
        ? removeOverroundShin(h2hOdds)
        : removeOverround(h2hOdds);
      fairHome = bookmakerFair[0];
      fairDraw = h2hOdds.length === 3 ? bookmakerFair[1] : 0.0;
      fairAway = h2hOdds.length === 3 ? bookmakerFair[2] : bookmakerFair[1];
    } catch {}
  }

  // Regressão Bayesiana (Shrinkage)
  const probHomeCalibrada = w * (analysis.probabilidades_ml.casa / 100) + (1 - w) * fairHome;
  const probDrawCalibrada = w * (analysis.probabilidades_ml.empate / 100) + (1 - w) * fairDraw;
  const probAwayCalibrada = w * (analysis.probabilidades_ml.fora / 100) + (1 - w) * fairAway;

  const markets: MarketValueBet[] = [];

  // 1. Moneyline
  if (h2h) {
    const homeOutcome = h2h.outcomes.find(o => o.name === match.home_team);
    const drawOutcome = h2h.outcomes.find(o => o.name === 'Draw');
    const awayOutcome = h2h.outcomes.find(o => o.name === match.away_team);

    if (homeOutcome) markets.push(createValueMarket('Vitória Casa', homeOutcome.price, probHomeCalibrada));
    if (drawOutcome) markets.push(createValueMarket('Empate', drawOutcome.price, probDrawCalibrada));
    if (awayOutcome) markets.push(createValueMarket('Vitória Fora', awayOutcome.price, probAwayCalibrada));
  }

  // 2. Gols
  const totals = bookmaker.markets.find(m => m.key === 'totals');
  let fairOver25 = 0.50;
  if (totals) {
    const o25 = totals.outcomes.find(o => o.name === 'Over 2.5');
    const u25 = totals.outcomes.find(o => o.name === 'Under 2.5');
    if (o25 && u25) {
      try {
        const fairProbs = removeOverround([o25.price, u25.price]);
        fairOver25 = fairProbs[0];
      } catch {}
    }
  }
  const probOver25Calibrada = w * (analysis.gols.over25.probabilidade / 100) + (1 - w) * fairOver25;

  if (totals) {
    const o25 = totals.outcomes.find(o => o.name === 'Over 2.5');
    if (o25) markets.push(createValueMarket('Mais de 2.5 Gols', o25.price, probOver25Calibrada));
  }

  if (analysis.dupla_chance) {
    const homeOdd = h2h?.outcomes.find(o => o.name === match.home_team)?.price;
    const drawOdd = h2h?.outcomes.find(o => o.name === 'Draw')?.price;
    const awayOdd = h2h?.outcomes.find(o => o.name === match.away_team)?.price;

    const mlProbs = analysis.probabilidades_ml;
    const favoritoProb = Math.max(mlProbs.casa, mlProbs.empate, mlProbs.fora);
    const favoritoMuitoClaro = favoritoProb > 60;

    if (homeOdd && drawOdd && awayOdd) {
      try {
        // EV-03: Derive DC odds from fair probs (no overround) for correct EV calculation
        const prob1X_fair = fairHome + fairDraw;
        const probX2_fair = fairDraw + fairAway;
        const prob12_fair = fairHome + fairAway;
        const dc1X_bookmaker_odd = prob1X_fair > 0 ? 1 / prob1X_fair : 1 / ((1 / homeOdd) + (1 / drawOdd));
        const dcX2_bookmaker_odd = probX2_fair > 0 ? 1 / probX2_fair : 1 / ((1 / drawOdd) + (1 / awayOdd));
        const dc12_bookmaker_odd = prob12_fair > 0 ? 1 / prob12_fair : 1 / ((1 / homeOdd) + (1 / awayOdd));

        const probIa1X = probHomeCalibrada + probDrawCalibrada;
        const probIaX2 = probDrawCalibrada + probAwayCalibrada;
        const probIa12 = probHomeCalibrada + probAwayCalibrada;

        const m1X = createValueMarket('Dupla Chance 1X', dc1X_bookmaker_odd, probIa1X, true);
        if (favoritoMuitoClaro) { m1X.recomenda = false; m1X.observacao = 'Favorito muito claro — dupla chance tem baixo valor'; }
        markets.push(m1X);

        const mX2 = createValueMarket('Dupla Chance X2', dcX2_bookmaker_odd, probIaX2, true);
        if (favoritoMuitoClaro) { mX2.recomenda = false; mX2.observacao = 'Favorito muito claro — dupla chance tem baixo valor'; }
        markets.push(mX2);

        const m12 = createValueMarket('Dupla Chance 12', dc12_bookmaker_odd, probIa12, true);
        if (favoritoMuitoClaro) { m12.recomenda = false; m12.observacao = 'Favorito muito claro — dupla chance tem baixo valor'; }
        markets.push(m12);

      } catch (e: any) {
        console.warn('[DC] Falha ao calcular dupla chance:', e.message);
        const dc1X_odd = 1 / ((1 / homeOdd) + (1 / drawOdd));
        const dcX2_odd = 1 / ((1 / drawOdd) + (1 / awayOdd));
        const dc12_odd = 1 / ((1 / homeOdd) + (1 / awayOdd));

        const m1X = createValueMarket('Dupla Chance 1X', dc1X_odd, probHomeCalibrada + probDrawCalibrada, true);
        markets.push(m1X);
        const mX2 = createValueMarket('Dupla Chance X2', dcX2_odd, probDrawCalibrada + probAwayCalibrada, true);
        markets.push(mX2);
        const m12 = createValueMarket('Dupla Chance 12', dc12_odd, probHomeCalibrada + probAwayCalibrada, true);
        markets.push(m12);
      }
    }
  }

  // GATE-02: Filter by min/max odd for clubs
  const validatedMarkets = markets.filter(m => validateMarket(m)).filter(m => {
    if (m.odd_api < CLUB_MIN_ODD || m.odd_api > CLUB_MAX_ODD) return false;
    return true;
  });

  return {
    mercados: validatedMarkets,
    total_value_bets: validatedMarkets.filter(m => m.is_value_bet).length,
    tem_value: validatedMarkets.some(m => m.is_value_bet),
    melhor_value: validatedMarkets.sort((a, b) => b.edge - a.edge)[0] || null
  };
}

function createValueMarket(name: string, oddApi: number, probIA: number, estimated: boolean = false): MarketValueBet {
  const fairOdd = 1 / probIA;
  let edge = (probIA * oddApi) - 1;

  const atingiuTeto = edge > MAX_EDGE_REALISTA;
  const edgeLimitado = Math.min(edge, MAX_EDGE_REALISTA);

  return {
    market: name,
    odd_api: oddApi,
    prob_ia: probIA * 100,
    odd_fair: fairOdd,
    edge: edgeLimitado,
    is_value_bet: edge > 0.05 && !atingiuTeto,
    recomenda: edge > 0.10 && !atingiuTeto,
    odd_is_estimated: estimated || atingiuTeto,
    observacao: ''
  };
}

function validateMarket(market: MarketValueBet): boolean {
  if (market.odd_is_estimated && market.edge > MAX_EDGE_REALISTA) return false;
  if (market.prob_ia < MIN_PROB_THRESHOLD) return false;
  return true;
}

export function validateReport(report: ValueBetReport): ValueBetReport {
  report.mercados = report.mercados.map(m => {
    if (m.prob_ia < MIN_PROB_THRESHOLD) m.is_value_bet = false;
    if (m.odd_is_estimated && m.edge > MAX_EDGE_REALISTA) m.is_value_bet = false;
    return m;
  });

  const validValues = report.mercados.filter(m => m.is_value_bet);
  report.total_value_bets = validValues.length;
  report.tem_value = validValues.length > 0;
  report.melhor_value = validValues.sort((a, b) => b.edge - a.edge)[0] || null;

  return report;
}

export function extractMarketReference(matchData: any): MarketReference {
  const bookmakers = matchData.bookmakers || [];

  let sharpBook = bookmakers.find((b: any) => b.key === 'pinnacle');
  let chosenKey: 'pinnacle' | 'betfair_ex_eu' | null = 'pinnacle';

  if (!sharpBook) {
    sharpBook = bookmakers.find((b: any) => b.key === 'betfair_ex_eu');
    chosenKey = 'betfair_ex_eu';
  }

  if (!sharpBook) {
    return { sharpBookmaker: null, rawOdds: [], fairProbs: [], overround: 0, lastUpdate: '', hasReference: false };
  }

  const h2h = sharpBook.markets.find((m: any) => m.key === 'h2h');
  if (!h2h || !h2h.outcomes || h2h.outcomes.length < 2) {
    return { sharpBookmaker: null, rawOdds: [], fairProbs: [], overround: 0, lastUpdate: '', hasReference: false };
  }

  let rawOdds: number[];
  try {
    rawOdds = orderOutcomes(h2h.outcomes, matchData.home_team, matchData.away_team);
  } catch {
    return { sharpBookmaker: null, rawOdds: [], fairProbs: [], overround: 0, lastUpdate: '', hasReference: false };
  }

  let fairProbs: number[];
  let overround: number;
  try {
    // EV-02: Use Shin method for 3-way markets (removes favourite-longshot bias)
    fairProbs = rawOdds.length === 3
      ? removeOverroundShin(rawOdds)
      : removeOverround(rawOdds);
    overround = rawOdds.reduce((sum: number, o: number) => sum + (1 / o), 0);
  } catch {
    return { sharpBookmaker: null, rawOdds: [], fairProbs: [], overround: 0, lastUpdate: '', hasReference: false };
  }

  return {
    sharpBookmaker: chosenKey,
    rawOdds,
    fairProbs,
    overround: (overround - 1) * 100,
    lastUpdate: sharpBook.last_update || new Date().toISOString(),
    hasReference: true
  };
}

export function orderOutcomes(outcomes: any[], homeTeam: string, awayTeam: string): number[] {
  const home = outcomes.find(o => o.name === homeTeam)?.price;
  const away = outcomes.find(o => o.name === awayTeam)?.price;
  const draw = outcomes.find(o => o.name === 'Draw')?.price;

  if (home == null || away == null) {
    throw new Error(`orderOutcomes: outcomes incompletos para ${homeTeam} vs ${awayTeam}`);
  }

  return draw != null ? [home, draw, away] : [home, away];
}

export interface JogoPonderado {
  pesoTotal: number;
  golsMarcados: number;
}

export interface ConfiancaDados {
  nJogosEfetivos: number;
  cvLambda: number;
  shrinkageAlpha: number;
}

export interface ResultadoGateConfianca {
  passou: boolean;
  motivo?: string;
}

export function calcNJogosEfetivos(pool: JogoPonderado[]): number {
  return pool
    .filter(j => j.pesoTotal > 0.05)
    .reduce((acc, j) => acc + j.pesoTotal, 0);
}

export function calcCVLambda(pool: JogoPonderado[]): number {
  const gols = pool.map(j => j.golsMarcados);
  if (gols.length < 2) return 999;
  const media = gols.reduce((a, b) => a + b, 0) / gols.length;
  if (media === 0) return 999;
  const variancia = gols.reduce((acc, g) => acc + Math.pow(g - media, 2), 0) / gols.length;
  return Math.sqrt(variancia) / media;
}

export function calcShrinkageAlpha(nJogosEfetivos: number): number {
  return Math.min(1, nJogosEfetivos / 20);
}

export function gateConfiancaDados(dados: ConfiancaDados): ResultadoGateConfianca {
  if (dados.nJogosEfetivos < 8) {
    return {
      passou: false,
      motivo: `Dados insuficientes: ${dados.nJogosEfetivos.toFixed(1)} jogos efetivos (mínimo: 8)`
    };
  }
  if (dados.cvLambda > 0.50) {
    return {
      passou: false,
      motivo: `Lambda instável: CV=${dados.cvLambda.toFixed(2)} (máximo: 0.50)`
    };
  }
  if (dados.shrinkageAlpha < 0.25) {
    return {
      passou: false,
      motivo: `Modelo sem autonomia: α=${dados.shrinkageAlpha.toFixed(2)} (mínimo: 0.25)`
    };
  }
  return { passou: true };
}
