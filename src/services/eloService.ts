/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match } from '../types';
import { removeOverround } from './valueBetService';

export interface EloData {
  home_rating: number;
  away_rating: number;
  delta: number;
  raw_delta: number;
  favorito: string;
  calibrando: boolean;
  confianca_home: 'alta' | 'media' | 'baixa';
  confianca_away: 'alta' | 'media' | 'baixa';
  jogos_minimos_atingidos: boolean;
  probabilidades: {
    casa: number;
    empate: number;
    fora: number;
  };
}

interface EloRatings {
  [teamName: string]: {
    rating: number;
    matches: number;
    lastPlayed?: number;
  };
}

const STORAGE_KEY = 'evengine_elo_ratings';
const BASE_RATING = 1500;

/**
 * ELO-01: K-factor varies by match importance.
 */
function kFactor(matches: number, importance: 'copa' | 'liga' | 'amistoso' = 'liga'): number {
  const importanceMultiplier = importance === 'copa' ? 1.5 : importance === 'amistoso' ? 0.5 : 1.0;
  let base: number;
  if (matches < 30) base = 32;
  else if (matches < 60) base = 24;
  else base = 16;
  return base * importanceMultiplier;
}

const HOME_ADVANTAGE = 65;

// XMD-06: Team name aliases for ELO lookup (clubs + seleções)
const TEAM_NAME_ALIASES: Record<string, string> = {
  // Clubes
  'Inter Milan': 'Inter',
  'AC Milan': 'Milan',
  'Atletico Mineiro': 'Atletico MG',
  'RB Leipzig': 'Leipzig',
  'Bayer Leverkusen': 'Leverkusen',
  'Atletico Madrid': 'Atletico Madrid',
  'Borussia Dortmund': 'Dortmund',
  // Seleções — variações PT/ES/API → chave canônica do PRESET_RATINGS
  'Brasil': 'Brazil', 'Alemanha': 'Germany', 'Franca': 'France', 'França': 'France',
  'Espanha': 'Spain', 'Holanda': 'Netherlands', 'Países Baixos': 'Netherlands',
  'Paises Baixos': 'Netherlands', 'Inglaterra': 'England', 'Belgica': 'Belgium',
  'Bélgica': 'Belgium', 'Croacia': 'Croatia', 'Croácia': 'Croatia',
  'Servia': 'Serbia', 'Sérvia': 'Serbia', 'Suica': 'Switzerland', 'Suíça': 'Switzerland',
  'Dinamarca': 'Denmark', 'Suecia': 'Sweden', 'Suécia': 'Sweden',
  'Noruega': 'Norway', 'Turquia': 'Turkey', 'Ucrania': 'Ukraine', 'Ucrânia': 'Ukraine',
  'Polonia': 'Poland', 'Polônia': 'Poland', 'Hungria': 'Hungary',
  'Grecia': 'Greece', 'Grécia': 'Greece', 'Romenia': 'Romania', 'Romênia': 'Romania',
  'Eslovaquia': 'Slovakia', 'Eslováquia': 'Slovakia',
  'Eslovenia': 'Slovenia', 'Eslovênia': 'Slovenia',
  'Austria': 'Austria', 'Áustria': 'Austria',
  'Finlandia': 'Finland', 'Finlândia': 'Finland',
  'Republica Tcheca': 'Czech Republic', 'Czechia': 'Czech Republic',
  'Bosnia e Herzegovina': 'Bosnia Herzegovina', 'Bosnia & Herzegovina': 'Bosnia Herzegovina',
  'Mexico': 'Mexico', 'México': 'Mexico',
  'Equador': 'Ecuador', 'Uruguai': 'Uruguay', 'Paraguai': 'Paraguay',
  'Colombia': 'Colombia', 'Colômbia': 'Colombia',
  'Venezuela': 'Venezuela', 'Bolivia': 'Bolivia', 'Bolívia': 'Bolivia',
  'Chile': 'Chile', 'Peru': 'Peru',
  'Arabia Saudita': 'Saudi Arabia', 'Catar': 'Qatar',
  'Africa do Sul': 'South Africa', 'Nova Zelandia': 'New Zealand',
  'Irlanda': 'Republic of Ireland', 'Irlanda do Norte': 'Northern Ireland',
  "Costa do Marfim": 'Ivory Coast', "Cote d'Ivoire": 'Ivory Coast',
  'Camaroes': 'Cameroon', 'Camaroões': 'Cameroon',
  'Nigeria': 'Nigeria', 'Nigéria': 'Nigeria',
  'Egito': 'Egypt', 'Gana': 'Ghana',
  'Argelia': 'Algeria', 'Argélia': 'Algeria',
  'Tunisia': 'Tunisia', 'Tunísia': 'Tunisia',
  'Japao': 'Japan', 'Japão': 'Japan',
  'Coreia do Sul': 'South Korea', 'Korea Republic': 'South Korea', 'Korea Rep': 'South Korea',
  'Coreia do Norte': 'North Korea',
  'Australia': 'Australia', 'Austrália': 'Australia',
  'India': 'India', 'Índia': 'India', 'Iraque': 'Iraq',
  'Ira': 'Iran', 'Irã': 'Iran', 'IR Iran': 'Iran',
  'Cabo Verde': 'Cape Verde', 'Guine-Bissau': 'Guinea-Bissau',
  'Guine Equatorial': 'Equatorial Guinea',
  'Estados Unidos': 'United States', 'USA': 'United States', 'US': 'United States',
};

