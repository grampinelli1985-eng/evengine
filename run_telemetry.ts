import { fetchAllMatches } from './src/services/oddsService';
import { analyzeMatch } from './src/services/geminiService';
import { getGeminiCallCount, resetGeminiCallCounter } from './src/services/telemetryService';
import { describe, it } from 'vitest';

describe('Real Analyses', () => {
  it('runs 3 analyses and prints telemetry', async () => {
    console.log("Buscando partidas...");
    const matches = await fetchAllMatches();
    const targetMatches = matches.slice(0, 3);
    
    console.log(`Foram encontradas ${matches.length} partidas. Analisando as 3 primeiras...`);

    for (let i = 0; i < targetMatches.length; i++) {
      const match = targetMatches[i];
      console.log(`\n--- Analisando Partida ${i+1}: ${match.home_team} vs ${match.away_team} ---`);
      resetGeminiCallCounter();
      
      try {
        await analyzeMatch(match);
        console.log(`✅ Concluído. Chamadas Gemini totais: ${getGeminiCallCount()}`);
      } catch (e) {
        console.error(`❌ Erro na análise:`, e);
        console.log(`Chamadas Gemini até o erro: ${getGeminiCallCount()}`);
      }
    }
  }, 120000); // 2 min timeout
});
