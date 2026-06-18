/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match } from '../types';

export interface LineMovement {
  id: string;
  opening_odds: { home: number; draw: number; away: number };
  current_odds: { home: number; draw: number; away: number };
  variation: { home: number; draw: number; away: number };
  tem_steam: boolean;
  opened_at: number;
}

const STORAGE_KEY = 'evengine_line_movement';

function getStoredMovements(): Record<string, LineMovement> {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : {};
}

export function registerOpeningOdds(matches: Match[]) {
  const movements = getStoredMovements();
  let changed = false;

  matches.forEach(match => {
    if (movements[match.id]) return;

    const bookmaker = match.bookmakers?.[0];
    const h2h = bookmaker?.markets?.find(m => m.key === 'h2h');
    const outcomes = h2h?.outcomes || [];
    
    const home = outcomes.find(o => o.name === match.home_team)?.price;
    const draw = outcomes.find(o => o.name === 'Draw')?.price;
    const away = outcomes.find(o => o.name === match.away_team)?.price;

    if (home && draw && away) {
      movements[match.id] = {
        id: match.id,
        opening_odds: { home, draw, away },
        current_odds: { home, draw, away },
        variation: { home: 0, draw: 0, away: 0 },
        tem_steam: false,
        opened_at: Date.now(),
      };
      changed = true;
    }
  });

  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(movements));
  }
}

export function detectLineMovement(match: Match): LineMovement | null {
  const movements = getStoredMovements();
  const move = movements[match.id];
  if (!move) return null;

  const bookmaker = match.bookmakers?.[0];
  const h2h = bookmaker?.markets?.find(m => m.key === 'h2h');
  const outcomes = h2h?.outcomes || [];
  
  const currentHome = outcomes.find(o => o.name === match.home_team)?.price;
  const currentDraw = outcomes.find(o => o.name === 'Draw')?.price;
  const currentAway = outcomes.find(o => o.name === match.away_team)?.price;

  if (currentHome && currentDraw && currentAway) {
    const varHome = ((currentHome - move.opening_odds.home) / move.opening_odds.home) * 100;
    const varDraw = ((currentDraw - move.opening_odds.draw) / move.opening_odds.draw) * 100;
    const varAway = ((currentAway - move.opening_odds.away) / move.opening_odds.away) * 100;

    move.current_odds = { home: currentHome, draw: currentDraw, away: currentAway };
    move.variation = { 
      home: Math.abs(varHome) < 1 ? 0 : varHome, 
      draw: Math.abs(varDraw) < 1 ? 0 : varDraw, 
      away: Math.abs(varAway) < 1 ? 0 : varAway 
    };

    // Steam: queda >= 8% na odd (= aumento de confiança/volume no mercado) em até 2h da abertura
    const hoursOpen = (Date.now() - (move.opened_at || 0)) / (60 * 60 * 1000);
    const steamWindow = hoursOpen <= 2;
    move.tem_steam = steamWindow && (varHome <= -8 || varDraw <= -8 || varAway <= -8);

    movements[match.id] = move;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(movements));
    return move;
  }

  return move;
}
