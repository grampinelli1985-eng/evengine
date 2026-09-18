import { describe, it, expect, vi, beforeEach } from 'vitest';

const proxy = vi.fn();
vi.mock('../oddsProxyClient', () => ({ fetchViaOddsProxy: (...a: any[]) => proxy(...a) }));

// localStorage mínimo — o ambiente de teste é node.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};

import {
  registerMatchForTracking,
  getPendingTrackedMatches,
  pollLiveResults,
  sportKeysToPoll,
} from '../liveTrackerService';

const started = () => new Date(Date.now() - 60 * 60 * 1000).toISOString(); // começou há 1h

const scoresBody = (home: string, away: string, completed: boolean) => [
  { home_team: home, away_team: away, completed, scores: [{ name: home, score: '2' }, { name: away, score: '1' }] },
];
const ok = (body: any) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  proxy.mockReset();
  store.clear();
});

describe('liveTracker — custo de créditos do /scores', () => {
  it('consulta SÓ a liga do jogo pendente (1 chamada, não 16)', async () => {
    registerMatchForTracking('m1', 'Arsenal', 'Chelsea', started(), 'soccer_epl');
    proxy.mockResolvedValue(ok(scoresBody('Arsenal', 'Chelsea', false)));

    await pollLiveResults();

    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][0]).toContain('/sports/soccer_epl/scores/');
  });

  it('liga fora da lista fixa (ex.: serie B) também é consultada pela própria liga', async () => {
    registerMatchForTracking('m2', 'Sport', 'Avai', started(), 'soccer_brazil_serie_b');
    proxy.mockResolvedValue(ok([]));

    await pollLiveResults();

    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][0]).toContain('soccer_brazil_serie_b');
  });

  it('duas ligas pendentes → uma chamada por liga', async () => {
    registerMatchForTracking('m1', 'Arsenal', 'Chelsea', started(), 'soccer_epl');
    registerMatchForTracking('m2', 'Real Madrid', 'Sevilla', started(), 'soccer_spain_la_liga');
    proxy.mockResolvedValue(ok([]));

    await pollLiveResults();

    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it('jogo legado sem sportKey mantém a varredura completa (comportamento antigo)', () => {
    registerMatchForTracking('old', 'A', 'B', started());
    const keys = sportKeysToPoll(getPendingTrackedMatches());
    expect(keys.length).toBeGreaterThan(10);
  });

  it('completa o sportKey de um jogo já rastreado sem ele', () => {
    registerMatchForTracking('m1', 'Arsenal', 'Chelsea', started());
    registerMatchForTracking('m1', 'Arsenal', 'Chelsea', started(), 'soccer_epl');
    expect(getPendingTrackedMatches()[0].sportKey).toBe('soccer_epl');
    expect(sportKeysToPoll(getPendingTrackedMatches())).toEqual(['soccer_epl']);
  });

  it('para de consultar ligas restantes quando todos os pendentes já encerraram', async () => {
    registerMatchForTracking('m1', 'Arsenal', 'Chelsea', started(), 'soccer_epl');
    registerMatchForTracking('m2', 'Real Madrid', 'Sevilla', started(), 'soccer_spain_la_liga');
    proxy.mockResolvedValueOnce(ok([
      ...scoresBody('Arsenal', 'Chelsea', true),
    ])).mockResolvedValueOnce(ok(scoresBody('Real Madrid', 'Sevilla', true)));

    await pollLiveResults();
    // Ambos encerrados só após a 2ª liga: as duas foram necessárias.
    expect(proxy).toHaveBeenCalledTimes(2);

    // Já resolvidos → próximo ciclo não gasta nada.
    proxy.mockClear();
    await pollLiveResults();
    expect(proxy).not.toHaveBeenCalled();
  });
});
