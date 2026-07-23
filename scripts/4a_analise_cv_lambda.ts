import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Carrega as variáveis de ambiente do .env na raiz do projeto
dotenv.config({ path: resolve(process.cwd(), '.env') });

const url = process.env.VITE_SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!url || !key) {
  console.error("VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLISHABLE_KEY faltando no .env");
  process.exit(1);
}

const supabase = createClient(url, key);

export interface JogoPonderado {
  pesoTotal: number;
  golsMarcados: number;
  fonteSintetica?: boolean;
}

// Cópia de calcCVLambda
function calcCVLambda(pool: JogoPonderado[]): number {
  if (!pool || pool.length === 0) return 1.5;

  let sumW = 0;
  let sumWX = 0;
  for (const j of pool) {
    sumW += j.pesoTotal;
    sumWX += j.pesoTotal * j.golsMarcados;
  }
  if (sumW === 0) return 1.5;

  const mean = sumWX / sumW;

  let sumWVariance = 0;
  for (const j of pool) {
    sumWVariance += j.pesoTotal * Math.pow(j.golsMarcados - mean, 2);
  }
  const variance = sumWVariance / sumW;

  if (mean === 0) return 1.5;

  const cv = Math.sqrt(variance) / mean;
  return cv;
}

// Cópia de montarPoolComPeso
function montarPoolComPeso(fonteInfo: any): JogoPonderado[] {
  if (!fonteInfo) return [];
  if (fonteInfo.lastGoalsFor) {
    return fonteInfo.lastGoalsFor.map((g: number) => ({ pesoTotal: 1.0, golsMarcados: g, fonteSintetica: fonteInfo.isSynthetic }));
  }
  return [];
}

async function run() {
  console.log("Iniciando analise_cv_lambda...");
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('data')
    .limit(1000);

  if (error) {
    console.error("Erro ao buscar dados do Supabase:", error);
    return;
  }

  const cvLambdas: number[] = [];
  let syntheticCount = 0;
  let realCount = 0;

  for (const row of data) {
    try {
      const report = row.data;
      if (!report || !report.scouting) continue;

      const homeGoals = report.scouting.home_goals;
      const awayGoals = report.scouting.away_goals;

      if (!homeGoals && !awayGoals) continue;

      const isHomeSynthetic = homeGoals?.isSynthetic;
      const isAwaySynthetic = awayGoals?.isSynthetic;

      if (isHomeSynthetic || isAwaySynthetic) {
        syntheticCount++;
        continue;
      }

      const dataPool: JogoPonderado[] = [
        ...montarPoolComPeso(homeGoals),
        ...montarPoolComPeso(awayGoals),
      ];

      if (dataPool.length > 0) {
        const cvLambda = calcCVLambda(dataPool);
        cvLambdas.push(cvLambda);
        realCount++;
      }
    } catch (e) {
      console.error("Erro ao processar linha:", e);
    }
  }

  cvLambdas.sort((a, b) => a - b);

  console.log(`\n=== Relatório de Análise empírica do cvLambda ===`);
  console.log(`Amostras Reais Analisadas: ${realCount}`);
  console.log(`Amostras Sintéticas Ignoradas: ${syntheticCount}`);

  if (realCount === 0) {
    console.log("AVISO: Nenhum dado real o suficiente para gerar uma distribuição confiável.");
    return;
  }

  const min = cvLambdas[0];
  const max = cvLambdas[cvLambdas.length - 1];
  const avg = cvLambdas.reduce((a, b) => a + b, 0) / realCount;
  
  const p50 = cvLambdas[Math.floor(realCount * 0.50)];
  const p75 = cvLambdas[Math.floor(realCount * 0.75)];
  const p90 = cvLambdas[Math.floor(realCount * 0.90)];
  const p95 = cvLambdas[Math.floor(realCount * 0.95)];

  console.log(`Mínimo: ${min.toFixed(4)}`);
  console.log(`Média:  ${avg.toFixed(4)}`);
  console.log(`Max:    ${max.toFixed(4)}`);
  console.log(`P50:    ${p50.toFixed(4)}`);
  console.log(`P75:    ${p75.toFixed(4)}`);
  console.log(`P90:    ${p90.toFixed(4)}`);
  console.log(`P95:    ${p95.toFixed(4)}`);
}

run();
