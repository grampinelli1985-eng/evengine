/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match, AnalysisResponse, ValueBetReport, MarketValueBet, LEAGUES, MarketReference } from '../types';

const MAX_EDGE_REALISTA = 0.30;

export const KELLY_MAX_ABSOLUTO = 0.03; // 3% do bankroll — teto hard

export function aplicarKellyMax(kellyCalculado: number): number {
  return Math.min(kellyCalculado, KELLY_MAX_ABSOLUTO);
}

/**
 * Remove a margem da casa (overround/vig) das odds, retornando
 * probabilidades "justas" que somam exatamente 100%.
 *
 * Exemplo: odds [2.10, 3.40, 3.80]
 * → implied [47.6%, 29.4%, 26.3%] (soma 103.3% — overround de 3.3%)
 * → fair [46.1%, 28.5%, 25.4%] (soma 100%)
 *
 * @param odds Array de odds decimais (ex: [2.10, 3.40, 3.80])
 * @returns Array de probabilidades justas em fração (0-1)
 * @throws Error se alguma odd for inválida (≤ 1.0, NaN, null, undefined, Infinity)
 */
export function removeOverround(odds: number[]): number[] {
  // 1. Validar entrada
  if (!Array.isArray(odds) || odds.length === 0) {
    throw new Error('removeOverround: array de odds vazio ou inválido');
  }
  if (odds.some(o => o === null || o === undefined || isNaN(o) || !isFinite(o) || o <= 1.0)) {
    throw new Error(`removeOverround: odds inválidas detectadas: ${JSON.stringify(odds)}`);
  }

  // 2. Probabilidade implícita bruta de cada odd: 1/odd
  const implied = odds.map(o => 1 / o);

  // 3. Overround = soma das probabilidades implícitas
  const overround = implied.reduce((sum, p) => sum + p, 0);

  // 4. Normalizar (probabilidade justa = implícita / overround)
  return implied.map(p => p / overround);
}

export function calcularValueBets(match: Match, analysis: AnalysisResponse): ValueBetReport {
  const bookmaker = match.bookmakers?.[0];
  if (!bookmaker) return { mercados: [], total_value_bets: 0, tem_value: false, melhor_value: null };

  const league = LEAGUES.find(l => l.key === match.sport_key);
  const imprevisibilidade = league?.imprevisibilidade || 'media';

  // MENOR 3: w = 0.85 quando liga não está mapeada (shrinkage conservador como precaução).
  // Liga conhecida: usa imprevisibilidade para calcular w normalmente.
  // Liga desconhecida (league === undefined): w = 0.85 independente do fallback 'media'.
  const w = !league ? 0.85 :
            imprevisibilidade === 'muito_alta' ? 0.80 :
            imprevisibilidade === 'alta' ? 0.90 : 1.0;

  const ref = extractMarketReference(match);

  // Obter probabilidade justa de referência do mercado sem vig
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
      const bookmakerFair = removeOverround(h2hOdds);
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
        // Odds sintéticas comerciais (com margem da Pinnacle, igual ao que aparece no site)
        const dc1X_bookmaker_odd = 1 / ((1 / homeOdd) + (1 / drawOdd));
        const dcX2_bookmaker_odd = 1 / ((1 / drawOdd) + (1 / awayOdd));
        const dc12_bookmaker_odd = 1 / ((1 / homeOdd) + (1 / awayOdd));

        // Probabilidades da IA calibradas e consistentes sem duplo-penalização redundante
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
        // Fallback robusto
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

  const validatedMarkets = markets.filter(m => validateMarket(m));

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

  // IMPORTANTE 1: threshold elevado para 0.85 (28.5%) — edges entre 22.5-28.5% são raros mas possíveis.
  // O teto absoluto MAX_EDGE_REALISTA (30%) ainda é respeitado.
  const atingiuTeto = edge >= MAX_EDGE_REALISTA * 0.85; // 28.5% já é suspeito
  const edgeLimitado = Math.min(edge, MAX_EDGE_REALISTA);

  return {
    market: name,
    odd_api: oddApi,
    prob_ia: probIA * 100,
    odd_fair: fairOdd,
    edge: edgeLimitado,
    is_value_bet: edge > 0.05 && !atingiuTeto && edge <= MAX_EDGE_REALISTA,
    recomenda: edge > 0.10 && !atingiuTeto,
    odd_is_estimated: estimated || atingiuTeto,
    observacao: ''
  };
}

