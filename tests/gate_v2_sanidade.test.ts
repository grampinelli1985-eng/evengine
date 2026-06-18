import { describe, it, expect, vi } from 'vitest';
import { checkOddsSanity, runTipsterEngine } from '../src/services/tipsterEngine';

vi.mock('../src/services/geminiService', () => {
  return {
    callGeminiAPI: vi.fn().mockResolvedValue(JSON.stringify({
      status: 'APROVADO',
      score: 85,
      stake: { percentual: 2 },
      mercado_selecionado: {
        nome: 'Vitória Casa',
        probabilidade_final: 65,
        odd_referencia: 2.00,
        break_even_odd: 1.54,
        odd_bet365_publica: 2.00,
        selecionado: true
      },
      todos_mercados: []
    }))
  };
});

describe('BLOCO 5 — SANIDADE DE ODDS E MAPEAMENTO', () => {

  const baseAnalysis = {
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
      ranking: {
        home_ranking: 1600,
        away_ranking: 1400
      }
    },
    scouting: {
      home_form: ['V', 'V', 'E', 'D', 'V'],
      away_form: ['D', 'D', 'E', 'V', 'D']
    }
  };

  const baseInput = {
    analysis: baseAnalysis,
    matchCardValues: {
      ev: 30.0,
      kelly: 4.0,
      tier: 'A',
      confianca: 90,
      convergenciaOk: true
    },
    oddManualBet365: 2.00,
    bancaTotal: 1000
  };

  describe('Unidade: checkOddsSanity', () => {

    it('ODD_IMPLAUSIVEL - Over 0.5 gols com odd 2.00 deve falhar no Passo 1', () => {
      const chosenCandidate = {
        nome: 'Over 0.5 gols',
        type: 'goals',
        odd_api: 1.05
      };

      const result = checkOddsSanity(
        { ...baseAnalysis, odds: { retry_odd: 2.10 } }, // retry also invalid
        chosenCandidate,
        2.00 // bet365 odd
      );

      expect(result.passo1_limite).toBe('ODD_IMPLAUSIVEL');
      expect(result.desvio_valido).toBe(false);
      expect(result.mapeamento_status).toBe('FALHOU');
      expect(result.erro_tipo).toBe('ODD_IMPLAUSIVEL');
      expect(result.observacao).toContain('incompatível com mercado Over 0.5 gols');
    });

    it('COMPARACAO_INVERTIDA - Mapeamento com inversão Over vs Under ou Casa vs Fora', () => {
      const chosenCandidate = {
        nome: 'Over 2.5 gols',
        type: 'goals',
        odd_api: 1.80
      };

      // Mismatch specified in odds.bet365_market_name
      const analysisMismatched = {
        ...baseAnalysis,
        odds: {
          bet365_market_name: 'Under 2.5 gols'
        }
      };

      const result = checkOddsSanity(
        analysisMismatched,
        chosenCandidate,
        1.90
      );

      expect(result.passo2_simetria).toBe('COMPARACAO_INVERTIDA');
      expect(result.desvio_valido).toBe(false);
      expect(result.mapeamento_status).toBe('FALHOU');
      expect(result.erro_tipo).toBe('COMPARACAO_INVERTIDA');
    });

    it('DESVIO_IMPLAUSIVEL com RETRY CORRIGIDO - Desvio excessivo corrigido por backup_odd', () => {
      const chosenCandidate = {
        nome: 'Over 2.5 gols',
        type: 'goals',
        odd_api: 1.80
      };

      const analysisWithBackup = {
        ...baseAnalysis,
        odds: {
          retry_odd: 1.95 // valid odd with normal deviation (+8.3%)
        }
      };

      const result = checkOddsSanity(
        analysisWithBackup,
        chosenCandidate,
        4.00 // extremely high, triggers Passo 3 failure (deviation > 36%)
      );

      expect(result.retry_executado).toBe(true);
      expect(result.retry_resultado).toBe('CORRIGIDO');
      expect(result.desvio_valido).toBe(true);
      expect(result.odd_bet365_final).toBe(1.95);
      expect(result.desvio_final).toBe(8.3);
    });

    it('DESVIO_CONFIRMADO - Desvio excessivo que não possui backup_odd ou backup_odd é igual deve ser confirmado e aprovado', () => {
      const chosenCandidate = {
        nome: 'Over 2.5 gols',
        type: 'goals',
        odd_api: 1.80
      };

      const result = checkOddsSanity(
        baseAnalysis,
        chosenCandidate,
        2.90 // within max limit of 3.00 for Over 2.5, but deviation is 61.1% which exceeds 36% limit
      );

      expect(result.passo3_desvio).toBe('DESVIO_CONFIRMADO');
      expect(result.retry_resultado).toBe('FALHOU');
      expect(result.desvio_valido).toBe(true);
      expect(result.odd_bet365_final).toBe(2.90);
      expect(result.desvio_final).toBe(61.1);
    });

  });

  describe('Integração: runTipsterEngine', () => {

    it('Bypass de validação de desvios quando desvio_valido = false', async () => {
      const input = {
        ...baseInput,
        analysis: {
          ...baseAnalysis,
          elo: {
            ranking: {
              home_ranking: 1800,
              away_ranking: 1400 // Delta = 400 > 150. Max allowed odd for favorite is 1.50
            }
          },
          valueBet: {
            report: {
              melhor_value: {
                market: 'Vitória Casa',
                odd_api: 1.40,
                prob_ia: 75,
                edge: 0.05
              }
            }
          }
        },
        oddManualBet365: 4.00 // Implausible (exceeds 1.50 limit)
      };

      const result = await runTipsterEngine(input as any);
      expect(result.sharp_context).toBeDefined();
      expect(result.sharp_context.sanidade_odds.desvio_valido).toBe(false);
      expect(result.sharp_context.mapeamento_status).toBe('FALHOU');
      expect(result.sharp_context.erro_tipo).toBe('ODD_IMPLAUSIVEL');

      // The decision should NOT crash, and Stage 2.5 (decisao_classificacao / armadilhas) should NOT execute / be bypassed
      expect(result.sharp_context.desvio_classificacao).toBeUndefined();
    });

  });

});
