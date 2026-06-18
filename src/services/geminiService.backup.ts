/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";
import { Match, AnalysisResponse } from "../types";
import { calculateElo, sanitizeEloRatings } from "./eloService";
import { calculatePoisson, debugPoisson } from "./poissonService";

import { fetchRealScouting, fetchInjuries } from "./scoutingService";
import { fetchMatchStats, LEAGUE_ID_MAP } from "./fixtureStatsService";
import { TipsterAnalysisService } from "./tipsterAnalysisService";
import { removeOverround, extractMarketReference } from "./valueBetService";
import { GEMINI_MODEL } from "../config/ai";
import { getCachedAnalysis, setCachedAnalysis } from "./analysisCacheService";


const tipsterService = new TipsterAnalysisService();


let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (aiInstance) return aiInstance;
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey.length < 10) return null;
  aiInstance = new GoogleGenAI({ apiKey });
  return aiInstance;
}

export async function callGeminiAPI(systemPrompt: string, userMessage: string, responseFormat = "json") {
  const ai = getAI();
  if (!ai) {
    throw new Error("Gemini AI instance not initialized. Check your API key.");
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],

      config: {
        systemInstruction: systemPrompt,
        responseMimeType: responseFormat === "json" ? "application/json" : "text/plain",
      }
    });

    const text = response.text || '';
    return text;
  } catch (error) {
    console.error("Gemini API call failed:", error);
    throw error;
  }
}

