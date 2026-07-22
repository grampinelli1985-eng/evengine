import { fetchRealScouting } from './src/services/scoutingService.js';
import { runTipsterEngine } from './src/services/tipsterEngine.js';

// Mock localStorage
if (typeof global !== 'undefined') {
  (global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    clear: () => {}
  };
}

async function testProd() {
  console.log("Iniciando análise real...");
  try {
    // Fazer uma requisição real passando um jogo (ex: Arsenal x Chelsea, etc)
    const report = await fetchRealScouting('Arsenal', 'Chelsea', 39, 'soccer_epl');
    console.log("Scouting Report:", JSON.stringify(report, null, 2));

    const result = await runTipsterEngine({
      analysis: {
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        scouting: report
      },
      matchCardValues: {
        ev: 10,
        kelly: 2,
        tier: 'A',
        confianca: 80,
        convergenciaOk: true
      },
      bancaTotal: 1000,
      pendentesCount: 0
    });
    console.log("Engine Verdict:", JSON.stringify(result, null, 2));
  } catch(e) {
    console.error("Erro:", e);
  }
}
testProd();
