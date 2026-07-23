import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const url = process.env.VITE_SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!url || !key) {
  console.error("VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLISHABLE_KEY faltando no .env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  console.log("Iniciando análise de bloqueios...");
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('data')
    .limit(500); // Pegar os últimos 500 caches

  if (error) {
    console.error("Erro ao buscar dados do Supabase:", error);
    return;
  }

  const divergenciasElo: number[] = [];
  const underdogsEloDelta: number[] = [];
  const underdogsPinDelta: number[] = [];

  for (const row of data) {
    try {
      const report = row.data;
      if (!report || !report.tipsterEngine || !report.tipsterEngine.mercado_selecionado) continue;
      
      const mercado = report.tipsterEngine.mercado_selecionado;
      // Considera apenas mercados 1x2 (Vitória Casa, Empate, Vitória Fora)
      const nome = mercado.nome?.toLowerCase() || '';
      const is1x2 = nome.includes('vitória') || nome.includes('empate');
      
      if (!is1x2) continue;

      const probIA = mercado.probabilidade_final;
      const probElo = mercado.probabilidade_elo;
      const oddAPI = mercado.odd_referencia;

      if (probIA == null || probElo == null || oddAPI == null) continue;

      const deltaElo = Math.abs(probIA - probElo);
      divergenciasElo.push(deltaElo);

      const isUnderdog = probIA < 30;
      if (isUnderdog) {
        const pinDelta = Math.abs(probIA - ((1 / oddAPI) * 100));
        underdogsEloDelta.push(deltaElo);
        underdogsPinDelta.push(pinDelta);
      }
    } catch (e) {
      // Ignorar erros na linha
    }
  }

  const reportPercentiles = (label: string, arr: number[]) => {
    if (arr.length === 0) {
      console.log(`\n=== ${label} ===\nSem dados suficientes.`);
      return;
    }
    arr.sort((a, b) => a - b);
    const min = arr[0];
    const max = arr[arr.length - 1];
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    
    const p50 = arr[Math.floor(arr.length * 0.50)];
    const p75 = arr[Math.floor(arr.length * 0.75)];
    const p90 = arr[Math.floor(arr.length * 0.90)];
    const p95 = arr[Math.floor(arr.length * 0.95)];

    console.log(`\n=== ${label} (N=${arr.length}) ===`);
    console.log(`Mínimo: ${min.toFixed(2)}pp`);
    console.log(`Média:  ${avg.toFixed(2)}pp`);
    console.log(`Max:    ${max.toFixed(2)}pp`);
    console.log(`P50:    ${p50.toFixed(2)}pp`);
    console.log(`P75:    ${p75.toFixed(2)}pp`);
    console.log(`P90:    ${p90.toFixed(2)}pp`);
    console.log(`P95:    ${p95.toFixed(2)}pp`);
  };

  reportPercentiles("Divergência ELO (Todos 1x2)", divergenciasElo);
  reportPercentiles("Underdog Delta ELO (prob_ia < 30)", underdogsEloDelta);
  reportPercentiles("Underdog Delta Pinnacle (prob_ia < 30)", underdogsPinDelta);
}

run();
