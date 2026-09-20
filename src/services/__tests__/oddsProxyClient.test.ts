import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({ supabase: null }));

import { syncOddsKeyId, ODDS_KEY_ID_STORAGE } from '../oddsProxyClient';

const withKeyId = (id: string | null) =>
  new Response('[]', { status: 200, headers: id ? { 'x-odds-key-id': id } : {} });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('syncOddsKeyId — troca de chave da Odds API', () => {
  it('mesma chave: não mexe no estado', () => {
    localStorage.setItem(ODDS_KEY_ID_STORAGE, 'aaa');
    localStorage.setItem('odds_api_remaining', '480');

    expect(syncOddsKeyId(withKeyId('aaa'))).toBe(false);
    expect(localStorage.getItem('odds_api_remaining')).toBe('480');
  });

  it('chave nova: descarta flag de erro e cota da chave antiga e grava o novo id', () => {
    localStorage.setItem(ODDS_KEY_ID_STORAGE, 'aaa');
    localStorage.setItem('odds_api_error_status', '429');
    localStorage.setItem('odds_api_remaining', '0');
    localStorage.setItem('odds_api_used', '500');
    sessionStorage.setItem('odds_api_remaining', '0');
    sessionStorage.setItem('odds_api_used', '500');

    expect(syncOddsKeyId(withKeyId('bbb'))).toBe(true);

    expect(localStorage.getItem('odds_api_error_status')).toBeNull();
    expect(localStorage.getItem('odds_api_remaining')).toBeNull();
    expect(localStorage.getItem('odds_api_used')).toBeNull();
    expect(sessionStorage.getItem('odds_api_remaining')).toBeNull();
    expect(sessionStorage.getItem('odds_api_used')).toBeNull();
    expect(localStorage.getItem(ODDS_KEY_ID_STORAGE)).toBe('bbb');
  });

  it('primeira vez sem id guardado: adota o id e limpa flag antigo', () => {
    localStorage.setItem('odds_api_error_status', '401');

    expect(syncOddsKeyId(withKeyId('aaa'))).toBe(true);
    expect(localStorage.getItem('odds_api_error_status')).toBeNull();
    expect(localStorage.getItem(ODDS_KEY_ID_STORAGE)).toBe('aaa');
  });

  it('resposta sem x-odds-key-id (NO_API_KEY / proxy antigo): não apaga nada', () => {
    localStorage.setItem(ODDS_KEY_ID_STORAGE, 'aaa');
    localStorage.setItem('odds_api_error_status', '401');

    expect(syncOddsKeyId(withKeyId(null))).toBe(false);
    expect(localStorage.getItem('odds_api_error_status')).toBe('401');
    expect(localStorage.getItem(ODDS_KEY_ID_STORAGE)).toBe('aaa');
  });
});