function validateMarket(market: MarketValueBet): boolean {
  if (market.odd_is_estimated && market.edge > MAX_EDGE_REALISTA) return false;
  if (market.prob_ia < 5) return false;
  return true;
}

export function validateReport(report: ValueBetReport): ValueBetReport {
  // Relaxed limit: a value bet is about EDGE, not just high probability.
  // We only disable if prob is extremely low (< 15%) or odd is estimated and edge too high.
  report.mercados = report.mercados.map(m => {
    if (m.prob_ia < 15) m.is_value_bet = false;
    if (m.odd_is_estimated && m.edge > 0.25) m.is_value_bet = false;
    return m;
  });

  // Re-sync totals
  const validValues = report.mercados.filter(m => m.is_value_bet);
  report.total_value_bets = validValues.length;
  report.tem_value = validValues.length > 0;
  report.melhor_value = validValues.sort((a, b) => b.edge - a.edge)[0] || null;

  return report;
}

/**
 * Extrai a referência matemática sharp de um jogo, priorizando Pinnacle
 * e usando Betfair Exchange EU como fallback.
 */
export function extractMarketReference(matchData: any): MarketReference {
  const bookmakers = matchData.bookmakers || [];

  // 1. Tentar Pinnacle primeiro
  let sharpBook = bookmakers.find((b: any) => b.key === 'pinnacle');
  let chosenKey: 'pinnacle' | 'betfair_ex_eu' | null = 'pinnacle';

  // 2. Fallback para Betfair Exchange EU
  if (!sharpBook) {
    sharpBook = bookmakers.find((b: any) => b.key === 'betfair_ex_eu');
    chosenKey = 'betfair_ex_eu';
  }

  // 3. Sem referência disponível
  if (!sharpBook) {
    return {
      sharpBookmaker: null,
      rawOdds: [],
      fairProbs: [],
      overround: 0,
      lastUpdate: '',
      hasReference: false
    };
  }

  // 4. Extrair odds do mercado h2h
  const h2h = sharpBook.markets.find((m: any) => m.key === 'h2h');
  if (!h2h || !h2h.outcomes || h2h.outcomes.length < 2) {
    return { sharpBookmaker: null, rawOdds: [], fairProbs: [], overround: 0, lastUpdate: '', hasReference: false };
  }

  // Ordem padrão esperada: [Home, Away, Draw] no h2h do the-odds-api
  // CUIDADO: a API não garante ordem; precisamos ordenar por nome dos times
  let rawOdds: number[];
  try {
    rawOdds = orderOutcomes(h2h.outcomes, matchData.home_team, matchData.away_team);
  } catch {
    return { sharpBookmaker: null, rawOdds: [], fairProbs: [], overround: 0, lastUpdate: '', hasReference: false };
  }

  // 5. Calcular vig-free
  let fairProbs: number[];
  let overround: number;
  try {
    fairProbs = removeOverround(rawOdds);
    overround = rawOdds.reduce((sum: number, o: number) => sum + (1/o), 0);
  } catch {
    return { sharpBookmaker: null, rawOdds: [], fairProbs: [], overround: 0, lastUpdate: '', hasReference: false };
  }

  return {
    sharpBookmaker: chosenKey,
    rawOdds,
    fairProbs,
    overround: (overround - 1) * 100,  // em %
    lastUpdate: sharpBook.last_update || new Date().toISOString(),
    hasReference: true
  };
}

/**
 * Ordena outcomes do h2h em [home, away, draw] (3-way) ou [home, away] (2-way)
 */
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
  // IMPORTANTE 2: threshold reduzido de 0.60 para 0.50 para exigir melhor qualidade de ajuste Poisson.
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
