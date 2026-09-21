import { describe, it, expect, vi, beforeEach } from 'vitest';

// Registra as chamadas de UPDATE em clv_entries: { patch, filters }.
const updates: Array<{ patch: any; filters: Record<string, any> }> = [];
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: () => {
      const call = { patch: null as any, filters: {} as Record<string, any> };
      const b: any = {
        update: (patch: any) => { call.patch = patch; return b; },
        eq: (col: string, val: any) => { call.filters[col] = val; return b; },
        then: (res: any, rej: any) => { updates.push(call); return Promise.resolve({ error: null }).then(res, rej); },
      };
      return b;
    },
  },
}));
vi.mock('../planService', () => ({ getCachedProfile: () => ({ id: 'u1' }) }));

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};

import { sincronizarResultadoCLV, atualizarResultadoCLV, getEntradasCLV, type CLVEntry } from '../clvService';

const KEY = 'evengine_clv_entries_u1';
const entry = (over: Partial<CLVEntry>): CLVEntry => ({
  matchId: 'm1', homeTeam: 'A', awayTeam: 'B', sportKey: 'soccer_epl', commenceTime: '2026-09-19T15:00:00Z',
  mercado: 'Empate', oddUtilizada: 3.5, oddFechamento: null, clvPct: null,
  resultado: 'PENDENTE', analyzedAt: '2026-09-18T10:00:00Z', closedAt: null, ...over,
});
const seed = (...e: CLVEntry[]) => store.set(KEY, JSON.stringify(e));
const resultados = () => getEntradasCLV().map(e => `${e.mercado}:${e.resultado}`);

beforeEach(() => {
  store.clear();
  updates.length = 0;
});

describe('sincronizarResultadoCLV', () => {
  it('grava o resultado real numa entrada PENDENTE', async () => {
    seed(entry({}));
    await sincronizarResultadoCLV('m1', 'GREEN', 'Empate');
    expect(resultados()).toEqual(['Empate:GREEN']);
  });

  it('sobrescreve o VOID de expiração (limparEntradasAntigas) pelo resultado real — o que o painel mostrava como tudo VOID', async () => {
    seed(entry({ resultado: 'VOID', closedAt: '2026-09-19T19:00:00Z' }));
    await sincronizarResultadoCLV('m1', 'RED', 'Empate');
    expect(resultados()).toEqual(['Empate:RED']);
  });

  it('não pisa num resultado já definitivo (GREEN/RED)', async () => {
    seed(entry({ resultado: 'GREEN' }));
    await sincronizarResultadoCLV('m1', 'RED', 'Empate');
    expect(resultados()).toEqual(['Empate:GREEN']);
  });

  it('VOID de fato não sobrescreve VOID nem PENDENTE de outro jogo', async () => {
    seed(entry({ resultado: 'VOID' }), entry({ matchId: 'm2', mercado: 'Empate' }));
    await sincronizarResultadoCLV('m1', 'VOID', 'Empate');
    expect(getEntradasCLV().map(e => e.resultado)).toEqual(['VOID', 'PENDENTE']);
  });

  it('com dois mercados no mesmo jogo, grava só no mercado da aposta', async () => {
    seed(entry({ mercado: 'Empate' }), entry({ mercado: 'Vitória Casa' }));
    await sincronizarResultadoCLV('m1', 'GREEN', 'Vitória Casa');
    expect(resultados()).toEqual(['Empate:PENDENTE', 'Vitória Casa:GREEN']);
  });

  it('mercado sem correspondência exata: usa a entrada única do jogo', async () => {
    seed(entry({ mercado: 'Empate' }));
    await sincronizarResultadoCLV('m1', 'GREEN', 'Draw');
    expect(resultados()).toEqual(['Empate:GREEN']);
  });

  it('mercado sem correspondência e várias entradas: não adivinha', async () => {
    seed(entry({ mercado: 'Empate' }), entry({ mercado: 'Vitória Casa' }));
    await sincronizarResultadoCLV('m1', 'GREEN', 'Dupla Chance 1X');
    expect(resultados()).toEqual(['Empate:PENDENTE', 'Vitória Casa:PENDENTE']);
  });

  it('sem mercado (chamadas antigas): mantém o comportamento por jogo', async () => {
    seed(entry({}));
    await sincronizarResultadoCLV('m1', 'GREEN');
    expect(resultados()).toEqual(['Empate:GREEN']);
  });

  it('propaga ao Supabase filtrando por jogo, usuário, PENDENTE e mercado', async () => {
    seed(entry({}));
    await sincronizarResultadoCLV('m1', 'GREEN', 'Empate');
    expect(updates).toEqual([{
      patch: { resultado: 'GREEN' },
      filters: { match_id: 'm1', resultado: 'PENDENTE', user_id: 'u1', mercado: 'Empate' },
    }]);
  });
});

describe('atualizarResultadoCLV', () => {
  it('com mercado, atualiza a entrada certa', () => {
    seed(entry({ mercado: 'Empate' }), entry({ mercado: 'Vitória Casa' }));
    atualizarResultadoCLV('m1', 'RED', 'Vitória Casa');
    expect(resultados()).toEqual(['Empate:PENDENTE', 'Vitória Casa:RED']);
  });
});
