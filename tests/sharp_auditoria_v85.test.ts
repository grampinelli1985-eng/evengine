import { calcCVLambda, calcNJogosEfetivos, pesoTemporalJogo, JogoPonderado } from '../src/services/valueBetService';
import { seedEloFromOdds, getStoredRatings, STORAGE_KEY } from '../src/services/eloService';

describe('Auditoria v8.5 - Confiança de Dados + ELO', () => {

  beforeEach(() => {
    localStorage.clear();
  });

  it('FIX 1: pool composto só de gols sintéticos -> calcCVLambda retorna 999', () => {
    const pool: JogoPonderado[] = [
      { pesoTotal: 1, golsMarcados: 2, fonteSintetica: true },
      { pesoTotal: 1, golsMarcados: 1, fonteSintetica: true },
      { pesoTotal: 1, golsMarcados: 1, fonteSintetica: true },
    ];
    
    const cv = calcCVLambda(pool);
    expect(cv).toBe(999);
  });

  it('FIX 1: pool com gols reais mistos -> calcCVLambda usa apenas os reais no cálculo', () => {
    const pool: JogoPonderado[] = [
      { pesoTotal: 1, golsMarcados: 2, fonteSintetica: true },
      { pesoTotal: 1, golsMarcados: 1, fonteSintetica: true },
      { pesoTotal: 1, golsMarcados: 4, fonteSintetica: false },
      { pesoTotal: 1, golsMarcados: 2, fonteSintetica: false },
    ];
    
    const cv = calcCVLambda(pool);
    
    // média dos reais = (4+2)/2 = 3
    // variância dos reais = ((4-3)^2 + (2-3)^2)/2 = (1+1)/2 = 1
    // CV = sqrt(1)/3 = 1/3 ≈ 0.333333
    
    expect(cv).toBeCloseTo(1/3, 5);
  });

  it('FIX 2: dois jogos idênticos, um recente e um antigo -> nJogosEfetivos pondera o antigo com peso menor', () => {
    const pesoRecente = pesoTemporalJogo(7);   // 7 dias
    const pesoAntigo = pesoTemporalJogo(180);  // 180 dias
    
    expect(pesoRecente).toBeGreaterThan(pesoAntigo);
    
    const pool: JogoPonderado[] = [
      { pesoTotal: pesoRecente, golsMarcados: 2 },
      { pesoTotal: pesoAntigo, golsMarcados: 2 },
    ];
    
    const nJogos = calcNJogosEfetivos(pool);
    expect(nJogos).toBe(pesoRecente + pesoAntigo);
  });

  it('FIX 3: seedEloFromOdds não cria entrada duplicada para aliases de time', () => {
    // Setup initial ratings with base name
    const initialRatings = {
      'Inter': { rating: 1600, matches: 10, lastPlayed: Date.now() },
      'Milan': { rating: 1550, matches: 10, lastPlayed: Date.now() }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialRatings));

    // A match with aliased name 'Inter Milan'
    const match = {
      home_team: 'Inter Milan',
      away_team: 'AC Milan',
      bookmakers: [{
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Inter Milan', price: 2.0 },
            { name: 'Draw', price: 3.2 },
            { name: 'AC Milan', price: 3.5 }
          ]
        }]
      }]
    };

    seedEloFromOdds(match as any);

    const ratings = getStoredRatings();
    
    // It should have resolved 'Inter Milan' to 'Inter' and not created a new key
    expect(ratings['Inter Milan']).toBeUndefined();
    expect(ratings['Inter']).toBeDefined();
    
    // Same for 'AC Milan' -> 'Milan'
    expect(ratings['AC Milan']).toBeUndefined();
    expect(ratings['Milan']).toBeDefined();
  });
});
