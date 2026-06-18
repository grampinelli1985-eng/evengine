import { runTipsterEngine } from '../src/services/tipsterEngine.js';

const baseInput = {
  analysis: {
    valueBet: {
      report: {
        melhor_value: {
          market: 'Vitória Casa',
          odd_api: 2.00,
          prob_ia: 65,
          edge: 0.30
        }
      }
    },
    odds: {
      atual: 2.00
    },
    elo: {
      probabilidades: {
        casa: 50
      }
    },
    scouting: {
      data_source: 'api-football',
      desfalques: [],
      away_desfalques: [],
      home_form: ['V', 'V', 'E', 'D', 'V'],
      away_form: ['D', 'D', 'E', 'V', 'D']
    },
    h2h: {
      fonte: 'api-football'
    },
    lineMovement: {
      tipo: 'ESTAVEL'
    }
  },
  matchCardValues: {
    ev: 30.0,
    kelly: 8.0,
    tier: 'A',
    confianca: 90,
    convergenciaOk: true
  },
  oddManualBet365: null,
  bancaTotal: 1000
};

const input = {
  ...baseInput,
  analysis: {
    ...baseInput.analysis,
    scouting: {
      data_source: 'unavailable',
      desfalques: [],
      away_desfalques: [],
      home_form: [],
      away_form: []
    }
  }
};

const result = await runTipsterEngine(input);
console.log('RESULT STATUS:', result.status);
console.log('RESULT BLOQUEIO:', result.bloqueio);
console.log('SHARP CONTEXT:', result.sharp_context);
