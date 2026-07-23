import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFormaRecente } from '../src/services/scoutingService';

vi.mock('../src/services/scoutingService', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getTeamIdAsync: vi.fn().mockResolvedValue(-1), // Simulate API failure
    buscarResultadosRecentes: vi.fn().mockResolvedValue([]), // Simulate Odds API failure
  };
});

describe('Auditoria v8.14: Prevenção de Gemini Search Secundário', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Não deve chamar Gemini Search quando getFormaRecente tem allowGeminiFallback=false', async () => {
    // allowGeminiFallback = false means we just return without calling Gemini.
    const res = await getFormaRecente('Time Desconhecido', 'soccer_brazil_campeonato', 'Brasileirão', -1, false);
    
    // As it was disabled, source should be unavailable
    expect(res.source).toBe('unavailable');
    expect(res.data).toEqual([]);
  });
});
