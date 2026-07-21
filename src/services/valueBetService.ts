/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match, AnalysisResponse, ValueBetReport, MarketValueBet, LEAGUES, MarketReference } from '../types';

const MAX_EDGE_REALISTA = 0.12; // EV-04: edges above 12% vs Pinnacle are virtually impossible and indicate model error

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
  // EV-01: Always use Pinnacle (or betfair_ex_eu as fallback) for reference bookmaker.
  // EV-05: Track whether we fell through to a soft bookmaker — affects model confidence.
  const pinnacleBook = match.bookmakers?.find(b => b.key === 'pinnacle');
  const betfairBook = match.bookmakers?.find(b => b.key === 'betfair_ex_eu');
  const hasSharpRef = !!(pinnacleBook ?? betfairBook);
  const refBookmaker = pinnacleBook ?? betfairBook ?? match.bookmakers?.[0];
  const bookmaker = refBookmaker;
  if (!bookmaker) return { mercados: [], total_value_bets: 0, tem_value: false, melhor_value: null };
  if (!hasSharpRef) {
    console.warn(
      `[EV-05] Sem referência sharp (Pinnacle/Betfair) para ${match.home_team} vs ${match.away_team}.` +
      ` Usando "${bookmaker.key}" como referência — edge calculado pode ser artificial.`
    );
  }

  const league = LEAGUES.find(l => l.key === match.sport_key);
  const imprevisibilidade = league?.imprevisibilidade || 'media';

  // EV-05: Reduce model weight when using soft bookmaker — their lines are inefficient,
  // so trusting our model more than the reference would inflate EV artificially.
  // Cap Bayesian weight at 0.35 without a sharp reference (punitive shrinkage).
  const wBase = !league ? 0.85 :
    imprevisibilidade === 'muito_alta' ? 0.80 :
      imprevisibilidade === 'alta' ? 0.90 : 1.0;
  const w = hasSharpRef ? wBase : Math.min(wBase, 0.35);

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
    } catch { }
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
      } catch { }
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
        // EV-03 fix: DC odds derived from actual bookmaker H2H odds, not fair probs.
        // Using 1/prob_fair as "bookmaker odd" compared our model to a vig-free line,
        // creating an artificial edge. Instead we combine the raw bookmaker H2H odds
        // the same way a bookmaker would price DC: 1 / (1/o1 + 1/o2) gives the
        // effective bookmaker DC price (preserving the original vig structure).
        const dc1X_bookmaker_odd = 1 / ((1 / homeOdd) + (1 / drawOdd));
        const dcX2_bookmaker_odd = 1 / ((1 / drawOdd) + (1 / awayOdd));
        const dc12_bookmaker_odd = 1 / ((1 / homeOdd) + (1 / awayOdd));

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

  // 4. BTTS (Ambas Marcam)
  const bttsMarket = bookmaker.markets.find(m => m.key === 'btts');
  if (analysis.poisson?.btts_prob !== undefined) {
    const bttsProb = analysis.poisson.btts_prob / 100;
    let fairBtts = 0.50;
    let bttsYesOdd: number | null = null;

    if (bttsMarket) {
      const yes = bttsMarket.outcomes.find((o: any) => o.name === 'Yes');
      const no = bttsMarket.outcomes.find((o: any) => o.name === 'No');
      if (yes && no) {
        try {
          const fp = removeOverround([yes.price, no.price]);
          fairBtts = fp[0];
          bttsYesOdd = yes.price;
        } catch { }
      }
    }

    const probBttsCalibrada = w * bttsProb + (1 - w) * fairBtts;
    if (bttsYesOdd) {
      markets.push(createValueMarket('Ambas Marcam (Sim)', bttsYesOdd, probBttsCalibrada));
    }
  }

  // 5. DNB (Empate Anula Aposta)
  {
    const dnbMarket = bookmaker.markets.find(m => m.key === 'draw_no_bet');
    const dnbHRaw = h2h?.outcomes.find((o: any) => o.name === match.home_team)?.price;
    const dnbARaw = h2h?.outcomes.find((o: any) => o.name === match.away_team)?.price;
    const total12 = probHomeCalibrada + probAwayCalibrada;

    if (total12 > 0 && dnbHRaw && dnbARaw) {
      const probDnbHome = probHomeCalibrada / total12;
      const probDnbAway = probAwayCalibrada / total12;
      const fairTotal12 = fairHome + fairAway;

      let dnbHOdd: number | null = null;
      let dnbAOdd: number | null = null;
      let dnbEstimated = false;

      if (dnbMarket) {
        dnbHOdd = dnbMarket.outcomes.find((o: any) => o.name === match.home_team)?.price ?? null;
        dnbAOdd = dnbMarket.outcomes.find((o: any) => o.name === match.away_team)?.price ?? null;
      } else if (fairTotal12 > 0) {
        // Derive from sharp h2h fair probs (vig-free — mark estimated)
        dnbHOdd = fairTotal12 / fairHome;
        dnbAOdd = fairTotal12 / fairAway;
        dnbEstimated = true;
      }

      if (dnbHOdd) markets.push(createValueMarket('Empate Anula - Casa', dnbHOdd, probDnbHome, dnbEstimated));
      if (dnbAOdd) markets.push(createValueMarket('Empate Anula - Fora', dnbAOdd, probDnbAway, dnbEstimated));
    }
  }

  // 6. Asian Totals (Over 2.0, 2.25, 2.75, 3.0)
  // Effective probs account for push scenarios per Dixon-Coles/Asian lines math:
  //   Over N.0:  win=P(goals>N), push=P(goals=N), lose=P(goals<N)  → eff = P(win)/(P(win)+P(lose))
  //   Over N.25: split ½ on N.0 + ½ on N.5                         → eff = P(win)/(1-0.5*P(push))
  //   Over N.75: split ½ on N.5 + ½ on (N+1).0                     → eff = (P(win)+0.5*P(push))/(1-0.5*P(push))
  if (analysis.poisson && totals) {
    const po = analysis.poisson;
    const p25 = po.over_2_5 / 100;  // P(goals ≥ 3)
    const p15 = po.over_1_5 / 100;  // P(goals ≥ 2)
    const p35 = po.over_3_5 / 100;  // P(goals ≥ 4)

    const eq2 = Math.max(0, p15 - p25);   // P(goals = 2)
    const eq3 = Math.max(0, p25 - p35);   // P(goals = 3)
    const lt2 = Math.max(0, 1 - p15);     // P(goals ≤ 1)
    const lt3 = Math.max(0, 1 - p25);     // P(goals ≤ 2)

    if (p25 > 0) {
      const eff20 = (p25 + lt2) > 0 ? p25 / (p25 + lt2) : 0;
      const eff225 = (1 - 0.5 * eq2) > 0 ? p25 / (1 - 0.5 * eq2) : 0;
      const eff275 = (1 - 0.5 * eq3) > 0 ? (p35 + 0.5 * eq3) / (1 - 0.5 * eq3) : 0;
      const eff30 = (p35 + lt3) > 0 ? p35 / (p35 + lt3) : 0;

      // Try alternate_totals for real bookmaker Asian odds
      const altTotals = bookmaker.markets.find(m => m.key === 'alternate_totals');
      const getAltOdd = (label: string): number | null =>
        altTotals?.outcomes.find((o: any) => o.name === label)?.price ?? null;

      const asianLines = [
        { name: 'Asian Over 2.0', eff: eff20, altLabel: 'Over 2' },
        { name: 'Asian Over 2.25', eff: eff225, altLabel: 'Over 2.25' },
        { name: 'Asian Over 2.75', eff: eff275, altLabel: 'Over 2.75' },
        { name: 'Asian Over 3.0', eff: eff30, altLabel: 'Over 3' },
      ];

      for (const line of asianLines) {
        if (line.eff <= 0) continue;
        // Bookmaker reference: scale sharp fair Over 2.5 prob proportionally by model shape
        const refProb = fairOver25 * (line.eff / p25);
        if (refProb <= 0 || refProb >= 1) continue;

        const altOdd = getAltOdd(line.altLabel);
        const estimated = !altOdd;
        const bookmakerOdd = altOdd ?? (1 / refProb);

        const probCalibrada = w * line.eff + (1 - w) * refProb;
        markets.push(createValueMarket(line.name, bookmakerOdd, probCalibrada, estimated));
      }
    }
  }

  // GATE-02: Filter by min/max odd for clubs (Asian/prop markets exempt from min odd)
  const validatedMarkets = markets.filter(m => validateMarket(m)).filter(m => {
    const isAsianOrProp = m.market.startsWith('Asian') || m.market.startsWith('Ambas') || m.market.startsWith('Empate Anula');
    if (!isAsianOrProp && (m.odd_api < CLUB_MIN_ODD || m.odd_api > CLUB_MAX_ODD)) return false;
    return true;
  });

  const bestValueOnly = validatedMarkets.filter(m => m.is_value_bet);

  return {
    mercados: validatedMarkets,
    total_value_bets: bestValueOnly.length,
    tem_value: bestValueOnly.length > 0,
    melhor_value: bestValueOnly.sort((a, b) => b.edge - a.edge)[0] || null
  };
}

