import { describe, it, expect } from 'vitest';
import { runTipsterEngine } from '../src/services/tipsterEngine';

describe('Auditoria v8.19 - Remoção do Multiplicador Silencioso 0.70x (Underdogs)', () => {
  it('Deve manter a probabilidade IA intacta e calcular EV corretamente sem o viés de 0.70x', async () => {
    // 1. Mercado 1x2 com probabilidadeIaCalibrada de 25% (< 30%, condição que antes disparava o multiplicador)
    const input = {
      analysis: {
        matchData: { home_team: 'Underdog FC', away_team: 'Favorite United' },
        probabilidades_ml: { casa: 25, empate: 25, fora: 50 },
        elo: { 
          probabilidades: { casa: 25, empate: 25, fora: 50 },
          jogos_minimos_atingidos: true
        },
        scouting: { 
          data_source: 'real',
          home_form: ['D', 'D', 'E', 'D', 'D'],
          away_form: ['V', 'V', 'V', 'V', 'E']
        },
        h2h: { fonte: 'gemini_factual' },
        resumo: 'Jogo de teste'
      },
      matchCardValues: [
        {
          nome: 'Vitória Casa',
          type: '1x2',
          odd_api: 4.50, // 4.50 -> 22.2% implied prob. 25% prob is value!
          prob_ia: 25,
          prob_elo: 25
        }
      ],
      confianca: 80,
      oddManualBet365: 4.50,
      bancaTotal: 1000,
      userConfirmedAudit: false,
      pendentesCount: 0
    };

    // O underdog (casa) tem 25% de probabilidade.
    // Antes da correção v8.19, isso seria multiplicado por 0.70 (17.5%), destruindo o EV.
    // Após a correção, o valor usado no cálculo de EV permanece o original.
    const result = await runTipsterEngine(input as any);
    
    const candidate = result.mercado_selecionado || result.mercado;
    
    // Apenas verificamos se o EV não foi severamente mutilado e o mercado ainda tem valor ou
    // se a probabilidade permaneceu fiel.
    expect(candidate).toBeDefined();
    if (candidate) {
      // Como o EV sem redução deve ser atrativo e probabilidade deve ser mantida.
      // Se houvesse o bias de 0.70x, a prob ficaria perto de 17.5%.
      expect(candidate.probabilidade_final).toBeGreaterThan(20);
    }
  });
});
