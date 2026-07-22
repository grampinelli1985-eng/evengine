/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 📢 ARQUITETURA DE PERSISTÊNCIA - DIRETRIZ MVP
 *
 * Limitação do MVP: A persistência do controle de Stop Loss, Stop Win e do PnL diário
 * está implementada no lado do cliente (Local Storage) nesta fase.
 *
 * Plano de Evolução (Roadmap):
 * Para a categoria/tier 'Sharp' (profissional), a persistência e validação dessas travas
 * e limites serão migradas para o lado do servidor (Server-Side Persistence) de modo
 * a evitar manipulações por parte do cliente e garantir segurança corporativa.
 */

import { BancaState } from '../types';
import { supabase } from './supabaseClient';
import { getCachedProfile } from './planService';

function getStorageKey(): string {
  const profile = getCachedProfile();
  return `evengine_banca_state${profile?.id ? `_${profile.id}` : ''}`;
}

function getResetKey(): string {
  const profile = getCachedProfile();
  return `evengine_banca_last_reset${profile?.id ? `_${profile.id}` : ''}`;
}

export interface BancaDB {
  id: string;
  user_id: string;
  nome: string;
  valor_inicial: number;
  valor_atual: number;
  created_at: string;
}

const DEFAULT_BANCA: BancaState = {
  total: 1000,
  pnl_diario: 0,
  stake_recomendado: 0,
  kelly: 0,
  stops: { win: false, loss: false }
};

// [INC-BANCA-2 FIX] Separado em função pura (leitura) + checkAndResetDaily (side-effect)
export function getBanca(): BancaState {
  const stored = localStorage.getItem(getStorageKey());
  return stored ? JSON.parse(stored) : { ...DEFAULT_BANCA };
}

export function checkAndResetDaily(): void {
  const lastReset = localStorage.getItem(getResetKey());
  const today = new Date().toISOString().split('T')[0];

  if (lastReset !== today) {
    const state = getBanca();
    state.pnl_diario = 0;
    state.stops = { win: false, loss: false };
    state.apostasHoje = 0;
    localStorage.setItem(getResetKey(), today);
    saveBanca(state);
  }
}

export function saveBanca(state: BancaState) {
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
}

export function setBancaAtual(valor: number): void {
  const state = getBanca();
  state.bancaAtual = valor;
  state.total = valor;
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
}

export function getBancaAtual(): number {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return 1000;
    const state = JSON.parse(raw);
    return state.bancaAtual ?? state.total ?? 1000;
  } catch {
    return 1000;
  }
}

export function resetarContadores(): void {
  const state = getBanca();
  state.apostasHoje = 0;
  state.stops = { win: false, loss: false };
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
  salvarStopLossState(STOP_LOSS_INICIAL);
  window.dispatchEvent(new CustomEvent('evengine_stop_loss_changed', { detail: STOP_LOSS_INICIAL }));
}

// [BUG-BANCA-1 FIX] Removido cap absoluto R$500 — usa apenas 3% da banca
export function calculateKellyStake(prob: number, odd: number, bancaTotal: number, fraction: number = 0.25): number {
  if (odd <= 1) return 0;

  const p = prob / 100;
  const b = odd - 1;
  const q = 1 - p;

  const kelly = (p * b - q) / b;
  if (kelly <= 0) return 0;

  const stakeValue = bancaTotal * kelly * fraction;

  // Arredondar para número inteiro
  let roundedStake = Math.round(stakeValue);
  
  // Se o Kelly calculou uma stake positiva, garantir pelo menos R$1
  if (stakeValue > 0 && roundedStake < 1) {
    roundedStake = 1;
  }

  // Hard cap: 3% da banca (KELLY_MAX_ABSOLUTO)
  return Math.min(roundedStake, bancaTotal * 0.03);
}

export function getStopStatus(banca: BancaState) {
  const winLimit = banca.total * 0.15;   // +15% lucro no dia
  const lossLimit = -banca.total * 0.05; // -5% perda no dia

  return {
    win: banca.pnl_diario >= winLimit,
    loss: banca.pnl_diario <= lossLimit
  };
}

// [BUG-BANCA-2 FIX] Stops calculados com banca-base anterior à modificação
export function registrarResultadoDiario(valor: number) {
  const banca = getBanca();
  const bancaBase = banca.total; // captura antes de modificar
  banca.pnl_diario += valor;
  banca.total += valor;
  banca.picoHistorico = Math.max(banca.picoHistorico || bancaBase, banca.total);

  const stops = getStopStatus({ ...banca, total: bancaBase });
  banca.stops = stops;

  saveBanca(banca);
}

export function getDrawdownAtual(): number {
  const state = getBanca();
  const pico = state.picoHistorico || state.total;
  if (pico <= 0) return 0;
  return (pico - state.total) / pico;
}

export function emModoConservador(): boolean {
  return getDrawdownAtual() > 0.20;
}

