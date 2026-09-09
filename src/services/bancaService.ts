/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

// [H-01 FIX] Stop loss key now user-scoped to prevent cross-user contamination
function getStopLossKey(): string {
  const profile = getCachedProfile();
  return `evengine_stop_loss_state${profile?.id ? `_${profile.id}` : ''}`;
}

function getActiveBancaKey(): string {
  const profile = getCachedProfile();
  return `evengine_active_banca_id${profile?.id ? `_${profile.id}` : ''}`;
}

export function getStopLossAlertKey(): string {
  const profile = getCachedProfile();
  return `evengine_stop_loss_alert_dismissed${profile?.id ? `_${profile.id}` : ''}`;
}

export interface BancaDB {
  id: string;
  user_id: string;
  nome: string;
  valor_inicial: number;
  valor_atual: number;
  created_at: string;
  // [D-1 FIX] Stop-loss state persisted server-side
  stop_loss_state?: StopLossState | null;
}

const DEFAULT_BANCA: BancaState = {
  total: 1000,
  pnl_diario: 0,
  stake_recomendado: 0,
  kelly: 0,
  stops: { win: false, loss: false }
};

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

  // Limpa caches BLOQUEADO ao resetar manualmente o stop-loss
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('ev_bloqueado_')) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

export function calculateKellyStake(prob: number, odd: number, bancaTotal: number, fraction: number = 0.25): number {
  if (odd <= 1) return 0;

  const p = prob / 100;
  const b = odd - 1;
  const q = 1 - p;

  const kelly = (p * b - q) / b;
  if (kelly <= 0) return 0;

  const stakeValue = bancaTotal * kelly * fraction;
  if (stakeValue <= 0) return 0;

  return Math.min(stakeValue, bancaTotal * 0.03);
}

export function getStopStatus(banca: BancaState) {
  const winLimit = banca.total * 0.15;
  const lossLimit = -banca.total * 0.05;

  return {
    win: banca.pnl_diario >= winLimit,
    loss: banca.pnl_diario <= lossLimit
  };
}

export function registrarResultadoDiario(valor: number) {
  const banca = getBanca();
  const bancaBase = banca.total;
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

export function carregarStopLossState(): StopLossState {
  try {
    const raw = localStorage.getItem(getStopLossKey());
    if (!raw) return { ...STOP_LOSS_INICIAL };
    const parsed = JSON.parse(raw);
    const redStreakAtual = parsed.redStreakAtual ?? 0;
    const suspensaoAtiva = (parsed.suspensaoAtiva ?? false) && redStreakAtual >= getStopLossLimite();
    return {
      redStreakAtual,
      suspensaoAtiva,
      timestampUltimoRed: parsed.timestampUltimoRed ?? 0,
      historicoStreak: parsed.historicoStreak ?? [],
      winsDesdeUltimoRed: parsed.winsDesdeUltimoRed ?? 0,
    };
  } catch {
    return { ...STOP_LOSS_INICIAL };
  }
}

/**
 * [D-1 FIX] Loads stop-loss state from DB (authoritative source).
 * Falls back to localStorage if DB is unavailable.
 * Call this on app mount after authentication.
 */
export async function carregarStopLossStateFromDB(): Promise<StopLossState> {
  if (!supabase) return carregarStopLossState();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return carregarStopLossState();

    const userId = session.user.id;
    const bancas = await getBancasFromSupabase(userId);
    const activeId = localStorage.getItem(getActiveBancaKey());
    const active = (activeId ? bancas.find(b => b.id === activeId) : null) ?? bancas[0];

    if (active?.stop_loss_state) {
      localStorage.setItem(getStopLossKey(), JSON.stringify(active.stop_loss_state));
      return active.stop_loss_state as StopLossState;
    }
  } catch (e) {
    console.warn('[BancaService] carregarStopLossStateFromDB error:', e);
  }
  return carregarStopLossState();
}

/**
 * [D-1 FIX] Persists stop-loss state to localStorage (sync) and DB (async).
 */
