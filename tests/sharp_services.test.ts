import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Match } from '../src/types';

// Setup storage mocks
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem(key: string) {
    return localStorageStore[key] || null;
  },
  setItem(key: string, value: string) {
    localStorageStore[key] = value.toString();
  },
  clear() {
    for (const key in localStorageStore) {
      delete localStorageStore[key];
    }
  },
  removeItem(key: string) {
    delete localStorageStore[key];
  }
};

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true
});

import {
  registerOpeningOdds,
  detectLineMovement,
  getLineMovement,
  cleanOldLineMovements
} from '../src/services/lineMovementService';

import {
  registrarEntradaCLV,
  capturarOddsFechamento,
  atualizarResultadoCLV,
  getEntradasCLV,
  getCLVSummary
} from '../src/services/clvService';

import {
  analisarEquivalentesAH
} from '../src/services/asianHandicapService';

import { fetchWCMatches } from '../src/services/worldCup/wcOddsService';
import { fetchAllMatches } from '../src/services/oddsService';

describe('Auditoria Sharp Money — Line Movement (Steam Move)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  const mockMatch: Match = {
    id: 'test_match_1',
    home_team: 'Chelsea',
    away_team: 'Arsenal',
    sport_key: 'soccer_epl',
    sport_title: 'Premier League',
    commence_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        last_update: new Date().toISOString(),
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Chelsea', price: 2.00 },
              { name: 'Arsenal', price: 3.50 },
              { name: 'Draw', price: 3.40 }
            ]
          }
        ]
      }
    ]
  };

  it('Deve registrar odds de abertura com sucesso', () => {
    registerOpeningOdds([mockMatch]);
    const lm = getLineMovement('test_match_1');
    expect(lm).toBeDefined();
    expect(lm?.snapshots.length).toBe(1);
    expect(lm?.snapshots[0].home).toBe(2.00);
    expect(lm?.tipo).toBe('ESTAVEL');
  });

  it('Deve classificar queda gradual quando odd cai 3%', () => {
    registerOpeningOdds([mockMatch]);

    const updatedMatch: Match = {
      ...mockMatch,
      bookmakers: [
        {
          key: 'pinnacle',
          title: 'Pinnacle',
          last_update: new Date().toISOString(),
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Chelsea', price: 1.93 }, // Queda de ~3.5%
                { name: 'Arsenal', price: 3.65 },
                { name: 'Draw', price: 3.40 }
              ]
            }
          ]
        }
      ]
    };

    const res = detectLineMovement(updatedMatch);
    expect(res?.tipo).toBe('GRADUAL');
    expect(res?.sharpScore).toBe(55);
  });

  it('Deve detectar Steam Move quando odd cai 5% em curto intervalo', () => {
    registerOpeningOdds([mockMatch]);

    const updatedMatch: Match = {
      ...mockMatch,
      bookmakers: [
        {
          key: 'pinnacle',
          title: 'Pinnacle',
          last_update: new Date().toISOString(),
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Chelsea', price: 1.88 }, // Queda de 6%
                { name: 'Arsenal', price: 3.80 },
                { name: 'Draw', price: 3.50 }
              ]
            }
          ]
        }
      ]
    };

    const res = detectLineMovement(updatedMatch);
    expect(res?.tem_steam).toBe(true);
    expect(res?.tipo).toBe('STEAM_MOVE');
    expect(res?.steam_side).toBe('home');
    expect(res?.sharpScore).toBe(85);
  });
});