export function aplicarModoConservador(stakeCalculada: number): number {
  return emModoConservador() ? stakeCalculada * 0.50 : stakeCalculada;
}

export function getEstadoProtecao() {
  const banca = getBanca();
  const stops = getStopStatus(banca);

  return {
    stop_loss_ativo: stops.loss,
    stop_win_ativo: stops.win,
    pnl_diario: banca.pnl_diario,
    banca_total: banca.total
  };
}

export interface StopLossState {
  redStreakAtual: number;
  suspensaoAtiva: boolean;
  timestampUltimoRed: number;
  historicoStreak: number[];
  winsDesdeUltimoRed: number;
}

const STOP_LOSS_INICIAL: StopLossState = {
  redStreakAtual: 0,
  suspensaoAtiva: false,
  timestampUltimoRed: 0,
  historicoStreak: [],
  winsDesdeUltimoRed: 0,
};

const STOP_LOSS_KEY = 'evengine_stop_loss_state';

export function carregarStopLossState(): StopLossState {
  try {
    const raw = localStorage.getItem(STOP_LOSS_KEY);
    if (!raw) return { ...STOP_LOSS_INICIAL };
    const parsed = JSON.parse(raw);
    return {
      redStreakAtual: parsed.redStreakAtual ?? 0,
      suspensaoAtiva: parsed.suspensaoAtiva ?? false,
      timestampUltimoRed: parsed.timestampUltimoRed ?? 0,
      historicoStreak: parsed.historicoStreak ?? [],
      winsDesdeUltimoRed: parsed.winsDesdeUltimoRed ?? 0,
    };
  } catch {
    return { ...STOP_LOSS_INICIAL };
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
      winsDesdeUltimoRed: (estado.winsDesdeUltimoRed || 0) + 1,
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
      winsDesdeUltimoRed: 0,
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

export function podeAumentarStake(stakeAnterior: number, stakeCalculada: number): boolean {
  if (stakeCalculada <= stakeAnterior) return true;
  const estado = carregarStopLossState();
  return (estado.winsDesdeUltimoRed || 0) >= 2;
}

export function registrarEntradaAprovada(): void {
  const state = getBanca();
  state.apostasHoje = (state.apostasHoje || 0) + 1;
  saveBanca(state);
}

export function limiteEntradasAtingido(): boolean {
  const state = getBanca();
  return (state.apostasHoje || 0) >= 3;
}

export function limiteJogosSimultaneosAtingido(pendentesCount: number): boolean {
  return pendentesCount >= 2;
}

export function podeEntrarNovaAposta(pendentesCount?: number): boolean {
  const streak = carregarStopLossState();
  if (streak.suspensaoAtiva) return false;

  const protecao = getEstadoProtecao();
  if (protecao.stop_loss_ativo || protecao.stop_win_ativo) return false;

  if (limiteEntradasAtingido()) return false;
  if (pendentesCount !== undefined && limiteJogosSimultaneosAtingido(pendentesCount)) return false;

  return true;
}




export function dispararAlertaStopLoss(streak: number): void {
  localStorage.setItem('evengine_stop_loss_alert_dismissed', 'false');
  window.dispatchEvent(new CustomEvent('evengine_stop_loss_alert_trigger', { detail: { streak } }));
}

/**
 * Fetch all bancas of a user from Supabase
 */
export async function getBancasFromSupabase(userId: string): Promise<BancaDB[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('bancas')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Erro ao buscar bancas no Supabase:', err);
    return [];
  }
}

/**
 * Insert a new banca into Supabase
 */
export async function addBancaToSupabase(userId: string, nome: string, valorInicial: number): Promise<BancaDB | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('bancas')
      .insert({
        user_id: userId,
        nome: nome,
        valor_inicial: valorInicial,
        valor_atual: valorInicial
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Erro ao adicionar banca no Supabase:', err);
    return null;
  }
}

/**
 * Switch the active banca and update state/local storage
 */
export async function switchActiveBanca(banca: BancaDB): Promise<void> {
  localStorage.setItem('evengine_active_banca_id', banca.id);

  const state = getBanca();
  state.bancaAtual = Number(banca.valor_atual);
  state.total = Number(banca.valor_atual);
  saveBanca(state);

  window.dispatchEvent(new CustomEvent('evengine_banca_changed'));
}

/**
 * Update the active banca's balance in Supabase and local state
 */
export async function updateBancaBalance(bancaId: string, novoValor: number): Promise<void> {
  if (supabase) {
    try {
      await supabase
        .from('bancas')
        .update({ valor_atual: novoValor })
        .eq('id', bancaId);
    } catch (err) {
      console.error('Erro ao atualizar saldo da banca no Supabase:', err);
    }
  }

  const state = getBanca();
  state.bancaAtual = novoValor;
  state.total = novoValor;
  saveBanca(state);
  window.dispatchEvent(new CustomEvent('evengine_banca_changed'));
}
