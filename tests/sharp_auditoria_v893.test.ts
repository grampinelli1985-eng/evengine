import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTeamIdAsync, TEAM_NAME_MAP, fetchRealScouting } from '../src/services/scoutingService';
import { GEMINI_MODEL } from '../src/config/ai';
import * as scoutingService from '../src/services/scoutingService';

describe('Auditoria v8.9.3 - Times Não Mapeados + Label de Modelo', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Mock global fetch para simular sucesso na API-Football
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/teams/statistics')) {
        return {
          ok: true,
          json: async () => ({
            response: { form: 'WWWWW' }
          }),
          clone: function() { return this; }
        };
      }
      if (url.includes('/fixtures')) {
        return {
          ok: true,
          json: async () => ({
            response: []
          }),
          clone: function() { return this; }
        };
      }
      return { ok: true, json: async () => ({}) };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. Bragantino-SP deve ser resolvido para o ID correto 2376', async () => {
    expect(TEAM_NAME_MAP['Bragantino-SP']).toBe(2376);
    const id = await getTeamIdAsync('Bragantino-SP');
    expect(id).toBe(2376);
  });

  it('2. Model label está correto', () => {
    expect(GEMINI_MODEL).toBe('gemini-3.5-flash');
  });

  it('3. Nenhuma chamada ao Gemini Search é disparada para times presentes no mapa', async () => {
    const spyGemini = vi.spyOn(scoutingService, 'fetchFormaRecenteViaGeminiSearch');
    
    // Bragantino-SP está no mapa (ID 2376), logo deve tentar API-Football e ter sucesso
    await fetchRealScouting('Bragantino-SP', 'Corinthians', 71, 'soccer_brazil_campeonato');
    
    // Confirma que não tentou o fallback do Gemini
    expect(spyGemini).not.toHaveBeenCalled();
  });
});