export function resolveTeamName(name: string): string {
  return TEAM_NAME_ALIASES[name] ?? name;
}

/**
 * ELO-02 + ELO-05: Davidson draw model — real formula.
 */
function calcDrawModel(dr: number): { probCasa: number; probEmpate: number; probFora: number } {
  const theta = 0.15;
  const expDelta = Math.pow(10, dr / 400);
  const denominator = expDelta + theta + 1;
  const probCasa = expDelta / denominator;
  const probEmpate = theta / denominator;
  const probFora = 1 / denominator;
  return { probCasa, probEmpate, probFora };
}

// ELO-04: Temporal decay
const DECAY_HALF_LIFE_DAYS = 180;
const DECAY_FACTOR = 0.25;
// ELO-06: Minimum days before decay starts (tournament break buffer)
const DECAY_MIN_DAYS = 45;
// Baseline lastPlayed for preset teams that have no live match history yet
const PRESET_CALIBRATION_DATE = new Date('2026-05-01').getTime();

// Staleness thresholds (days since last match)
const ELO_STALENESS_WARNING_DAYS = 60;
const ELO_STALENESS_STALE_DAYS = 120;

// ELO-07: Divergence warning threshold (fraction, e.g. 0.15 = 15%)
export const ELO_DIVERGENCE_WARNING_THRESHOLD = 0.15;

function applyTemporalDecay(entry: { rating: number; matches: number; lastPlayed?: number }): number {
  // ELO-04 fix: use PRESET_CALIBRATION_DATE as fallback so decay fires for preset teams
  const lastPlayedMs = entry.lastPlayed ?? PRESET_CALIBRATION_DATE;
  const daysSinceLastPlayed = (Date.now() - lastPlayedMs) / (1000 * 60 * 60 * 24);
  if (daysSinceLastPlayed < DECAY_MIN_DAYS) return entry.rating;
  const periods = daysSinceLastPlayed / DECAY_HALF_LIFE_DAYS;
  const decayAmount = (entry.rating - BASE_RATING) * (1 - Math.pow(1 - DECAY_FACTOR, periods));
  return entry.rating - decayAmount;
}

const PRESET_RATINGS: Record<string, number> = {
  // ── Clubes ──────────────────────────────────────────────────────────────
  'Manchester City': 1950, 'Real Madrid': 1930, 'Liverpool': 1880, 'Bayern Munich': 1850,
  'Arsenal': 1870, 'Barcelona': 1820, 'Inter': 1840, 'PSG': 1810, 'Bayer Leverkusen': 1830,
  'Flamengo': 1780, 'Palmeiras': 1770, 'Botafogo': 1720, 'São Paulo': 1680,
  'Atlético Mineiro': 1690, 'Internacional': 1650, 'Fluminense': 1640,

  // ── Seleções — calibradas por ELO Mundial + desempenho recente ──────────
  // Tier S: candidatos ao título
  'Argentina': 2080, 'France': 2040, 'England': 2000, 'Spain': 2010,
  'Brazil': 1990, 'Belgium': 1960, 'Portugal': 1970,
  // Tier A: fortes candidatos a semifinal
  'Netherlands': 1940, 'Germany': 1930, 'Italy': 1920, 'Croatia': 1900,
  'Uruguay': 1890, 'Denmark': 1870, 'Switzerland': 1865, 'Colombia': 1855,
  'Mexico': 1840, 'United States': 1830, 'Senegal': 1820, 'Morocco': 1825,
  // Tier B: competitivos mas menos favoritos
  'Japan': 1800, 'South Korea': 1780, 'Australia': 1760, 'Serbia': 1770,
  'Poland': 1755, 'Ukraine': 1750, 'Turkey': 1745, 'Austria': 1730,
  'Ecuador': 1720, 'Chile': 1715, 'Paraguay': 1700, 'Peru': 1695,
  'Venezuela': 1690, 'Bolivia': 1640, 'Nigeria': 1710, 'Ivory Coast': 1700,
  'Ghana': 1680, 'Cameroon': 1670, 'Egypt': 1660, 'Algeria': 1650,
  'Tunisia': 1640, 'South Africa': 1600, 'Saudi Arabia': 1620,
  'Iran': 1615, 'Qatar': 1590, 'Canada': 1680, 'Costa Rica': 1620,
  'Panama': 1590, 'Honduras': 1570, 'Jamaica': 1550,
  // Tier C: demais participantes
  'Sweden': 1740, 'Norway': 1720, 'Finland': 1650, 'Greece': 1640,
  'Czech Republic': 1680, 'Slovakia': 1650, 'Hungary': 1645,
  'Romania': 1640, 'Slovenia': 1620, 'Bosnia Herzegovina': 1610,
  'North Korea': 1520, 'New Zealand': 1540, 'Cape Verde': 1550,
  'Guinea-Bissau': 1490, 'Equatorial Guinea': 1480,
};

