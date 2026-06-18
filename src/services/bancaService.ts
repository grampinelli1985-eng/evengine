/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BancaState } from '../types';

const STORAGE_KEY = 'evengine_banca_state';

const DEFAULT_BANCA: BancaState = {
  total: 1000,
  pnl_diario: 0,
  stake_recomendado: 0,
  kelly: 0,
  stops: { win: false, loss: false }
};

export function getBanca(): BancaState {
  const stored = localStorage.getItem(STORAGE_KEY);
  const state: BancaState = stored ? JSON.parse(stored) : DEFAULT_BANCA;

  // Reset diário à meia-noite
  const lastReset = localStorage.getItem('evengine_banca_last_reset');
  const today = new Date().toISOString().split('T')[0];

  if (lastReset !== today) {
    state.pnl_diario = 0;
    state.stops = { win: false, loss: false };
    state.apostasHoje = 0;
    localStorage.setItem('evengine_banca_last_reset', today);
    saveBanca(state);
  }

  return state;
}

export function saveBanca(state: BancaState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Salvar banca
export function setBancaAtual(valor: number): void {
  const state = getBanca();
  state.bancaAtual = valor;
  state.total = valor;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Ler banca
export function getBancaAtual(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 1000;
    const state = JSON.parse(raw);
    return state.bancaAtual ?? state.total ?? 1000;
  } catch {
    return 1000;
  }
}

// Resetar contadores diários
export function resetarContadores(): void {
  const state = getBanca();
  state.apostasHoje = 0;
  state.stops = { win: false, loss: false };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  salvarStopLossState(STOP_LOSS_INICIAL);
  window.dispatchEvent(new CustomEvent('evengine_stop_loss_changed', { detail: STOP_LOSS_INICIAL }));
}

export function calculateKellyStake(prob: number, odd: number, bancaTotal: number, fraction: number = 0.25): number {
  if (odd <= 1) return 0;

  const p = prob / 100;
  const b = odd - 1;
  const q = 1 - p;

  const kelly = (p * b - q) / b;
  if (kelly <= 0) return 0;

  const stakeValue = bancaTotal * kelly * fraction;

  // Arredondar para múltiplo de R$5
  const roundedStake = Math.round(stakeValue / 5) * 5;

  // Limite máximo de 3% da banca ou R$500
  return Math.min(roundedStake, bancaTotal * 0.03, 500);
}

export function getStopStatus(banca: BancaState) {
  const winLimit = banca.total * 0.15; // 15% win stop
  const lossLimit = -banca.total * 0.05; // 5% loss stop

  return {
    win: banca.pnl_diario >= winLimit,
    loss: banca.pnl_diario <= lossLimit
  };
}

export function registrarResultadoDiario(valor: number) {
  const banca = getBanca();
  banca.pnl_diario += valor;
  banca.total += valor;

  const stops = getStopStatus(banca);
  banca.stops = stops;

  saveBanca(banca);
}

export function getEstadoProtecao() {
  const banca = getBanca();
  const stops = getStopStatus(banca);

  const estado = {
    stop_loss_ativo: stops.loss,
    stop_win_ativo: stops.win,
    pnl_diario: banca.pnl_diario,
    banca_total: banca.total
  };

  return estado;
}

export interface StopLossState {
  redStreakAtual: number;     // contador de reds consecutivos
  suspensaoAtiva: boolean;    // true = novas apostas bloqueadas
  timestampUltimoRed: number; // Unix ms do último red registrado
  historicoStreak: number[];  // array dos últimos streaks (para UI)
}

// Estado inicial:
const STOP_LOSS_INICIAL: StopLossState = {
  redStreakAtual: 0,
  suspensaoAtiva: false,
  timestampUltimoRed: 0,
  historicoStreak: [],
};

const STOP_LOSS_KEY = 'evengine_stop_loss_state';

export function carregarStopLossState(): StopLossState {
  try {
    const raw = localStorage.getItem(STOP_LOSS_KEY);
    if (!raw) return STOP_LOSS_INICIAL;
    const parsed = JSON.parse(raw);
    return {
      redStreakAtual: parsed.redStreakAtual ?? 0,
      suspensaoAtiva: parsed.suspensaoAtiva ?? false,
      timestampUltimoRed: parsed.timestampUltimoRed ?? 0,
      historicoStreak: parsed.historicoStreak ?? [],
    };
  } catch {
    return STOP_LOSS_INICIAL;
  }
}

export function salvarStopLossState(state: StopLossState): void {
  localStorage.setItem(STOP_LOSS_KEY, JSON.stringify(state));
}

export interface Aposta {
  resultado: string;
}

export function registrarResultado(aposta: Aposta): StopLossState {
  const estado = carregarStopLossState();
  const res = aposta.resultado.toLowerCase();

  if (res === 'green' || res === 'win') {
    const novoEstado: StopLossState = {
      ...estado,
      redStreakAtual: 0,
      suspensaoAtiva: false,
    };
    salvarStopLossState(novoEstado);
    window.dispatchEvent(new CustomEvent('evengine_stop_loss_changed', { detail: novoEstado }));
    return novoEstado;
  }

  if (res === 'red' || res === 'loss') {
    const novoStreak = estado.redStreakAtual + 1;
    const suspender = novoStreak >= 3;

    const novoEstado: StopLossState = {
      redStreakAtual: novoStreak,
      suspensaoAtiva: suspender,
      timestampUltimoRed: Date.now(),
      historicoStreak: [...(estado.historicoStreak || []), novoStreak],
    };

    salvarStopLossState(novoEstado);
    window.dispatchEvent(new CustomEvent('evengine_stop_loss_changed', { detail: novoEstado }));

    if (suspender) {
      dispararAlertaStopLoss(novoStreak);
    }

    return novoEstado;
  }

  return estado;
}

export function podeEntrarNovaAposta(): boolean {
  const estado = carregarStopLossState();
  return !estado.suspensaoAtiva;
}

export function dispararAlertaStopLoss(streak: number): void {
  localStorage.setItem('evengine_stop_loss_alert_dismissed', 'false');
  window.dispatchEvent(new CustomEvent('evengine_stop_loss_alert_trigger', { detail: { streak } }));
}
