import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSession = vi.fn();
vi.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: () => getSession() } } }));

import { submitPlatformOddsKey } from '../oddsKeyAdminService';

const fetchMock = vi.fn();
(globalThis as any).fetch = (...a: any[]) => fetchMock(...a);

const reply = (status: number, body: any) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
});

describe('submitPlatformOddsKey', () => {
  it('sem sessão: NOT_AUTHENTICATED e nenhuma chamada de rede', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await submitPlatformOddsKey('abc')).toEqual({ ok: false, reason: 'NOT_AUTHENTICATED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sucesso: manda a chave aparada com o JWT e devolve a cota restante', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, key_id: 'x', remaining: 480 }));

    expect(await submitPlatformOddsKey('  chave123  ')).toEqual({ ok: true, remaining: 480 });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(JSON.parse(init.body)).toEqual({ apiKey: 'chave123' });
  });

  it.each([
    [422, 'INVALID_KEY'],
    [422, 'OUT_OF_CREDITS'],
    [400, 'INVALID_FORMAT'],
    [403, 'FORBIDDEN'],
  ])('HTTP %i %s vira a razão correspondente', async (status, code) => {
    fetchMock.mockResolvedValue(reply(status, { error: code }));
    expect(await submitPlatformOddsKey('k')).toEqual({ ok: false, reason: code });
  });

  it('erro desconhecido ou falha de rede: ERROR', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: 'STORE_FAILED' }));
    expect(await submitPlatformOddsKey('k')).toEqual({ ok: false, reason: 'ERROR' });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await submitPlatformOddsKey('k')).toEqual({ ok: false, reason: 'ERROR' });
  });
});
