import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const sessionStorageStore: Record<string, string> = {};
const sessionStorageMock = {
  getItem(key: string) {
    return sessionStorageStore[key] || null;
  },
  setItem(key: string, value: string) {
    sessionStorageStore[key] = value.toString();
  },
  clear() {
    for (const key in sessionStorageStore) {
      delete sessionStorageStore[key];
    }
  },
  removeItem(key: string) {
    delete sessionStorageStore[key];
  }
};

Object.defineProperty(global, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true
});

// Setup global fetch mock
const fetchMock = vi.fn();
Object.defineProperty(global, 'fetch', {
  value: fetchMock,
  writable: true
});

// Setup environment variables before imports
vi.stubEnv('VITE_ODDS_API_KEY', 'mocked_odds_api_key');

// Import the calibrationService. Note: Import after defining mocks so it reads them.
import {
  registrarPrevisao,
  resolverPrevisoesPendentes,
  getCalibracaoStats
} from '../src/services/calibrationService';

describe('Auditoria Sharp Money - Ponto 3: Filtro de Liga + Cache TTL', () => {

  beforeEach(() => {
    localStorageMock.clear();
    sessionStorageMock.clear();
    fetchMock.mockReset();
    vi.clearAllMocks();
  });

  it('Gate 1: Skip total (zero requisições) se a liga do jogo não for monitorada', async () => {
    // 1. Configure monitored leagues to only be Premier League
    localStorageMock.setItem('evengine_selected_leagues', JSON.stringify(['soccer_epl']));

    // 2. Register a pending prediction of an unmonitored league (e.g., soccer_italy_serie_a)
    // The commence time is set to 3 hours ago to make sure it is considered pending
    const commenceTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    registrarPrevisao({
      matchId: 'match_unmonitored',
      homeTeam: 'Juventus',
      awayTeam: 'Milan',
      commenceTime,
      mercadoPrevisto: 'Vitória Casa',
      resultadoPrevisto: 'Home',
      confiancaEstimada: 75,
      evEstimado: 12.5,
      oddUtilizada: 2.1,
      scoreGate: 2.5,
      sportKey: 'soccer_italy_serie_a'
    });

    // 3. Resolve pending predictions
    await resolverPrevisoesPendentes();

    // 4. Verify fetch was never called (zero requests)
    expect(fetchMock).not.toHaveBeenCalled();

    // 5. Verify the prediction remains PENDENTE
    const stats = getCalibracaoStats();
    const prev = stats.previsoes.find(p => p.id === 'match_unmonitored');
    expect(prev).toBeDefined();
    expect(prev?.status).toBe('PENDENTE');
  });

  it('Gate 1 & 3: Deve chamar a API com a URL correta se a liga for monitorada', async () => {
    // 1. Configure monitored leagues to include soccer_italy_serie_a (verifying corrected Serie A key)
    localStorageMock.setItem('evengine_selected_leagues', JSON.stringify(['soccer_italy_serie_a']));

    // 2. Mock a successful API response from Odds API scores endpoint
    const mockGames = [
      {
        id: 'match_monitored',
        home_team: 'Juventus',
        away_team: 'Milan',
        completed: true,
        scores: [
          { name: 'Juventus', score: '2' },
          { name: 'Milan', score: '1' }
        ]
      }
    ];

    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockGames
    });

    // 3. Register prediction
    const commenceTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    registrarPrevisao({
      matchId: 'match_monitored',
      homeTeam: 'Juventus',
      awayTeam: 'Milan',
      commenceTime,
      mercadoPrevisto: 'Vitória Casa',
      resultadoPrevisto: 'Home',
      confiancaEstimada: 75,
      evEstimado: 12.5,
      oddUtilizada: 2.1,
      scoreGate: 2.5,
      sportKey: 'soccer_italy_serie_a'
    });

    // 4. Resolve
    await resolverPrevisoesPendentes();

    // 5. Verify fetch was called with correct sport key and correct URL
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('/sports/soccer_italy_serie_a/scores/');
    
    // Ensure the old mismatched key is NOT used
    expect(calledUrl).not.toContain('/sports/soccer_serie_a/scores/');

    // 6. Verify prediction status is updated to WIN
    const stats = getCalibracaoStats();
    const prev = stats.previsoes.find(p => p.id === 'match_monitored');
    expect(prev).toBeDefined();
    expect(prev?.status).toBe('WIN');
    expect(prev?.resultadoReal).toBe('Home');
  });

  it('Gate 2: Cache hit (zero requisições adicionais) se houver cache válido no localStorage', async () => {
    // 1. Configure monitored leagues
    localStorageMock.setItem('evengine_selected_leagues', JSON.stringify(['soccer_epl']));

    // 2. Populate localStorage with a valid cache (TTL is 30 mins, so set timestamp to 5 minutes ago)
    const mockGames = [
      {
        id: 'match_cached',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        completed: true,
        scores: [
          { name: 'Arsenal', score: '1' },
          { name: 'Chelsea', score: '1' }
        ]
      }
    ];

    localStorageMock.setItem(
      'scores_cache_soccer_epl',
      JSON.stringify({
        data: mockGames,
        timestamp: Date.now() - 5 * 60 * 1000 // 5 mins ago
      })
    );

    // 3. Register prediction
    const commenceTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    registrarPrevisao({
      matchId: 'match_cached',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      commenceTime,
      mercadoPrevisto: 'Empate',
      resultadoPrevisto: 'Draw',
      confiancaEstimada: 65,
      evEstimado: 8.0,
      oddUtilizada: 3.4,
      scoreGate: 1.5,
      sportKey: 'soccer_epl'
    });

    // 4. Resolve
    await resolverPrevisoesPendentes();

    // 5. Verify fetch was NEVER called due to cache hit
    expect(fetchMock).not.toHaveBeenCalled();

    // 6. Verify status resolves correctly using cached data
    const stats = getCalibracaoStats();
    const prev = stats.previsoes.find(p => p.id === 'match_cached');
    expect(prev).toBeDefined();
    expect(prev?.status).toBe('WIN'); // draw predicted, draw occurred
  });

  it('Gate 2 Cache Miss: Busca na API e atualiza o cache no localStorage', async () => {
    // 1. Configure monitored leagues
    localStorageMock.setItem('evengine_selected_leagues', JSON.stringify(['soccer_epl']));

    // 2. Mock API call
    const mockGames = [
      {
        id: 'match_miss',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        completed: true,
        scores: [
          { name: 'Arsenal', score: '0' },
          { name: 'Chelsea', score: '2' }
        ]
      }
    ];

    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockGames
    });

    // 3. Register prediction
    const commenceTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    registrarPrevisao({
      matchId: 'match_miss',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      commenceTime,
      mercadoPrevisto: 'Vitória Fora',
      resultadoPrevisto: 'Away',
      confiancaEstimada: 65,
      evEstimado: 8.0,
      oddUtilizada: 3.4,
      scoreGate: 1.5,
      sportKey: 'soccer_epl'
    });

    // 4. Resolve
    await resolverPrevisoesPendentes();

    // 5. Verify fetch was called once
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 6. Verify localStorage now contains cached data
    const cachedRaw = localStorageMock.getItem('scores_cache_soccer_epl');
    expect(cachedRaw).not.toBeNull();
    const cached = JSON.parse(cachedRaw!);
    expect(cached.data).toEqual(mockGames);
    expect(Date.now() - cached.timestamp).toBeLessThan(10000); // Created just now
  });

});
