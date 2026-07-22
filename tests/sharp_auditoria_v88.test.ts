import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { runTipsterEngine } from '../src/services/tipsterEngine';

describe('Auditoria v8.8 - Decaimento Temporal Real', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Deve calcular peso decaido para jogos reais com data', async () => {
    const agora = Date.now();
    // 2 dias atrás
    const jogoRecente = new Date(agora - 2 * 24 * 60 * 60 * 1000).toISOString();
    // 85 dias atrás
    const jogoAntigo = new Date(agora - 85 * 24 * 60 * 60 * 1000).toISOString();

    const result = await runTipsterEngine({
      analysis: {
        home_team: 'Home',
        away_team: 'Away',
        scouting: {
          home_form: ['V', 'V', 'V', 'V', 'V'],
          away_form: ['V', 'V', 'V', 'V', 'V'],
          h2h: [],
          scout_summary: 'Test',
          home_goals: {
            jogos: [
              { gols_for: 2, gols_against: 0, data: jogoRecente },
              { gols_for: 2, gols_against: 0, data: jogoAntigo }
            ]
          },
          away_goals: {
            jogos: [
              { gols_for: 2, gols_against: 0, data: jogoRecente },
              { gols_for: 2, gols_against: 0, data: jogoAntigo }
            ]
          }
        }
      },
      matchCardValues: { ev: 10, kelly: 1.5, tier: 'B', confianca: 80, convergenciaOk: true },
      bancaTotal: 1000
    });

    expect(result.sharp_context?.nJogosEfetivos).toBeLessThan(4); // peso do antigo < 1, então soma total < 4
  });

  it('2. Jogo com data vazia (fallback) recebe peso neutro (1.0)', async () => {
    const result = await runTipsterEngine({
      analysis: {
        home_team: 'Home',
        away_team: 'Away',
        scouting: {
          home_form: ['V', 'V', 'V', 'V', 'V'],
          away_form: ['V', 'V', 'V', 'V', 'V'],
          h2h: [],
          scout_summary: 'Test',
          home_goals: {
            jogos: [
              { gols_for: 2, gols_against: 0, data: '' },
              { gols_for: 2, gols_against: 0, data: '' }
            ]
          },
          away_goals: {
            jogos: [
              { gols_for: 2, gols_against: 0, data: '' },
              { gols_for: 2, gols_against: 0, data: '' }
            ]
          }
        }
      },
      matchCardValues: { ev: 10, kelly: 1.5, tier: 'B', confianca: 80, convergenciaOk: true },
      bancaTotal: 1000
    });

    expect(result.sharp_context?.nJogosEfetivos).toBeCloseTo(4); // 2 + 2 = 4 (peso 1 cada)
  });

  it('3. fetchGolsRecentes real (mock de rede) retorna jogos com data no formato ISO extraído de fixture.date', async () => {
    // Mock global fetch para simular API-Football funcionando com datas
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/teams/statistics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: { form: 'VVVDD' } })
        });
      }
      if (url.includes('/fixtures/headtohead')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        });
      }
      if (url.includes('/fixtures?team=')) {
        // Simula gols
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: [
              { fixture: { date: '2026-07-20T12:00:00Z' }, teams: { home: { id: 42 }, away: { id: 49 } }, goals: { home: 2, away: 1 } },
              { fixture: { date: '2026-07-10T12:00:00Z' }, teams: { home: { id: 42 }, away: { id: 49 } }, goals: { home: 1, away: 0 } },
              { fixture: { date: '2026-07-01T12:00:00Z' }, teams: { home: { id: 49 }, away: { id: 42 } }, goals: { home: 0, away: 3 } }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { fetchRealScouting } = await import('../src/services/scoutingService');
    const report = await fetchRealScouting('Arsenal', 'Chelsea', 39);

    expect(report.home_goals).toBeDefined();
    expect(report.home_goals?.jogos.length).toBeGreaterThanOrEqual(3);
    expect(report.home_goals?.jogos[0].data).toBe('2026-07-20T12:00:00Z');
    expect(report.home_goals?.jogos[1].data).toBe('2026-07-10T12:00:00Z');
  });
});