function getStoredRatings(): EloRatings {
  const base: EloRatings = {};
  // ELO-04 fix: seed lastPlayed so applyTemporalDecay fires correctly for preset teams
  Object.entries(PRESET_RATINGS).forEach(([team, rating]) => {
    base[team] = { rating, matches: 30, lastPlayed: PRESET_CALIBRATION_DATE };
  });

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return base;

  try {
    const parsed: EloRatings = JSON.parse(stored);
    // Stored values win; preset provides initial values for teams not yet seen live
    return { ...base, ...parsed };
  } catch {
    console.warn('[ELO] Storage corrupted — resetting to presets');
    localStorage.removeItem(STORAGE_KEY);
    return base;
  }
}

function getRatingForTeam(ratings: EloRatings, teamName: string): { rating: number; matches: number; lastPlayed?: number } {
  const resolved = resolveTeamName(teamName);
  return ratings[teamName] || ratings[resolved] || { rating: BASE_RATING, matches: 0 };
}

export function calculateElo(match: Match): EloData {
  const ratings = getStoredRatings();

  const homeRaw = getRatingForTeam(ratings, match.home_team);
  const awayRaw = getRatingForTeam(ratings, match.away_team);

  const home = { ...homeRaw, rating: applyTemporalDecay(homeRaw) };
  const away = { ...awayRaw, rating: applyTemporalDecay(awayRaw) };

  const dr = (home.rating + HOME_ADVANTAGE) - away.rating;

  const { probCasa: casaProb, probEmpate: drawProb, probFora: foraProb } = calcDrawModel(dr);

  const confHome = home.matches >= 30 ? 'alta' : home.matches >= 15 ? 'media' : 'baixa';
  const confAway = away.matches >= 30 ? 'alta' : away.matches >= 15 ? 'media' : 'baixa';
  const jogosMin = home.matches >= 10 && away.matches >= 10;

  return {
    home_rating: Math.round(home.rating),
    away_rating: Math.round(away.rating),
    delta: Math.round(dr),
    raw_delta: Math.abs(Math.round(home.rating) - Math.round(away.rating)),
    favorito: dr > 0 ? match.home_team : match.away_team,
    calibrando: home.matches < 10 || away.matches < 10,
    confianca_home: confHome,
    confianca_away: confAway,
    jogos_minimos_atingidos: jogosMin,
    probabilidades: {
      casa: parseFloat((casaProb * 100).toFixed(1)),
      empate: parseFloat((drawProb * 100).toFixed(1)),
      fora: parseFloat((foraProb * 100).toFixed(1)),
    },
  };
}

