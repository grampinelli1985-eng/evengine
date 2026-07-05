/**
 * wcTipsterEngine.ts — Motor de análise para torneios internacionais
 *
 * Gate v2.2 — 5 camadas de proteção contra RED:
 *  1. B-EV:   EV mínimo dinâmico por fase (grupos 4%, knockout 6%) + teto MAX_EV_REALISTA (20%)
 *  2. B-CONF: Confiança mínima 62%
 *  3. B-SCORE: Score composto mínimo 45
 *  4. B-MEFF: Market Efficiency — edge vs Pinnacle implied < 3% → sem vantagem
 *             edge vs Pinnacle implied > 20pp → modelo diverge do mercado (B-MEFF-HIGH)
 *  5. B-ODD:  Odd mínima 1.50 (favoritos pesados = alta variância no futebol internacional)
 *  Stake máximo reduzido para 2% (WC: dados limitados, variância alta)
 *
 * BLD-01 (v2.2): Blend adaptativo ELO + Mercado Pinnacle
 *  - Peso base ELO: 65% (vs 85% em clubes — dados WC mais escassos)
 *  - Penalidade de staleness: até -20pp quando ELO sem atualização > 60 dias
 *  - Penalidade de divergência: até -25pp proporcional ao delta ELO vs mercado
 *  - Peso mínimo ELO: 30% (garante que modelo não seja 100% market follower)
 */

import { WCMatch, WCAnalysisResult } from './wcTypes';
import { calculateWCElo, seedWCEloFromOdds } from './wcEloService';
import { calculateWCPoisson, calcularEVMercadoWC } from './wcPoissonService';
import { getBancaAtual } from '../bancaService';
import { getEloStalenessInfo } from '../eloService';

const TEAM_PT: Record<string, string> = {
  'Brazil': 'Brasil', 'Argentina': 'Argentina', 'France': 'França', 'England': 'Inglaterra',
  'Spain': 'Espanha', 'Germany': 'Alemanha', 'Portugal': 'Portugal', 'Netherlands': 'Holanda',
  'Belgium': 'Bélgica', 'Italy': 'Itália', 'Croatia': 'Croácia', 'Uruguay': 'Uruguai',
  'Colombia': 'Colômbia', 'Mexico': 'México', 'United States': 'Estados Unidos', 'USA': 'Estados Unidos',
  'Canada': 'Canadá', 'Morocco': 'Marrocos', 'Japan': 'Japão', 'South Korea': 'Coreia do Sul',
  'Australia': 'Austrália', 'Serbia': 'Sérvia', 'Switzerland': 'Suíça', 'Denmark': 'Dinamarca',
  'Poland': 'Polônia', 'Ecuador': 'Equador', 'Ghana': 'Gana', 'Cameroon': 'Camarões',
  'Tunisia': 'Tunísia', 'Iran': 'Irã', 'Saudi Arabia': 'Arábia Saudita', 'Qatar': 'Catar',
  'Costa Rica': 'Costa Rica', 'Wales': 'País de Gales', 'Chile': 'Chile', 'Peru': 'Peru',
  'Venezuela': 'Venezuela', 'Bolivia': 'Bolívia', 'Paraguay': 'Paraguai', 'Egypt': 'Egito',
  'Nigeria': 'Nigéria', 'Algeria': 'Argélia', 'Czech Republic': 'República Tcheca',
  'Austria': 'Áustria', 'Turkey': 'Turquia', 'Ukraine': 'Ucrânia', 'South Africa': 'África do Sul',
  'Ivory Coast': 'Costa do Marfim', "Côte d'Ivoire": 'Costa do Marfim',
  'Bosnia & Herzegovina': 'Bósnia e Herzegovina', 'New Zealand': 'Nova Zelândia',
  'Scotland': 'Escócia', 'Haiti': 'Haiti',
};
function ptBR(name: string): string { return TEAM_PT[name] ?? name; }

// Thresholds do Gate WC v2.1
const GATE_MIN_EV_GRUPOS = 4.0;
const GATE_MIN_EV_KNOCKOUT = 6.0;
const GATE_MAX_EV_REALISTA = 20.0;   // EV acima disso → modelo diverge do mercado
const GATE_MIN_CONF = 62;
const GATE_MIN_SCORE = 45;
const GATE_MIN_ODD = 1.50;
const GATE_MAX_ODD = 4.50;
const GATE_MIN_EDGE_VS_MARKET = 3.0;
const GATE_MAX_EDGE_VS_MARKET = 20.0; // acima → seeding inconsistente
const KELLY_FRACTION = 0.25;
const MAX_STAKE_PCT = 0.02;

const KNOCKOUT_PHASES = new Set(['oitavas', 'quartas', 'semi', 'final']);

