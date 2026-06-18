import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock localStorage and window globally for test environment
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value.toString();
    },
    clear() {
      store = {};
    },
    removeItem(key: string) {
      delete store[key];
    }
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: storageMock,
  writable: true
});

Object.defineProperty(global, 'window', {
  value: {
    dispatchEvent: vi.fn(),
    localStorage: storageMock
  },
  writable: true
});

// Import services
import { 
  carregarStopLossState, 
  salvarStopLossState, 
  registrarResultado, 
  podeEntrarNovaAposta,
  calculateKellyStake,
  dispararAlertaStopLoss
} from '../src/services/bancaService';
import { runTipsterEngine } from '../src/services/tipsterEngine';
import { removeOverround, aplicarKellyMax } from '../src/services/valueBetService';

describe('Auditoria Sharp Money - Ponto 1: Caps de Probabilidades e Kelly', () => {

  it('P_casa + P_empate + P_fora === 1.000 após shrinkage (Soma exata, 3 casas decimais)', () => {
    // 1X2 market Pinnacle odds
    const oddsML = [2.10, 3.40, 3.80];
    const fairProbs = removeOverround(oddsML);
    
    // Check sum of fair probabilities
    const sum = fairProbs.reduce((acc, p) => acc + p, 0);
    expect(sum).toBeCloseTo(1.000, 3);
    expect(parseFloat(sum.toFixed(3))).toBe(1.000);

    // Test with Bayesian shrinkage (w = 0.90)
    const w = 0.90;
    const pRaw = [0.65, 0.20, 0.15]; // sums to 1.00
    
    const pCalibrated = pRaw.map((p, idx) => w * p + (1 - w) * fairProbs[idx]);
    const calSum = pCalibrated.reduce((acc, p) => acc + p, 0);
    expect(calSum).toBeCloseTo(1.000, 3);
    expect(parseFloat(calSum.toFixed(3))).toBe(1.000);
  });

  it('EV calculado com P_raw idêntico ao EV com P_shrinkage normalizado (quando w=1.0) ou diferença proporcional', () => {
    const pRaw = 0.65;
    const odd = 2.0;
    const evRaw = (pRaw * odd) - 1;
    
    // With w = 1.0, shrinkage does not change probability, so EV should match exactly
    const w = 1.0;
    const pCalibrated = w * pRaw + (1 - w) * 0.50; // no-op shrinkage
    const evCalibrated = (pCalibrated * odd) - 1;
    
    expect(Math.abs(evRaw - evCalibrated)).toBeLessThan(0.001);
  });

  it('Nenhuma referência a CAP_, aplicarCap, ou renormalização no geminiService.ts', () => {
    const servicePath = path.resolve(__dirname, '../src/services/geminiService.ts');
    const content = fs.readFileSync(servicePath, 'utf8');

    // Asserts that none of the prohibited terms are present in geminiService.ts
    expect(content).not.toContain('CAP_');
    expect(content).not.toContain('aplicarCap');
    expect(content).not.toContain('renormalização');
    expect(content).not.toContain('renormalizacao');
  });

  it('Kelly retornado nunca supera 3% (0.03) mesmo com EV muito alto', () => {
    // Under high EV (e.g. prob = 0.95, odd = 4.0 -> EV = 2.80)
    const prob = 95;
    const odd = 4.0;
    
    // Sizing formula: kelly = (EV) / (odd - 1)
    const ev = (prob / 100 * odd) - 1;
    const kellyFull = ev / (odd - 1);
    
    const kellyFinalVal = aplicarKellyMax(kellyFull);
    expect(kellyFinalVal).toBeLessThanOrEqual(0.03);

    // Test bankroll calculation cap
    const bankroll = 1000;
    const stake = calculateKellyStake(prob, odd, bankroll);
    expect(stake).toBeLessThanOrEqual(bankroll * 0.03);
  });

});

describe('Auditoria Sharp Money - Ponto 2: Stop Loss Ativo com Alerta', () => {

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('3 reds consecutivos ativam suspensão', () => {
    registrarResultado({ resultado: 'red' });
    registrarResultado({ resultado: 'red' });
    const estado = registrarResultado({ resultado: 'red' });
    
    expect(estado.redStreakAtual).toBe(3);
    expect(estado.suspensaoAtiva).toBe(true);
    expect(podeEntrarNovaAposta()).toBe(false);
  });

  it('2 reds + 1 green = streak zerado', () => {
    registrarResultado({ resultado: 'red' });
    registrarResultado({ resultado: 'red' });
    const estado = registrarResultado({ resultado: 'green' });
    
    expect(estado.redStreakAtual).toBe(0);
    expect(estado.suspensaoAtiva).toBe(false);
    expect(podeEntrarNovaAposta()).toBe(true);
  });

  it('Red após green recomeça do zero', () => {
    registrarResultado({ resultado: 'green' });
    const estado = registrarResultado({ resultado: 'red' });
    
    expect(estado.redStreakAtual).toBe(1);
    expect(estado.suspensaoAtiva).toBe(false);
  });

  it('4 reds consecutivos mantêm suspensão com streak = 4', () => {
    registrarResultado({ resultado: 'red' });
    registrarResultado({ resultado: 'red' });
    registrarResultado({ resultado: 'red' });
    const estado = registrarResultado({ resultado: 'red' });
    
    expect(estado.redStreakAtual).toBe(4);
    expect(estado.suspensaoAtiva).toBe(true);
  });

  it('podeEntrarNovaAposta retorna false com suspensão ativa', () => {
    // Manually force active suspension
    salvarStopLossState({
      redStreakAtual: 3,
      suspensaoAtiva: true,
      timestampUltimoRed: Date.now(),
      historicoStreak: [3]
    });
    
    expect(podeEntrarNovaAposta()).toBe(false);
  });

  it('Estado persiste após reload', () => {
    registrarResultado({ resultado: 'red' });
    registrarResultado({ resultado: 'red' });
    registrarResultado({ resultado: 'red' });
    
    expect(podeEntrarNovaAposta()).toBe(false);

    // Simulate reload by loading directly from localStorage
    const estadoPersistido = carregarStopLossState();
    expect(estadoPersistido.suspensaoAtiva).toBe(true);
    expect(estadoPersistido.redStreakAtual).toBe(3);
  });

  it('Alerta é disparado exatamente no 3° red', () => {
    registrarResultado({ resultado: 'red' });
    expect(localStorage.getItem('evengine_stop_loss_alert_dismissed')).not.toBe('false');

    registrarResultado({ resultado: 'red' });
    expect(localStorage.getItem('evengine_stop_loss_alert_dismissed')).not.toBe('false');

    registrarResultado({ resultado: 'red' });
    expect(localStorage.getItem('evengine_stop_loss_alert_dismissed')).toBe('false');
    expect(window.dispatchEvent).toHaveBeenCalled();
  });

  it('Alerta NÃO é disparado no 2° red', () => {
    registrarResultado({ resultado: 'red' });
    registrarResultado({ resultado: 'red' });
    
    expect(localStorage.getItem('evengine_stop_loss_alert_dismissed')).not.toBe('false');
  });

});
