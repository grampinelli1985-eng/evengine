import { describe, it, expect } from 'vitest';
import {
  normalizeMercado,
  classifyMercado,
  requiredMarkets,
} from '../../../supabase/functions/clv-capture/mercado';

describe('clv-capture / classifyMercado', () => {
  it.each([
    ['Vitória Casa', 'h2h'],
    ['Vitória Fora', 'h2h'], // nome real gravado pelo app; antes não era reconhecido
    ['Vitória Visitante', 'h2h'],
    ['Empate', 'h2h'],
    ['Mais de 2.5 Gols', 'totals'],
    ['Over 2.5', 'totals'],
    ['Menos de 2.5 Gols', 'totals'],
    ['Dupla Chance 1X', 'double_chance'],
    ['Dupla Chance X2', 'double_chance'],
    ['Dupla Chance 12', 'double_chance'],
    ['Asian Handicap -0.5', 'spreads'],
  ])('%s -> %s', (mercado, esperado) => {
    expect(classifyMercado(mercado)).toBe(esperado);
  });

  it('BTTS, DNB, escanteios e finalizações são não suportados (antes caíam em h2h/totals)', () => {
    for (const mercado of [
      'Ambas Marcam (Sim)',
      'Empate Anula - Casa', // antes: 'casa' → h2h (odd errada)
      'Empate Anula - Fora',
      'Mais de 9.5 Escanteios', // antes: 'mais de' → totals de GOLS (odd errada)
      'Over 10.5 Corners',
      'Mais de 11.5 Finalizações',
      'Mais de 4.5 Cartões',
    ]) {
      expect(classifyMercado(mercado), mercado).toBe('unsupported');
    }
  });

  it('mercado desconhecido é não suportado', () => {
    expect(classifyMercado('Resultado Exato 2-1')).toBe('unsupported');
  });

  it('normalizeMercado remove acentos', () => {
    expect(normalizeMercado('Vitória Casa')).toBe('vitoria casa');
  });
});

describe('clv-capture / requiredMarkets (1 crédito por mercado pedido)', () => {
  it('só h2h quando todas as entradas são 1X2 ou dupla chance', () => {
    expect(requiredMarkets(['Vitória Casa', 'Empate', 'Dupla Chance 1X'])).toEqual(['h2h']);
  });

  it('h2h + totals sem spreads (antes: sempre h2h,totals,spreads)', () => {
    expect(requiredMarkets(['Vitória Casa', 'Mais de 2.5 Gols']).sort()).toEqual(['h2h', 'totals']);
  });

  it('spreads só quando há entrada de handicap', () => {
    expect(requiredMarkets(['Mais de 2.5 Gols', 'Asian Handicap -0.5']).sort()).toEqual(['spreads', 'totals']);
  });

  it('entradas não suportadas não pedem mercado nenhum', () => {
    expect(requiredMarkets(['Ambas Marcam (Sim)', 'Empate Anula - Casa', 'Mais de 9.5 Escanteios'])).toEqual([]);
  });
});
