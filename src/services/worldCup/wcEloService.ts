/**
 * wcEloService.ts — Sistema ELO isolado para seleções nacionais
 *
 * Diferenças vs eloService.ts de clubes:
 *  - Sem vantagem de mando (jogos em campo neutro na Copa)
 *  - K-factor 40 para WC, 30 para eliminatórias (menos dados, maior peso)
 *  - Base de ratings separada no localStorage: evengine_wc_elo_v1
 *  - Seeding inicial baseado em rankings FIFA 2026
 *  - Modelo de empate Davidson adaptado para torneios
 */

import { WCMatch, WCEloData, WCNationalTeam } from './wcTypes';

const WC_ELO_KEY = 'evengine_wc_elo_v1';
const BASE_RATING = 1500;
const K_FACTOR_WC = 40;
const K_FACTOR_QUALIFIER = 30;
const K_FACTOR_FRIENDLY = 15;
const DRAW_TENDENCY = 0.18; // torneios internacionais têm mais empates que ligas

// Ratings base derivados de FIFA Ranking jun/2026 + histórico ELO WC
const WC_SEED_RATINGS: Record<string, number> = {
  // Top tier — S (1750+)
  'Argentina': 1850,
  'France': 1820,
  'England': 1790,
  'Brazil': 1780,
  'Spain': 1770,
  'Portugal': 1760,
  'Germany': 1745,
  'Netherlands': 1740,
  'Belgium': 1720,
  'Italy': 1710,
  // A tier (1650-1720)
  'Uruguay': 1700,
  'Colombia': 1690,
  'Croatia': 1685,
  'Denmark': 1680,
  'Switzerland': 1670,
  'United States': 1660,
  'Mexico': 1655,
  'Senegal': 1650,
  'Morocco': 1648,
  'Japan': 1645,
  // B tier (1580-1650)
  'Poland': 1635,
  'Sweden': 1625,
  'Austria': 1620,
  'Australia': 1615,
  'South Korea': 1610,
  'Ecuador': 1605,
  'Cameroon': 1595,
  'Serbia': 1590,
  'Chile': 1585,
  'Nigeria': 1580,
  // C tier (1500-1580)
  'Ghana': 1570,
  'Ivory Coast': 1560,
  'Turkey': 1555,
  'Ukraine': 1545,
  'Czech Republic': 1540,
  'Hungary': 1530,
  'Peru': 1525,
  'Paraguay': 1520,
  'Iran': 1515,
  'Algeria': 1510,
  'Egypt': 1505,
  'Tunisia': 1500,
};

interface WCEloRecord {
  rating: number;
  matches: number;
  lastUpdated: number;
}

