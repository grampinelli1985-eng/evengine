import { GoogleGenAI, Type } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

const GEMINI_MODEL = "gemini-3.5-flash";

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
   qualitativa forte em contrário, e mencione isso no campo "resumo".
7. O campo "resumo" deve ser sucinto e objetivo (no máximo 2 frases, máximo 35 palavras).
8. Responda EXCLUSIVAMENTE com o objeto JSON puro. Não inclua nenhum texto antes ou depois, nem blocos de código markdown.`;

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
        total_esperado: { type: Type.NUMBER },
        probabilidade_over85: { type: Type.NUMBER },
        confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"] },
        recomenda: { type: Type.BOOLEAN },
      },
      required: ["total_esperado", "probabilidade_over85", "confianca", "recomenda"],
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
    mercados_alternativos: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["resumo", "gols", "escanteios", "probabilidades_ml", "mercados_alternativos"],
};

const userMessage = `Analise: Arsenal vs Chelsea (Premier League).

Probabilidades de referência (vig-free, vindas do Pinnacle):
- Casa: 45.0%
- Empate: 25.0%
- Fora: 30.0%

Movimento de linha desde a abertura — Casa: -5.0%, Empate: 2.0%, Fora: 3.0%. ⚠️ STEAM MOVE DETECTADO (queda >=8% em até 2h da abertura — sinal de dinheiro sharp).

- Forma H: W,D,W,W,L, A: L,D,D,L,W
- Desfalques Casa: Partey, Saka
- Desfalques Visitante: James, Chilwell
- Stats recentes: 
* Arsenal (Rank 2) - Gols: 2.1 Média pró, 0.9 Média sofrida
* Chelsea (Rank 10) - Gols: 1.2 Média pró, 1.5 Média sofrida`;

const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY || '' });

function extrairJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

async function run() {
  console.log("=== INICIANDO TESTE E2E DA API GEMINI 3.5 FLASH ===");
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        maxOutputTokens: 600,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.2,
        responseSchema: ANALYSIS_SCHEMA
      },
    });
    
    console.log("TEXTO BRUTO RECEBIDO:");
    console.log(response.text);
    console.log("------------------------");
    
    if (response.text) {
        if (!response.text.endsWith("}") && !response.text.trim().endsWith("}")) {
            console.log("⚠️ AVISO: A resposta não termina com '}' - PROVÁVEL TRUNCAMENTO!");
            console.log("Comprimento da string:", response.text.length);
        } else {
            console.log("✅ A resposta parece terminar corretamente com '}'.");
        }
        
        const extracted = extrairJSON(response.text);
        console.log("JSON EXTRAÍDO:");
        console.log(extracted);
        
        try {
            JSON.parse(extracted);
            console.log("✅ JSON.parse FUNCIONOU PERFEITAMENTE!");
        } catch (err) {
            console.error("❌ ERRO NO JSON.parse:", err);
        }
    } else {
        console.log("❌ Resposta vazia recebida.");
    }

  } catch (error) {
    console.error("Gemini API call failed:", error);
  }
}

run();
