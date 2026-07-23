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
  console.log("Iniciando simulação de bloqueios v8.17...");
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('data')
    .limit(500);

  if (error) {
    console.error("Erro ao buscar dados do Supabase:", error);
    return;
  }

  let total1x2 = 0;
  let bloqueadosOld = 0;
  let bloqueadosNew = 0;

  for (const row of data) {
    try {
      const report = row.data;
      if (!report || !report.tipsterEngine || !report.tipsterEngine.mercado_selecionado) continue;
      
      const mercado = report.tipsterEngine.mercado_selecionado;
      const nome = mercado.nome?.toLowerCase() || '';
      const is1x2 = nome.includes('vitória') || nome.includes('empate');
      
      if (!is1x2) continue;

      const probIA = mercado.probabilidade_final;
      const probElo = mercado.probabilidade_elo;

      if (probIA == null || probElo == null) continue;

      const deltaElo = Math.abs(probIA - probElo);
      total1x2++;

      // old rules: 20 : 35
      // Para simular, assumimos ELO calibrado (maioria) ou testamos pelo isEloCalibrated se disponível
      const isEloCalibrated = report.tipsterEngine.sharp_context?.motivo_especifico?.includes('ELO confiável: Sim') ?? true;
      const maxOld = isEloCalibrated ? 20 : 35;
      const maxNew = isEloCalibrated ? 45 : 60;

      if (deltaElo > maxOld) {
        bloqueadosOld++;
      }
      if (deltaElo > maxNew) {
        bloqueadosNew++;
      }
    } catch (e) {
      // Ignorar erros
    }
  }

  console.log(`\n=== Simulação B-DIVERGENCIA-ELO (N=${total1x2}) ===`);
  console.log(`Bloqueios com threshold ANTIGO (20/35): ${bloqueadosOld} (${((bloqueadosOld/total1x2)*100).toFixed(1)}%)`);
  console.log(`Bloqueios com threshold NOVO (45/60): ${bloqueadosNew} (${((bloqueadosNew/total1x2)*100).toFixed(1)}%)`);
}

run();