function getStoredRatings(): Record<string, WCEloRecord> {
  try {
    const raw = localStorage.getItem(WC_ELO_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveRatings(ratings: Record<string, WCEloRecord>): void {
  localStorage.setItem(WC_ELO_KEY, JSON.stringify(ratings));
}

export function getWCTeamRating(team: string): number {
  const ratings = getStoredRatings();
  if (ratings[team]) return ratings[team].rating;
  // Seeding: se não houver histórico, usar seed FIFA ou base
  return WC_SEED_RATINGS[team] ?? BASE_RATING;
}

export function seedWCEloFromOdds(match: WCMatch): void {
  const ratings = getStoredRatings();
  let changed = false;

  if (ratings[match.home_team] && ratings[match.away_team]) return;

  const pinnacle = match.bookmakers.find(b => b.key === 'pinnacle') ?? match.bookmakers[0];
  if (!pinnacle) return;

  const h2h = pinnacle.markets.find(m => m.key === 'h2h');
  if (!h2h || h2h.outcomes.length < 2) return;

  const homeOut = h2h.outcomes.find(o => o.name === match.home_team);
  const awayOut = h2h.outcomes.find(o => o.name === match.away_team);
  if (!homeOut || !awayOut) return;

  const rawHome = 1 / homeOut.price;
  const rawAway = 1 / awayOut.price;
  const total = rawHome + rawAway + (h2h.outcomes.find(o => o.name === 'Draw') ? 1 / (h2h.outcomes.find(o => o.name === 'Draw')!.price) : 0);
  const probHome = rawHome / total;

  if (!ratings[match.home_team]) {
    // Sem home advantage em campo neutro
    const impliedRating = 1500 + 400 * Math.log10(Math.max(0.01, probHome / Math.max(0.01, 1 - probHome)));
    ratings[match.home_team] = {
      rating: Math.min(Math.max(WC_SEED_RATINGS[match.home_team] ?? impliedRating, 1200), 2000),
      matches: 5,
      lastUpdated: Date.now()
    };
    changed = true;
  }
  if (!ratings[match.away_team]) {
    const probAway = rawAway / total;
    const impliedRating = 1500 + 400 * Math.log10(Math.max(0.01, probAway / Math.max(0.01, 1 - probAway)));
    ratings[match.away_team] = {
      rating: Math.min(Math.max(WC_SEED_RATINGS[match.away_team] ?? impliedRating, 1200), 2000),
      matches: 5,
      lastUpdated: Date.now()
    };
    changed = true;
  }
  if (changed) saveRatings(ratings);
}

export function calculateWCElo(match: WCMatch, phase?: WCMatch['phase']): WCEloData {
  const ratings = getStoredRatings();

  const homeRating = ratings[match.home_team]?.rating ?? WC_SEED_RATINGS[match.home_team] ?? BASE_RATING;
  const awayRating = ratings[match.away_team]?.rating ?? WC_SEED_RATINGS[match.away_team] ?? BASE_RATING;

  const delta = homeRating - awayRating;

  // Sem home advantage em campo neutro (Copa do Mundo)
  const probHomeWin = 1 / (1 + Math.pow(10, -delta / 400));
  const probAwayWin = 1 / (1 + Math.pow(10, delta / 400));

  // Modelo de empate: Davidson adaptado
  // P(draw) proporcional à proximidade de ratings e tendência de torneio
  const proximidade = 1 - Math.abs(delta) / 800;
  const probDraw = Math.min(0.35, Math.max(0.10, DRAW_TENDENCY * (1 + proximidade * 0.4)));

  const adjustment = 1 - probDraw;
  const probCasa = probHomeWin * adjustment;
  const probFora = probAwayWin * adjustment;

  const favorito = probCasa > probFora ? match.home_team : match.away_team;

  const kFactor = phase === 'grupos' || phase === 'eliminatorias' ? K_FACTOR_QUALIFIER :
                  phase ? K_FACTOR_WC : K_FACTOR_FRIENDLY;

  return {
    home_rating: Math.round(homeRating),
    away_rating: Math.round(awayRating),
    delta: Math.round(delta),
    probabilidades: {
      casa: Math.round(probCasa * 100),
      empate: Math.round(probDraw * 100),
      fora: Math.round(probFora * 100),
    },
    favorito,
    kFactor,
  } as WCEloData & { kFactor: number };
}

export function updateWCEloAfterResult(
  homeTeam: string,
  awayTeam: string,
  result: 'home' | 'draw' | 'away',
  phase?: WCMatch['phase']
): void {
  const ratings = getStoredRatings();

  const homeRating = ratings[homeTeam]?.rating ?? WC_SEED_RATINGS[homeTeam] ?? BASE_RATING;
  const awayRating = ratings[awayTeam]?.rating ?? WC_SEED_RATINGS[awayTeam] ?? BASE_RATING;

  const delta = homeRating - awayRating;
  const expectedHome = 1 / (1 + Math.pow(10, -delta / 400));
  const expectedAway = 1 - expectedHome;

  const actualHome = result === 'home' ? 1 : result === 'draw' ? 0.5 : 0;
  const actualAway = 1 - actualHome;

  const k = phase === 'final' || phase === 'semi' ? K_FACTOR_WC * 1.5 :
            phase === 'grupos' ? K_FACTOR_WC : K_FACTOR_QUALIFIER;

  const newHomeRating = Math.round(homeRating + k * (actualHome - expectedHome));
  const newAwayRating = Math.round(awayRating + k * (actualAway - expectedAway));

  ratings[homeTeam] = {
    rating: Math.min(Math.max(newHomeRating, 1200), 2100),
    matches: (ratings[homeTeam]?.matches ?? 0) + 1,
    lastUpdated: Date.now()
  };
  ratings[awayTeam] = {
    rating: Math.min(Math.max(newAwayRating, 1200), 2100),
    matches: (ratings[awayTeam]?.matches ?? 0) + 1,
    lastUpdated: Date.now()
  };

  saveRatings(ratings);
}

export function getAllWCRatings(): WCNationalTeam[] {
  const stored = getStoredRatings();

  const all = new Set([...Object.keys(stored), ...Object.keys(WC_SEED_RATINGS)]);
  return Array.from(all).map(team => ({
    name: team,
    fifaRank: 0,
    eloRating: stored[team]?.rating ?? WC_SEED_RATINGS[team] ?? BASE_RATING,
    confederation: getConfederation(team),
    recentForm: [],
    avgGoalsScored: 1.2,
    avgGoalsConceded: 1.0,
  })).sort((a, b) => b.eloRating - a.eloRating);
}

function getConfederation(team: string): WCNationalTeam['confederation'] {
  const UEFA = ['France', 'England', 'Spain', 'Portugal', 'Germany', 'Netherlands', 'Belgium', 'Italy', 'Croatia', 'Denmark', 'Switzerland', 'Poland', 'Sweden', 'Austria', 'Serbia', 'Czech Republic', 'Hungary', 'Turkey', 'Ukraine'];
  const CONMEBOL = ['Brazil', 'Argentina', 'Uruguay', 'Colombia', 'Chile', 'Ecuador', 'Paraguay', 'Peru'];
  const CAF = ['Senegal', 'Morocco', 'Cameroon', 'Nigeria', 'Ghana', 'Ivory Coast', 'Algeria', 'Egypt', 'Tunisia'];
  const AFC = ['Japan', 'South Korea', 'Australia', 'Iran'];
  const CONCACAF = ['United States', 'Mexico'];

  if (UEFA.includes(team)) return 'UEFA';
  if (CONMEBOL.includes(team)) return 'CONMEBOL';
  if (CAF.includes(team)) return 'CAF';
  if (AFC.includes(team)) return 'AFC';
  if (CONCACAF.includes(team)) return 'CONCACAF';
  return 'OFC';
}

export function resetWCElo(): void {
  localStorage.removeItem(WC_ELO_KEY);
}
