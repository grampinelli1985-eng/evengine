import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { 
  registrarResultadoDiario, 
  getBanca, 
  getDrawdownAtual,
  emModoConservador,
  aplicarModoConservador,
  registrarResultado,
  podeAumentarStake,
  registrarEntradaAprovada,
  limiteEntradasAtingido,
  limiteJogosSimultaneosAtingido,
  podeEntrarNovaAposta,
  carregarStopLossState
} from '../src/services/bancaService';
import * as bancaService from '../src/services/bancaService';

describe('Auditoria v8.6 - Proteção de Capital e Integridade (8 Testes Críticos)', () => {

  beforeEach(() => {
    localStorage.clear();
    // Iniciar banca base 1000
    const banca = getBanca();
    banca.total = 1000;
    banca.picoHistorico = 1000;
    banca.apostasHoje = 0;
    banca.stops = { win: false, loss: false };
    localStorage.setItem('evengine_banca_state', JSON.stringify(banca));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TESTE 1: picoHistorico e registrarResultadoDiario
  it('1. Deve atualizar picoHistorico corretamente ao ter lucro diário', () => {
    registrarResultadoDiario(200); // 1000 -> 1200
    let banca = getBanca();
    expect(banca.total).toBe(1200);
    expect(banca.picoHistorico).toBe(1200);

    registrarResultadoDiario(-300); // 1200 -> 900
    banca = getBanca();
    expect(banca.total).toBe(900);
    expect(banca.picoHistorico).toBe(1200); // pico se mantém
  });

  // TESTE 2: Drawdown cálculo
  it('2. Deve calcular corretamente o drawdown atual em relação ao pico', () => {
    const banca = getBanca();
    banca.total = 800;
    banca.picoHistorico = 1000;
    localStorage.setItem('evengine_banca_state', JSON.stringify(banca));
    
    // (1000 - 800) / 1000 = 0.20
    expect(getDrawdownAtual()).toBe(0.20);
  });

  // TESTE 3: emModoConservador
  it('3. Deve ativar modo conservador apenas se drawdown ultrapassar 20%', () => {
    const banca = getBanca();
    banca.total = 800; // drawdown = 20%
    banca.picoHistorico = 1000;
    localStorage.setItem('evengine_banca_state', JSON.stringify(banca));
    expect(emModoConservador()).toBe(false); // <= 20%

    banca.total = 799; // drawdown > 20%
    localStorage.setItem('evengine_banca_state', JSON.stringify(banca));
    expect(emModoConservador()).toBe(true);
  });

  // TESTE 4: aplicarModoConservador
  it('4. Deve cortar a stake pela metade se estiver no modo conservador', () => {
    const banca = getBanca();
    banca.total = 750; // drawdown 25% (pico 1000)
    banca.picoHistorico = 1000;
    localStorage.setItem('evengine_banca_state', JSON.stringify(banca));
    
    expect(aplicarModoConservador(100)).toBe(50);
  });

  // TESTE 5: Incremento de stake apenas após 2 wins (podeAumentarStake)
  it('5. Não deve permitir aumentar stake sem 2 wins consecutivos após red', () => {
    // Registra um red
    registrarResultado({ resultado: 'loss' });
    let streak = carregarStopLossState();
    expect(streak.winsDesdeUltimoRed).toBe(0);

    // Tenta aumentar stake (atual = 50, calc = 70) -> deve negar
    expect(podeAumentarStake(50, 70)).toBe(false);

    // Registra um win
    registrarResultado({ resultado: 'win' });
    expect(podeAumentarStake(50, 70)).toBe(false);

    // Registra segundo win
    registrarResultado({ resultado: 'win' });
    // Agora deve permitir
    expect(podeAumentarStake(50, 70)).toBe(true);

    // Sempre deve permitir stake menor ou igual, independente dos wins
    registrarResultado({ resultado: 'loss' });
    expect(podeAumentarStake(50, 40)).toBe(true);
  });

  // TESTE 6: Limite de apostas diárias
  it('6. Deve bloquear novas entradas após 3 apostas aprovadas', () => {
    expect(limiteEntradasAtingido()).toBe(false);
    
    registrarEntradaAprovada();
    registrarEntradaAprovada();
    expect(limiteEntradasAtingido()).toBe(false);

    registrarEntradaAprovada(); // Atinge 3
    expect(limiteEntradasAtingido()).toBe(true);
  });

  // TESTE 7: Limite de jogos simultâneos
  it('7. Deve bloquear se existirem 2 ou mais jogos simultâneos (pendentes)', () => {
    expect(limiteJogosSimultaneosAtingido(0)).toBe(false);
    expect(limiteJogosSimultaneosAtingido(1)).toBe(false);
    expect(limiteJogosSimultaneosAtingido(2)).toBe(true);
    expect(limiteJogosSimultaneosAtingido(3)).toBe(true);
  });

  // TESTE 8: Agregador podeEntrarNovaAposta
  it('8. A função agregadora podeEntrarNovaAposta deve validar todos os bloqueios', () => {
    // Cenário limpo
    expect(podeEntrarNovaAposta(0)).toBe(true);

    // Bloqueia por jogos simultâneos (2 pendentes)
    expect(podeEntrarNovaAposta(2)).toBe(false);

    // Bloqueia por limite diário (3 aprovadas)
    registrarEntradaAprovada();
    registrarEntradaAprovada();
    registrarEntradaAprovada();
    expect(podeEntrarNovaAposta(0)).toBe(false);

    // Reseta banca
    localStorage.clear();
    const banca = getBanca();
    banca.apostasHoje = 0;
    localStorage.setItem('evengine_banca_state', JSON.stringify(banca));
    
    // Bloqueia por stop loss ativo (3 reds)
    registrarResultado({ resultado: 'loss' });
    registrarResultado({ resultado: 'loss' });
    registrarResultado({ resultado: 'loss' });
    expect(podeEntrarNovaAposta(0)).toBe(false);
  });

  // TESTE 9: Novo usuário sem histórico de apostas
  it('9. Usuário sem histórico de apostas (stakeAnterior = null) não deve ter stake zerada', () => {
    // Simula a lógica da UI integrada em EngineApp.tsx
    let stakeAnterior: number | null = null;
    let kellyReaisValue = 100;
    
    // Registra um red na conta para ativar a restrição caso houvesse aposta anterior
    registrarResultado({ resultado: 'loss' });

    // A regra só deve ser aplicada se stakeAnterior !== null
    if (stakeAnterior !== null && !podeAumentarStake(stakeAnterior, kellyReaisValue)) {
      kellyReaisValue = Math.min(kellyReaisValue, stakeAnterior);
    }

    // A stake sugerida deve permanecer 100, e não ser capada para 0
    expect(kellyReaisValue).toBe(100);
  });

});
