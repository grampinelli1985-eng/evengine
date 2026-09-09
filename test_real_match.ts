import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { analyzeGoalsMarket, calculateTeamPower } from './src/services/goalsService';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log("Buscando dados originais do cache...");
  
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('data')
    .eq('fixture_key', 'internacional-flamengo-20260729')
    .limit(1);

  if (error || !data || data.length === 0) {
    console.error("Erro ao buscar dados do Supabase:", error);
    return;
  }

  const parsedData = typeof data[0].data === 'string' ? JSON.parse(data[0].data) : data[0].data;
  
  const homeGoals = parsedData.scouting?.home_goals;
  const awayGoals = parsedData.scouting?.away_goals;

  if (!homeGoals || !awayGoals) {
      console.log("Dados de gols nao encontrados no cache");
      return;
  }

  const homePower = calculateTeamPower(homeGoals);
  const awayPower = calculateTeamPower(awayGoals);

  console.log("Powers Recalculados (com Suavização):");
  console.log("Home (Internacional):", homePower);
  console.log("Away (Flamengo):", awayPower);

  // Re-run analyzeGoalsMarket
  // analyzeGoalsMarket(homeTeam, awayTeam, homeAttackPower, homeDefensePower, awayAttackPower, awayDefensePower, odds, scoutingHome, scoutingAway, homeGeminiXg, awayGeminiXg, fixtureId, leagueName)
  const analysis = await analyzeGoalsMarket(
      'Internacional', 'Flamengo',
      homePower.attackPower, homePower.defensePower,
      awayPower.attackPower, awayPower.defensePower,
      { over_1_5: 1.25, over_2_5: 1.85, over_3_5: 3.10, btb: 1.80 },
      undefined, undefined, undefined, undefined, undefined,
      'Brasileirão' // Ou similar, para pegar a média correta. Se não achar, usa default {home: 1.45, away: 1.15}
  );

  console.log("\nNovo Lambda Total Esperado (totalGoalsExpected):", analysis.totalGoalsExpected);
  console.log("Novo Modelo Poisson Completo:", JSON.stringify(analysis.probabilities, null, 2));
}

runTest();
