import { describe, it, expect, vi, beforeEach } from 'vitest';

const sincronizar = vi.fn().mockResolvedValue(undefined);
vi.mock('../clvService', () => ({ sincronizarResultadoCLV: (...a: any[]) => sincronizar(...a) }));
vi.mock('../bancaService', () => ({
  registrarResultadoDiario: vi.fn(),
  registrarResultado: vi.fn(),
  getBancaAtual: () => 1000,
  setBancaAtual: vi.fn(),
  getBancasFromSupabase: async () => [],
  updateBancaBalance: vi.fn(),
}));

// Bet "no banco": o SELECT de pendentes e o do resolveBet devolvem esta linha; o UPDATE devolve ela com o patch.
let dbBets: any[] = [];
vi.mock('../supabaseClient', () => {
  const makeBuilder = () => {
    let op: 'select' | 'update' = 'select';
    let single = false;
    let patch: any = null;
    const b: any = {
      select: () => b,
      update: (p: any) => { op = 'update'; patch = p; return b; },
      eq: () => b,
      single: () => { single = true; return b; },
      then: (res: any, rej: any) => {
        const value =
          op === 'update' ? { data: dbBets.map(x => ({ ...x, ...patch })), error: null }
          : single ? { data: dbBets[0] ?? null, error: null }
          : { data: dbBets, error: null };
        return Promise.resolve(value).then(res, rej);
      },
    };
    return b;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: () => makeBuilder(),
    },
  };
});

// Ambiente node: o crédito na banca dispara um evento no window.
(globalThis as any).window = { dispatchEvent: () => true };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

import { autoResolveBetFromLiveResult, extractMatchId } from '../betService';

const bet = (market: string, matchId = 'abc123') => ({
  id: 'b1', analysis_id: null, market, odd_taken: 3, stake_amount: 10, status: 'pending',
  notes: `Home × Away | Liga | 19/09/2026 | matchId:${matchId} ##sharp##{"opening_odd":3}`,
});

beforeEach(() => {
  sincronizar.mockClear();
  dbBets = [];
});

describe('autoResolveBetFromLiveResult → CLV', () => {
  it('aposta GREEN: sincroniza o CLV com o jogo e o mercado da aposta', async () => {
    dbBets = [bet('Empate')];
    const n = await autoResolveBetFromLiveResult({ matchId: 'abc123', homeGoals: 1, awayGoals: 1, placar: '1-1' });
    expect(n).toBe(1);
    expect(sincronizar).toHaveBeenCalledWith('abc123', 'GREEN', 'Empate');
  });

  it('aposta RED: sincroniza como RED', async () => {
    dbBets = [bet('Vitória Casa')];
    await autoResolveBetFromLiveResult({ matchId: 'abc123', homeGoals: 0, awayGoals: 2, placar: '0-2' });
    expect(sincronizar).toHaveBeenCalledWith('abc123', 'RED', 'Vitória Casa');
  });

  it('aposta de outro jogo não é resolvida nem sincronizada', async () => {
    dbBets = [bet('Empate', 'outro')];
    const n = await autoResolveBetFromLiveResult({ matchId: 'abc123', homeGoals: 1, awayGoals: 1, placar: '1-1' });
    expect(n).toBe(0);
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it('mercado que o auto-resolve não sabe avaliar (escanteios) fica pendente e sem sincronizar', async () => {
    dbBets = [bet('Mais de 9.5 Escanteios')];
    const n = await autoResolveBetFromLiveResult({ matchId: 'abc123', homeGoals: 1, awayGoals: 1, placar: '1-1' });
    expect(n).toBe(0);
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it('falha ao sincronizar o CLV não desfaz nem esconde a aposta já resolvida', async () => {
    dbBets = [bet('Empate')];
    sincronizar.mockRejectedValueOnce(new Error('rede'));
    const n = await autoResolveBetFromLiveResult({ matchId: 'abc123', homeGoals: 1, awayGoals: 1, placar: '1-1' });
    expect(n).toBe(1);
  });
});

describe('extractMatchId', () => {
  it('lê o matchId das notes, com ou sem metadados sharp depois', () => {
    expect(extractMatchId('A × B | EPL | 19/09/2026 | matchId:6fb54fd5b3da95e4f4bbef62b7022bd7 ##sharp##{"x":1}'))
      .toBe('6fb54fd5b3da95e4f4bbef62b7022bd7');
    expect(extractMatchId('A × B | EPL | matchId:xyz')).toBe('xyz');
  });

  it('sem matchId (aposta manual antiga) ou notes nulas → null', () => {
    expect(extractMatchId('só uma anotação')).toBeNull();
    expect(extractMatchId(null)).toBeNull();
  });
});
