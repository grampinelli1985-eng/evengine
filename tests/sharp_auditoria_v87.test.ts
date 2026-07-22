import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchRealScouting } from '../src/services/scoutingService';
import { runTipsterEngine } from '../src/services/tipsterEngine';

describe('Auditoria v8.7 - Hotfix B-DADOS Gols (Scouting)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Deve extrair home_goals e away_goals da API-Football quando disponível e não ser bloqueado por Lambda', async () => {
    // Mock global fetch para simular API-Football funcionando
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
              { fixture: { date: '2026-07-20T00:00:00Z' }, teams: { home: { id: 42 }, away: { id: 49 } }, goals: { home: 2, away: 1 } },
              { fixture: { date: '2026-07-10T00:00:00Z' }, teams: { home: { id: 42 }, away: { id: 49 } }, goals: { home: 1, away: 0 } },
              { fixture: { date: '2026-07-01T00:00:00Z' }, teams: { home: { id: 49 }, away: { id: 42 } }, goals: { home: 0, away: 3 } },
              { fixture: { date: '2026-06-20T00:00:00Z' }, teams: { home: { id: 42 }, away: { id: 49 } }, goals: { home: 1, away: 1 } },
              { fixture: { date: '2026-06-10T00:00:00Z' }, teams: { home: { id: 42 }, away: { id: 49 } }, goals: { home: 2, away: 0 } }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const report = await fetchRealScouting('Arsenal', 'Chelsea', 39);

    expect(report.home_goals).toBeDefined();
    expect(report.home_goals?.jogos.length).toBeGreaterThanOrEqual(3);
    
    // Tenta rodar o engine, ele deve ser aprovado (assumindo que o resto passa)
    const engineResult = await runTipsterEngine({
      analysis: { scouting: report },
      matchCardValues: { ev: 10, kelly: 1.5, tier: 'B', confianca: 80, convergenciaOk: true },
      bancaTotal: 1000
    });
    
    // O bloqueio não deve ser o 'B-DADOS: Lambda instável' se ev = 10, etc
    // Como os dados são sintéticos e ev = 10, ele não deve ser bloqueado por Lambda > 1.05 se for fonte real
    expect(engineResult.bloqueio?.codigo).not.toBe('B-DADOS');
  });

  it('2. Deve usar fallback do The Odds API caso API-Football falhe e retornar gols reais', async () => {
    // API-Football falha no fetch de fixtures (gols)
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/fixtures?team=')) {
        return Promise.resolve({ ok: false }); // falha
      }
      if (url.includes('/sports/soccer_epl/scores')) {
        // Fallback Odds API
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { completed: true, home_team: 'Arsenal', away_team: 'Liverpool', scores: [{ name: 'Arsenal', score: '2' }, { name: 'Liverpool', score: '1' }] },
            { completed: true, home_team: 'Arsenal', away_team: 'Man City', scores: [{ name: 'Arsenal', score: '1' }, { name: 'Man City', score: '0' }] },
            { completed: true, home_team: 'Spurs', away_team: 'Arsenal', scores: [{ name: 'Spurs', score: '0' }, { name: 'Arsenal', score: '3' }] },
          ])
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: {} }) });
    });

    // Simula a chamada (sportKey = soccer_epl é necessário para the odds api)
    const report = await fetchRealScouting('Arsenal', 'Chelsea', 39, 'soccer_epl');
    
    expect(report.home_goals).toBeDefined();
    expect(report.home_goals?.jogos).toEqual([
      { gols_for: 2, gols_against: 1, data: '' },
      { gols_for: 1, gols_against: 0, data: '' },
      { gols_for: 3, gols_against: 0, data: '' }
    ]);
  });

  it('3. Quando nenhuma fonte tem gols, deve retornar undefined (causando lambda sintético)', async () => {
    // Ambas falham
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({ ok: false }));
    
    const report = await fetchRealScouting('Arsenal', 'Chelsea', 39, 'soccer_epl');
    
    expect(report.home_goals).toBeUndefined();
    expect(report.away_goals).toBeUndefined();
  });
});
