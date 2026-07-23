import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as scoutingService from '../src/services/scoutingService';
import * as telemetryService from '../src/services/telemetryService';
import * as apiQuotaService from '../src/services/apiQuotaService';
import { runTipsterEngine } from '../src/services/tipsterEngine';

// Mock getTeamIdAsync indiretamente via Supabase
vi.mock('../src/services/supabaseClient', () => {
  const fromMock = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null })
  });

  return {
    supabase: {
      from: fromMock,
      rpc: vi.fn().mockImplementation((fnName, args) => {
        if (fnName === 'auto_map_team_name') {
          if (args.team_name && args.team_name.includes('Ajax')) return Promise.resolve({ data: 194, error: null });
          if (args.team_name && args.team_name.includes('Feyenoord')) return Promise.resolve({ data: 197, error: null });
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      })
    }
  };
});

describe('Auditoria v8.13 - Pre-check de Dados (Economia Gemini)', () => {
  let trackPrecheckSkipSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    trackPrecheckSkipSpy = vi.spyOn(telemetryService, 'trackPrecheckSkip').mockImplementation(() => {});
    vi.spyOn(apiQuotaService, 'hasQuota').mockReturnValue(true);

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockApiFootballResponse = (homeCount: number, awayCount: number) => {
    (global.fetch as any).mockImplementation((url: string) => {
      // Mock team id
      if (url.includes('teams/statistics') || url.includes('fixtures?team=')) {
        const teamIdMatch = url.match(/team=(\d+)/);
        const teamId = teamIdMatch ? parseInt(teamIdMatch[1]) : 0;
        
        let count = 0;
        if (teamId === 194) count = homeCount;
        else if (teamId === 197) count = awayCount;

        const fixtures = Array(count).fill({
          fixture: { date: '2026-01-01' },
          teams: { home: { id: teamId }, away: { id: 999 } },
          goals: { home: 1, away: 1 }
        });

        console.log(`[TEST MOCK] fetch url: ${url}, teamId: ${teamId}, count: ${count}`);
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: url.includes('statistics') ? { form: 'WDW'.slice(0, count) } : fixtures
          })
        });
      }

      if (url.includes('headtohead')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ response: [] })
        });
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: [] }) });
    });
  };

  it('1. Ambos com menos de 3 jogos -> precheck falha, pula Gemini', async () => {
    mockApiFootballResponse(2, 1);

    // Mock getTeamIdAsync mapping directly via autoMap to avoid fetch errors
    // Since we can't easily mock inner functions, we rely on the API-Football mock.
    // For team ID mapping, if it fails it returns -1, which results in <3 games.
    
    const res = await scoutingService.fetchRealScouting('TimeA_Unk', 'TimeB_Unk');
    
    expect(trackPrecheckSkipSpy).toHaveBeenCalledWith('Ambos os times sem histórico mínimo na API-Football');
    expect(res.home_goals).toBeUndefined();
    expect(res.away_goals).toBeUndefined();
    expect(res.data_source).toBe('unavailable');
    expect(res.confiavel).toBe(false);
  });

  it('2. Um time com dado suficiente (>=3), outro sem -> precheck passa, fluxo normal (Gemini permitido)', async () => {
    mockApiFootballResponse(3, 1); // Home tem 3, Away tem 1
    
    const res = await scoutingService.fetchRealScouting('Ajax', 'Feyenoord');
    
    // trackPrecheckSkip não deve ser chamado
    expect(trackPrecheckSkipSpy).not.toHaveBeenCalled();
  });

  it('3. Ambos com dado suficiente (>=3) -> precheck passa, fluxo normal', async () => {
    mockApiFootballResponse(5, 4); // Home tem 5, Away tem 4
    
    const res = await scoutingService.fetchRealScouting('Ajax', 'Feyenoord');
    
    expect(trackPrecheckSkipSpy).not.toHaveBeenCalled();
  });

  it('4. Confirmar que caso 1 cai no gate B-DADOS do TipsterEngine', async () => {
    mockApiFootballResponse(1, 1);
    
    const scout = await scoutingService.fetchRealScouting('TimeA_Unk', 'TimeB_Unk');
    
    const engineRes = await runTipsterEngine({
      analysis: {
        scouting: scout,
        matchData: { id: 'test', home_team: 'TimeA_Unk', away_team: 'TimeB_Unk', sport_key: 'soccer_epl' }
      }
    } as any);

    console.log('Motivos de bloqueio:', engineRes.score.motivos_bloqueio);
    expect(engineRes.decisao.status).toBe('BLOQUEADO');
    expect(engineRes.score.motivos_bloqueio.some((m: string) => m.includes('B-DADOS'))).toBe(true);
  });
});
