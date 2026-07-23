import { runTipsterEngine } from '../src/services/tipsterEngine';

describe('Auditoria de Escala do EV (v8.10.2)', () => {
  const getBaseAnalysis = () => ({
    probabilidades_ml: { casa: 46.0, empate: 30.9, fora: 23.1 }, // 46% casa
    elo: {
      jogos_minimos_atingidos: true,
      probabilidades: { casa: 46.0, empate: 30.9, fora: 23.1 }
    },
    valueBet: {
      report: {
        mercados: [
          { market: 'Vitória Casa', type: '1x2', prob_ia: 46.0, odd_api: 2.20, edge: 0.012 }
        ],
        melhor_value: { market: 'Vitória Casa', type: '1x2', prob_ia: 46.0, odd_api: 2.20, edge: 0.012 }
      }
    },
    scouting: {
      home_form: ['V', 'V', 'E', 'V', 'V'],
      away_form: ['D', 'E', 'D', 'D', 'D'],
      desfalques: [],
      away_desfalques: [],
      data_source: 'real'
    },
    h2h: { fonte: 'api_football' },
    ticket: { tipo: 'simples' }
  });

  const getBaseInput = (analysisOverride: any = {}, oddPinnacle: number) => ({
    analysis: { ...getBaseAnalysis(), ...analysisOverride },
    matchCardValues: { tier: 'B', confianca: 80 },
    oddManualBet365: oddPinnacle + 0.05,
    bancaTotal: 1000,
    pendentesCount: 0,
    userConfirmedAudit: false,
    currentLocalTime: new Date().toISOString()
  });

  it('deve produzir um EV correto na escala percentual (ex: 0.84 para 0.84%) no payload final', async () => {
    // Calculando para obter aprox 0.84%: prob=50%, odd=2.0168 -> EV = 0.84%
    const probIA = 50.0;
    const oddApi = 2.0168; // (0.5 * 2.0168 - 1) = 0.0084 = 0.84%
    
    const input = getBaseInput({
      probabilidades_ml: { casa: probIA, empate: 25.0, fora: 25.0 },
      elo: { probabilidades: { casa: probIA, empate: 25.0, fora: 25.0 } },
      valueBet: {
        report: { melhor_value: { market: 'Vitória Casa', type: '1x2', prob_ia: probIA, odd_api: oddApi, edge: 0.0084 } },
        mercados: []
      }
    }, oddApi);
    
    // Injetamos a odd api no mercado 1x2 de vitória casa (mock em tipsterEngine recria candidates)
    // O EV final é calculado como: ((prob_ia / 100) * odd_api - 1) * 100
    // ((50 / 100) * 2.0168 - 1) * 100 = 0.84%
    
    // NOTA: como o tipsterEngine recalcula, garantimos que a saída não multiplicará por 100 de novo
    const result = await runTipsterEngine(input);
    
    // O valor deve estar próximo de 0.8 na escala percentual, e nunca 84.0
    const evCalculado = result.mercado_selecionado?.ev || 0;
    
    expect(evCalculado).toBeLessThan(1.0);
    expect(evCalculado).toBeGreaterThan(0.8);
    // Este valor será passado diretamente ao componente AnalysisDecisionCard
    // Sem a heurística de multiplicar por 100, a UI agora exibirá 0.8% e não 84.0%
  });

  it('deve lidar corretamente com um EV genuinamente alto (ex: 15%)', async () => {
    const probIA = 50.0;
    const oddApi = 2.30; // (0.5 * 2.30 - 1) * 100 = 15.0%
    
    const input = getBaseInput({
      probabilidades_ml: { casa: probIA, empate: 25.0, fora: 25.0 },
      elo: { probabilidades: { casa: probIA, empate: 25.0, fora: 25.0 } },
      valueBet: {
        report: { melhor_value: { market: 'Vitória Casa', type: '1x2', prob_ia: probIA, odd_api: oddApi, edge: 0.15 } },
        mercados: []
      }
    }, oddApi);
    
    const result = await runTipsterEngine(input);
    
    const evCalculado = result.mercado_selecionado?.ev || 0;
    
    expect(evCalculado).toBeGreaterThanOrEqual(14.0);
    expect(evCalculado).toBeLessThanOrEqual(16.0);
  });
});
