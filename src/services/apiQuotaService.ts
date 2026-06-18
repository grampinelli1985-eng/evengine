/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const STORAGE_KEY = 'evengine_api_quota';

interface QuotaState {
  requests: number;
  lastReset: string;
}

function getQuotaState(): QuotaState {
  const stored = localStorage.getItem(STORAGE_KEY);
  const now = new Date().toISOString().split('T')[0];
  
  if (stored) {
    const state = JSON.parse(stored);
    if (state.lastReset === now) {
      return state;
    }
  }
  
  const newState = { requests: 0, lastReset: now };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  return newState;
}

export function trackRequest() {
  const state = getQuotaState();
  state.requests += 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function hasQuota(needed: number = 1): boolean {
  const state = getQuotaState();
  const limit = 100; // API-Football free tier limit per day is usually 100
  return state.requests + needed <= limit;
}

export function getQuotaUsage(): number {
  const state = getQuotaState();
  const limit = 100;
  return (state.requests / limit) * 100;
}

export async function syncQuotaFromAPI(): Promise<void> {
  try {
    const response = await fetch('/api/football/status', {
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) return;

    const data = await response.json();
    if (data.response && data.response.requests) {
      const state = getQuotaState();
      state.requests = data.response.requests.current;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Falha silenciosa — não bloquear o app
    console.warn('Quota sync indisponível — continuando offline');
  }
}
