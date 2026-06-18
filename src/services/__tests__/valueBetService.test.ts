import { removeOverround } from '../valueBetService';
import { describe, test, expect } from 'vitest';

describe('removeOverround', () => {
  test('mercado 1X2 com overround de 3.3% normaliza para soma 1.0', () => {
    const result = removeOverround([2.10, 3.40, 3.80]);
    expect(result.reduce((s, p) => s + p, 0)).toBeCloseTo(1.0, 4);
  });
  
  test('mercado binário (over/under) normaliza para soma 1.0', () => {
    const result = removeOverround([1.50, 2.50]);
    expect(result.reduce((s, p) => s + p, 0)).toBeCloseTo(1.0, 4);
  });
  
  test('mercado sem vig (overround = 1.0) retorna probabilidades idênticas', () => {
    const result = removeOverround([2.0, 2.0]);
    expect(result[0]).toBeCloseTo(0.5, 4);
    expect(result[1]).toBeCloseTo(0.5, 4);
  });
  
  test('lança erro para odd menor ou igual a 1.0', () => {
    expect(() => removeOverround([0.95, 2.0])).toThrow();
    expect(() => removeOverround([1.0, 2.0])).toThrow();
  });
  
  test('lança erro para NaN', () => {
    expect(() => removeOverround([NaN, 2.0])).toThrow();
  });
  
  test('lança erro para array vazio', () => {
    expect(() => removeOverround([])).toThrow();
  });
  
  test('lança erro para Infinity', () => {
    expect(() => removeOverround([Infinity, 2.0])).toThrow();
  });
});
