import { fetchAllMatches } from '../src/services/oddsService';

async function testApi() {
  const apiKey = process.env.VITE_ODDS_API_KEY || import.meta.env?.VITE_ODDS_API_KEY;
  if (!apiKey || apiKey === 'MY_ODDS_API_KEY') {
    console.log("Sem API_KEY real, abortando script de cobertura");
    return;
  }

  // Pegar algumas ligas ativas
  const matches = await fetchAllMatches(apiKey, ['soccer_brazil_campeonato', 'soccer_epl', 'soccer_spain_la_liga']);
  
  let hasPinnacle = 0;
  let onlyBetfair = 0;
  let noRef = 0;

  matches.forEach(m => {
    const pinnacle = m.bookmakers.find(b => b.key === 'pinnacle');
    const betfair = m.bookmakers.find(b => b.key === 'betfair_ex_eu');

    if (pinnacle) hasPinnacle++;
    else if (betfair) onlyBetfair++;
    else noRef++;
  });

  console.log(`=== ESTATÍSTICAS DE COBERTURA ===`);
  console.log(`Total de jogos nas ligas avaliadas: ${matches.length}`);
  console.log(`Com Pinnacle: ${hasPinnacle} (${((hasPinnacle/matches.length)*100).toFixed(1)}%)`);
  console.log(`Apenas Betfair: ${onlyBetfair} (${((onlyBetfair/matches.length)*100).toFixed(1)}%)`);
  console.log(`Sem Referência Sharp: ${noRef} (${((noRef/matches.length)*100).toFixed(1)}%)`);

  if (matches.length > 0) {
    console.log("\n=== PAYLOAD SAMPLE (Primeiro Jogo) ===");
    const m = matches[0];
    console.log(`Jogo: ${m.home_team} vs ${m.away_team}`);
    m.bookmakers.forEach(b => {
      console.log(`- Bookmaker: ${b.key}`);
      const h2h = b.markets.find((m: any) => m.key === 'h2h');
      if (h2h) {
        h2h.outcomes.forEach((o: any) => console.log(`  > ${o.name}: ${o.price}`));
      }
    });
  }
}

testApi();
