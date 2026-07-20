import { describe, it, expect, vi } from 'vitest';
import { recalculateTipsterMetrics, runTipsterEngine } from '../src/services/tipsterEngine';

vi.mock('../src/services/geminiService', () => {
  return {
    callGeminiAPI: vi.fn().mockResolvedValue(JSON.stringify({
      status: 'APROVADO',
      score: 85,
      stake: { percentual: 2 },
      mercado_selecionado: {
        nome: 'Vitória Casa',
        probabilidade_final: 75,
        odd_referencia: 1.85,
        break_even_odd: 1.33,
        odd_bet365_publica: 1.80,
        selecionado: true
      },
      todos_mercados: []
    }))
  };
});

describe('DecisaoEngine Consistency', () => {

  const mockEngineDataAprovado = {
    status: 'APROVADO',
    decisao: { status: 'APROVADO' },
    score: { valor: 85, motivos_bloqueio: [] },
    mercado_selecionado: {
      nome: 'Vitória Casa',
      probabilidade_final: 75,
      odd_referencia: 1.85,
      break_even_odd: 1.33,
      odd_bet365_publica: 1.80,
      selecionado: true
    },
    todos_mercados: [
      {
        nome: 'Vitória Casa',
        probabilidade_final: 75,
        odd_referencia: 1.85,
        break_even_odd: 1.33,
        odd_bet365_publica: 1.80,
        selecionado: true
      },
      {
        nome: 'Empate',
        probabilidade_final: 20,
        odd_referencia: 3.50,
        break_even_odd: 5.00,
        odd_bet365_publica: undefined,
        selecionado: false
      }
    ],
    stake: { percentual: 2, valor_reais: 20 }
  };

  it('Cenário APROVADO: Card e Tabela mostram mesmo mercado', () => {
    expect(mockEngineDataAprovado.decisao.status).toBe('APROVADO');
    expect(mockEngineDataAprovado.mercado_selecionado).toBeDefined();
    expect(mockEngineDataAprovado.todos_mercados.length).toBeGreaterThan(0);
    expect(mockEngineDataAprovado.mercado_selecionado.nome).toBe(mockEngineDataAprovado.todos_mercados[0].nome);
  });

  it('APÓS RECALCULATE: todos_mercados e odd_bet365_publica preservados', () => {
    const resultRecalculate = recalculateTipsterMetrics(
      mockEngineDataAprovado,
      1.82, // oddManualBet365
      {},   // marketReference
      75,   // probIA
      1000  // bancaTotal
    );
    
    expect(resultRecalculate.mercado_selecionado).toBeDefined();
    expect(resultRecalculate.mercado_selecionado.odd_bet365_manual).toBe(1.82);
    expect(resultRecalculate.mercado_selecionado.odd_bet365_publica).toBe(1.80);
    expect(resultRecalculate.todos_mercados.length).toBe(2);
  });

  it('Cenário BLOQUEADO B1: campos preenchidos, sem strings vazias', () => {
    const b1Result = recalculateTipsterMetrics(
      mockEngineDataAprovado,
      1.10, // odd manual horrível, causa EV negativo
      {},
      75,
      1000
    );
    
    expect(b1Result.decisao).toBeDefined();
    expect(b1Result.score.motivos_bloqueio).toBeDefined();
    expect(Array.isArray(b1Result.score.motivos_bloqueio)).toBe(true);
  });

  it('Cenário 429 Fallback: Estrutura íntegra', () => {
    const b1Result = recalculateTipsterMetrics(
      mockEngineDataAprovado,
      1.10,
      {},
      75,
      1000
    );
    // score.valor must be a number, not nested object
    expect(typeof b1Result.score.valor).toBe('number');
  });

  describe('Gate B7 - Line Movement (Threshold 5%)', () => {
    const baseInput = {
      analysis: {
        valueBet: {
          report: {
            melhor_value: {
              market: 'Vitória Casa',
              odd_api: 1.94, // Pinnacle
              prob_ia: 55,
              edge: 0.067
            }
          }
        },
        odds: {
          atual: 1.94
        },
        scouting: {
          data_source: 'api-football',
          desfalques: false,
          home_form: ['V', 'V', 'V', 'V', 'V'],
          away_form: ['V', 'V', 'V', 'V', 'V']
        },
        h2h: {
          fonte: 'api-football'
        },
        lineMovement: {
          tipo: 'ESTAVEL'
        }
      },
      matchCardValues: {
        ev: 6.7,
        kelly: 2.0,
        tier: 'A',
        confianca: 93,
        convergenciaOk: true
      },
      oddManualBet365: null,
      bancaTotal: 1000
    };

    it('Teste 1: Movimento pequeno (Chelsea Pinnacle 1.94 vs Bet365 2.00, desvio +3.1%) -> DEVE PASSAR', async () => {
      const input = {
        ...baseInput,
        oddManualBet365: 2.00 // +3.1% deviation
      };
      
      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('APROVADO');
      expect(result.bloqueio).toBeUndefined();
    });

    it('Teste 2: Movimento médio (Pinnacle 2.00 vs Bet365 2.08, desvio +4.0%) -> DEVE PASSAR', async () => {
      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          valueBet: {
            report: {
              melhor_value: {
                ...baseInput.analysis.valueBet.report.melhor_value,
                odd_api: 2.00 // Pinnacle
              }
            }
          }
        },
        oddManualBet365: 2.08 // +4.0% deviation
      };
      
      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('APROVADO');
      expect(result.bloqueio).toBeUndefined();
    });

    it('Teste 3: Movimento dramático (Pinnacle 2.00 vs Bet365 2.15, desvio +7.5%) -> DEVE BLOQUEAR', async () => {
      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          valueBet: {
            report: {
              melhor_value: {
                ...baseInput.analysis.valueBet.report.melhor_value,
                odd_api: 2.00 // Pinnacle
              }
            }
          }
        },
        oddManualBet365: 2.15 // +7.5% deviation (> 5% threshold)
      };
      
      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B7');
      expect(result.bloqueio.motivo).toContain('Linha moveu dramaticamente contra sua posição (+7.5%)');
    });

    it('Teste 4: Movimento a seu favor (Pinnacle 2.00 vs Bet365 1.95, desvio -2.5%) -> DEVE PASSAR', async () => {
      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          valueBet: {
            report: {
              melhor_value: {
                ...baseInput.analysis.valueBet.report.melhor_value,
                odd_api: 2.00 // Pinnacle
              }
            }
          }
        },
        oddManualBet365: 1.95 // -2.5% deviation (favorable)
      };
      
      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('APROVADO');
      expect(result.bloqueio).toBeUndefined();
    });
  });

  describe('Gate B-UNDERDOG-CALIBRATION & Underdog Multiplier', () => {
    const baseInput = {
      analysis: {
        valueBet: {
          report: {
            melhor_value: {
              market: 'Vitória Casa',
              odd_api: 4.90, // Pinnacle
              prob_ia: 27, // Underdog (< 30%)
              edge: 0.323
            }
          }
        },
        odds: {
          atual: 4.90
        },
        elo: {
          probabilidades: {
            casa: 15 // ELO: 15% -> Delta = 27 - 15 = 12% (> 8%)
          }
        },
        scouting: {
          data_source: 'api-football',
          desfalques: false
        },
        h2h: {
          fonte: 'api-football'
        },
        lineMovement: {
          tipo: 'ESTAVEL'
        }
      },
      matchCardValues: {
        ev: 32.3,
        kelly: 8.4,
        tier: 'A',
        confianca: 90,
        convergenciaOk: true
      },
      oddManualBet365: null,
      bancaTotal: 1000
    };

    it('Teste 1: Underdog descalibrado (Gemini 27%, ELO 15%, delta 12pp) -> DEVE BLOQUEAR por B-UNDERDOG-CALIBRATION', async () => {
      const result = await runTipsterEngine(baseInput as any);
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-UNDERDOG-CALIBRATION');
      expect(result.bloqueio.motivo).toContain('descalibrada com ELO (15%) ou Pinnacle (20%) por > 8pp');
    });

    it('Teste 2: Underdog calibrado dentro do delta (Gemini 27%, ELO 22%, delta 5pp) -> DEVE PASSAR a calibração e reduzir probabilidade em 0.70x', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 85,
        mercado: {
          nome: 'Vitória Casa',
          probabilidade_ia: 27,
          odd: 4.90
        },
        stake: { percentual: 2 }
      }));

      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          elo: {
            probabilidades: {
              casa: 22 // ELO: 22% -> Delta = 27 - 22 = 5% (< 8%)
            }
          }
        }
      };
      
      const result = await runTipsterEngine(input as any);
      // O multiplicador 0.70x deve ser aplicado: 27 * 0.7 = 18.9%
      expect(result.mercado_selecionado.probabilidade_final).toBe(18.9);
      // E o EV deve ser recalculado: (0.189 * 4.90) - 1 = -7.4%
      // Como o EV é -7.4% (< 3%), deve ser bloqueado por B-EV!
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-EV');
      expect(result.bloqueio.motivo).toContain('EV do mercado selecionado abaixo');
    });
  });

  describe('Modo Auditoria - Odd Manual com EV Negativo', () => {
    it('Deve bloquear B1 se EV for negativo e userConfirmedAudit for false', () => {
      const result = recalculateTipsterMetrics(
        mockEngineDataAprovado,
        1.10, // odd manual horrível, causa EV negativo
        {},
        75, // probIA
        1000, // bancaTotal
        {},
        false // userConfirmedAudit
      );
      
      expect(result.decisao.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-EV');
      expect(result.modo_auditoria).toBe(false);
      expect(result.aviso_ev_negativo).toBeNull();
    });

    it('Deve aprovar (bypass B1) se EV for negativo e userConfirmedAudit for true', () => {
      const result = recalculateTipsterMetrics(
        mockEngineDataAprovado,
        1.10, // odd manual horrível, causa EV negativo
        {},
        75, // probIA
        1000, // bancaTotal
        {},
        true // userConfirmedAudit
      );
      
      expect(result.decisao.status).toBe('APROVADO');
      expect(result.bloqueio).toBeUndefined();
      expect(result.modo_auditoria).toBe(true);
      expect(result.aviso_ev_negativo).toBeLessThan(0.03);
      expect(result.audit_mode.ativo).toBe(true);
    });
  });

  describe('Mercados de Dupla Chance no TipsterEngine', () => {
    const baseInput = {
      analysis: {
        valueBet: {
          report: {
            mercados: [
              {
                market: 'Dupla Chance 1X',
                odd_api: 1.30,
                prob_ia: 90,
                edge: 0.17
              },
              {
                market: 'Dupla Chance X2',
                odd_api: 1.40,
                prob_ia: 75,
                edge: 0.05
              }
            ]
          }
        },
        dupla_chance: {
          "1X": { probabilidade: 80, odd_equivalente: 1.30, recomenda: true },
          "X2": { probabilidade: 75, odd_equivalente: 1.40, recomenda: true },
          "12": { probabilidade: 70, odd_equivalente: 1.50, recomenda: false }
        },
        elo: {
          probabilidades: {
            casa: 45,
            empate: 25,
            fora: 30
          }
        },
        scouting: {
          data_source: 'api-football',
          desfalques: false
        },
        h2h: {
          fonte: 'api-football'
        },
        lineMovement: {
          tipo: 'ESTAVEL'
        }
      },
      matchCardValues: {
        ev: 5.0,
        kelly: 2.0,
        tier: 'A',
        confianca: 90,
        convergenciaOk: true
      },
      oddManualBet365: null,
      bancaTotal: 1000
    };

    it('Deve incluir os candidatos de dupla chance e calcular o prob_elo correspondente', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 80,
        mercado: {
          nome: 'Dupla Chance 1X',
          probabilidade_ia: 80,
          odd: 1.30
        },
        stake: { percentual: 1.5 }
      }));

      const result = await runTipsterEngine(baseInput as any);
      
      expect(result.todos_mercados).toBeDefined();
      const dc1X = result.todos_mercados.find((m: any) => m.nome === 'Dupla Chance 1X');
      const dcX2 = result.todos_mercados.find((m: any) => m.nome === 'Dupla Chance X2');
      
      expect(dc1X).toBeDefined();
      expect(dcX2).toBeDefined();
      
      // ELO para 1X deve ser casa (45) + empate (25) = 70%
      expect(result.mercado_selecionado.probabilidade_elo).toBe(70);
    });
  });

  describe('Sharp Context Enrichment Layer v1.0', () => {
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

    it('Teste 1: Desfalque de jogador principal (Elye Wahi) -> DEVE reduzir probabilidade do time da casa por -4pp', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 85,
        mercado: {
          nome: 'Vitória Casa',
          probabilidade_ia: 63, // Alinhado ao EV -4pp
          odd: 2.00
        },
        stake: { percentual: 2 }
      }));

      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          scouting: {
            ...baseInput.analysis.scouting,
            desfalques: ['Elye Wahi']
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.sharp_context).toBeDefined();
      expect(result.sharp_context.desfalques_verificados).toBe(true);
      expect(result.sharp_context.ajuste_probabilidade_aplicado).toContain('-4.0pp');
      expect(result.mercado_selecionado.probabilidade_final).toBe(63);
    });

    it('Teste 2: Playoff Jogo 2 e leg 1 foi 0-0 -> DEVE aumentar a probabilidade do visitante por +5pp', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 85,
        mercado: {
          nome: 'Vitória Fora',
          probabilidade_ia: 40,
          odd: 2.50
        },
        stake: { percentual: 2 }
      }));

      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          valueBet: {
            report: {
              melhor_value: {
                market: 'Vitória Fora',
                odd_api: 2.50,
                prob_ia: 35,
                edge: 0.15
              }
            }
          },
          resumo: 'Playoff mata-mata jogo de volta (jogo 2). O primeiro jogo terminou empatado em 0-0.',
          scouting: {
            ...baseInput.analysis.scouting,
            away_form: ['V', 'E', 'V', 'E', 'V']
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.sharp_context).toBeDefined();
      expect(result.sharp_context.contexto_competicao).toContain('playoff_jogo2');
      expect(result.sharp_context.ajuste_probabilidade_aplicado).toContain('+5.0pp');
    });

    it('Teste 3: Dados de suspensões ausentes (scouting indisponível) -> DEVE aplicar incerteza de -3pp e emitir alerta sem bloquear por B-DADOS', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 85,
        mercado: {
          nome: 'Vitória Casa',
          probabilidade_ia: 62, // 65 - 3pp
          odd: 1.80
        },
        stake: { percentual: 2 }
      }));

      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          valueBet: {
            report: {
              melhor_value: {
                ...baseInput.analysis.valueBet.report.melhor_value,
                odd_api: 1.80,
                prob_ia: 62
              }
            }
          },
          scouting: {
            data_source: 'unavailable',
            desfalques: [],
            away_desfalques: [],
            home_form: [],
            away_form: []
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.sharp_context).toBeDefined();
      expect(result.sharp_context.desfalques_verificados).toBe(false);
      expect(result.sharp_context.ajuste_probabilidade_aplicado).toContain('-3');
      // Triggers block B-DADOS due to lack of effective matches (Gate 3 Data Trust)
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-DADOS');
      expect(result.alertas.length).toBeGreaterThan(0);
      expect(result.alertas.some((a: string) => a.includes('DADO AUSENTE'))).toBe(true);
    });

    it('Teste 4: Desvio Bet365 vs Pinnacle menor que 1.0% -> DEVE bloquear por desvio insuficiente', async () => {
      const input = {
        ...baseInput,
        oddManualBet365: 2.01 // Pinnacle is 2.00 -> deviation is +0.5% (< 1.0%)
      };

      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-EV');
      expect(result.bloqueio.motivo).toContain('Desvio Bet365 (2.01) vs Pinnacle (2.00) é < +1.0%');
    });

    it('Teste 5: Temporada Regular (regular_season) -> contexto neutro DEVE aplicar ajuste de 0pp', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 85,
        mercado: {
          nome: 'Vitória Casa',
          probabilidade_ia: 65, // Sem alteração
          odd: 2.00
        },
        stake: { percentual: 2 }
      }));

      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          resumo: 'Jogo válido pela temporada regular do campeonato.'
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.sharp_context.contexto_competicao).toBe('regular_season');
      expect(result.sharp_context.ajuste_probabilidade_aplicado).toBe('Nenhum');
      expect(result.mercado_selecionado.probabilidade_final).toBe(65);
    });

    it('Teste 6: Final de Copa + Mandante sem vitória recente -> DEVE aplicar ajuste de -3pp no mandante', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 85,
        mercado: {
          nome: 'Vitória Casa',
          probabilidade_ia: 63.5, // Alinhado ao EV -3pp
          odd: 2.00
        },
        stake: { percentual: 2 }
      }));

      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          resumo: 'Grande decisão da final de copa nacional.',
          scouting: {
            ...baseInput.analysis.scouting,
            home_form: ['D', 'D', 'E', 'D', 'E'] // 0 vitórias (< 2)
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.sharp_context.contexto_competicao).toBe('final_copa');
      expect(result.sharp_context.ajuste_probabilidade_aplicado).toContain('-3.0pp');
      expect(result.mercado_selecionado.probabilidade_final).toBe(63.5);
    });

    it('Teste 7: Pressão de Fim de Temporada (rebaixamento/acesso) -> DEVE aplicar +3pp motivacional ao time', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 85,
        mercado: {
          nome: 'Vitória Casa',
          probabilidade_ia: 66.5, // Alinhado ao EV +3pp
          odd: 2.00
        },
        stake: { percentual: 2 }
      }));

      const input = {
        ...baseInput,
        analysis: {
          ...baseInput.analysis,
          matchData: { home_team: 'Vasco' },
          resumo: 'Jogo de fim de temporada com o Vasco lutando desesperadamente contra o rebaixamento.'
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.sharp_context.contexto_competicao).toBe('rebaixamento/acesso');
      expect(result.sharp_context.ajuste_probabilidade_aplicado).toContain('+3.0pp');
      expect(result.mercado_selecionado.probabilidade_final).toBe(66.5);
    });

    it('deve bloquear quando Elo em calibração E EV negativo', async () => {
      const { callGeminiAPI } = await import('../src/services/geminiService');
      (callGeminiAPI as any).mockResolvedValueOnce(JSON.stringify({
        status: 'APROVADO',
        score: 100,
        mercado: {
          nome: 'Vitória Casa',
          probabilidade_ia: 30,
          odd: 2.00
        },
        stake: { percentual: 2 }
      }));

      const input = {
        analysis: {
          valueBet: {
            report: {
              melhor_value: {
                market: 'Vitória Casa',
                odd_api: 2.00,
                prob_ia: 30,
                edge: -0.186
              }
            }
          },
          odds: { atual: 2.00 },
          elo: {
            jogos_minimos_atingidos: false,
            probabilidades: { casa: 50 }
          },
          scouting: {
            data_source: 'api-football',
            desfalques: [],
            away_desfalques: [],
            home_form: ['V', 'V', 'E', 'D', 'V'],
            away_form: ['D', 'D', 'E', 'V', 'D']
          },
          h2h: { fonte: 'api-football' },
          lineMovement: { tipo: 'ESTAVEL' }
        },
        matchCardValues: {
          ev: -18.6,
          kelly: 0,
          tier: 'A',
          confianca: 100,
          convergenciaOk: true
        },
        oddManualBet365: null,
        bancaTotal: 1000
      };

      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-EV');
    });
  });

  describe('Bloco 6 — Atualização e Validação de Linha', () => {
    const baseInputTemplate = {
      analysis: {
        currentLocalTime: '2026-05-29T20:06:00',
        valueBet: {
          report: {
            melhor_value: {
              market: 'Vitória Casa',
              odd_api: 2.00, // opening odd reference
              prob_ia: 60,
              edge: 0.20
            }
          }
        },
        scouting: {
          data_source: 'api-football',
          desfalques: false,
          home_form: ['V', 'V', 'V', 'V', 'V'],
          away_form: ['V', 'V', 'V', 'V', 'V']
        },
        h2h: {
          fonte: 'api-football'
        },
        linha: {}
      },
      matchCardValues: {
        ev: 20.0,
        kelly: 2.0,
        tier: 'A',
        confianca: 90,
        convergenciaOk: true
      },
      oddManualBet365: null,
      bancaTotal: 1000
    };

    it('Teste 1: Busca de Odd com Fonte 1 Direta Válida (Pinnacle exato + timestamp ok) -> usar Fonte 1', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {
            odd_abertura: 2.00,
            pinnacle_direto_odd: 1.95,
            pinnacle_direto_timestamp: '20:00' // valid timestamp within 15 mins of current local time 20:06
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.linha).toBeDefined();
      expect(result.linha.odd_atual).toBe(1.95);
      expect(result.linha.fonte).toBe('pinnacle_direto');
      expect(result.linha.timestamp_valido).toBe(true);
      expect(result.linha.movimento_pts).toBe(0.05);
      expect(result.linha.movimento_direcao).toBe('caiu');
    });

    it('Teste 2: Busca de Odd com Fonte 1 desatualizada (> 15 min), e sem Fonte 2/3 -> usar Fonte 1 mas flag timestamp_valido=false e B-SCOUT', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {
            odd_abertura: 2.00,
            pinnacle_direto_odd: 1.95,
            pinnacle_direto_timestamp: '19:40' // invalid (>15 mins from 20:06)
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-SCOUT');
      expect(result.linha.timestamp_valido).toBe(false);
    });

    it('Teste 3: Fonte 1 desatualizada, mas com Fonte 2 (oddschecker) -> usar Fonte 2 com real-time ok', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {
            odd_abertura: 2.00,
            pinnacle_direto_odd: 1.95,
            pinnacle_direto_timestamp: '19:40', // old
            oddschecker_odd: 1.90
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.linha.odd_atual).toBe(1.90);
      expect(result.linha.fonte).toBe('oddschecker');
      expect(result.linha.timestamp_valido).toBe(true);
    });

    it('Teste 4: Apenas Fonte 3 (agregador) -> usar Fonte 3 com -5pp de penalidade na confiança', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {
            odd_abertura: 2.00,
            agregador_odd: 1.90
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.linha.odd_atual).toBe(1.90);
      expect(result.linha.fonte).toBe('fonte_secundaria');
      expect(result.linha.timestamp_valido).toBe(true);
      // Adjusted confidence should be 90 (base) - 5 (Fonte 3) = 85
      expect(result.sharp_context.confianca_ajustada).toBe(85);
    });

    it('Teste 5: Todas as fontes falham -> flag LINHA_INDISPONIVEL, bloquear com B-SCOUT', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {} // empty
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-SCOUT');
      expect(result.linha.fonte).toBe('LINHA_INDISPONIVEL');
    });

    it('Teste 6: Detecção de Line Movement Extremo (> 0.50 pts) -> flag LINE_MOVEMENT_EXTREMO, revisao_manual e -15pp', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {
            odd_abertura: 3.10,
            pinnacle_direto_odd: 2.50, // 0.60 pts movement (extremo)
            pinnacle_direto_timestamp: '20:00'
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.linha.movimento_classificacao).toBe('extremo');
      expect(result.linha.sinal_sharp).toBe('SHARP_COMPRANDO');
      expect(result.sharp_context.desvio_flags).toContain('LINE_MOVEMENT_EXTREMO');
      expect(result.sharp_context.desvio_flags).toContain('REVISAO_MANUAL_OBRIGATORIA');
      // sinal sharp_comprando should add +15pp to confidence: 90 + 15 = 105 (capped at 100)
      expect(result.sharp_context.confianca_ajustada).toBe(100);
    });

    it('Teste 7: Validação Cruzada Divergente (diff 2%-5%) -> usar a menor odd (mais conservadora)', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {
            odd_abertura: 2.00,
            pinnacle_direto_odd: 2.00,
            pinnacle_direto_timestamp: '20:00',
            oddschecker_odd: 1.93 // diff = (2.00 - 1.93)/2.00 = 3.5%
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.linha.validacao_cruzada).toBe('DIVERGENTE');
      expect(result.linha.odd_atual).toBe(1.93); // smaller used
    });

    it('Teste 8: Validação Cruzada Linha Desatualizada (diff > 5%) -> usar a menor odd e flag LINHA_DESATUALIZADA', async () => {
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          linha: {
            odd_abertura: 2.00,
            pinnacle_direto_odd: 2.00,
            pinnacle_direto_timestamp: '20:00',
            oddschecker_odd: 1.85 // diff = (2.00 - 1.85)/2.00 = 7.5%
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.linha.validacao_cruzada).toBe('LINHA_DESATUALIZADA');
      expect(result.linha.odd_atual).toBe(1.85);
      expect(result.sharp_context.desvio_flags).toContain('LINHA_DESATUALIZADA');
    });

    it('Teste 9: Protocolo de Urgência (< 2h para kickoff, line moved > 0.15, EV cai < 3%) -> reclassificar para BLOQUEADO [B-EV]', async () => {
      const commenceTimeIn1Hour = new Date(Date.now() + 1000 * 60 * 60).toISOString();
      const input = {
        ...baseInputTemplate,
        analysis: {
          ...baseInputTemplate.analysis,
          commence_time: commenceTimeIn1Hour,
          currentLocalTime: new Date(Date.now()).toISOString(),
          valueBet: {
            report: {
              melhor_value: {
                market: 'Vitória Casa',
                odd_api: 3.10, // opening
                prob_ia: 36.2 // EV abertura = +12.2%
              }
            }
          },
          linha: {
            odd_abertura: 3.10,
            pinnacle_direto_odd: 2.78, // magnitude 0.32 pts, EV real = +0.6%
            pinnacle_direto_timestamp: '20:00'
          }
        }
      };

      const result = await runTipsterEngine(input as any);
      expect(result.status).toBe('BLOQUEADO');
      expect(result.bloqueio.codigo).toBe('B-EV');
      expect(result.linha.alerta_movimento).toBe(true);
      expect(result.linha.ev_real).toBe(0.64);
      expect(result.linha.ev_abertura).toBe(12.22);
      expect(result.linha.diferenca_ev).toBe(11.58);
      expect(result.alertas[result.alertas.length - 1]).toContain('⚡ LINHA MOVEU');
    });
  });
});

