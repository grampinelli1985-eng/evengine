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
import { detectLineMovement } from "./lineMovementService";
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

// ============================================================
// OTIMIZAÇÃO 1: System prompt fixo com TODAS as regras rígidas.
// Antes: regras viviam dentro do `prompt` (texto), repetidas em
// toda chamada junto com o restante do contexto dinâmico.
// Agora: regras ficam só aqui — um bloco estável, mais barato de
// processar e que não precisa ser re-redigido por jogo.
// ============================================================
const SYSTEM_INSTRUCTION = `Você é EVEngine AI, motor de inteligência preditiva para apostas esportivas sharp.

REGRAS RÍGIDAS (sempre aplicam):
1. Nenhuma probabilidade pode exceder 95%.
2. Variação máxima de ±10pp em relação à probabilidade implícita das odds.
3. recomenda: true apenas se probabilidade >= 70% (gols) ou >= 75% (outros).
4. Over 1.5 >= Over 2.5 >= Over 3.5 SEMPRE.
5. Quando houver referência sharp (Pinnacle/Betfair Exchange), sua análise deve
   DIVERGIR dela apenas quando houver convicção real baseada em contexto
   qualitativo (lesões, forma, motivação). Concordância cega não gera value.
6. Quando houver movimento de linha (steam move) informado, isso é sinal de
   dinheiro sharp entrando — favoreça a direção do movimento, salvo evidência
   qualitativa forte em contrário, e mencione isso no campo "resumo".`;

// ============================================================
// OTIMIZAÇÃO 2: responseSchema em vez de exemplo JSON no prompt.
// Antes: o prompt incluía um objeto JSON de exemplo completo como
// texto (~150-200 tokens de output "desperdiçados" ensinando o
// formato). Agora: o schema é declarado estruturalmente e o
// próprio SDK garante a forma da resposta — sem gastar tokens de
// prompt explicando isso, e sem risco de o modelo "inventar" campos.
// ============================================================
const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    resumo: { type: Type.STRING },
    gols: {
      type: Type.OBJECT,
      properties: {
        over15: {
          type: Type.OBJECT,
          properties: {
            probabilidade: { type: Type.NUMBER },
            confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"] },
            recomenda: { type: Type.BOOLEAN },
          },
          required: ["probabilidade", "confianca", "recomenda"],
        },
        over25: {
          type: Type.OBJECT,
          properties: {
            probabilidade: { type: Type.NUMBER },
            confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"] },
            recomenda: { type: Type.BOOLEAN },
          },
          required: ["probabilidade", "confianca", "recomenda"],
        },
        over35: {
          type: Type.OBJECT,
          properties: {
            probabilidade: { type: Type.NUMBER },
            confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"] },
            recomenda: { type: Type.BOOLEAN },
          },
          required: ["probabilidade", "confianca", "recomenda"],
        },
      },
      required: ["over15", "over25", "over35"],
    },
    escanteios: {
      type: Type.OBJECT,
      properties: {
        faixa_esperada: { type: Type.STRING },
        observacao: { type: Type.STRING },
        probabilidade: { type: Type.NUMBER },
      },
      required: ["faixa_esperada", "probabilidade"],
    },
    finalizacoes: {
      type: Type.OBJECT,
      properties: {
        faixa_esperada: { type: Type.STRING },
        observacao: { type: Type.STRING },
        probabilidade: { type: Type.NUMBER },
      },
      required: ["faixa_esperada", "probabilidade"],
    },
    dupla_chance: {
      type: Type.OBJECT,
      properties: {
        "1X": {
          type: Type.OBJECT,
          properties: {
            probabilidade: { type: Type.NUMBER },
            odd_equivalente: { type: Type.NUMBER },
            recomenda: { type: Type.BOOLEAN },
          },
          required: ["probabilidade", "odd_equivalente", "recomenda"],
        },
        X2: {
          type: Type.OBJECT,
          properties: {
            probabilidade: { type: Type.NUMBER },
            odd_equivalente: { type: Type.NUMBER },
            recomenda: { type: Type.BOOLEAN },
          },
          required: ["probabilidade", "odd_equivalente", "recomenda"],
        },
        "12": {
          type: Type.OBJECT,
          properties: {
            probabilidade: { type: Type.NUMBER },
            odd_equivalente: { type: Type.NUMBER },
            recomenda: { type: Type.BOOLEAN },
          },
          required: ["probabilidade", "odd_equivalente", "recomenda"],
        },
      },
      required: ["1X", "X2", "12"],
    },
    probabilidades_ml: {
      type: Type.OBJECT,
      properties: {
        casa: { type: Type.NUMBER },
        empate: { type: Type.NUMBER },
        fora: { type: Type.NUMBER },
      },
      required: ["casa", "empate", "fora"],
    },
    dica_principal: { type: Type.STRING },
    home_expected_goals: { type: Type.NUMBER },
    away_expected_goals: { type: Type.NUMBER },
    qualidade_score: { type: Type.NUMBER },
  },
  required: [
    "resumo",
    "gols",
    "escanteios",
    "finalizacoes",
    "dupla_chance",
    "probabilidades_ml",
    "dica_principal",
    "home_expected_goals",
    "away_expected_goals",
    "qualidade_score",
  ],
};

