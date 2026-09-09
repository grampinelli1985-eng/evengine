/**
 * supabase/functions/gemini-proxy/index.ts
 * S-1 FIX — Gemini API proxy. GEMINI_API_KEY stays server-side only.
 *
 * Deploy: supabase functions deploy gemini-proxy --no-verify-jwt
 * Secret: supabase secrets set GEMINI_API_KEY=<your-key>
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeminiRequestBody {
  systemInstruction: string;
  userMessage: string;
  responseFormat?: "json" | "text";
  schema?: object;
  model?: string;
  fallbackModel?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // ── Validate Supabase JWT ──────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization header" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Parse request body ─────────────────────────────────────────────────────
  let body: GeminiRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { systemInstruction, userMessage, responseFormat = "json", schema, model, fallbackModel } = body;
  if (!systemInstruction || !userMessage) {
    return new Response(JSON.stringify({ error: "Missing systemInstruction or userMessage" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "Gemini API key not configured on server" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Call Gemini REST API ───────────────────────────────────────────────────
  const targetModel = model ?? "gemini-2.0-flash";
  const text = await callGemini(GEMINI_API_KEY, targetModel, systemInstruction, userMessage, responseFormat, schema, fallbackModel);

  return new Response(JSON.stringify({ text }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});

async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userMessage: string,
  responseFormat: "json" | "text",
  schema?: object,
  fallbackModel?: string
): Promise<string> {
  const payload: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      responseMimeType: responseFormat === "json" ? "application/json" : "text/plain",
      maxOutputTokens: 1200,
      temperature: 0.2,
      ...(schema ? { responseSchema: schema } : {}),
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Fallback to alternate model on 404
  if (resp.status === 404 && fallbackModel) {
    console.warn(`[gemini-proxy] model ${model} not found, falling back to ${fallbackModel}`);
    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`;
    resp = await fetch(fallbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload }),
    });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
