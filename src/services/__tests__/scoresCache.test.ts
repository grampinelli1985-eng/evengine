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

import { fetchScoresCached, __resetScoresCacheState, SCORES_CACHE_TTL_MS } from '../scoresCache';

const ok = (body: any) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  proxy.mockReset();
  store.clear();
  __resetScoresCacheState();
  vi.useRealTimers();
});

describe('scoresCache', () => {
  it('chama /scores?daysFrom=3 da liga e cacheia', async () => {
    proxy.mockResolvedValue(ok([{ id: 'g1' }]));
    const a = await fetchScoresCached('soccer_epl');
    const b = await fetchScoresCached('soccer_epl');

    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][0]).toBe('/sports/soccer_epl/scores/?daysFrom=3');
    expect(a.status).toBe('ok');
    expect(b).toEqual({ games: [{ id: 'g1' }], status: 'cache' });
  });

  it('cacheia também a resposta VAZIA (liga sem jogos) — não refaz a chamada', async () => {
    proxy.mockResolvedValue(ok([]));
    await fetchScoresCached('soccer_brazil_serie_b');
    const again = await fetchScoresCached('soccer_brazil_serie_b');

    expect(proxy).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ games: [], status: 'cache' });
  });

  it('refaz a chamada depois do TTL de 30 min', async () => {
    vi.useFakeTimers();
    proxy.mockResolvedValue(ok([]));
    await fetchScoresCached('soccer_epl');
    vi.advanceTimersByTime(SCORES_CACHE_TTL_MS - 1000);
    await fetchScoresCached('soccer_epl');
    expect(proxy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    await fetchScoresCached('soccer_epl');
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it('uma chamada só quando calibração e scouting pedem a mesma liga ao mesmo tempo', async () => {
    proxy.mockResolvedValue(ok([{ id: 'g1' }]));
    await Promise.all([fetchScoresCached('soccer_epl'), fetchScoresCached('soccer_epl')]);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it('ligas diferentes têm caches independentes', async () => {
    proxy.mockResolvedValue(ok([]));
    await fetchScoresCached('soccer_epl');
    await fetchScoresCached('soccer_spain_la_liga');
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, 'unauthorized'],
    [429, 'rate_limited'],
    [422, 'unprocessable'],
    [500, 'error'],
  ])('HTTP %i -> %s e NÃO cacheia (tenta de novo depois)', async (httpStatus, status) => {
    proxy.mockResolvedValue(new Response('{}', { status: httpStatus }));
    const r = await fetchScoresCached('soccer_epl');
    expect(r).toEqual({ games: [], status });

    await fetchScoresCached('soccer_epl');
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it('401 com error_code OUT_OF_USAGE_CREDITS -> out_of_credits (chave válida, cota zerada) e NÃO cacheia', async () => {
    proxy.mockImplementation(async () => new Response(
      JSON.stringify({ message: 'Usage quota has been reached.', error_code: 'OUT_OF_USAGE_CREDITS' }),
      { status: 401 },
    ));
    const r = await fetchScoresCached('soccer_epl');
    expect(r).toEqual({ games: [], status: 'out_of_credits' });

    await fetchScoresCached('soccer_epl');
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it('corpo que não é array não é cacheado', async () => {
    proxy.mockResolvedValue(ok({ message: 'oops' }));
    const r = await fetchScoresCached('soccer_epl');
    expect(r.status).toBe('error');
    await fetchScoresCached('soccer_epl');
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it('nunca lança em falha de rede', async () => {
    proxy.mockRejectedValue(new Error('offline'));
    await expect(fetchScoresCached('soccer_epl')).resolves.toEqual({ games: [], status: 'error' });
  });
});
