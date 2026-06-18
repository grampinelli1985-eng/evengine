
import { extractMarketReference } from './services/valueBetService';

// Redefinindo os mocks localmente para o teste
const MOCK_MATCHES = [
  {
    id: 'mock_match_1',
    sport_key: 'soccer_epl',
    home_team: 'Manchester City',
    away_team: 'Arsenal',
    bookmakers: [
      {
        key: 'pinnacle',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Manchester City', price: 2.45 },
              { name: 'Arsenal', price: 3.00 },
              { name: 'Draw', price: 3.45 }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'mock_match_2',
    sport_key: 'soccer_spain_la_liga',
    home_team: 'Real Madrid',
    away_team: 'Espanyol',
    bookmakers: [
      {
        key: 'pinnacle',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Real Madrid', price: 1.24 },
              { name: 'Espanyol', price: 13.50 },
              { name: 'Draw', price: 6.30 }
            ]
          }
        ]
      }
    ]
  }
];

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('❌ FAILED: ' + message);
    process.exit(1);
  }
}

function runTests() {
  console.log('=== RODANDO TESTES UNITÁRIOS MOCKS FASE 1B ===');

  MOCK_MATCHES.forEach((mock, index) => {
    console.log(`\nTestando Mock ${index + 1}: ${mock.home_team} vs ${mock.away_team}`);
    const ref = extractMarketReference(mock);
    
    assert(ref.hasReference === true, 'Deve ter referência sharp');
    assert(ref.sharpBookmaker === 'pinnacle', 'Bookmaker deve ser pinnacle');
    
    // Validar soma das fairProbs (deve ser 1.0)
    const sumProbs = ref.fairProbs.reduce((s, p) => s + p, 0);
    assert(Math.abs(sumProbs - 1.0) < 0.0001, `Soma das probabilidades deve ser 1.0 (atual: ${sumProbs})`);
    
    // Validar overround/vig
    console.log(`Vig detectado: ${ref.overround.toFixed(2)}%`);
    assert(ref.overround > 2.0, `Vig muito baixo: ${ref.overround.toFixed(2)}%`);
    assert(ref.overround < 6.0, `Vig muito alto: ${ref.overround.toFixed(2)}%`);
    
    console.log(`✓ Mock ${index + 1} validado com sucesso.`);
  });

  console.log('\n=== TODOS OS TESTES PASSARAM ===');
}

runTests();
