import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  calcNJogosEfetivos,
  calcCVLambda,
  calcShrinkageAlpha,
  gateConfiancaDados,
  JogoPonderado
} from '../src/services/valueBetService';

describe('Auditoria Sharp Money - Ponto 4: Substituição do margemSegura (Gate de Confiança de Dados)', () => {

  it('nJogosEfetivos = 7, outros critérios ok -> gateConfiancaDados retorna passou=false', () => {
    const result = gateConfiancaDados({
      nJogosEfetivos: 7.0,
      cvLambda: 0.40,
      shrinkageAlpha: 0.50
    });
    expect(result.passou).toBe(false);
    expect(result.motivo).toContain('Dados insuficientes');
  });

  it('nJogosEfetivos = 8, outros critérios ok -> gateConfiancaDados retorna passou=true', () => {
    const result = gateConfiancaDados({
      nJogosEfetivos: 8.0,
      cvLambda: 0.40,
      shrinkageAlpha: 0.50
    });
    expect(result.passou).toBe(true);
  });

  it('cvLambda = 0.61, nJogos ok, alpha ok -> gateConfiancaDados retorna passou=false', () => {
    const result = gateConfiancaDados({
      nJogosEfetivos: 10.0,
      cvLambda: 0.61,
      shrinkageAlpha: 0.50
    });
    expect(result.passou).toBe(false);
    expect(result.motivo).toContain('Lambda instável');
  });

  it('cvLambda = 0.60, outros critérios ok -> gateConfiancaDados retorna passou=true', () => {
    const result = gateConfiancaDados({
      nJogosEfetivos: 10.0,
      cvLambda: 0.60,
      shrinkageAlpha: 0.50
    });
    expect(result.passou).toBe(true);
  });

  it('shrinkageAlpha = 0.24, outros critérios ok -> gateConfiancaDados retorna passou=false', () => {
    const result = gateConfiancaDados({
      nJogosEfetivos: 10.0,
      cvLambda: 0.40,
      shrinkageAlpha: 0.24
    });
    expect(result.passou).toBe(false);
    expect(result.motivo).toContain('Modelo sem autonomia');
  });

  it('shrinkageAlpha = 0.25, outros critérios ok -> gateConfiancaDados retorna passou=true', () => {
    const result = gateConfiancaDados({
      nJogosEfetivos: 10.0,
      cvLambda: 0.40,
      shrinkageAlpha: 0.25
    });
    expect(result.passou).toBe(true);
  });

  it('Cálculo de nJogosEfetivos ignora jogos com pesoTotal <= 0.05', () => {
    const pool: JogoPonderado[] = [
      { pesoTotal: 1.0, golsMarcados: 2 },
      { pesoTotal: 0.5, golsMarcados: 1 },
      { pesoTotal: 0.04, golsMarcados: 3 } // Should be ignored
    ];
    const n = calcNJogosEfetivos(pool);
    expect(n).toBe(1.5);
  });

  it('Cálculo de cvLambda calcula desvio padrão / média dos gols marcados', () => {
    const pool: JogoPonderado[] = [
      { pesoTotal: 1.0, golsMarcados: 1 },
      { pesoTotal: 1.0, golsMarcados: 3 }
    ];
    // Mean = (1 + 3) / 2 = 2.
    // Variance = ((1 - 2)^2 + (3 - 2)^2) / 2 = (1 + 1) / 2 = 1.
    // StdDev = sqrt(1) = 1.
    // CV = 1 / 2 = 0.5.
    const cv = calcCVLambda(pool);
    expect(cv).toBeCloseTo(0.5, 4);
  });

  it('Cálculo de calcShrinkageAlpha retorna min(1, nJogosEfetivos / 20)', () => {
    expect(calcShrinkageAlpha(10)).toBe(0.5);
    expect(calcShrinkageAlpha(30)).toBe(1.0);
  });

  it('Confirmar que margemSegura foi completamente removido do codebase (zero ocorrências)', () => {
    const srcPath = path.resolve(__dirname, '../src');
    
    const findPatternInDir = (dir: string, pattern: string): boolean => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          if (findPatternInDir(filePath, pattern)) return true;
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes(pattern)) {
            console.log(`Found pattern "${pattern}" in file: ${filePath}`);
            return true;
          }
        }
      }
      return false;
    };

    const found = findPatternInDir(srcPath, 'margemSegura');
    expect(found).toBe(false);
  });

});
