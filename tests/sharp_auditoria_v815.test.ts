import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoUpdateEloFromResults } from '../src/services/eloUpdateService';
import * as eloService from '../src/services/eloService';

const mockAtualizarEloPartida = vi.fn();

vi.mock('../src/services/eloService', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    atualizarEloPartida: (...args) => mockAtualizarEloPartida(...args),
  };
});

describe('Auditoria v8.15: Consistência do ELO e Resolução de Alias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Verifica se autoUpdateEloFromResults repassa corretamente os nomes e o serviço base resolve', async () => {
    // We mock fetch internally to simulate a response with unresolved names
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: [
          {
            fixture: { id: 9999, status: { short: 'FT' } },
            teams: {
              home: { name: 'Korea Republic' },
              away: { name: 'USA' }
            },
            goals: { home: 2, away: 1 }
          }
        ]
      })
    }) as any;

    // Reset processed IDs
    localStorage.removeItem('evengine_elo_processed_wc');

    const report = await autoUpdateEloFromResults(true);

    // We expect updating with South Korea and United States,
    // since we'll refactor autoUpdateEloFromResults to pass canonHome and canonAway directly
    expect(mockAtualizarEloPartida).toHaveBeenCalledWith('South Korea', 'United States', '1', 'copa');

    expect(report.updatedCount).toBe(1);
  });
});
