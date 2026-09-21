import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  getDueTrackedMatches,
  hasPendingLiveMatches,
  onApiError,
  __resetLiveTrackerState,
  type ApiErrorType,
} from '../liveTrackerService';

const started = () => new Date(Date.now() - 60 * 60 * 1000).toISOString(); // começou há 1h

const scoresBody = (home: string, away: string, completed: boolean) => [
  { home_team: home, away_team: away, completed, scores: [{ name: home, score: '2' }, { name: away, score: '1' }] },
];
const ok = (body: any) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  proxy.mockReset();
  store.clear();
  __resetLiveTrackerState();
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

describe('liveTracker — janela de consulta (jogos antigos / não resolvíveis)', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

  it('jogo na janela ativa (<=3h) é consultado a cada ciclo', async () => {
    registerMatchForTracking('m1', 'Sport', 'Avai', hoursAgo(2), 'soccer_brazil_serie_b');
    proxy.mockResolvedValue(ok([])); // nunca casa

    await pollLiveResults();
    await pollLiveResults();

    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it('jogo passado de 3h sem resultado: 1 consulta e depois silêncio por 3h', async () => {
    registerMatchForTracking('m1', 'Sport', 'Avai', hoursAgo(5), 'soccer_brazil_serie_b');
    proxy.mockResolvedValue(ok([]));

    await pollLiveResults(); // primeira: nunca foi checado
    expect(proxy).toHaveBeenCalledTimes(1);

    await pollLiveResults(); // ciclos seguintes (10min depois): throttled
    await pollLiveResults();
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it('jogo passado de 3h volta a ser consultado após 3h', async () => {
    registerMatchForTracking('m1', 'Sport', 'Avai', hoursAgo(5), 'soccer_brazil_serie_b');
    proxy.mockResolvedValue(ok([]));
    await pollLiveResults();

    const now = Date.now() + 3 * 60 * 60 * 1000 + 1000;
    expect(getDueTrackedMatches(now).map(m => m.matchId)).toEqual(['m1']);
    expect(getDueTrackedMatches(now - 60 * 60 * 1000)).toEqual([]);
  });

  it('jogo com mais de 48h nunca é consultado (a API não devolve)', () => {
    registerMatchForTracking('m1', 'Sport', 'Avai', hoursAgo(30), 'soccer_brazil_serie_b');
    expect(getDueTrackedMatches().length).toBe(1); // 30h: ainda dentro das 48h
    expect(getDueTrackedMatches(Date.now() + 20 * 60 * 60 * 1000)).toEqual([]); // 50h
  });

  it('jogo que ainda não começou (>5min) não é consultado', async () => {
    registerMatchForTracking('m1', 'Sport', 'Avai', new Date(Date.now() + 60 * 60 * 1000).toISOString(), 'soccer_epl');
    await pollLiveResults();
    expect(proxy).not.toHaveBeenCalled();
    expect(hasPendingLiveMatches()).toBe(false);
  });
});

describe('liveTracker — aviso quando o /scores falha (apostas sem resolução automática)', () => {
  const quotaBody = { message: 'Usage quota has been reached.', error_code: 'OUT_OF_USAGE_CREDITS' };
  const status = (code: number, body?: unknown) => new Response(body ? JSON.stringify(body) : '{}', { status: code });

  let emitted: ApiErrorType[];
  let unsubscribe: () => void;
  beforeEach(() => {
    emitted = [];
    unsubscribe = onApiError(e => emitted.push(e));
  });
  afterEach(() => unsubscribe());

  const track = () => registerMatchForTracking('m1', 'Arsenal', 'Chelsea', started(), 'soccer_epl');

  it('401 OUT_OF_USAGE_CREDITS: avisa "créditos acabaram" com HTTP 401', async () => {
    track();
    proxy.mockResolvedValue(status(401, quotaBody));

    await pollLiveResults();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ kind: 'scores_unavailable', statusCode: 401 });
    expect(emitted[0]!.detail).toContain('créditos');
  });

  it('401 sem error_code de cota: avisa chave inválida, não créditos', async () => {
    track();
    proxy.mockResolvedValue(status(401, { message: 'Invalid key' }));

    await pollLiveResults();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.detail).toContain('chave');
    expect(emitted[0]!.detail).not.toContain('créditos');
  });

  it('429: avisa limite excedido', async () => {
    track();
    proxy.mockResolvedValue(status(429));

    await pollLiveResults();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ kind: 'scores_unavailable', statusCode: 429 });
  });

  it('não repete o aviso a cada ciclo de 10 min (usuário que fechou o banner não o vê voltar)', async () => {
    track();
    proxy.mockResolvedValue(status(401, quotaBody));

    await pollLiveResults();
    await pollLiveResults();
    await pollLiveResults();

    expect(emitted.filter(Boolean)).toHaveLength(1);
  });

  it('volta a avisar depois que o /scores se recupera e falha de novo', async () => {
    track();
    proxy.mockResolvedValueOnce(status(401, quotaBody));
    await pollLiveResults();

    proxy.mockResolvedValueOnce(ok([])); // recuperou (jogo ainda em andamento, sem placar)
    await pollLiveResults();

    proxy.mockResolvedValueOnce(status(401, quotaBody));
    await pollLiveResults();

    expect(emitted.filter(e => e?.kind === 'scores_unavailable')).toHaveLength(2);
  });

  it('falha de chave/créditos não carimba o jogo como consultado (não segura a retentativa)', async () => {
    registerMatchForTracking('m1', 'Sport', 'Avai', new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), 'soccer_brazil_serie_b');
    proxy.mockResolvedValue(status(401, quotaBody));

    await pollLiveResults();
    await pollLiveResults(); // sem carimbo: jogo de 5h continua elegível no ciclo seguinte

    expect(proxy).toHaveBeenCalledTimes(2);
    expect(getPendingTrackedMatches()[0].lastCheckedAt).toBeUndefined();
  });

  it('sem falha nenhuma, nenhum aviso é emitido', async () => {
    track();
    proxy.mockResolvedValue(ok(scoresBody('Arsenal', 'Chelsea', true)));

    await pollLiveResults();

    expect(emitted.filter(e => e?.kind === 'scores_unavailable')).toHaveLength(0);
  });
});
