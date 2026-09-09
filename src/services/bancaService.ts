/**
 * bancaService.ts
 *
 * [D-1 FIX] Stop-loss state now persisted to `bancas.stop_loss_state` JSONB column.
 * localStorage is kept as a fast read cache; DB is the authoritative source loaded
 * on mount and written on every state mutation.
 *
 * Requires migration: supabase/migrations/add_stop_loss_state.sql
 */

import { supabase } from './supabaseClient';
import { getCachedProfile } from './planService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BancaDB {
  id: string;
  user_id: string;
  nome: string;
  valor_inicial: number;
  valor_atual: number;
  created_at: string;
  stop_loss_state?: StopLossState | null;
}

export interface StopLossState {
  consecutiveRedCount: number;
  isBlocked: boolean;
  blockReason: string | null;
  lastRedDate: string | null;
  dailyRedCount: number;
  lastDailyReset: string | null;
}

// ─── localStorage keys (userId-scoped) ────────────────────────────────────────

function getStopLossKey(userId: string): string {
  return `evengine_stop_loss_state_${userId}`;
}

function getBancaKey(): string {
  return 'evengine_banca_atual';
}

function getActiveBancaIdKey(): string {
  return 'evengine_active_banca_id';
}

// ─── Banca local helpers ──────────────────────────────────────────────────────

export function getBancaAtual(): number {
  const raw = localStorage.getItem(getBancaKey());
  return raw ? parseFloat(raw) : 1000;
}

export function setBancaAtual(valor: number): void {
  localStorage.setItem(getBancaKey(), String(valor));
}

// ─── Supabase CRUD ────────────────────────────────────────────────────────────

export async function getBancasFromSupabase(userId: string): Promise<BancaDB[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('bancas')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[BancaService] getBancasFromSupabase error:', error.message);
    return [];
  }
  return (data as BancaDB[]) ?? [];
}

export async function updateBancaBalance(bancaId: string, novoValor: number): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('bancas')
    .update({ valor_atual: novoValor })
    .eq('id', bancaId);
  if (error) console.warn('[BancaService] updateBancaBalance error:', error.message);
}

// ─── Stop-loss state ──────────────────────────────────────────────────────────

const DEFAULT_STOP_LOSS_STATE: StopLossState = {
  consecutiveRedCount: 0,
  isBlocked: false,
  blockReason: null,
  lastRedDate: null,
  dailyRedCount: 0,
  lastDailyReset: null,
};

function getUserId(): string | null {
  return getCachedProfile()?.id ?? null;
}

export function carregarStopLossState(): StopLossState {
  const userId = getUserId();
  if (!userId) return { ...DEFAULT_STOP_LOSS_STATE };
  try {
    const raw = localStorage.getItem(getStopLossKey(userId));
    if (raw) return JSON.parse(raw) as StopLossState;
  } catch { /* ignore */ }
  return { ...DEFAULT_STOP_LOSS_STATE };
}

export async function carregarStopLossStateFromDB(): Promise<StopLossState> {
  const userId = getUserId();
  if (!userId || !supabase) return carregarStopLossState();

  try {
    // Find the active banca for this user
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return carregarStopLossState();

    const bancas = await getBancasFromSupabase(userId);
    const storedActiveId = localStorage.getItem(getActiveBancaIdKey());
    const active = (storedActiveId ? bancas.find(b => b.id === storedActiveId) : null) ?? bancas[0];

    if (active?.stop_loss_state) {
      // Sync DB state to localStorage cache
      localStorage.setItem(getStopLossKey(userId), JSON.stringify(active.stop_loss_state));
      return active.stop_loss_state as StopLossState;
    }
  } catch (e) {
    console.warn('[BancaService] carregarStopLossStateFromDB error:', e);
  }

  // Fall back to localStorage
  return carregarStopLossState();
}

export function salvarStopLossState(state: StopLossState): void {
  const userId = getUserId();
  if (!userId) return;

  // 1. Write to localStorage immediately (fast / sync)
  try {
    localStorage.setItem(getStopLossKey(userId), JSON.stringify(state));
  } catch { /* ignore */ }

  // 2. Persist to DB asynchronously (fire-and-forget)
  if (supabase) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      getBancasFromSupabase(userId).then(bancas => {
        const storedActiveId = localStorage.getItem(getActiveBancaIdKey());
        const active = (storedActiveId ? bancas.find(b => b.id === storedActiveId) : null) ?? bancas[0];
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

// ─── Stop-loss logic ──────────────────────────────────────────────────────────

export function checkAndResetDaily(): StopLossState {
  const state = carregarStopLossState();
  const todayUTC = new Date().toISOString().split('T')[0];

  if (state.lastDailyReset !== todayUTC) {
    const updated: StopLossState = {
      ...state,
      dailyRedCount: 0,
      lastDailyReset: todayUTC,
    };
    salvarStopLossState(updated);
    return updated;
  }
  return state;
}

export function registrarResultadoDiario(resultado: 'green' | 'red' | 'void'): void {
  let state = checkAndResetDaily();

  if (resultado === 'red') {
    const updated: StopLossState = {
      ...state,
      consecutiveRedCount: state.consecutiveRedCount + 1,
      dailyRedCount: state.dailyRedCount + 1,
      lastRedDate: new Date().toISOString(),
    };

    // Bloqueia após 3 REDs consecutivos ou 5 REDs no dia
    if (updated.consecutiveRedCount >= 3) {
      updated.isBlocked = true;
      updated.blockReason = `Stop-loss ativado: ${updated.consecutiveRedCount} reds consecutivos.`;
    } else if (updated.dailyRedCount >= 5) {
      updated.isBlocked = true;
      updated.blockReason = `Stop-loss ativado: ${updated.dailyRedCount} reds no dia.`;
    }

    salvarStopLossState(updated);
  } else if (resultado === 'green') {
    const updated: StopLossState = {
      ...state,
      consecutiveRedCount: 0,
    };
    salvarStopLossState(updated);
  }
  // 'void' não altera contadores
}

export function registrarResultado(resultado: 'green' | 'red' | 'void'): void {
  registrarResultadoDiario(resultado);
}

export function resetarStopLoss(): void {
  salvarStopLossState({ ...DEFAULT_STOP_LOSS_STATE });
}

export function isStopLossAtivo(): boolean {
  return carregarStopLossState().isBlocked;
}

export function getStopLossReason(): string | null {
  return carregarStopLossState().blockReason;
}

// ─── Cleanup on sign-out ──────────────────────────────────────────────────────

export function clearBancaOnSignOut(userId: string): void {
  localStorage.removeItem(getStopLossKey(userId));
  localStorage.removeItem(getBancaKey());
  localStorage.removeItem(getActiveBancaIdKey());
}
