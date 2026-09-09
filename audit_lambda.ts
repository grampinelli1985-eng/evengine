import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env", { URL: !!supabaseUrl, KEY: !!supabaseKey });
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runAudit() {
  console.log("Iniciando auditoria retroativa...");
  
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('id, fixture_key, data, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error("Erro ao buscar dados do Supabase:", error);
    return;
  }

  let totalAnalyses = data.length;
  let goalsMarketsApproved = 0;
  let inflatedLambdaApproved = 0;
  
  const affectedFixtures = [];

  for (const row of data) {
    try {
      const parsedData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const teEngine = parsedData?.te_engine;
      if (!teEngine) continue;

      const isAprovado = teEngine.decisao?.status === 'APROVADO';
      const mercadoSelecionado = teEngine.mercado_selecionado?.nome || '';
      
      const isGoalsMarket = mercadoSelecionado.includes('Over') || mercadoSelecionado.includes('Ambos');
      
      if (isAprovado && isGoalsMarket) {
        goalsMarketsApproved++;
        
        const totalExpected = teEngine.goalsAnalysis?.totalGoalsExpected;
        const lambda = parseFloat(totalExpected);
        
        if (lambda > 4.5) {
          inflatedLambdaApproved++;
          affectedFixtures.push({
            id: row.id,
            fixture: row.fixture_key,
            mercado: mercadoSelecionado,
            lambda: lambda,
            ev_exibido: teEngine.mercado_selecionado?.ev,
            data: row.created_at
          });
        }
      }
    } catch (e) {
      console.warn("Erro parseando data do row", row.id);
    }
  }

  console.log("\n--- RESULTADO DA AUDITORIA RETROATIVA ---");
  console.log(`Total de análises em cache avaliadas (últimas 500): ${totalAnalyses}`);
  console.log(`Entradas APROVADAS em mercados de gols (Over/Ambos): ${goalsMarketsApproved}`);
  console.log(`Dessas, quantas tinham λ implausível (> 4.5): ${inflatedLambdaApproved}`);
  console.log("\nLista de entradas possivelmente prejudicadas (Aprovadas com EV inflado):");
  console.table(affectedFixtures);
}

runAudit();
