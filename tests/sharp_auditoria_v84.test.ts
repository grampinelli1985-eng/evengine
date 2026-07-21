import { describe, it, expect } from 'vitest';
import {
  createValueMarket,
  validateReport,
  gateConfiancaDados
} from '../src/services/valueBetService';

describe('Auditoria Sharp Money v8.4 - Testes Corretivos', () => {

  describe('FIX 1: createValueMarket thresholds e recomenda', () => {
    
    it('recomenda na faixa 10–12%: edge de 11% -> is_value_bet: true, recomenda: true, odd_is_estimated: false', () => {
      // prob = 0.50 (50%), odd = 2.22 => edge = 0.50 * 2.22 - 1 = 0.11 (11%)
      const market = createValueMarket('Teste 11%', 2.22, 0.50, false);
      expect(market.edge).toBeCloseTo(0.11, 2);
      expect(market.is_value_bet).toBe(true);
      expect(market.recomenda).toBe(true);
      expect(market.odd_is_estimated).toBe(false);
      // Como 11% >= 10.2%, observacao não deve estar vazia (zona de atenção)
      expect(market.observacao.length).toBeGreaterThan(0);
    });

    it('Zona de atenção: edge de 10.5% -> recomenda: true, observacao não vazia', () => {
      // prob = 0.50, odd = 2.21 => edge = 0.105 (10.5%)
      const market = createValueMarket('Teste 10.5%', 2.21, 0.50, false);
      expect(market.edge).toBeCloseTo(0.105, 3);
      expect(market.recomenda).toBe(true);
      expect(market.observacao.length).toBeGreaterThan(0);
      expect(market.observacao).toContain('Edge elevado, próximo do teto de plausibilidade');
    });

    it('Teto impossível: edge de 12.5% (bruto) -> is_value_bet: false, recomenda: false, edge retornado capado em 0.12', () => {
      // prob = 0.50, odd = 2.25 => edge = 0.125 (12.5%)
      const market = createValueMarket('Teste 12.5%', 2.25, 0.50, false);
      expect(market.edge).toBe(0.12); // capado no MAX_EDGE_REALISTA
      expect(market.is_value_bet).toBe(false);
      expect(market.recomenda).toBe(false);
      expect(market.odd_is_estimated).toBe(true);
    });

  });

  describe('FIX 3: melhor_value sem filtro is_value_bet', () => {

    it('melhor_value nunca aponta para mercado com is_value_bet: false, mesmo quando este tem edge bruto maior', () => {
      const report = {
        mercados: [
          {
            market: 'Mercado Falso (Teto)',
            odd_api: 2.50,
            prob_ia: 50,
            odd_fair: 2.0,
            edge: 0.12, // Era 0.25 capado em 0.12
            is_value_bet: false, // Desqualificado por exceder teto plausível
            recomenda: false,
            odd_is_estimated: true,
            observacao: ''
          },
          {
            market: 'Mercado Bom',
            odd_api: 2.10,
            prob_ia: 50,
            odd_fair: 2.0,
            edge: 0.05,
            is_value_bet: true,
            recomenda: false,
            odd_is_estimated: false,
            observacao: ''
          }
        ],
        total_value_bets: 0,
        tem_value: false,
        melhor_value: null
      };

      const validated = validateReport(report);
      
      expect(validated.melhor_value).not.toBeNull();
      // Deve apontar para o Mercado Bom, pois o Mercado Falso tem is_value_bet: false
      expect(validated.melhor_value?.market).toBe('Mercado Bom');
      expect(validated.melhor_value?.edge).toBe(0.05);
    });

  });

  describe('FIX 4: cvLambda limite empírico 1.05', () => {

    it('cvLambda = 0.95 -> deve passar conforme nova calibração', () => {
      const result = gateConfiancaDados({
        nJogosEfetivos: 10, // > 8
        cvLambda: 0.95,
        shrinkageAlpha: 0.50 // > 0.25
      });
      // Atualizado com base na distribuição empírica (1.05)
      expect(result.passou).toBe(true);
    });

    it('cvLambda = 1.06 -> deve bloquear', () => {
      const result = gateConfiancaDados({
        nJogosEfetivos: 10,
        cvLambda: 1.06,
        shrinkageAlpha: 0.50
      });
      expect(result.passou).toBe(false);
      expect(result.motivo).toContain('Lambda instável');
    });

  });

});
