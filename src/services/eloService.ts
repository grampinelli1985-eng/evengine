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
  };
}

const STORAGE_KEY = 'evengine_elo_ratings';
const BASE_RATING = 1500;
function kFactor(matches: number): number {
  if (matches < 30) return 32;
  if (matches < 60) return 24;
  return 16;
}
const HOME_ADVANTAGE = 65;

const PRESET_RATINGS: Record<string, number> = {
  // Global Elites
  'Manchester City': 1950, 'Real Madrid': 1930, 'Liverpool': 1880, 'Bayern Munich': 1850,
  'Arsenal': 1870, 'Barcelona': 1820, 'Inter': 1840, 'PSG': 1810, 'Bayer Leverkusen': 1830,
  
  // Brasileirão Top
  'Flamengo': 1780, 'Palmeiras': 1770, 'Botafogo': 1720, 'São Paulo': 1680, 
  'Atlético Mineiro': 1690, 'Internacional': 1650, 'Fluminense': 1640,
};

function getStoredRatings(): EloRatings {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const initial: EloRatings = {};
    Object.entries(PRESET_RATINGS).forEach(([team, rating]) => {
      initial[team] = { rating, matches: 30 };
    });
    return initial;
  }
  return JSON.parse(stored);
}

export function calculateElo(match: Match): EloData {
  const ratings = getStoredRatings();
  
  const home = ratings[match.home_team] || { rating: BASE_RATING, matches: 0 };
  const away = ratings[match.away_team] || { rating: BASE_RATING, matches: 0 };

  const dr = (home.rating + HOME_ADVANTAGE) - away.rating;
  const winProb = 1 / (1 + Math.pow(10, -dr / 400));

  // Modelo Davidson para empate (estimado)
  const drawProb = 0.25 + (Math.abs(dr) < 100 ? (100 - Math.abs(dr)) / 1000 : 0);

  const casaProb = winProb * (1 - drawProb);
  const foraProb = (1 - winProb) * (1 - drawProb);

  // Cálculo de confiança
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
    
    // Remover o overround para obter a probabilidade justa
    // O mercado 1x2 normalizado deve incluir a drawOdd para remover corretamente a margem da casa.
    const drawOdd = outcomes.find(o => o.name === 'Draw')?.price;
    let probHome = 1 / homeOdd;
    
    if (drawOdd) {
      try {
        const fairProbs = removeOverround([homeOdd, drawOdd, awayOdd]);
        probHome = fairProbs[0];
      } catch (e) {
        console.warn('Erro ao remover overround no eloService, usando prob bruta', e);
      }
    }
    
    // Calcular rating implícito: prob = 1 / (1 + 10^((Ra-Rb)/400))
    // Se o time não tem histórico, injetamos um rating inicial coerente com a odd
    let changed = false;
    if (!ratings[match.home_team]) {
      // Deduzir HOME_ADVANTAGE para evitar dupla contagem ao calcular ELO em calculateElo
      const impliedRating = 1500 + 400 * Math.log10(probHome / (1 - probHome)) - HOME_ADVANTAGE;
      ratings[match.home_team] = { rating: Math.min(Math.max(impliedRating, 1200), 1900), matches: 5 };
      changed = true;
    }
    if (!ratings[match.away_team]) {
      const probAway = drawOdd ? (1 - probHome - (1 / drawOdd)) : (1 - probHome);
      const clampedAway = Math.max(0.05, Math.min(0.95, probAway));
      const impliedRatingAway = 1500 + 400 * Math.log10(clampedAway / (1 - clampedAway));
      ratings[match.away_team] = { rating: Math.min(Math.max(impliedRatingAway, 1200), 1900), matches: 5 };
      changed = true;
    }
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  }
}

export function sanitizeEloRatings() {
  const ratings = getStoredRatings();
  let changed = false;
  
  // Detectar corrupção: muitos times com o mesmo rating exato (além do base)
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
  | 'pre_jogo'       // Antes do kickoff
  | 'ao_vivo'        // Entre kickoff e kickoff+120min
  | 'aguardando_resultado'  // Entre kickoff+120min e kickoff+6h, sem resultado registrado
  | 'pendencia'      // Após kickoff+6h, sem resultado registrado (move pra aba)
  | 'registrado'     // Resultado já registrado pelo usuário
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
  if (minutosDecorridos < 360) return 'aguardando_resultado'; // até 6h depois
  return 'pendencia';
}

export function atualizarEloPartida(
  homeTeam: string,
  awayTeam: string,
  resultado: 'WIN' | 'RED' | 'VOID' | '1' | 'X' | '2' | 'Draw'
): void {
  if (resultado === 'VOID') return; // Sem alteração de ELO
  
  const ratings = getStoredRatings();
  const home = ratings[homeTeam] || { rating: BASE_RATING, matches: 0 };
  const away = ratings[awayTeam] || { rating: BASE_RATING, matches: 0 };
  
  const dr = (home.rating + HOME_ADVANTAGE) - away.rating;
  const winProb = 1 / (1 + Math.pow(10, -dr / 400));
  const drawProb = 0.25 + (Math.abs(dr) < 100 ? (100 - Math.abs(dr)) / 1000 : 0);
  
  const pHome = winProb * (1 - drawProb);
  const pAway = (1 - winProb) * (1 - drawProb);
  const pDraw = drawProb;

  const eh = pHome + 0.5 * pDraw;
  const ea = pAway + 0.5 * pDraw;

  let sh = 0.5;
  let sa = 0.5;
  
  if (resultado === 'WIN' || resultado === '1') {
    sh = 1;
    sa = 0;
  } else if (resultado === 'RED' || resultado === '2') {
    sh = 0;
    sa = 1;
  } else {
    sh = 0.5;
    sa = 0.5;
  }
  
  home.rating = home.rating + kFactor(home.matches) * (sh - eh);
  home.matches = home.matches + 1;

  away.rating = away.rating + kFactor(away.matches) * (sa - ea);
  away.matches = away.matches + 1;
  
  ratings[homeTeam] = home;
  ratings[awayTeam] = away;
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
}