export async function analyzeMatch(match: Match): Promise<AnalysisResponse> {
  console.log("🟡 FUNÇÃO ANALYZEMATCH CHAMADA PARA:", match.id);

  // CACHE COMPARTILHADO (Supabase): a mesma partida não é mais reanalisada
  // por cada navegador/usuário — todos consultam e gravam na mesma tabela.
  const cached = await getCachedAnalysis(match.id);
  if (cached) {
    return cached;
  }
 
  const leagueId = LEAGUE_ID_MAP[match.sport_key] || 71;

  // 1. Context gathering in parallel
  const [scouting, homeInjuries, awayInjuries, stats] = await Promise.all([
    fetchRealScouting(match.home_team, match.away_team, leagueId),
    fetchInjuries(match.home_team, leagueId),
    fetchInjuries(match.away_team, leagueId),
    fetchMatchStats(match.home_team, match.away_team, leagueId)
  ]);

  const marketRef = extractMarketReference(match);

  let refText = "Referência Sharp não disponível.";
  if (marketRef.hasReference && marketRef.fairProbs.length >= 3) {
    refText = `Probabilidades de referência (vig-free, vindas do ${marketRef.sharpBookmaker === 'pinnacle' ? 'Pinnacle' : 'Betfair Exchange'}):
- Casa: ${(marketRef.fairProbs[0]*100).toFixed(1)}%
- Empate: ${(marketRef.fairProbs[1]*100).toFixed(1)}%
- Fora: ${(marketRef.fairProbs[2]*100).toFixed(1)}%

Essas são as probabilidades JUSTAS do mercado segundo bookmakers sharp (referência mundial de pricing). Sua análise deve **divergir** dessas probabilidades quando você tiver convicção baseada em contexto (lesões, forma, motivação, fatores qualitativos). Concordância perfeita com o mercado não gera value.`;
  }

  const prompt = `
Você é EVEngine AI v8.0, um motor de inteligência preditiva.
Analise: ${match.home_team} vs ${match.away_team} (${match.sport_title}).

DADOS REAIS:
${refText}
- Forma H: ${scouting.home_form.join('')}, A: ${scouting.away_form.join('')}
- Desfalques Casa: ${homeInjuries.join(', ')}
- Desfalques Visitante: ${awayInjuries.join(', ')}
- Stats Recentes: ${JSON.stringify(stats)}

REGRAS RÍGIDAS:
1. Nenhuma probabilidade pode exceder 95%.
2. Variação máxima de ±10pp em relação à probabilidade implícita das odds.
3. recomenda: true apenas se probabilidade >= 70% (gols) ou >= 75% (outros).
4. Over 1.5 >= Over 2.5 >= Over 3.5 SEMPRE.

Retorne JSON:
{
  "resumo": "Análise técnica curta",
  "gols": {
    "over15": {"probabilidade": 85, "confianca": "alta", "recomenda": true},
    "over25": {"probabilidade": 60, "confianca": "media", "recomenda": false},
    "over35": {"probabilidade": 35, "confianca": "baixa", "recomenda": false}
  },
  "escanteios": {"faixa_esperada": "9-11", "observacao": "...", "probabilidade": 80},
  "finalizacoes": {"faixa_esperada": "24-28", "observacao": "...", "probabilidade": 75},
  "dupla_chance": {
    "1X": {"probabilidade": 82, "odd_equivalente": 1.22, "recomenda": true},
    "X2": {"probabilidade": 45, "odd_equivalente": 2.22, "recomenda": false},
    "12": {"probabilidade": 78, "odd_equivalente": 1.28, "recomenda": true}
  },
  "probabilidades_ml": {"casa": 55, "empate": 25, "fora": 20},
  "dica_principal": "Texto da dica",
  "home_expected_goals": 1.8,
  "away_expected_goals": 1.1,
  "qualidade_score": 88
}
`;

  // TODO: IMPORTANTE 4 — O system prompt abaixo ("Você é EVEngine AI v8.0...") é redundante
  // com o conteúdo do `prompt` acima, que já contém REGRAS RÍGIDAS e contexto completo.
  // Refatoração recomendada: mover REGRAS RÍGIDAS e contexto para o system prompt e
  // deixar apenas dados dinâmicos (times, odds, lesões, stats) no user message.
  // Não alterar agora para evitar quebra de comportamento em produção.
  const ai = getAI();
  let analysis: any;

  if (ai) {
    try {
      const rawText = await callGeminiAPI(
        "Você é EVEngine AI v8.0, um motor de inteligência preditiva para apostas esportivas.",
        prompt,
        "json"
      );
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      analysis = JSON.parse(cleaned);

      // Validação de segurança para garantir que campos vitais existam
      if (!analysis.probabilidades_ml) {
        analysis.probabilidades_ml = { casa: 33, empate: 34, fora: 33 };
      }
      if (analysis.home_expected_goals === undefined) analysis.home_expected_goals = 1.4;
      if (analysis.away_expected_goals === undefined) analysis.away_expected_goals = 1.2;

    } catch (e: any) {
      console.error("Analysis failed, using fallback:", e);
      analysis = generateFallbackAnalysis(match, scouting);
    }
  } else {
    analysis = generateFallbackAnalysis(match, scouting);
  }

  // Sanitização em sequência
  // IMPORTANTE 2: sanitizeWithOdds removida (era no-op completo)
  analysis = sanitizeAnalysis(analysis);
  analysis = sanitizeGolsProbabilities(analysis);
  analysis = sanitizeMarketConsistency(analysis);
  analysis = validateEscanteiosFinal(analysis);

  // Sobrescrever com modelos reais
  analysis.scouting = scouting;
  analysis.scouting.desfalques = homeInjuries;
  analysis.scouting.away_desfalques = awayInjuries;
  analysis.desfalques = homeInjuries;
  analysis.elo = calculateElo(match);
  analysis.poisson = calculatePoisson(analysis.home_expected_goals, analysis.away_expected_goals, match.sport_title || match.sport_key);
  debugPoisson(analysis.home_expected_goals, analysis.away_expected_goals, analysis.poisson, analysis.poisson.fonteXg);

  analysis.qualidade = analysis.qualidade_score || 70;


  // 4. Tipster Analysis Integration
  try {
    const oddH = marketRef.hasReference && marketRef.rawOdds.length > 0 ? marketRef.rawOdds[0] : 2.0;

    const tipsterResult = tipsterService.analyzePick({
      match: {
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        date: match.commence_time,
      },
      market: { type: '1x2', outcome: 'Home' }, // Defaulting to Home for tipster baseline
      odds: oddH,
      bankroll: 1000,
    }, {
      winRate: (analysis.qualidade || 70) / 100,
      avgOdds: 2.0,
      roi: 0.08,
      dailyLimit: 100
    });

    analysis.tipster = tipsterResult;
  } catch (e) {
    console.warn("Tipster analysis skipped:", e);
  }

  analysis.marketReference = marketRef;

  // CACHE COMPARTILHADO: grava no Supabase em vez de localStorage.
  // Não bloqueia o retorno — se a gravação falhar, o usuário ainda recebe a análise.
 console.log("🔵 TENTANDO SALVAR NO CACHE:", match.id);
setCachedAnalysis(match, analysis).then(() => {
  console.log("✅ CACHE SALVO COM SUCESSO");
}).catch((err) => {
  console.error("🔴 ERRO AO SALVAR CACHE:", err);
});

  return analysis;
}