export function seedEloFromOdds(match: Match) {
  const bookmaker = match.bookmakers?.[0];
  const h2h = bookmaker?.markets?.find(m => m.key === 'h2h');
  const outcomes = h2h?.outcomes || [];

  const homeOdd = outcomes.find(o => o.name === match.home_team)?.price;
  const awayOdd = outcomes.find(o => o.name === match.away_team)?.price;

  if (homeOdd && awayOdd) {
    const ratings = getStoredRatings();

    const drawOdd = outcomes.find(o => o.name === 'Draw')?.price;
    let probHome = 1 / homeOdd;
    let probAway = 1 / awayOdd;

    if (drawOdd) {
      try {
        const fairProbs = removeOverround([homeOdd, drawOdd, awayOdd]);
        probHome = fairProbs[0];
        probAway = fairProbs[2];
      } catch (e) {
        console.warn('Erro ao remover overround no eloService, usando prob bruta', e);
      }
    } else {
      try {
        const fairProbs2 = removeOverround([homeOdd, awayOdd]);
        probHome = fairProbs2[0];
        probAway = fairProbs2[1];
      } catch {}
    }

    let changed = false;
    if (!ratings[match.home_team]) {
      const impliedRating = 1500 + 400 * Math.log10(probHome / (1 - probHome)) - HOME_ADVANTAGE;
      ratings[match.home_team] = { rating: Math.min(Math.max(impliedRating, 1200), 1900), matches: 5, lastPlayed: Date.now() };
      changed = true;
    }
    if (!ratings[match.away_team]) {
      const clampedAway = Math.max(0.05, Math.min(0.95, probAway));
      const impliedRatingAway = 1500 + 400 * Math.log10(clampedAway / (1 - clampedAway));
      ratings[match.away_team] = { rating: Math.min(Math.max(impliedRatingAway, 1200), 1900), matches: 5, lastPlayed: Date.now() };
      changed = true;
    }
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  }
}

export function sanitizeEloRatings() {
  const ratings = getStoredRatings();
  const values = Object.values(ratings).map(r => r.rating);
  const counts: Record<number, number> = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);

  for (const [val, count] of Object.entries(counts)) {
    if (Number(val) !== BASE_RATING && count > 10) {
      console.warn(`Elo corruption detected for rating ${val}. Resetting...`);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
  }
}

export type EstadoJogo =
  | 'pre_jogo'
  | 'ao_vivo'
  | 'aguardando_resultado'
  | 'pendencia'
  | 'registrado'
  ;

export function calcularEstadoJogo(jogo: {
  resultado_registrado?: boolean;
  resultado_ignorado?: boolean;
  commence_time?: string;
  date?: string;
}): EstadoJogo {
  if (jogo.resultado_registrado || jogo.resultado_ignorado) return 'registrado';

  const agora = new Date();
  const startTime = jogo.commence_time || jogo.date || '';
  if (!startTime) return 'pre_jogo';

  const kickoff = new Date(startTime);
  const minutosDecorridos = (agora.getTime() - kickoff.getTime()) / 60000;

  if (minutosDecorridos < 0) return 'pre_jogo';
  if (minutosDecorridos < 120) return 'ao_vivo';
  if (minutosDecorridos < 360) return 'aguardando_resultado';
  return 'pendencia';
}

export function atualizarEloPartida(
  homeTeam: string,
  awayTeam: string,
  resultado: 'WIN' | 'RED' | 'VOID' | '1' | 'X' | '2' | 'Draw',
  importance: 'copa' | 'liga' | 'amistoso' = 'liga',
  marketType?: '1' | '2' | 'X'
): void {
  if (resultado === 'VOID') return;

  // ELO-08: resolve aliases so API-Football names ("Korea Republic") → ELO keys ("South Korea")
  const homeKey = resolveTeamName(homeTeam);
  const awayKey = resolveTeamName(awayTeam);

  const ratings = getStoredRatings();
  const home = ratings[homeKey] || { rating: BASE_RATING, matches: 0 };
  const away = ratings[awayKey] || { rating: BASE_RATING, matches: 0 };

  home.rating = applyTemporalDecay(home);
  away.rating = applyTemporalDecay(away);

  const dr = (home.rating + HOME_ADVANTAGE) - away.rating;
  const { probCasa: pHome, probEmpate: pDraw, probFora: pAway } = calcDrawModel(dr);

  const eh = pHome + 0.5 * pDraw;
  const ea = pAway + 0.5 * pDraw;

  let sh = 0.5;
  let sa = 0.5;

  // HIS-04: Explicit result translation — marketType is required for WIN/RED to avoid
  // misattributing outcomes. When marketType is absent and result is WIN/RED, log a
  // warning and fall back to neutral (0.5/0.5) instead of wrongly assuming away win.
  if (resultado === '1' || (resultado === 'WIN' && marketType === '1')) {
    sh = 1; sa = 0;
  } else if (resultado === '2' || (resultado === 'WIN' && marketType === '2')) {
    sh = 0; sa = 1;
  } else if (resultado === 'X' || resultado === 'Draw' || (resultado === 'WIN' && marketType === 'X')) {
    sh = 0.5; sa = 0.5;
  } else if (resultado === 'RED' && marketType === '1') {
    sh = 0; sa = 1;
  } else if (resultado === 'RED' && marketType === '2') {
    sh = 0.75; sa = 0.25;
  } else if (resultado === 'RED' && marketType === 'X') {
    sh = 0.5; sa = 0.5;
  } else if (resultado === 'WIN' || resultado === 'RED') {
    console.warn(`[ELO] atualizarEloPartida: resultado '${resultado}' sem marketType — usando score neutro 0.5/0.5`);
    sh = 0.5; sa = 0.5;
  }

  home.rating = home.rating + kFactor(home.matches, importance) * (sh - eh);
  home.matches = home.matches + 1;
  home.lastPlayed = Date.now();

  away.rating = away.rating + kFactor(away.matches, importance) * (sa - ea);
  away.matches = away.matches + 1;
  away.lastPlayed = Date.now();

  // Store under canonical key so future lookups always hit correctly
  ratings[homeKey] = home;
  ratings[awayKey] = away;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
}

