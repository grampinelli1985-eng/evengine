import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runFind() {
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('id, fixture_key, data, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.error(error);
    return;
  }

  const results = [];
  for (const row of data) {
    try {
      const parsedData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const teEngine = parsedData?.tipsterEngine;
      if (!teEngine) continue;

      const totalExpected = teEngine.goalsAnalysis?.totalGoalsExpected;
      if (totalExpected === undefined) continue;

      const lambda = parseFloat(totalExpected);
      results.push({ lambda, row, parsedData, teEngine });
    } catch (e) {}
  }

  results.sort((a, b) => a.lambda - b.lambda);
  const top1 = results.find(r => r.row.fixture_key.includes("internacional-flamengo"));
  if (top1) {
      console.log("Top lambda:", top1.lambda, "Fixture:", top1.row.fixture_key);
      console.log("homeStats:", JSON.stringify(top1.parsedData.home, null, 2)); console.log("awayStats:", JSON.stringify(top1.parsedData.away, null, 2)); console.log("league:", top1.parsedData.league?.name)
      console.log("Keys of parsedData:", Object.keys(top1.parsedData));
      console.log("Scouting:", JSON.stringify(top1.parsedData.scouting, null, 2));
  } else {
      console.log("No data found.");
  }
}
runFind();