function generateFallbackAnalysis(match: Match, scouting: any): any {
  return {
    resumo: "[MODO DE SEGURANÇA] API indisponível. Usando modelos estatísticos locais.",
    gols: {
      over15: { probabilidade: 70, confianca: "media", recomenda: false },
      over25: { probabilidade: 45, confianca: "baixa", recomenda: false },
      over35: { probabilidade: 20, confianca: "baixa", recomenda: false }
    },
    escanteios: { faixa_esperada: "8-10", observacao: "Média da liga", probabilidade: 60 },
    finalizacoes: { faixa_esperada: "22-26", observacao: "Média da liga", probabilidade: 60 },
    dupla_chance: {
      "1X": { probabilidade: 65, odd_equivalente: 1.5, recomenda: false },
      "X2": { probabilidade: 65, odd_equivalente: 1.5, recomenda: false },
      "12": { probabilidade: 70, odd_equivalente: 1.4, recomenda: false }
    },
    probabilidades_ml: { casa: 33, empate: 34, fora: 33 },
    dica_principal: "Aguarde retorno da IA para análise profunda",
    home_expected_goals: 1.2,
    away_expected_goals: 1.1,
    qualidade_score: 50
  };
}

function sanitizeAnalysis(data: any): any {
  const limit = (v: number) => Math.min(Math.max(v || 0, 1), 95);

  if (data.probabilidades_ml) {
    data.probabilidades_ml.casa = limit(data.probabilidades_ml.casa);
    data.probabilidades_ml.empate = limit(data.probabilidades_ml.empate);
    data.probabilidades_ml.fora = limit(data.probabilidades_ml.fora);

    const total = data.probabilidades_ml.casa + data.probabilidades_ml.empate + data.probabilidades_ml.fora;
    data.probabilidades_ml.casa = Math.round((data.probabilidades_ml.casa / total) * 100);
    data.probabilidades_ml.empate = Math.round((data.probabilidades_ml.empate / total) * 100);
    data.probabilidades_ml.fora = 100 - data.probabilidades_ml.casa - data.probabilidades_ml.empate;
  }

  const checkRec = (obj: any, isGoal: boolean = false) => {
    const threshold = isGoal ? 70 : 75;
    if (obj && obj.probabilidade < threshold) obj.recomenda = false;
  };

  checkRec(data.gols?.over15, true);
  checkRec(data.gols?.over25, true);
  checkRec(data.gols?.over35, true);
  checkRec(data.dupla_chance?.['1X']);
  checkRec(data.dupla_chance?.['X2']);
  checkRec(data.dupla_chance?.['12']);

  return data;
}

// IMPORTANTE 2: sanitizeWithOdds removida — era no-op completo (apenas retornava data sem alterações)

