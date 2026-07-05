/**
 * wcEloService.ts — Sistema ELO isolado para seleções nacionais
 *
 * Diferenças vs eloService.ts de clubes:
 *  - Sem vantagem de mando (jogos em campo neutro na Copa)
 *  - K-factor 40 para WC, 30 para eliminatórias (menos dados, maior peso)
 *  - Base de ratings separada no localStorage: evengine_wc_elo_v1
 *  - Seeding inicial baseado em rankings FIFA 2026
 *  - Modelo de empate Davidson (θ=0.18) — mesmo framework do eloService de clubes
 */

import { WCMatch, WCEloData, WCNationalTeam } from './wcTypes';
import { removeOverround } from '../valueBetService';

const WC_ELO_KEY = 'evengine_wc_elo_v1';
const BASE_RATING = 1500;
const K_FACTOR_WC = 40;
const K_FACTOR_QUALIFIER = 30;
const K_FACTOR_FRIENDLY = 15;
// XMD-03: Davidson theta calibrated for international tournaments (more draws than club football)
const DAVIDSON_THETA = 0.18;

// Ratings base derivados de FIFA Ranking jun/2026 + histórico ELO WC
// Nomes em inglês E português para cobrir qualquer variante retornada pela API
const WC_SEED_RATINGS: Record<string, number> = {
  // Top tier — S (1750+)
  'Argentina': 1850,
  'France': 1820,    'França': 1820,
  'England': 1790,   'Inglaterra': 1790,
  'Brazil': 1780,    'Brasil': 1780,
  'Spain': 1770,     'Espanha': 1770,
  'Portugal': 1760,
  'Germany': 1745,   'Alemanha': 1745,
  'Netherlands': 1740, 'Holanda': 1740, 'Países Baixos': 1740,
  'Belgium': 1720,   'Bélgica': 1720,
  'Italy': 1710,     'Itália': 1710,
  // A tier (1650-1720)
  'Uruguay': 1700,   'Uruguai': 1700,
  'Colombia': 1690,  'Colômbia': 1690,
  'Croatia': 1685,   'Croácia': 1685,
  'Denmark': 1680,   'Dinamarca': 1680,
  'Switzerland': 1670, 'Suíça': 1670,
  'United States': 1660, 'Estados Unidos': 1660, 'USA': 1660,
  'Mexico': 1655,    'México': 1655,
  'Senegal': 1650,
  'Morocco': 1648,   'Marrocos': 1648,
  'Japan': 1645,     'Japão': 1645,
  // B tier (1580-1650)
  'Norway': 1650,    'Noruega': 1650,
  'Poland': 1635,    'Polônia': 1635,
  'Wales': 1615,     'País de Gales': 1615,
  'Sweden': 1625,    'Suécia': 1625,
  'Austria': 1620,   'Áustria': 1620,
  'Australia': 1615, 'Austrália': 1615,
  'South Korea': 1610, 'Coreia do Sul': 1610,
  'Ecuador': 1605,   'Equador': 1605,
  'Canada': 1600,    'Canadá': 1600,
  'Cameroon': 1595,  'Camarões': 1595,
  'Scotland': 1590,  'Escócia': 1590,
  'Serbia': 1590,    'Sérvia': 1590,
  'Venezuela': 1590,
  'Chile': 1585,
  'Nigeria': 1580,   'Nigéria': 1580,
  // C tier (1500-1580)
  'Bosnia & Herzegovina': 1570, 'Bósnia e Herzegovina': 1570,
  'Ghana': 1570,
  'Costa Rica': 1570,
  'Ivory Coast': 1560, 'Costa do Marfim': 1560,
  'Greece': 1555,    'Grécia': 1555,
  'Turkey': 1555,    'Turquia': 1555,
  'Ukraine': 1545,   'Ucrânia': 1545,
  'Saudi Arabia': 1540, 'Arábia Saudita': 1540,
  'Czech Republic': 1540, 'República Tcheca': 1540,
  'Iraq': 1530,      'Iraque': 1530,
  'Panama': 1530,    'Panamá': 1530,
  'Hungary': 1530,   'Hungria': 1530,
  'Slovakia': 1535,  'Eslováquia': 1535,
  'Uzbekistan': 1520, 'Uzbequistão': 1520,
  'Peru': 1525,
  'Paraguay': 1520,  'Paraguai': 1520,
  'Honduras': 1520,
  'Slovenia': 1520,  'Eslovênia': 1520,
  'Iran': 1515,      'Irã': 1515,
  'Jordan': 1510,    'Jordânia': 1510,
  'Algeria': 1510,   'Argélia': 1510,
  'El Salvador': 1510,
  'Egypt': 1505,     'Egito': 1505,
  'Romania': 1530,   'Romênia': 1530,
  'Tunisia': 1500,   'Tunísia': 1500,
  'DR Congo': 1480,  'República Democrática do Congo': 1480,
  'South Africa': 1475, 'África do Sul': 1475,
  'Oman': 1480,      'Omã': 1480,
  'New Zealand': 1490, 'Nova Zelândia': 1490,
  'Qatar': 1480,
  'Jamaica': 1490,
  'Cabo Verde': 1465,
  'Albania': 1480,   'Albânia': 1480,
  'Angola': 1455,
  'Mali': 1470,
  'Haiti': 1460,
  'Bolivia': 1440,   'Bolívia': 1440,
  'Mozambique': 1445, 'Moçambique': 1445,
  'Trinidad and Tobago': 1450, 'Trinidad e Tobago': 1450,
  'Guatemala': 1480,
  'Suriname': 1440,
  'Tanzania': 1440,  'Tanzânia': 1440,
  'Zimbabwe': 1435,  'Zimbábue': 1435,
  'Sudan': 1430,     'Sudão': 1430,
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

// XMD-03: Davidson draw model — consistent with eloService.ts
// θ=0.18 calibrated for international tournaments (more draws than club football)
function calcDavidsonProbs(delta: number): { probCasa: number; probEmpate: number; probFora: number } {
  const expDelta = Math.pow(10, delta / 400);
  const denominator = expDelta + DAVIDSON_THETA + 1;
  return {
    probCasa: expDelta / denominator,
    probEmpate: DAVIDSON_THETA / denominator,
    probFora: 1 / denominator,
  };
}

export function getWCTeamRating(team: string): number {
  const ratings = getStoredRatings();
  if (ratings[team]) return Math.round(ratings[team].rating);
  // Seeding: se não houver histórico, usar seed FIFA ou base
  return Math.round(WC_SEED_RATINGS[team] ?? BASE_RATING);
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
  const drawOut = h2h.outcomes.find(o => o.name === 'Draw');
  if (!homeOut || !awayOut) return;

  // XMD-03: Use removeOverround for consistent normalization (same as eloService and valueBetService)
  let probHome: number;
  let probAway: number;
  try {
    const odds = drawOut
      ? [homeOut.price, drawOut.price, awayOut.price]
      : [homeOut.price, awayOut.price];
    const fairProbs = removeOverround(odds);
    probHome = fairProbs[0];
    probAway = drawOut ? fairProbs[2] : fairProbs[1];
  } catch {
    // Fallback to simple proportional normalization
    const rawHome = 1 / homeOut.price;
    const rawAway = 1 / awayOut.price;
    const rawDraw = drawOut ? 1 / drawOut.price : 0;
    const total = rawHome + rawAway + rawDraw;
    probHome = rawHome / total;
    probAway = rawAway / total;
  }

  if (!ratings[match.home_team]) {
    // Sem home advantage em campo neutro
    const impliedRating = 1500 + 400 * Math.log10(Math.max(0.01, probHome / Math.max(0.01, 1 - probHome)));
    ratings[match.home_team] = {
      rating: Math.round(Math.min(Math.max(WC_SEED_RATINGS[match.home_team] ?? impliedRating, 1200), 2000)),
      matches: 5,
      lastUpdated: Date.now()
    };
    changed = true;
  }
  if (!ratings[match.away_team]) {
    const impliedRatingAway = 1500 + 400 * Math.log10(Math.max(0.01, probAway / Math.max(0.01, 1 - probAway)));
    ratings[match.away_team] = {
      rating: Math.round(Math.min(Math.max(WC_SEED_RATINGS[match.away_team] ?? impliedRatingAway, 1200), 2000)),
      matches: 5,
      lastUpdated: Date.now()
    };
    changed = true;
  }
  if (changed) saveRatings(ratings);
}

export function calculateWCElo(match: WCMatch, phase?: WCMatch['phase']): WCEloData {
  const ratings = getStoredRatings();

  const homeRating = Math.round(ratings[match.home_team]?.rating ?? WC_SEED_RATINGS[match.home_team] ?? BASE_RATING);
  const awayRating = Math.round(ratings[match.away_team]?.rating ?? WC_SEED_RATINGS[match.away_team] ?? BASE_RATING);

  // Sem home advantage em campo neutro (Copa do Mundo)
  const delta = homeRating - awayRating;

  // XMD-03: Real Davidson draw model — replaces ad-hoc draw probability formula
  const { probCasa, probEmpate, probFora } = calcDavidsonProbs(delta);

  const favorito = probCasa > probFora ? match.home_team : match.away_team;

  const kFactor = phase === 'grupos' || phase === 'eliminatorias' ? K_FACTOR_QUALIFIER :
                  phase ? K_FACTOR_WC : K_FACTOR_FRIENDLY;

  return {
    home_rating: Math.round(homeRating),
    away_rating: Math.round(awayRating),
    delta: Math.round(delta),
    probabilidades: {
      casa: Math.round(probCasa * 100),
      empate: Math.round(probEmpate * 100),
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

  const homeRating = Math.round(ratings[homeTeam]?.rating ?? WC_SEED_RATINGS[homeTeam] ?? BASE_RATING);
  const awayRating = Math.round(ratings[awayTeam]?.rating ?? WC_SEED_RATINGS[awayTeam] ?? BASE_RATING);

  const delta = homeRating - awayRating;

  // XMD-03: Use Davidson expected scores (consistent with calculateWCElo)
  const { probCasa: expectedHome, probFora: expectedAway } = calcDavidsonProbs(delta);

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
    eloRating: Math.round(stored[team]?.rating ?? WC_SEED_RATINGS[team] ?? BASE_RATING),
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