function getMinEV(phase?: WCMatch['phase']): number {
  return phase && KNOCKOUT_PHASES.has(phase) ? GATE_MIN_EV_KNOCKOUT : GATE_MIN_EV_GRUPOS;
}

function pinnacleImplied(match: WCMatch, outcomeName: string): number | null {
  const pinnacle = match.bookmakers.find(b => b.key === 'pinnacle') ?? match.bookmakers[0];
  if (!pinnacle) return null;
  const h2h = pinnacle.markets.find(m => m.key === 'h2h');
  if (!h2h || h2h.outcomes.length < 2) return null;

  const total = h2h.outcomes.reduce((s, o) => s + (o.price > 1 ? 1 / o.price : 0), 0);
  if (total <= 0) return null;

  const outcome = h2h.outcomes.find(o => o.name === outcomeName || ptBR(o.name) === outcomeName);
  if (!outcome || outcome.price <= 1) return null;

  return (1 / outcome.price / total) * 100;
}

// BLD-01: Extrai probabilidades implícitas Pinnacle para os 3 outcomes (normalizadas, sem overround)
interface PinnacleImpliedAll {
  home: number; // %
  draw: number; // %
  away: number; // %
}

function getPinnacleImpliedAll(match: WCMatch): PinnacleImpliedAll | null {
  const pinnacle = match.bookmakers.find(b => b.key === 'pinnacle') ?? match.bookmakers[0];
  if (!pinnacle) return null;
  const h2h = pinnacle.markets.find(m => m.key === 'h2h');
  if (!h2h || h2h.outcomes.length < 2) return null;

  const homeOut = h2h.outcomes.find(o => o.name === match.home_team);
  const awayOut = h2h.outcomes.find(o => o.name === match.away_team);
  const drawOut = h2h.outcomes.find(o => o.name === 'Draw');

  if (!homeOut || homeOut.price <= 1 || !awayOut || awayOut.price <= 1) return null;

  // Normalização proporcional (remove overround)
  const total = h2h.outcomes.reduce((s, o) => s + (o.price > 1 ? 1 / o.price : 0), 0);
  if (total <= 0) return null;

  return {
    home: (1 / homeOut.price / total) * 100,
    draw: drawOut && drawOut.price > 1 ? (1 / drawOut.price / total) * 100 : 0,
    away: (1 / awayOut.price / total) * 100,
  };
}

// BLD-01: Peso adaptativo do ELO no blend — reduz confiança quando ELO está desatualizado
// ou diverge significativamente do mercado sharp.
function calcBlendWeight(
  eloHomeProb: number,
  marketImplied: PinnacleImpliedAll | null,
  staleness: ReturnType<typeof getEloStalenessInfo>
): number {
  const W_BASE = 0.65; // WC: menos dados que clubes → menor confiança base no ELO

  // Penalidade de staleness: ELO sem atualização → menos confiável
  const stalenessPenalty = staleness.anyStale ? 0.20 : staleness.anyWarning ? 0.10 : 0;

  // Penalidade de divergência: quanto mais o ELO discorda do mercado, menos peso recebe
  let divergencePenalty = 0;
  if (marketImplied !== null) {
    const divergence = Math.abs(eloHomeProb - marketImplied.home);
    // Cada 1pp de divergência → -0.5pp de peso ELO, máx -25pp
    divergencePenalty = Math.min(0.25, divergence * 0.005);
  }

  return Math.max(0.30, W_BASE - stalenessPenalty - divergencePenalty);
}

interface WCCandidate {
  nome: string;
  probabilidade: number;
  odd: number;
  ev: number;
}

function extractCandidates(match: WCMatch, poisson: ReturnType<typeof calculateWCPoisson>): WCCandidate[] {
  const pinnacle = match.bookmakers.find(b => b.key === 'pinnacle') ?? match.bookmakers[0];
  if (!pinnacle) return [];

  const h2h = pinnacle.markets.find(m => m.key === 'h2h');
  const totals = pinnacle.markets.find(m => m.key === 'totals');

  const candidates: WCCandidate[] = [];

  if (h2h) {
    const homeOut = h2h.outcomes.find(o => o.name === match.home_team);
    const awayOut = h2h.outcomes.find(o => o.name === match.away_team);
    const drawOut = h2h.outcomes.find(o => o.name === 'Draw');

    if (homeOut) candidates.push({ nome: `Vitória ${ptBR(match.home_team)}`, probabilidade: 0, odd: homeOut.price, ev: 0 });
    if (drawOut) candidates.push({ nome: 'Empate', probabilidade: 0, odd: drawOut.price, ev: 0 });
    if (awayOut) candidates.push({ nome: `Vitória ${ptBR(match.away_team)}`, probabilidade: 0, odd: awayOut.price, ev: 0 });
  }

  // Mercados de gols — apenas com odds reais; stub hardcoded produz EV espúrio
  if (totals) {
    const over25Out = totals.outcomes.find(o => o.name === 'Over');
    if (over25Out && over25Out.price >= GATE_MIN_ODD) {
      candidates.push({ nome: 'Over 2.5 Gols', probabilidade: poisson.over25.probabilidade, odd: over25Out.price, ev: 0 });
    }
    const over15Out = totals.outcomes.find(o => o.name === 'Over 1.5');
    if (over15Out && over15Out.price >= GATE_MIN_ODD) {
      candidates.push({ nome: 'Over 1.5 Gols', probabilidade: poisson.over15.probabilidade, odd: over15Out.price, ev: 0 });
    }
  }

  return candidates;
}

