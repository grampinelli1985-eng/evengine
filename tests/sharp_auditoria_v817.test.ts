import { runTipsterEngine } from '../src/services/tipsterEngine';

describe('Auditoria v8.17: Correcao de Thresholds (Underdog e Divergencia ELO)', () => {
  const getBaseAnalysis = () => ({
    probabilidades_ml: { casa: 28.0, empate: 30.0, fora: 45.0 }, // Underdog = casa (28%)
    odds_1x2_api: { casa: 4.50, empate: 3.2, fora: 3.5 },
    elo: {
      jogos_minimos_atingidos: true,
      probabilidades: { casa: 40.0, empate: 30.0, fora: 30.0 }
    },
    valueBet: {
      report: {
        mercados: [
          { market: 'Vitória Casa', type: '1x2', prob_ia: 28.0, odd_api: 4.50, edge: 0.125 } // EV positive
        ],
        melhor_value: { market: 'Vitória Casa', type: '1x2', prob_ia: 28.0, odd_api: 4.50, edge: 0.125 }
      }
    },
    scouting: null,
    h2h: { fonte: 'api_football' },
    ticket: { tipo: 'simples' }
  });

  const getBaseInput = (analysisOverride: any = {}) => ({
    analysis: { ...getBaseAnalysis(), ...analysisOverride },
    matchCardValues: { tier: 'B', confianca: 80, ev: 12.5, kelly: 2.0, convergenciaOk: true },
    oddManualBet365: 4.50,
    bancaTotal: 1000,
    pendentesCount: 0,
    userConfirmedAudit: false,
    currentLocalTime: new Date().toISOString()
  });

  it('Teste 1: B-UNDERDOG-CALIBRATION nao deve mais bloquear underdogs (prob_ia < 30 e delta > 8pp)', async () => {
    // prob_ia = 25.0, prob_elo = 40.0 (delta = 15pp > 8pp)
    // Pinnacle odd = 4.50 -> implied prob = 22.2% (delta = 2.8pp)
    const input = getBaseInput();
    const result = await runTipsterEngine(input);
    
    // O bloqueio B-UNDERDOG-CALIBRATION nao deve ocorrer.
    if (result.status === 'BLOQUEADO') {
      expect(result.bloqueio && result.bloqueio.codigo).not.toBe('B-UNDERDOG-CALIBRATION');
    } else {
      expect(result.status).toBe('APROVADO');
    }
  });

  it('Teste 2: Divergencia ELO de 30pp deve PASSAR pelo B-DIVERGENCIA-ELO (limite subiu de 20pp para 45pp)', async () => {
    // Delta Casa: 55.0 - 25.0 = 30.0pp. Antes bloqueava, agora nao.
    const input = getBaseInput({
      elo: {
        jogos_minimos_atingidos: true,
        probabilidades: { casa: 55.0, empate: 20.0, fora: 25.0 }
      }
    });
    
    const result = await runTipsterEngine(input);
    
    if (result.status === 'BLOQUEADO') {
      expect(result.bloqueio && result.bloqueio.codigo).not.toBe('B-DIVERGENCIA-ELO');
      expect(result.bloqueio && result.bloqueio.codigo).not.toBe('B-UNDERDOG-CALIBRATION');
    }
  });

  it('Teste 3: Divergencia ELO de 48pp deve BLOQUEAR por B-DIVERGENCIA-ELO (acima de 45pp)', async () => {
    // Delta Casa: 73.0 - 25.0 = 48.0pp (> 45pp)
    const input = getBaseInput({
      elo: {
        jogos_minimos_atingidos: true,
        probabilidades: { casa: 73.0, empate: 10.0, fora: 17.0 }
      }
    });
    
    const result = await runTipsterEngine(input);
    
    expect(result.status).toBe('BLOQUEADO');
    expect(result.bloqueio && result.bloqueio.codigo).toBe('B-DIVERGENCIA-ELO');
  });
});