export function salvarStopLossState(state: StopLossState): void {
  localStorage.setItem(getStopLossKey(), JSON.stringify(state));

  // Persist to DB asynchronously so incognito/multi-device sessions can't bypass the gate
  if (supabase) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      const userId = session.user.id;
      getBancasFromSupabase(userId).then(bancas => {
        const activeId = localStorage.getItem(getActiveBancaKey());
        const active = (activeId ? bancas.find(b => b.id === activeId) : null) ?? bancas[0];
        if (!active) return;
        supabase!
          .from('bancas')
          .update({ stop_loss_state: state })
          .eq('id', active.id)
          .eq('user_id', userId)
          .then(({ error }) => {
            if (error) console.warn('[BancaService] salvarStopLossState DB error:', error.message);
          });
      });
    });
  }
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

    // Libera caches BLOQUEADO ao desativar o stop-loss com o primeiro GREEN
    if (estado.suspensaoAtiva) {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('ev_bloqueado_')) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
    }

    return novoEstado;
  }

  if (res === 'red' || res === 'loss') {
    const novoStreak = estado.redStreakAtual + 1;
    const suspender = novoStreak >= getStopLossLimite();

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
  return (state.apostasHoje || 0) >= 10;
}

export function limiteJogosSimultaneosAtingido(pendentesCount: number): boolean {
  return pendentesCount >= 10;
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
  localStorage.setItem(getStopLossAlertKey(), 'false');
  window.dispatchEvent(new CustomEvent('evengine_stop_loss_alert_trigger', { detail: { streak } }));
}

// ─── Limite de streak configurável ─────────────────────────────────────────

function getStopLossLimiteKey(): string {
  const profile = getCachedProfile();
  return `evengine_stop_loss_limite${profile?.id ? `_${profile.id}` : ''}`;
}

export const STOP_LOSS_LIMITE_DEFAULT = 3;

export function getStopLossLimite(): number {
  try {
    const raw = localStorage.getItem(getStopLossLimiteKey());
    if (!raw) return STOP_LOSS_LIMITE_DEFAULT;
    const n = parseInt(raw, 10);
    return isNaN(n) || n < 1 ? STOP_LOSS_LIMITE_DEFAULT : n;
  } catch {
    return STOP_LOSS_LIMITE_DEFAULT;
  }
}

export function setStopLossLimite(limite: number): void {
  const val = Math.max(1, Math.min(10, limite));
  localStorage.setItem(getStopLossLimiteKey(), String(val));
  window.dispatchEvent(new CustomEvent('evengine_stop_loss_limite_changed', { detail: { limite: val } }));
}

/**
 * [H-01 FIX] Clear all user-scoped localStorage keys on logout.
 * Call this inside supabaseClient's SIGNED_OUT handler.
 */
export function clearBancaOnSignOut(userId: string): void {
  const suffix = `_${userId}`;
  localStorage.removeItem(`evengine_banca_state${suffix}`);
  localStorage.removeItem(`evengine_banca_last_reset${suffix}`);
  localStorage.removeItem(`evengine_stop_loss_state${suffix}`);
  localStorage.removeItem(`evengine_active_banca_id${suffix}`);
  localStorage.removeItem(`evengine_stop_loss_alert_dismissed${suffix}`);
  localStorage.removeItem(`evengine_stop_loss_limite${suffix}`);
  localStorage.removeItem(`evengine_pending_bets${suffix}`);
  localStorage.removeItem(`evengine_placed_bets${suffix}`);
  localStorage.removeItem(`evengine_active_view${suffix}`);
  localStorage.removeItem(`evengine_selected_leagues${suffix}`);
  localStorage.removeItem('evengine_cached_profile');

  // Limpa caches BLOQUEADO que pertencem a este usuário (prefixo ev_bloqueado_)
  const bloqueadoKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('ev_bloqueado_')) bloqueadoKeys.push(k);
  }
  bloqueadoKeys.forEach(k => localStorage.removeItem(k));
}

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

export async function switchActiveBanca(banca: BancaDB): Promise<void> {
  localStorage.setItem(getActiveBancaKey(), banca.id);

  const state = getBanca();
  state.bancaAtual = Number(banca.valor_atual);
  state.total = Number(banca.valor_atual);
  saveBanca(state);

  window.dispatchEvent(new CustomEvent('evengine_banca_changed'));
}

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
