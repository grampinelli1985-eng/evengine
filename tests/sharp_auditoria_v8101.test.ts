import { runTipsterEngine } from '../src/services/tipsterEngine';

describe('Auditoria de Divergência ELO vs Modelo (B-DIVERGENCIA-ELO)', () => {
  const getBaseAnalysis = () => ({
    probabilidades_ml: { casa: 46.0, empate: 30.9, fora: 23.1 },
    elo: {
      jogos_minimos_atingidos: true,
      probabilidades: { casa: 94.5, empate: 0.7, fora: 4.8 }
    },
    valueBet: {
      report: {
        mercados: [
          { market: 'Vitória Casa', type: '1x2', prob_ia: 46.0, odd_api: 2.30, edge: 0.058 } // EV ~5.8%
        ],
        melhor_value: { market: 'Vitória Casa', type: '1x2', prob_ia: 46.0, odd_api: 2.30, edge: 0.058 }
      }
    },
    scouting: null,
    h2h: { fonte: 'api_football' },
    ticket: { tipo: 'simples' }
  });

  const getBaseInput = (analysisOverride: any = {}) => ({
    analysis: { ...getBaseAnalysis(), ...analysisOverride },
    matchCardValues: { tier: 'B', confianca: 80 },
    oddManualBet365: 2.35,
    bancaTotal: 1000,
    pendentesCount: 0,
    userConfirmedAudit: false,
    currentLocalTime: new Date().toISOString()
  });

  it('deve bloquear com B-DIVERGENCIA-ELO quando a divergência excede 45pp para ELO confiável', async () => {
    // Delta Casa: 94.5 - 46.0 = 48.5pp (> 45pp)
    const input = getBaseInput();
    const result = await runTipsterEngine(input);
    
    expect(result.status).toBe('BLOQUEADO');
    expect(result.bloqueio && result.bloqueio.codigo).toBe('B-DIVERGENCIA-ELO');
    expect(result.bloqueio && result.bloqueio.motivo).toContain('Δ49.8pp');
    expect(result.bloqueio && result.bloqueio.motivo).toContain('ELO confiável: Sim');
  });

  it('NÃO deve bloquear por B-DIVERGENCIA-ELO quando a divergência é menor que 45pp', async () => {
    // Delta Casa: 56.0 - 46.0 = 10.0pp (< 45pp)
    const input = getBaseInput({
      elo: {
        jogos_minimos_atingidos: true,
        probabilidades: { casa: 56.0, empate: 24.0, fora: 20.0 }
      }
    });
    
    const result = await runTipsterEngine(input);
    
    // Como a análise de ML tem um bom EV (2.30 * 46% = ~1.05 -> 5%), o mercado pode ser aprovado.
    // Pode haver outros bloqueios (B-SCORE), mas NÃO deve ser B-DIVERGENCIA-ELO.
    if (result.status === 'BLOQUEADO') {
      expect(result.bloqueio && result.bloqueio.codigo).not.toBe('B-DIVERGENCIA-ELO');
    } else {
      expect(result.status).toBe('APROVADO');
    }
  });

  it('deve utilizar tolerância maior (60pp) quando ELO não estiver calibrado', async () => {
    // Delta Casa: 96.0 - 46.0 = 50.0pp. 
    // Como ELO não está calibrado, limite é 60pp. Logo, NÃO deve bloquear por B-DIVERGENCIA-ELO.
    const input = getBaseInput({
      elo: {
        jogos_minimos_atingidos: false,
        probabilidades: { casa: 96.0, empate: 2.0, fora: 2.0 }
      }
    });
    
    const result = await runTipsterEngine(input);
    
    if (result.status === 'BLOQUEADO') {
      expect(result.bloqueio && result.bloqueio.codigo).not.toBe('B-DIVERGENCIA-ELO');
    }
  });

  // O Verdadeiro Cenário Botafogo x Vitória (Desvio extremo com um dos times em calibração)
  it('deve bloquear com B-DIVERGENCIA-ELO quando divergência excede 60pp MESMO com ELO não calibrado', async () => {
    // Delta Casa: 90.0 - 20.0 = 70.0pp (> 60pp)
    const input = getBaseInput({
      probabilidades_ml: { casa: 20.0, empate: 40.0, fora: 40.0 },
      valueBet: {
        report: {
          mercados: [
            { market: 'Vitória Casa', type: '1x2', prob_ia: 20.0, odd_api: 6.00, edge: 0.20 }
          ],
          melhor_value: { market: 'Vitória Casa', type: '1x2', prob_ia: 20.0, odd_api: 6.00, edge: 0.20 }
        }
      },
      elo: {
        jogos_minimos_atingidos: false,
        probabilidades: { casa: 90.0, empate: 5.0, fora: 5.0 }
      }
    });
    
    const result = await runTipsterEngine(input);
    
    expect(result.status).toBe('BLOQUEADO');
    expect(result.bloqueio && result.bloqueio.codigo).toBe('B-DIVERGENCIA-ELO');
    expect(result.bloqueio && result.bloqueio.motivo).toContain('Δ70.5pp');
    expect(result.bloqueio && result.bloqueio.motivo).toContain('ELO confiável: Não');
  });
});
