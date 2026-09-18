import { describe, it, expect, vi, beforeEach } from 'vitest';

const proxy = vi.fn();
vi.mock('../oddsProxyClient', () => ({ fetchViaOddsProxy: (...a: any[]) => proxy(...a) }));
vi.mock('../supabaseClient', () => ({ supabase: null })); // sem cache compartilhado

// localStorage mínimo — o ambiente de teste é node.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};

import { fetchAllMatches } from '../oddsService';

const H = 60 * 60 * 1000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();
const json = (body: any) => new Response(JSON.stringify(body), { status: 200 });

const event = (id: string, hours: number) => ({
  id, sport_key: 'soccer_epl', sport_title: 'EPL', commence_time: inHours(hours),
  home_team: 'A' + id, away_team: 'B' + id, bookmakers: [],
});

/** Roteia por caminho: /events (grátis) e /odds (pago). */
function route(opts: { events?: any[] | Response; odds?: any[] | Response }) {
  proxy.mockImplementation(async (path: string) => {
    const pick = path.includes('/events') ? opts.events : opts.odds;
    if (pick instanceof Response) return pick;
    return json(pick ?? []);
  });
}
const paidCalls = () => proxy.mock.calls.filter(c => (c[0] as string).includes('/odds/'));
const freeCalls = () => proxy.mock.calls.filter(c => (c[0] as string).includes('/events'));

beforeEach(() => {
  proxy.mockReset();
  store.clear();
});

describe('oddsService — economia de créditos', () => {
  it('liga SEM jogo em 7 dias: não chama /odds (0 créditos) e devolve vazio', async () => {
    route({ events: [event('1', 24 * 25)] }); // próximo jogo em 25 dias (ex.: Champions em pausa)
    const r = await fetchAllMatches(['soccer_epl']);

    expect(r).toEqual([]);
    expect(paidCalls()).toHaveLength(0);
    expect(freeCalls()).toHaveLength(1);
  });

  it('liga com jogo no horizonte: 1 chamada paga com markets=h2h,totals (sem spreads, sem daysFrom)', async () => {
    route({ events: [event('1', 10)], odds: [event('1', 10)] });
    const r = await fetchAllMatches(['soccer_epl']);

    expect(r).toHaveLength(1);
    expect(paidCalls()).toHaveLength(1);
    const path = paidCalls()[0][0] as string;
    expect(path).toContain('markets=h2h,totals&');
    expect(path).not.toContain('spreads');
    expect(path).not.toContain('daysFrom');
    expect(path).not.toMatch(/markets=[^&]*(btts|draw_no_bet|alternate)/); // só existem por evento
  });

  it('a decisão de agenda é cacheada: segunda rodada não repete nem a chamada grátis', async () => {
    route({ events: [event('1', 24 * 25)] });
    await fetchAllMatches(['soccer_epl']);
    await fetchAllMatches(['soccer_epl']);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it('falha na checagem grátis => fail-open: busca as odds normalmente', async () => {
    route({ events: new Response('{}', { status: 500 }), odds: [event('1', 10)] });
    const r = await fetchAllMatches(['soccer_epl']);
    expect(r).toHaveLength(1);
    expect(paidCalls()).toHaveLength(1);
  });

  it('rede caindo na checagem grátis => fail-open', async () => {
    proxy.mockImplementation(async (path: string) => {
      if (path.includes('/events')) throw new Error('offline');
      return json([event('1', 10)]);
    });
    const r = await fetchAllMatches(['soccer_epl']);
    expect(r).toHaveLength(1);
  });

  it('422 no pedido pago: repete uma vez com o pedido mínimo (liga não fica vazia)', async () => {
    let n = 0;
    proxy.mockImplementation(async (path: string) => {
      if (path.includes('/events')) return json([event('1', 10)]);
      n++;
      return n === 1 ? new Response('{}', { status: 422 }) : json([event('1', 10)]);
    });
    const r = await fetchAllMatches(['soccer_epl']);
    expect(r).toHaveLength(1);
    expect(paidCalls()).toHaveLength(2);
  });

  it('só as ligas com jogo geram chamada paga (3 de 5 sem jogo => 2 pagas)', async () => {
    proxy.mockImplementation(async (path: string) => {
      const quiet = ['soccer_uefa_champs_league', 'soccer_conmebol_copa_libertadores', 'soccer_conmebol_copa_sudamericana'];
      const active = !quiet.some(q => path.includes(q));
      if (path.includes('/events')) return json([event('x', active ? 10 : 24 * 25)]);
      return json([event('x', 10)]);
    });
    await fetchAllMatches([
      'soccer_epl', 'soccer_spain_la_liga',
      'soccer_uefa_champs_league', 'soccer_conmebol_copa_libertadores', 'soccer_conmebol_copa_sudamericana',
    ]);
    expect(paidCalls()).toHaveLength(2);
  });
});

describe('oddsService — TTL por proximidade do próximo jogo', () => {
  const seed = (ageHours: number, nextKickoffInHours: number) => {
    store.set('odds_cache_soccer_epl', JSON.stringify({
      data: [event('1', nextKickoffInHours)],
      timestamp: Date.now() - ageHours * H,
    }));
  };

  it('próximo jogo a >12h: cache de 4h ainda vale (TTL 6h) — 0 chamadas', async () => {
    seed(4, 20);
    route({});
    await fetchAllMatches(['soccer_epl']);
    expect(proxy).not.toHaveBeenCalled();
  });

  it('próximo jogo a >12h: cache de 7h expirou (TTL 6h) — atualiza', async () => {
    seed(7, 20);
    route({ events: [event('1', 20)], odds: [event('1', 20)] });
    await fetchAllMatches(['soccer_epl']);
    expect(paidCalls()).toHaveLength(1);
  });

  it('próximo jogo em 5h: mantém TTL de 3h — cache de 4h expirou', async () => {
    seed(4, 5);
    route({ events: [event('1', 5)], odds: [event('1', 5)] });
    await fetchAllMatches(['soccer_epl']);
    expect(paidCalls()).toHaveLength(1);
  });

  it('jogo em <90min: TTL de 30min preservado — cache de 40min expirou', async () => {
    seed(40 / 60, 1);
    route({ events: [event('1', 1)], odds: [event('1', 1)] });
    await fetchAllMatches(['soccer_epl']);
    expect(paidCalls()).toHaveLength(1);
  });
});