function sanitizeGolsProbabilities(data: any): any {
  if (!data.gols) return data;
  const g = data.gols;
  const o15 = g.over15?.probabilidade || 0;
  const o25 = g.over25?.probabilidade || 0;
  const o35 = g.over35?.probabilidade || 0;

  // CRÍTICO 1: Garantir monotonicidade estrita (Over 1.5 > Over 2.5 > Over 3.5)
  // sem aplicar ratios fixos. Ordena os valores originais de forma decrescente
  // e os atribui às posições corretas com cap de 95%.
  if (o25 > o15 || o35 > o25 || o35 > o15 || o15 === o25) {
    const sorted = [o15, o25, o35].sort((a, b) => b - a);
    g.over15.probabilidade = Math.min(sorted[0], 95);
    g.over25.probabilidade = Math.min(sorted[1], 95);
    g.over35.probabilidade = Math.min(sorted[2], 95);

    // Recalcular recomendações após ajuste
    if (g.over15.probabilidade < 70) g.over15.recomenda = false;
    if (g.over25.probabilidade < 70) g.over25.recomenda = false;
    if (g.over35.probabilidade < 70) g.over35.recomenda = false;
  }
  return data;
}

function sanitizeMarketConsistency(data: any): any {
  if (!data.probabilidades_ml || !data.dupla_chance) return data;

  const ml = data.probabilidades_ml;
  const dc = data.dupla_chance;

  // 1. Enforce ML sum = 100
  const totalML = ml.casa + ml.empate + ml.fora;
  ml.casa = Math.round((ml.casa / totalML) * 100);
  ml.empate = Math.round((ml.empate / totalML) * 100);
  ml.fora = 100 - ml.casa - ml.empate;

  // 2. Enforce DC = ML combinations
  dc['1X'].probabilidade = Math.min(ml.casa + ml.empate, 95);
  dc['X2'].probabilidade = Math.min(ml.empate + ml.fora, 95);
  dc['12'].probabilidade = Math.min(ml.casa + ml.fora, 95);

  // 3. Sync recommendations for DC based on new probs
  const syncRec = (obj: any) => {
    if (obj.probabilidade >= 75) obj.recomenda = true;
    else obj.recomenda = false;
  };

  syncRec(dc['1X']);
  syncRec(dc['X2']);
  syncRec(dc['12']);

  return data;
}

function validateEscanteiosFinal(analysis: any): any {
  // MENOR 5: variável `match` renomeada para `rangeMatch` para evitar shadow do escopo externo
  if (analysis.escanteios?.faixa_esperada) {
    const faixa = analysis.escanteios.faixa_esperada;
    const rangeMatch = faixa.match(/(\d+)-(\d+)/);

    if (rangeMatch) {
      const min = parseInt(rangeMatch[1], 10);
      const max = parseInt(rangeMatch[2], 10);
      const margem = max - min;

      if (margem < 2) {
        analysis.escanteios.probabilidade = Math.min(analysis.escanteios.probabilidade, 60);
        analysis.escanteios.observacao = (analysis.escanteios.observacao || '') + ' | Margem apertada — alta variância';
      }
    }
  }

  if (analysis.finalizacoes?.faixa_esperada) {
    const faixa = analysis.finalizacoes.faixa_esperada;
    const rangeMatch = faixa.match(/(\d+)-(\d+)/);

    if (rangeMatch) {
      const min = parseInt(rangeMatch[1], 10);
      const max = parseInt(rangeMatch[2], 10);
      const margem = max - min;

      if (margem < 4) {
        analysis.finalizacoes.probabilidade = Math.min(analysis.finalizacoes.probabilidade, 65);
        analysis.finalizacoes.observacao = (analysis.finalizacoes.observacao || '') + ' | Margem apertada — alta variância';
      }
    }
  }

  return analysis;
}