describe('Auditoria Sharp Money — CLV (Closing Line Value)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  const commenceTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min atrás ( kick off passado )

  it('Deve registrar entrada CLV e capturar odd de fechamento com sucesso', () => {
    registrarEntradaCLV({
      matchId: 'match_clv_1',
      homeTeam: 'Real Madrid',
      awayTeam: 'Barcelona',
      sportKey: 'soccer_spain_la_liga',
      commenceTime,
      mercado: 'Vitória Real Madrid',
      oddUtilizada: 2.10
    });

    const activeMatches: Match[] = [
      {
        id: 'match_clv_1',
        home_team: 'Real Madrid',
        away_team: 'Barcelona',
        sport_key: 'soccer_spain_la_liga',
        sport_title: 'La Liga',
        commence_time: commenceTime,
        bookmakers: [
          {
            key: 'pinnacle',
            title: 'Pinnacle',
            last_update: new Date().toISOString(),
            markets: [
              {
                key: 'h2h',
                outcomes: [
                  { name: 'Real Madrid', price: 2.00 }, // Odd caiu para 2.00 no kickoff
                  { name: 'Barcelona', price: 3.60 },
                  { name: 'Draw', price: 3.40 }
                ]
              }
            ]
          }
        ]
      }
    ];

    capturarOddsFechamento(activeMatches);

    const entries = getEntradasCLV();
    expect(entries[0].oddFechamento).toBe(2.00);
    expect(entries[0].clvPct).toBe(5.00); // (2.10/2.00 - 1)*100 = 5%
    expect(entries[0].resultado).toBe('PENDENTE');
  });

  it('Deve aplicar o fallback do Line Movement se a janela de captura ativas expirou', () => {
    // 1. Criar dados de Line Movement com snapshots simulando a odd de fechamento
    const openingSnap = { ts: Date.now() - 60 * 60 * 1000, home: 2.10, draw: 3.40, away: 3.50 };
    const kickoffSnap = { ts: Date.now() - 45 * 60 * 1000, home: 1.95, draw: 3.50, away: 3.80 }; // Odd na hora do kickoff (45 min atrás)

    const lmData = {
      match_clv_fallback: {
        matchId: 'match_clv_fallback',
        home_team: 'Bayern',
        away_team: 'Dortmund',
        snapshots: [openingSnap, kickoffSnap],
        variation: { home: -7.14, draw: 2.94, away: 8.57 },
        tem_steam: true,
        steam_side: 'home',
        tipo: 'STEAM_MOVE',
        direcao: 'FAVOR',
        alerta: 'Steam detectado',
        sharpScore: 85
      }
    };
    localStorageMock.setItem('evengine_line_movement', JSON.stringify(lmData));

    // 2. Registrar a entrada CLV
    registrarEntradaCLV({
      matchId: 'match_clv_fallback',
      homeTeam: 'Bayern',
      awayTeam: 'Dortmund',
      sportKey: 'soccer_germany_bundesliga',
      commenceTime: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // Começou há 20 min (janela expirada se não passarmos matches)
      mercado: 'Vitória Bayern',
      oddUtilizada: 2.10
    });

    // 3. Capturar passando array vazio (simula que o jogo já saiu do painel de ativas ou expirou window)
    // Mas a janela KICKOFF_WINDOW_MS = 30min ainda se aplicaria, então forçamos withinWindow = false modificando commenceTime
    const pastCommenceTime = new Date(Date.now() - 45 * 60 * 1000).toISOString(); // Começou há 45 min (> 30 min window)
    
    // Atualizar commenceTime para garantir withinWindow = false
    const entriesList = getEntradasCLV();
    entriesList[0].commenceTime = pastCommenceTime;
    localStorageMock.setItem('evengine_clv_entries', JSON.stringify(entriesList));

    capturarOddsFechamento([]); // Array vazio para forçar o uso do Line Movement fallback

    const updatedEntries = getEntradasCLV();
    expect(updatedEntries[0].oddFechamento).toBe(1.95); // Resgatou o kickoffSnap!
    expect(updatedEntries[0].clvPct).toBeCloseTo(7.69, 2); // (2.10 / 1.95 - 1)*100 = 7.69%
  });

  it('Deve atualizar o status do CLV ao sincronizar com o BetsView', () => {
    registrarEntradaCLV({
      matchId: 'match_clv_3',
      homeTeam: 'Real Madrid',
      awayTeam: 'Barcelona',
      sportKey: 'soccer_spain_la_liga',
      commenceTime,
      mercado: 'Vitória Real Madrid',
      oddUtilizada: 2.10
    });

    atualizarResultadoCLV('match_clv_3', 'GREEN');
    const entries = getEntradasCLV();
    expect(entries[0].resultado).toBe('GREEN');
  });
});

describe('Auditoria Sharp Money — Asian Handicap Overround', () => {
  it('Deve calcular equivalentes e overround corretamente', () => {
    const odds = { home: 1.90, draw: 3.40, away: 4.10 };
    const res = analisarEquivalentesAH('PSG', 'Marseille', odds);

    expect(res.overroundH2H).toBeGreaterThan(0);
    expect(res.equivalentesCasa.length).toBe(4);
    expect(res.melhorMercadoCasa?.overround).toBeLessThanOrEqual(res.overroundH2H);
  });
});

describe('Auditoria Sharp Money — Economia de Créditos (Quota saving)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  it('Deve salvar inatividade do torneio com 12h de cache se a API retornar 404', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve([])
      } as any)
    );

    // Primeira chamada: deve chamar o fetch
    const matches1 = await fetchWCMatches('test_api_key_valid_123', ['soccer_fifa_world_cup']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Segunda chamada: deve usar o cache inativo e não disparar novo fetch
    const matches2 = await fetchWCMatches('test_api_key_valid_123', ['soccer_fifa_world_cup']);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Continua sendo 1
    expect(matches1[0].id).toContain('wc_mock');
    expect(matches2[0].id).toContain('wc_mock');
  });

  it('Deve abortar a busca de todas as ligas (retornando vazio) se a API /sports falhar e não houver cache', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve([])
      } as any)
    );

    const matches = await fetchAllMatches('test_api_key_valid_123');
    // Como a API /sports falhou e não havia cache de esportes ativos anterior,
    // o sistema aborta a busca retornando [] para evitar buscar 9 ligas às cegas
    expect(matches).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Chamou apenas o /sports
  });
});
