import { describe, it, expect, beforeEach } from 'vitest';
import { 
  registrarAposta, 
  resolverAposta, 
  getHistoricoStats 
} from '../src/services/historicoService';
import { 
  getBanca, 
  setBancaAtual, 
  resetarContadores, 
  podeEntrarNovaAposta, 
  limiteEntradasAtingido,
  carregarStopLossState
} from '../src/services/bancaService';

describe('Auditoria de Proteção de Capital (v8.11)', () => {
  beforeEach(() => {
    // Limpa o localStorage para um estado zerado a cada teste
    localStorage.clear();
    resetarContadores();
    setBancaAtual(1000);
  });

  const criarAposta = (odd: number, stake: number) => {
    return registrarAposta({
      matchId: 'teste123',
      homeTeam: 'Casa',
      awayTeam: 'Fora',
      liga: 'Teste',
      mercado: 'Vitória Casa',
      odd,
      stake,
      gateScore: 80,
      confianca: 70,
      ev: 0.05,
      bancaAtual: 1000
    });
  };

  it('1. resolverAposta com RED aciona registrarResultadoDiario com valor negativo', () => {
    const id = criarAposta(2.0, 50); // aposta 50
    resolverAposta(id, 'RED', 950);

    const banca = getBanca();
    expect(banca.pnl_diario).toBe(-50); // O prejuízo da stake
  });

  it('2. resolverAposta com WIN aciona registrarResultadoDiario com lucro correto', () => {
    const id = criarAposta(2.0, 50); // aposta 50, lucro esperado = 50 * (2 - 1) = 50
    resolverAposta(id, 'WIN', 1050);

    const banca = getBanca();
    expect(banca.pnl_diario).toBe(50); // O lucro exato da operação
  });

  it('3. Após 3 REDs consecutivos, podeEntrarNovaAposta retorna false (Suspensão)', () => {
    expect(podeEntrarNovaAposta()).toBe(true);

    const id1 = criarAposta(2.0, 50);
    resolverAposta(id1, 'RED', 950);
    
    const id2 = criarAposta(2.0, 50);
    resolverAposta(id2, 'RED', 900);
    
    const id3 = criarAposta(2.0, 50);
    resolverAposta(id3, 'RED', 850);

    const stopState = carregarStopLossState();
    expect(stopState.redStreakAtual).toBe(3);
    expect(stopState.suspensaoAtiva).toBe(true);
    
    expect(podeEntrarNovaAposta()).toBe(false);
  });

  it('4. registrarAposta chamado 3 vezes no mesmo dia faz limiteEntradasAtingido() retornar true', () => {
    expect(limiteEntradasAtingido()).toBe(false);

    criarAposta(2.0, 50);
    expect(limiteEntradasAtingido()).toBe(false);

    criarAposta(2.0, 50);
    expect(limiteEntradasAtingido()).toBe(false);

    criarAposta(2.0, 50);
    expect(limiteEntradasAtingido()).toBe(true);
    
    // Consequentemente, podeEntrarNovaAposta também deve barrar
    expect(podeEntrarNovaAposta()).toBe(false);
  });
});