export async function callGeminiAPI(
  systemPrompt: string,
  userMessage: string,
  responseFormat: "json" | "text" = "json",
  schema?: object
) {
  const ai = getAI();
  if (!ai) {
    throw new Error("Gemini AI instance not initialized. Check your API key.");
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: responseFormat === "json" ? "application/json" : "text/plain",
        ...(schema ? { responseSchema: schema } : {}),
      },
    });

    const text = response.text || "";
    return text;
  } catch (error) {
    console.error("Gemini API call failed:", error);
    throw error;
  }
}

export async function analyzeMatch(match: Match): Promise<AnalysisResponse> {
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
    fetchMatchStats(match.home_team, match.away_team, leagueId),
  ]);

  const marketRef = extractMarketReference(match);

  // ============================================================
  // MELHORIA DE QUALIDADE SHARP: line movement (steam) já existia
  // em lineMovementService.ts mas não estava conectado ao prompt
  // da IA. Conectamos aqui — é exatamente o tipo de sinal que torna
  // a análise mais "sharp" (segue o dinheiro informado), sem custo
  // de API adicional (é cálculo local, só formatação de texto).
  // ============================================================
  const lineMovement = detectLineMovement(match);

  let refText = "Referência Sharp não disponível.";
  if (marketRef.hasReference && marketRef.fairProbs.length >= 3) {
    refText = `Probabilidades de referência (vig-free, vindas do ${marketRef.sharpBookmaker === "pinnacle" ? "Pinnacle" : "Betfair Exchange"}):
- Casa: ${(marketRef.fairProbs[0] * 100).toFixed(1)}%
- Empate: ${(marketRef.fairProbs[1] * 100).toFixed(1)}%
- Fora: ${(marketRef.fairProbs[2] * 100).toFixed(1)}%`;
  }

  let lineMovementText = "Movimento de linha: sem dados de abertura registrados.";
  if (lineMovement) {
    const { variation, tem_steam } = lineMovement;
    lineMovementText = `Movimento de linha desde a abertura — Casa: ${variation.home.toFixed(1)}%, Empate: ${variation.draw.toFixed(1)}%, Fora: ${variation.away.toFixed(1)}%.${tem_steam ? " ⚠️ STEAM MOVE DETECTADO (queda ≥8% em até 2h da abertura — sinal de dinheiro sharp)." : ""}`;
  }

  // ============================================================
  // OTIMIZAÇÃO 3: stats formatado como texto compacto em vez de
  // JSON.stringify bruto. Reduz ruído de sintaxe (chaves, aspas)
  // que não ajuda o modelo e só consome tokens.
  // ============================================================
  const statsText = formatStatsCompact(stats);

  // ============================================================
  // OTIMIZAÇÃO 4: prompt agora só com dados dinâmicos do jogo.
  // Regras rígidas e persona já estão no SYSTEM_INSTRUCTION fixo.
  // ============================================================
  const prompt = `Analise: ${match.home_team} vs ${match.away_team} (${match.sport_title}).

${refText}

${lineMovementText}

- Forma H: ${scouting.home_form.join("")}, A: ${scouting.away_form.join("")}
- Desfalques Casa: ${homeInjuries.join(", ") || "nenhum reportado"}
- Desfalques Visitante: ${awayInjuries.join(", ") || "nenhum reportado"}
- Stats recentes: ${statsText}`;

  const ai = getAI();
  let analysis: any;

  if (ai) {
    try {
      const rawText = await callGeminiAPI(
        SYSTEM_INSTRUCTION,
        prompt,
        "json",
        ANALYSIS_SCHEMA
      );
      // Com responseSchema, a resposta já vem como JSON válido — mas
      // mantemos a limpeza de fences por segurança (defensivo, custo zero).
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
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
  analysis.poisson = calculatePoisson(
    analysis.home_expected_goals,
    analysis.away_expected_goals,
    match.sport_title || match.sport_key
  );
  debugPoisson(
    analysis.home_expected_goals,
    analysis.away_expected_goals,
    analysis.poisson,
    analysis.poisson.fonteXg
  );

  analysis.qualidade = analysis.qualidade_score || 70;

  // 4. Tipster Analysis Integration
  try {
    const oddH = marketRef.hasReference && marketRef.rawOdds.length > 0 ? marketRef.rawOdds[0] : 2.0;

    const tipsterResult = tipsterService.analyzePick(
      {
        match: {
          homeTeam: match.home_team,
          awayTeam: match.away_team,
          date: match.commence_time,
        },
        market: { type: "1x2", outcome: "Home" },
        odds: oddH,
        bankroll: 1000,
      },
      {
        winRate: (analysis.qualidade || 70) / 100,
        avgOdds: 2.0,
        roi: 0.08,
        dailyLimit: 100,
      }
    );

    analysis.tipster = tipsterResult;
  } catch (e) {
    console.warn("Tipster analysis skipped:", e);
  }

  analysis.marketReference = marketRef;

  // CACHE COMPARTILHADO: grava no Supabase em vez de localStorage.
  // Não bloqueia o retorno — se a gravação falhar, o usuário ainda recebe a análise.
  void setCachedAnalysis(match, analysis);

  return analysis;
}

/**
 * Formata stats em texto compacto, evitando o ruído sintático de
 * JSON.stringify bruto (chaves, aspas repetidas) que só consome
 * tokens sem ajudar a qualidade da resposta do modelo.
 */
function formatStatsCompact(stats: any): string {
  if (!stats || typeof stats !== "object") return "indisponível";
  try {
    return Object.entries(stats)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(", ");
  } catch {
    return "indisponível";
  }
}

function generateFallbackAnalysis(match: Match, scouting: any): any {
  return {
    resumo: "[MODO DE SEGURANÇA] API indisponível. Usando modelos estatísticos locais.",
    gols: {
      over15: { probabilidade: 70, confianca: "media", recomenda: false },
      over25: { probabilidade: 45, confianca: "baixa", recomenda: false },
      over35: { probabilidade: 20, confianca: "baixa", recomenda: false },
    },
    escanteios: { faixa_esperada: "8-10", observacao: "Média da liga", probabilidade: 60 },
    finalizacoes: { faixa_esperada: "22-26", observacao: "Média da liga", probabilidade: 60 },
    dupla_chance: {
      "1X": { probabilidade: 65, odd_equivalente: 1.5, recomenda: false },
      X2: { probabilidade: 65, odd_equivalente: 1.5, recomenda: false },
      "12": { probabilidade: 70, odd_equivalente: 1.4, recomenda: false },
    },
    probabilidades_ml: { casa: 33, empate: 34, fora: 33 },
    dica_principal: "Aguarde retorno da IA para análise profunda",
    home_expected_goals: 1.2,
    away_expected_goals: 1.1,
    qualidade_score: 50,
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
  checkRec(data.dupla_chance?.["1X"]);
  checkRec(data.dupla_chance?.["X2"]);
  checkRec(data.dupla_chance?.["12"]);

  return data;
}

function sanitizeGolsProbabilities(data: any): any {
  if (!data.gols) return data;
  const g = data.gols;
  const o15 = g.over15?.probabilidade || 0;
  const o25 = g.over25?.probabilidade || 0;
  const o35 = g.over35?.probabilidade || 0;

  if (o25 > o15 || o35 > o25 || o35 > o15 || o15 === o25) {
    const sorted = [o15, o25, o35].sort((a, b) => b - a);
    g.over15.probabilidade = Math.min(sorted[0], 95);
    g.over25.probabilidade = Math.min(sorted[1], 95);
    g.over35.probabilidade = Math.min(sorted[2], 95);

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

  const totalML = ml.casa + ml.empate + ml.fora;
  ml.casa = Math.round((ml.casa / totalML) * 100);
  ml.empate = Math.round((ml.empate / totalML) * 100);
  ml.fora = 100 - ml.casa - ml.empate;

  dc["1X"].probabilidade = Math.min(ml.casa + ml.empate, 95);
  dc["X2"].probabilidade = Math.min(ml.empate + ml.fora, 95);
  dc["12"].probabilidade = Math.min(ml.casa + ml.fora, 95);

  const syncRec = (obj: any) => {
    if (obj.probabilidade >= 75) obj.recomenda = true;
    else obj.recomenda = false;
  };

  syncRec(dc["1X"]);
  syncRec(dc["X2"]);
  syncRec(dc["12"]);

  return data;
}

function validateEscanteiosFinal(analysis: any): any {
  if (analysis.escanteios?.faixa_esperada) {
    const faixa = analysis.escanteios.faixa_esperada;
    const rangeMatch = faixa.match(/(\d+)-(\d+)/);

    if (rangeMatch) {
      const min = parseInt(rangeMatch[1], 10);
      const max = parseInt(rangeMatch[2], 10);
      const margem = max - min;

      if (margem < 2) {
        analysis.escanteios.probabilidade = Math.min(analysis.escanteios.probabilidade, 60);
        analysis.escanteios.observacao = (analysis.escanteios.observacao || "") + " | Margem apertada — alta variância";
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
        analysis.finalizacoes.observacao = (analysis.finalizacoes.observacao || "") + " | Margem apertada — alta variância";
      }
    }
  }

  return analysis;
}
