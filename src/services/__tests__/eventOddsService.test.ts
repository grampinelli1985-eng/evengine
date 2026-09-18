import { describe, it, expect, vi, beforeEach } from 'vitest';

const proxy = vi.fn();
vi.mock('../oddsProxyClient', () => ({ fetchViaOddsProxy: (...a: any[]) => proxy(...a) }));

import {
  fetchEventMarkets,
  mergeEventMarkets,
  __resetEventOddsCache,
} from '../eventOddsService';
import { calcularValueBets } from '../valueBetService';
import type { Match } from '../../types';

const future = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();

const baseMatch = (over: Partial<Match> = {}): Match => ({
  id: 'evt1',
  sport_key: 'soccer_epl',
  sport_title: 'EPL',
  commence_time: future(),
  home_team: 'Tottenham Hotspur',
  away_team: 'Aston Villa',
  bookmakers: [
    {
      key: 'pinnacle',
      title: 'Pinnacle',
      last_update: '',
      markets: [{ key: 'h2h', last_update: '', outcomes: [{ name: 'Tottenham Hotspur', price: 1.7 }] }],
    },
  ],
  ...over,
});

// Resposta real (validada ao vivo na Odds API) do endpoint por evento.
const liveBody = {
  id: 'evt1',
  bookmakers: [
    {
      key: 'pinnacle',
      title: 'Pinnacle',
      markets: [
        { key: 'btts', last_update: 'x', outcomes: [{ name: 'Yes', price: 1.65 }, { name: 'No', price: 2.32 }] },
        {
          key: 'draw_no_bet',
          last_update: 'x',
          outcomes: [{ name: 'Aston Villa', price: 2.74 }, { name: 'Tottenham Hotspur', price: 1.49 }],
        },
      ],
    },
  ],
};

const ok = (body: any) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'x-requests-remaining': '498' } });

beforeEach(() => {
  proxy.mockReset();
  __resetEventOddsCache();
  try { localStorage.clear(); } catch {}
});

describe('eventOddsService', () => {
  it('calls the per-event endpoint (not the bulk one) with btts,draw_no_bet', async () => {
    proxy.mockResolvedValue(ok(liveBody));
    await fetchEventMarkets(baseMatch());
    const path = proxy.mock.calls[0][0] as string;
    expect(path).toContain('/sports/soccer_epl/events/evt1/odds');
    expect(path).toContain('markets=btts,draw_no_bet');
  });

  it('merges btts and draw_no_bet into the matching bookmaker without mutating the input', async () => {
    proxy.mockResolvedValue(ok(liveBody));
    const match = baseMatch();
    await fetchEventMarkets(match);
    const merged = mergeEventMarkets(match);

    const keys = merged.bookmakers[0].markets.map(m => m.key);
    expect(keys).toEqual(['h2h', 'btts', 'draw_no_bet']);
    expect(match.bookmakers[0].markets.map(m => m.key)).toEqual(['h2h']); // original intacto
  });

  it('does not refetch while the cache is fresh (credit protection)', async () => {
    proxy.mockResolvedValue(ok(liveBody));
    const match = baseMatch();
    await fetchEventMarkets(match);
    await fetchEventMarkets(match);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent fetches for the same event', async () => {
    proxy.mockResolvedValue(ok(liveBody));
    const match = baseMatch();
    await Promise.all([fetchEventMarkets(match), fetchEventMarkets(match)]);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it('negative-caches an event with no btts/dnb so it does not burn credits again', async () => {
    proxy.mockResolvedValue(ok({ id: 'evt1', bookmakers: [] }));
    const match = baseMatch();
    await fetchEventMarkets(match);
    await fetchEventMarkets(match);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(mergeEventMarkets(match)).toBe(match);
  });

  it('negative-caches 422/404', async () => {
    proxy.mockResolvedValue(new Response('{}', { status: 422 }));
    const match = baseMatch();
    await fetchEventMarkets(match);
    await fetchEventMarkets(match);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it('does not cache quota/auth errors and never throws', async () => {
    proxy.mockResolvedValue(new Response('{}', { status: 429 }));
    const match = baseMatch();
    await expect(fetchEventMarkets(match)).resolves.toBeUndefined();
    await fetchEventMarkets(match);
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(mergeEventMarkets(match)).toBe(match);
  });

  it('never throws on network failure', async () => {
    proxy.mockRejectedValue(new Error('offline'));
    await expect(fetchEventMarkets(baseMatch())).resolves.toBeUndefined();
  });

  it('skips mock, already-started and id-less matches (no API call)', async () => {
    await fetchEventMarkets(baseMatch({ _isMockData: true }));
    await fetchEventMarkets(baseMatch({ commence_time: new Date(Date.now() - 60_000).toISOString() }));
    await fetchEventMarkets(baseMatch({ id: '' }));
    expect(proxy).not.toHaveBeenCalled();
  });

  it('does not duplicate a market the bookmaker already has', async () => {
    proxy.mockResolvedValue(ok(liveBody));
    const match = baseMatch();
    match.bookmakers[0].markets.push({ key: 'btts', last_update: '', outcomes: [{ name: 'Yes', price: 9 }] });
    await fetchEventMarkets(match);
    const merged = mergeEventMarkets(match);
    expect(merged.bookmakers[0].markets.filter(m => m.key === 'btts')).toHaveLength(1);
    expect(merged.bookmakers[0].markets.find(m => m.key === 'btts')!.outcomes[0].price).toBe(9);
  });

  it('mergeEventMarkets is a safe no-op for null/undefined', () => {
    expect(mergeEventMarkets(undefined)).toBeUndefined();
    expect(mergeEventMarkets(null)).toBeNull();
  });

  describe('integração com calcularValueBets', () => {
    const analysis: any = {
      probabilidades_ml: { casa: 55, empate: 22, fora: 23 },
      gols: { over25: { probabilidade: 55 } },
      poisson: { btts_prob: 62 },
    };
    const withH2H = (): Match => {
      const m = baseMatch();
      m.bookmakers[0].markets = [
        {
          key: 'h2h',
          last_update: '',
          outcomes: [
            { name: 'Tottenham Hotspur', price: 1.7 },
            { name: 'Draw', price: 4.0 },
            { name: 'Aston Villa', price: 4.6 },
          ],
        },
      ];
      return m;
    };

    it('sem fetch: BTTS não aparece e DNB usa odd estimada', () => {
      const r = calcularValueBets(withH2H(), analysis);
      expect(r.mercados.find(x => x.market === 'Ambas Marcam (Sim)')).toBeUndefined();
      expect(r.mercados.find(x => x.market === 'Empate Anula - Casa')!.odd_is_estimated).toBe(true);
    });

    it('com fetch: BTTS usa a odd real (1.65) e DNB usa a odd real (1.49), não estimadas', async () => {
      proxy.mockResolvedValue(ok(liveBody));
      const match = withH2H();
      await fetchEventMarkets(match);
      const r = calcularValueBets(match, analysis);

      const btts = r.mercados.find(x => x.market === 'Ambas Marcam (Sim)')!;
      expect(btts.odd_api).toBe(1.65);
      expect(btts.odd_is_estimated).toBe(false);

      const dnbCasa = r.mercados.find(x => x.market === 'Empate Anula - Casa')!;
      expect(dnbCasa.odd_api).toBe(1.49);
      expect(dnbCasa.odd_is_estimated).toBe(false);
      const dnbFora = r.mercados.find(x => x.market === 'Empate Anula - Fora')!;
      expect(dnbFora.odd_api).toBe(2.74);
    });
  });
});