export function createValueMarket(name: string, oddApi: number, probIA: number, estimated: boolean = false): MarketValueBet {
  const fairOdd = 1 / probIA;
  const edgeRaw = (probIA * oddApi) - 1;

  const excedeuTetoPlausivel = edgeRaw >= MAX_EDGE_REALISTA;       // >= 12% → impossível, hard reject
  const zonaAtencao = edgeRaw >= MAX_EDGE_REALISTA * 0.85;         // 10.2%–12% → válido, mas exige cautela

  const edgeFinal = Math.min(edgeRaw, MAX_EDGE_REALISTA);

  return {
    market: name,
    odd_api: oddApi,
    prob_ia: probIA * 100,
    odd_fair: fairOdd,
    edge: edgeFinal,
    is_value_bet: edgeRaw > 0.05 && !excedeuTetoPlausivel,
    recomenda: edgeRaw > 0.10 && !excedeuTetoPlausivel,
    odd_is_estimated: estimated || excedeuTetoPlausivel,
    observacao: zonaAtencao && !excedeuTetoPlausivel
      ? 'Edge elevado, próximo do teto de plausibilidade — revisar dados manualmente antes de apostar.'
      : ''
  };
}

function validateMarket(market: MarketValueBet): boolean {
  if (market.prob_ia < 5) return false;
  return true;
}

export function validateReport(report: ValueBetReport): ValueBetReport {
  report.mercados = report.mercados.map(m => {
    if (m.prob_ia < 15) m.is_value_bet = false;
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
  if (dados.cvLambda > 1.05) {
    return {
      passou: false,
      motivo: `Lambda instável: CV=${dados.cvLambda.toFixed(2)} (máximo: 1.05)`
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
