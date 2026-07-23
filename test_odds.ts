import { fetchAllMatches } from './src/services/oddsService';
import { loadEnv } from 'vite';

async function testOdds() {
  const env = loadEnv('', process.cwd(), '');
  (global as any).import = { meta: { env } };
  
  try {
    const matches = await fetchAllMatches();
    console.log("Matches:", matches.length);
    if (matches.length > 0) {
      console.log("First match:", matches[0].home_team, "vs", matches[0].away_team);
    }
  } catch (e) {
    console.error(e);
  }
}

testOdds();
