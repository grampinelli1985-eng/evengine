/**
 * wcTipsterEngine.ts — Motor de análise para torneios internacionais
 *
 * Gate v2.1 — 5 camadas de proteção contra RED:
 *  1. B-EV:   EV mínimo dinâmico por fase (grupos 4%, knockout 6%)
 *  2. B-CONF: Confiança mínima 62%
 *  3. B-SCORE: Score composto mínimo 45
 *  4. B-MEFF: Market Efficiency — edge vs Pinnacle implied < 3% → sem vantagem real
 *  5. B-ODD:  Odd mínima 1.50 (favoritos pesados = alta variância no futebol internacional)
 *  Stake máximo reduzido para 2% (WC: dados limitados, variância alta)
 */

import { WCMatch, WCAnalysisResult } from './wcTypes';
import { calculateWCElo, seedWCEloFromOdds } from './wcEloService';
import { calculateWCPoisson, calcularEVMercadoWC } from './wcPoissonService';

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
};
function ptBR(name: string): string { return TEAM_PT[name] ?? name; }

// Thresholds do Gate WC v2.1
const GATE_MIN_EV_GRUPOS = 4.0;      // % — fase de grupos
const GATE_MIN_EV_KNOCKOUT = 6.0;    // % — oitavas em diante (maior variância)
const GATE_MIN_CONF = 62;            // % (era 60)
const GATE_MIN_SCORE = 45;
const GATE_MIN_ODD = 1.50;           // era 1.40 — favoritos pesados = armadilha WC
const GATE_MAX_ODD = 4.50;
const GATE_MIN_EDGE_VS_MARKET = 3.0; // % — vantagem mínima vs Pinnacle implied (B-MEFF)
const KELLY_FRACTION = 0.25;
const MAX_STAKE_PCT = 0.02;          // 2% (era 3%) — WC tem menos dados históricos

const KNOCKOUT_PHASES = new Set(['oitavas', 'quartas', 'semi', 'final']);

function getMinEV(phase?: WCMatch['phase']): number {
  return phase && KNOCKOUT_PHASES.has(phase) ? GATE_MIN_EV_KNOCKOUT : GATE_MIN_EV_GRUPOS;
}

// Probabilidade implícita do Pinnacle (sem overround) para um outcome
function pinnacleImplied(match: WCMatch, outcomeName: string): number | null {
  const pinnacle = match.bookmakers.find(b => b.key === 'pinnacle') ?? match.bookmakers[0];
  if (!pinnacle) return null;
  const h2h = pinnacle.markets.find(m => m.key === 'h2h');
  if (!h2h || h2h.outcomes.length < 2) return null;

  // Remover overround: soma das probabilidades brutas
  const total = h2h.outcomes.reduce((s, o) => s + (o.price > 1 ? 1 / o.price : 0), 0);
  if (total <= 0) return null;

  const outcome = h2h.outcomes.find(o => o.name === outcomeName || ptBR(o.name) === outcomeName);
  if (!outcome || outcome.price <= 1) return null;

  return (1 / outcome.price / total) * 100; // % sem overround
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

    if (homeOut) candidates.push({
      nome: `Vitória ${ptBR(match.home_team)}`,
      probabilidade: 0, // será preenchido via ELO
      odd: homeOut.price,
      ev: 0,
    });
    if (drawOut) candidates.push({
      nome: 'Empate',
      probabilidade: 0,
      odd: drawOut.price,
      ev: 0,
    });
    if (awayOut) candidates.push({
      nome: `Vitória ${ptBR(match.away_team)}`,
      probabilidade: 0,
      odd: awayOut.price,
      ev: 0,
    });
  }

  // Over/Under de Poisson
  candidates.push({ nome: 'Over 1.5 Gols', probabilidade: poisson.over15.probabilidade, odd: 1.30, ev: 0 });
  candidates.push({ nome: 'Over 2.5 Gols', probabilidade: poisson.over25.probabilidade, odd: 1.85, ev: 0 });
  candidates.push({ nome: 'Ambos Marcam', probabilidade: poisson.btts.probabilidade, odd: 1.75, ev: 0 });

  // Tentar pegar odd real de totals se disponível
  if (totals) {
    const over25Out = totals.outcomes.find(o => o.name === 'Over' && o.price);
    if (over25Out) {
      const idx = candidates.findIndex(c => c.nome === 'Over 2.5 Gols');
      if (idx >= 0) candidates[idx].odd = over25Out.price;
    }
  }

  return candidates;
}

