/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { registrarResultadoDiario, registrarResultado } from './bancaService';

interface BetResult {
  id: string;
  matchId: string;
  market: string;
  odd_bet: number;
  odd_closing: number;
  result: 'win' | 'loss' | 'void';
  amount: number;
  timestamp: string;
}

const STORAGE_KEY = 'evengine_clv_results';

export function registerResult(result: Omit<BetResult, 'id' | 'timestamp'>) {
  const stored = localStorage.getItem(STORAGE_KEY);
  const history: BetResult[] = stored ? JSON.parse(stored) : [];
  
  const newResult: BetResult = {
    ...result,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
    timestamp: new Date().toISOString()
  };
  
  history.push(newResult);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  
  if (result.result === 'win') {
    registrarResultadoDiario(result.amount * (result.odd_bet - 1));
    registrarResultado({ resultado: 'green' });
  } else if (result.result === 'loss') {
    registrarResultadoDiario(-result.amount);
    registrarResultado({ resultado: 'red' });
  }
}

export function getCLVSummary() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const history: BetResult[] = stored ? JSON.parse(stored) : [];
  
  if (history.length === 0) return null;
  
  const wins = history.filter(r => r.result === 'win').length;
  const hit_rate = (wins / history.length) * 100;
  
  const totalBet = history.reduce((acc, r) => acc + r.amount, 0);
  const totalReturn = history.reduce((acc, r) => {
    if (r.result === 'win') return acc + r.amount * r.odd_bet;
    if (r.result === 'void') return acc + r.amount;
    return acc;
  }, 0);
  
  const roi = ((totalReturn - totalBet) / totalBet) * 100;
  
  // CLV = (odd_bet / closing_no_vig) - 1
  // Aproximação: closing * 1.03 estima o preço vig-free assumindo ~3% overround
  // na Pinnacle (modelo Shin). Adequado para mercados binários; para mercados
  // 3-way usar removeOverround com os dois lados do mercado.
  const avgEV = history.reduce((acc, r) => {
    const noVigClosing = r.odd_closing * 1.03;
    return acc + (r.odd_bet / noVigClosing - 1);
  }, 0) / history.length;

  return {
    hit_rate,
    roi,
    ev: avgEV * 100,
    total_bets: history.length
  };
}
