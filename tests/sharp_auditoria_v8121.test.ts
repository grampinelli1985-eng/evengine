import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registrarTimeNaoMapeado, getTeamIdAsync } from '../src/services/scoutingService';
import { supabase } from '../src/services/supabaseClient';

// Mock do supabase
vi.mock('../src/services/supabaseClient', () => {
  const fromMock = vi.fn();
  return {
    supabase: {
      from: fromMock
    }
  };
});

describe('Auditoria v8.12.1 - Times Não Mapeados', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Chamar registrarTimeNaoMapeado duas vezes com o mesmo nome faz upsert (ocorrencias = 2)', async () => {
    // Primeiro mock: simula que o registro ainda não existe
    const selectMock1 = vi.fn().mockResolvedValue({ data: null, error: null });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    
    // Segundo mock: simula que o registro já existe (ocorrencias = 1)
    const selectMock2 = vi.fn().mockResolvedValue({ data: { id: 'uuid-1', ocorrencias: 1 }, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    // Configurando o from() para retornar a chain certa
    (supabase as any).from.mockImplementation((table: string) => {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: selectMock1.mock.calls.length === 0 ? selectMock1 : selectMock2
          })
        }),
        insert: insertMock,
        update: updateMock
      };
    });

    // Chamada 1
    await registrarTimeNaoMapeado('TimeInexistente123', 'test');
    expect(insertMock).toHaveBeenCalledWith({ nome_tentado: 'TimeInexistente123', contexto: 'test' });

    // Chamada 2
    await registrarTimeNaoMapeado('TimeInexistente123', 'test');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ ocorrencias: 2 }));
  });

  it('2. Falha na escrita do Supabase (mock de erro) não lança exceção nem interrompe o fluxo de getTeamIdAsync', async () => {
    // Força erro no supabase
    (supabase as any).from.mockImplementation(() => {
      throw new Error("Erro de conexão com DB");
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // getTeamIdAsync não deve lançar exceção, deve engolir o erro do Supabase e retornar -1
    const id = await getTeamIdAsync('Um Time Absolutamente Inexistente e Errado');
    
    expect(id).toBe(-1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[Telemetry] Falha ao registrar time não mapeado'), expect.any(Error));
    
    consoleWarnSpy.mockRestore();
  });
});
