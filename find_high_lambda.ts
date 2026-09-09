import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function runFind() {
  console.log("Procurando match com lambda alto (> 4.5)...");
  
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('id, fixture_key, data, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.error("Erro ao buscar dados do Supabase:", error);
    return;
  }

  for (const row of data) {
    try {
      const parsedData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const teEngine = parsedData?.tipsterEngine;
      console.log("Row keys:", Object.keys(parsedData)); if (!teEngine) continue;

      const totalExpected = teEngine.goalsAnalysis?.totalGoalsExpected;
      const lambda = parseFloat(totalExpected);
      
      if (false) {
        console.log("========== MATCH ENCONTRADO ==========");
        console.log("Fixture Key:", row.fixture_key);
        console.log("Lambda Total (totalGoalsExpected):", lambda);
        console.log("Mercado Selecionado:", teEngine.mercado_selecionado?.nome);
        console.log("Status:", teEngine.decisao?.status);
        console.log("Motivo:", teEngine.decisao?.motivo);
        
        const stats = parsedData?.stats;
        if (stats) {
            console.log("\n--- INFORMACOES DAS EQUIPES ---");
            console.log("Home Team:", stats.home?.name);
            console.log("Away Team:", stats.away?.name);
            console.log("Home Recent Goals For:", stats.home?.lastGoalsFor);
            console.log("Home Recent Goals Against:", stats.home?.lastGoalsAgainst);
            console.log("Away Recent Goals For:", stats.away?.lastGoalsFor);
            console.log("Away Recent Goals Against:", stats.away?.lastGoalsAgainst);
            console.log("League Name:", stats.league?.name);
            
            console.log("\n--- POISSON ESTIMATE E CONVERGENCIA ---");
            console.log("Poisson Estimate:", teEngine.goalsAnalysis?.models?.poissonEstimate);
            console.log("Gemini Estimate:", teEngine.goalsAnalysis?.models?.geminiEstimate);
            console.log("Convergencia:", teEngine.goalsAnalysis?.convergence);
            
            console.log("\n--- SPORTMONKS XG ---");
            console.log(JSON.stringify(teEngine.goalsAnalysis?.sportmonks_xg, null, 2));
        }

        break;
      }
    } catch (e) {
      // ignore
    }
  }
}

runFind();
