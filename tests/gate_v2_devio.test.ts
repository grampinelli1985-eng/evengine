import { describe, it, expect, vi } from 'vitest';
import { runTipsterEngine } from '../src/services/tipsterEngine';

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

describe('GATE V2.0 - Desvio Extremo e Regras D1 a D4', () => {

  const baseInput = {
    analysis: {
      valueBet: {
        report: {
          melhor_value: {
            market: 'Vitória Casa',
            odd_api: 2.00, // Pinnacle reference price
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
      },
      resumo: 'Jogo normal do campeonato.'
    },
    matchCardValues: {
      ev: 30.0,
      kelly: 4.0,
      tier: 'A',
      confianca: 90, // Confiança IA base
      convergenciaOk: true
    },
    oddManualBet365: null,
    bancaTotal: 1000
  };

  it('Regra D1: Desvio Positivo >= +20% (Odds Infladas) -> rebaixar confiança -15pp', async () => {
    const input = {
      ...baseInput,
      oddManualBet365: 2.50 // Pinnacle is 2.00 -> desvio = +25%
    };

    const result = await runTipsterEngine(input as any);
    expect(result.sharp_context).toBeDefined();
    expect(result.sharp_context.desvio_classificacao).toBe('Odds infladas');
    // Confiança IA base: 90. -15pp -> 75
    expect(result.sharp_context.confianca_ajustada).toBe(75);
    expect(result.sharp_context.desvio_flags).toContain('ODDS_INFLADAS_PUBLICO');
    expect(result.sharp_context.desvio_flags).toContain('REVISAO_MANUAL_OBRIGATORIA');
  });

  it('Regra D2: Contexto Amplificador (Final Copa + Desvio >= 20%) -> rebaixar confiança -25pp total', async () => {
    const input = {
      ...baseInput,
      analysis: {
        ...baseInput.analysis,
        resumo: 'Grande decisão da final da copa nacional!'
      },
      oddManualBet365: 2.50 // Pinnacle is 2.00 -> desvio = +25%
    };

    const result = await runTipsterEngine(input as any);
    expect(result.sharp_context).toBeDefined();
    expect(result.sharp_context.desvio_classificacao).toBe('Armadilha pública');
    // Confiança IA base: 90. -25pp total -> 65
    expect(result.sharp_context.confianca_ajustada).toBe(65);
    expect(result.sharp_context.desvio_flags).toContain('ARMADILHA_PUBLICA');
  });

  it('Regra D3: Desvio Negativo <= -20% (Sharp money) -> aumentar confiança +10pp, flag SHARP_CONFIRMADO', async () => {
    const input = {
      ...baseInput,
      oddManualBet365: 1.55 // Pinnacle is 2.00 -> desvio = -22.5%
    };

    const result = await runTipsterEngine(input as any);
    expect(result.sharp_context).toBeDefined();
    expect(result.sharp_context.desvio_classificacao).toBe('Sharp money confirmado');
    // Confiança IA base: 90. +10pp -> 100
    expect(result.sharp_context.confianca_ajustada).toBe(100);
    expect(result.sharp_context.desvio_flags).toContain('SHARP_CONFIRMADO');
  });

  it('Regra D4: Bloqueio total B-DESVIO (Desvio >= +30% em Jogo Decisivo) -> bloqueio, NÃO sugerir alternativa', async () => {
    const input = {
      ...baseInput,
      analysis: {
        ...baseInput.analysis,
        resumo: 'Grande final de copa nacional!',
        valueBet: {
          report: {
            mercados: [
              {
                market: 'Vitória Casa',
                odd_api: 2.00,
                prob_ia: 65,
                edge: 0.30
              },
              {
                market: 'Over 2.5',
                odd_api: 1.80,
                prob_ia: 70,
                edge: 0.15 // Mercado alternativo com EV+ alto
              }
            ]
          }
        }
      },
      oddManualBet365: 2.70 // Pinnacle is 2.00 -> desvio = +35% (>= +30%)
    };

    const result = await runTipsterEngine(input as any);
    expect(result.status).toBe('BLOQUEADO');
    expect(result.bloqueio.codigo).toBe('B-DESVIO');
    expect(result.bloqueio.motivo).toContain('distorção severa de mercado público');
    // Não sugerir alternativa!
    expect(result.sharp_context.mercado_alternativo).toBeNull();
  });
});