// ── ELO-06: Staleness info ────────────────────────────────────────────────

export interface EloStalenessInfo {
  team: string;
  canonicalKey: string;
  daysSinceLastPlayed: number;
  level: 'fresh' | 'warning' | 'stale';
  ratingOriginal: number;
  ratingDecayed: number;
  decayApplied: number;
}

export function getEloStalenessInfo(homeTeam: string, awayTeam: string): {
  home: EloStalenessInfo;
  away: EloStalenessInfo;
  anyStale: boolean;
  anyWarning: boolean;
} {
  const ratings = getStoredRatings();

  function buildInfo(team: string): EloStalenessInfo {
    const key = resolveTeamName(team);
    const entry = ratings[key] || { rating: BASE_RATING, matches: 0 };
    const lastPlayedMs = entry.lastPlayed ?? PRESET_CALIBRATION_DATE;
    const daysSinceLastPlayed = (Date.now() - lastPlayedMs) / (1000 * 60 * 60 * 24);
    const level: EloStalenessInfo['level'] =
      daysSinceLastPlayed >= ELO_STALENESS_STALE_DAYS ? 'stale' :
      daysSinceLastPlayed >= ELO_STALENESS_WARNING_DAYS ? 'warning' : 'fresh';
    const ratingDecayed = applyTemporalDecay(entry);
    return {
      team,
      canonicalKey: key,
      daysSinceLastPlayed: Math.round(daysSinceLastPlayed),
      level,
      ratingOriginal: Math.round(entry.rating),
      ratingDecayed: Math.round(ratingDecayed),
      decayApplied: Math.round(entry.rating - ratingDecayed),
    };
  }

  const home = buildInfo(homeTeam);
  const away = buildInfo(awayTeam);

  return {
    home,
    away,
    anyStale: home.level === 'stale' || away.level === 'stale',
    anyWarning: home.level !== 'fresh' || away.level !== 'fresh',
  };
}

// ── ELO-07: Divergence warning ────────────────────────────────────────────

export interface EloDivergenceCheck {
  status: 'ok' | 'aviso' | 'bloqueado';
  evCalculado: number;
  threshold: number;
  mensagem: string | null;
}

/**
 * Returns a gate status based on EV divergence from the B-EV hard limit.
 * @param evDecimal EV as a decimal fraction (0.15 = 15%)
 * @param bevMaxDecimal Hard block ceiling (default 0.20 for WC)
 */
export function checkEloDivergenceWarning(
  evDecimal: number,
  bevMaxDecimal = 0.20
): EloDivergenceCheck {
  const warnThreshold = bevMaxDecimal - ELO_DIVERGENCE_WARNING_THRESHOLD;

  if (evDecimal >= bevMaxDecimal) {
    return {
      status: 'bloqueado',
      evCalculado: evDecimal,
      threshold: bevMaxDecimal,
      mensagem: `EV de ${(evDecimal * 100).toFixed(1)}% excede o teto B-EV (${(bevMaxDecimal * 100).toFixed(0)}%). Gate bloqueado.`,
    };
  }
  if (evDecimal >= warnThreshold) {
    return {
      status: 'aviso',
      evCalculado: evDecimal,
      threshold: bevMaxDecimal,
      mensagem: `EV de ${(evDecimal * 100).toFixed(1)}% se aproxima do teto realista (${(bevMaxDecimal * 100).toFixed(0)}%). Verifique odds antes de registrar.`,
    };
  }
  return { status: 'ok', evCalculado: evDecimal, threshold: bevMaxDecimal, mensagem: null };
}
