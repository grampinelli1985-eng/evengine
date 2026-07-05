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
    try {
      const state = JSON.parse(stored);
      if (state.lastReset === now) {
        return state;
      }
    } catch {}
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

export function trackOddsApiRequest(headers: Headers) {
  const remaining = headers.get('x-requests-remaining');
  const used = headers.get('x-requests-used');
  
  const state = getQuotaState();
  if (used !== null) {
    state.requests = parseInt(used, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    sessionStorage.setItem('odds_api_used', used);
  }
  if (remaining !== null) {
    sessionStorage.setItem('odds_api_remaining', remaining);
  }
}

export function hasQuota(needed: number = 1): boolean {
  const state = getQuotaState();
  const limit = 500; // The Odds API free tier limit is 500
  return state.requests + needed <= limit;
}

export function getQuotaUsage(): number {
  const state = getQuotaState();
  const limit = 500;
  return (state.requests / limit) * 100;
}

export async function syncQuotaFromAPI(): Promise<void> {
  const used = sessionStorage.getItem('odds_api_used');
  if (used !== null) {
    const state = getQuotaState();
    state.requests = parseInt(used, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