function scoreComposto(ev: number, confianca: number, eloConfianca: number): number {
  const scoreEV = Math.min(100, Math.max(0, ev * 4));
  const scoreConf = confianca;
  const scoreElo = eloConfianca;
  const scoreOdd = Math.min(100, eloConfianca * 0.8);
  return Math.round(scoreEV * 0.35 + scoreConf * 0.25 + scoreElo * 0.20 + scoreOdd * 0.20);
}

export function runWCTipsterEngine(match: WCMatch): WCAnalysisResult {
  // KLY-03: Banca dinâmica — usa saldo real do usuário em vez de hardcoded 1000
  const bancaTotal = getBancaAtual();

  seedWCEloFromOdds(match);

  const elo = calculateWCElo(match, match.phase);
  const poisson = calculateWCPoisson(match, match.phase);

  const candidates = extractCandidates(match, poisson);

  // BLD-01: Blend adaptativo ELO + Pinnacle implied probability
  const marketImpliedAll = getPinnacleImpliedAll(match);
  const staleness = getEloStalenessInfo(match.home_team, match.away_team);
  const wElo = calcBlendWeight(elo.probabilidades.casa, marketImpliedAll, staleness);
  const wMkt = 1 - wElo;

  const blendedHome = marketImpliedAll
    ? wElo * elo.probabilidades.casa + wMkt * marketImpliedAll.home
    : elo.probabilidades.casa;
  const blendedDraw = marketImpliedAll
    ? wElo * elo.probabilidades.empate + wMkt * marketImpliedAll.draw
    : elo.probabilidades.empate;
  const blendedAway = marketImpliedAll
    ? wElo * elo.probabilidades.fora + wMkt * marketImpliedAll.away
    : elo.probabilidades.fora;

  const homeNamePt = ptBR(match.home_team);
  const awayNamePt = ptBR(match.away_team);
  candidates.forEach(c => {
    if (c.nome.includes(homeNamePt)) {
      c.probabilidade = parseFloat(blendedHome.toFixed(1));
    } else if (c.nome === 'Empate') {
      c.probabilidade = parseFloat(blendedDraw.toFixed(1));
    } else if (c.nome.includes(awayNamePt)) {
      c.probabilidade = parseFloat(blendedAway.toFixed(1));
    }
    c.ev = calcularEVMercadoWC(c.probabilidade, c.odd);
  });

  const viables = candidates
    .filter(c => c.ev > 0 && c.odd >= GATE_MIN_ODD && c.odd <= GATE_MAX_ODD)
    .sort((a, b) => b.ev - a.ev);

  const chosen = viables[0] ?? candidates.sort((a, b) => b.probabilidade - a.probabilidade)[0];

  if (!chosen) {
    return buildBlocked(match, elo, poisson, 'B-DADOS', 'Sem candidatos válidos com odds disponíveis');
  }

  const eloConfianca = 100 - Math.abs(elo.delta) / 20;
  const score = scoreComposto(chosen.ev, chosen.probabilidade, Math.max(0, eloConfianca));

  const minEV = getMinEV(match.phase);

  if (chosen.ev < minEV) {
    return buildBlocked(match, elo, poisson, 'B-EV',
      `EV ${chosen.ev.toFixed(1)}% abaixo do mínimo ${KNOCKOUT_PHASES.has(match.phase ?? '') ? 'knockout' : 'WC'} (${minEV}%)`);
  }

  if (chosen.ev > GATE_MAX_EV_REALISTA) {
    return buildBlocked(match, elo, poisson, 'B-EV',
      `EV ${chosen.ev.toFixed(1)}% acima do máximo realista (${GATE_MAX_EV_REALISTA}%) — ELO pode divergir do mercado`);
  }

  if (chosen.probabilidade < GATE_MIN_CONF) {
    return buildBlocked(match, elo, poisson, 'B-CONF',
      `Confiança ${chosen.probabilidade.toFixed(0)}% abaixo do mínimo (${GATE_MIN_CONF}%)`);
  }

  if (score < GATE_MIN_SCORE) {
    return buildBlocked(match, elo, poisson, 'B-SCORE',
      `Score composto ${score} abaixo do mínimo (${GATE_MIN_SCORE})`);
  }

  const marketImplied = pinnacleImplied(match,
    chosen.nome.includes(homeNamePt) ? match.home_team :
    chosen.nome.includes(awayNamePt) ? match.away_team : 'Draw'
  );

  let edgeVsMercado: number | null = null;
  if (marketImplied !== null) {
    edgeVsMercado = chosen.probabilidade - marketImplied;

    if (edgeVsMercado > GATE_MAX_EDGE_VS_MARKET) {
      return buildBlocked(match, elo, poisson, 'B-MEFF',
        `Edge vs Pinnacle ${edgeVsMercado.toFixed(1)}pp — ELO diverge excessivamente do mercado sharp (máx. ${GATE_MAX_EDGE_VS_MARKET}pp)`);
    }

    if (edgeVsMercado < GATE_MIN_EDGE_VS_MARKET) {
      return buildBlocked(match, elo, poisson, 'B-MEFF',
        `Edge vs mercado ${edgeVsMercado.toFixed(1)}% — Pinnacle já precificou (mín. ${GATE_MIN_EDGE_VS_MARKET}%)`);
    }
  }

  const p = chosen.probabilidade / 100;
  const b = chosen.odd - 1;
  const kelly = Math.max(0, (p * b - (1 - p)) / b);
  const stakeFrac = Math.min(kelly * KELLY_FRACTION, MAX_STAKE_PCT);
  const stakeReais = Math.round((bancaTotal * stakeFrac) / 5) * 5;

  const alertas: string[] = [];
  if (match.phase === 'eliminatorias') alertas.push('Eliminatórias: mais variância de resultado');
  if (KNOCKOUT_PHASES.has(match.phase ?? '')) alertas.push('Fase knockout: EV mínimo elevado para 6% — só apostas com edge claro');
  if (Math.abs(elo.delta) < 80) alertas.push('ELO delta < 80 — draw estratégico provável em fase de grupos');
  if (Math.abs(elo.delta) < 50) alertas.push('Times muito próximos no ELO — considere mercado de empate');
  if (poisson.over35.probabilidade > 50) alertas.push('Alta expectativa de gols — mercado de over pode ter valor');
  if (edgeVsMercado !== null && edgeVsMercado < 6) {
    alertas.push(`Edge vs Pinnacle: ${edgeVsMercado.toFixed(1)}% — mercado eficiente, apostar com cautela`);
  }
  // BLD-01: Informa quando blend reduziu o peso do ELO significativamente
  if (wElo < 0.60) {
    const reason = staleness.anyStale
      ? 'ELO desatualizado (>120 dias)'
      : staleness.anyWarning
        ? 'ELO desatualizado (>60 dias)'
        : 'divergência alta ELO vs mercado';
    alertas.push(
      `Blend adaptativo ativo: ELO ${(wElo * 100).toFixed(0)}% / Mercado ${((1 - wElo) * 100).toFixed(0)}% — ${reason}`
    );
  }

  return {
    matchId: match.id,
    homeTeam: ptBR(match.home_team),
    awayTeam: ptBR(match.away_team),
    phase: match.phase,
    elo,
    poisson,
    gate: {
      status: 'APROVADO',
      score,
      mercado: {
        nome: chosen.nome,
        ev: parseFloat(chosen.ev.toFixed(2)),
        odd: chosen.odd,
        probabilidade_ia: chosen.probabilidade,
      },
      stake: {
        kelly_base: parseFloat((kelly * 100).toFixed(2)),
        stake_final: parseFloat((stakeFrac * 100).toFixed(2)),
        valor_reais: stakeReais,
      },
      alertas,
    },
    timestamp: Date.now(),
  };
}

function buildBlocked(
  match: WCMatch,
  elo: ReturnType<typeof calculateWCElo>,
  poisson: ReturnType<typeof calculateWCPoisson>,
  codigo: string,
  motivo: string
): WCAnalysisResult {
  return {
    matchId: match.id,
    homeTeam: ptBR(match.home_team),
    awayTeam: ptBR(match.away_team),
    phase: match.phase,
    elo,
    poisson,
    gate: {
      status: 'BLOQUEADO',
      score: 0,
      bloqueio: { codigo, motivo },
      mercado: { nome: '—', ev: 0, odd: 0, probabilidade_ia: 0 },
      stake: { kelly_base: 0, stake_final: 0, valor_reais: 0 },
      alertas: [motivo],
    },
    timestamp: Date.now(),
  };
}