function scoreComposto(
  ev: number,
  confianca: number,
  eloConfianca: number,
): number {
  // Pesos adaptados para dados limitados de seleções:
  // EV 35%, Confiança 25%, ELO 20%, Odd valor 20%
  const scoreEV = Math.min(100, Math.max(0, ev * 4));
  const scoreConf = confianca;
  const scoreElo = eloConfianca;
  const scoreOdd = Math.min(100, eloConfianca * 0.8);

  return Math.round(scoreEV * 0.35 + scoreConf * 0.25 + scoreElo * 0.20 + scoreOdd * 0.20);
}

export function runWCTipsterEngine(
  match: WCMatch,
  bancaTotal: number = 1000
): WCAnalysisResult {
  // 1. Seed ELO se necessário
  seedWCEloFromOdds(match);

  // 2. Calcular ELO e Poisson
  const elo = calculateWCElo(match, match.phase);
  const poisson = calculateWCPoisson(match, match.phase);

  // 3. Montar candidatos e calcular EV para mercados H2H
  const candidates = extractCandidates(match, poisson);

  // Preencher probabilidades ELO nos mercados H2H
  // Comparar com nome pt-BR pois os candidatos já foram traduzidos
  const homeNamePt = ptBR(match.home_team);
  const awayNamePt = ptBR(match.away_team);
  candidates.forEach(c => {
    if (c.nome.includes(homeNamePt)) {
      c.probabilidade = elo.probabilidades.casa;
    } else if (c.nome === 'Empate') {
      c.probabilidade = elo.probabilidades.empate;
    } else if (c.nome.includes(awayNamePt)) {
      c.probabilidade = elo.probabilidades.fora;
    }
    c.ev = calcularEVMercadoWC(c.probabilidade, c.odd);
  });

  // 4. Selecionar melhor candidato por EV positivo
  const viables = candidates
    .filter(c => c.ev > 0 && c.odd >= GATE_MIN_ODD && c.odd <= GATE_MAX_ODD)
    .sort((a, b) => b.ev - a.ev);

  const chosen = viables[0] ?? candidates.sort((a, b) => b.probabilidade - a.probabilidade)[0];

  if (!chosen) {
    return buildBlocked(match, elo, poisson, 'B-DADOS', 'Sem candidatos válidos com odds disponíveis');
  }

  // 5. Score composto
  const eloConfianca = 100 - Math.abs(elo.delta) / 20;
  const score = scoreComposto(chosen.ev, chosen.probabilidade, Math.max(0, eloConfianca));

  // 6. Gate v2.1 — 5 camadas de proteção
  const minEV = getMinEV(match.phase);

  if (chosen.ev < minEV) {
    return buildBlocked(match, elo, poisson, 'B-EV',
      `EV ${chosen.ev.toFixed(1)}% abaixo do mínimo ${KNOCKOUT_PHASES.has(match.phase ?? '') ? 'knockout' : 'WC'} (${minEV}%)`);
  }
  if (chosen.probabilidade < GATE_MIN_CONF) {
    return buildBlocked(match, elo, poisson, 'B-CONF',
      `Confiança ${chosen.probabilidade.toFixed(0)}% abaixo do mínimo (${GATE_MIN_CONF}%)`);
  }
  if (score < GATE_MIN_SCORE) {
    return buildBlocked(match, elo, poisson, 'B-SCORE',
      `Score composto ${score} abaixo do mínimo (${GATE_MIN_SCORE})`);
  }

  // B-MEFF: verificar edge real vs Pinnacle implied
  const marketImplied = pinnacleImplied(match,
    chosen.nome.includes(homeNamePt) ? match.home_team :
    chosen.nome.includes(awayNamePt) ? match.away_team : 'Draw'
  );
  if (marketImplied !== null) {
    const edge = chosen.probabilidade - marketImplied;
    if (edge < GATE_MIN_EDGE_VS_MARKET) {
      return buildBlocked(match, elo, poisson, 'B-MEFF',
        `Edge vs mercado ${edge.toFixed(1)}% — Pinnacle já precificou (mín. ${GATE_MIN_EDGE_VS_MARKET}%)`);
    }
  }

  // 7. Kelly quarter-fraction com cap de 2%
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
  if (marketImplied !== null) {
    const edge = chosen.probabilidade - marketImplied;
    if (edge < 6) alertas.push(`Edge vs Pinnacle: ${edge.toFixed(1)}% — mercado eficiente, apostar com cautela`);
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
