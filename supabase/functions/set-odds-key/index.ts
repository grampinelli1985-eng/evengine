/**
 * supabase/functions/set-odds-key/index.ts
 * Admin-only: replaces the platform Odds API key used by odds-proxy.
 *
 * POST {SUPABASE_URL}/functions/v1/set-odds-key
 *   Authorization: Bearer <user_jwt>     (caller must have profiles.is_admin = true)
 *   Body: { "apiKey": "<new key>" }
 *
 * The key is validated against the Odds API BEFORE it is stored, using the free
 * /sports endpoint (0 credits): it must be accepted and must still have credits.
 * It is then upserted into platform_secrets (service-role only), which odds-proxy
 * reads first — so the swap takes effect on the next proxy call, no redeploy.
 * The key is never echoed back; only its non-reversible id and the credits left.
 *
 * Responses:
 *   200 { ok: true, key_id, remaining }
 *   400 { error: "INVALID_FORMAT" }
 *   401 { error: "Unauthorized" }
 *   403 { error: "FORBIDDEN" }
 *   422 { error: "INVALID_KEY" | "OUT_OF_CREDITS" }
 *   502 { error: "UPSTREAM_ERROR" }
 *
 * Deploy: supabase functions deploy set-odds-key --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SECRET_NAME = "ODDS_API_KEY";
const KEY_FORMAT = /^[A-Za-z0-9]{16,64}$/;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Same id odds-proxy returns in x-odds-key-id (truncated SHA-256). */
async function keyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json(401, { error: "Unauthorized" });

  const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: profile } = await adminClient
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.is_admin !== true) return json(403, { error: "FORBIDDEN" });

  let apiKey = "";
  try {
    const body = await req.json();
    apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  } catch { /* corpo inválido cai no INVALID_FORMAT */ }
  if (!KEY_FORMAT.test(apiKey)) return json(400, { error: "INVALID_FORMAT" });

  // /sports é gratuito: responde 401 para chave inválida e 200 (com a cota nos headers) para
  // chave válida — inclusive quando os créditos acabaram, o que checamos abaixo.
  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
  } catch {
    return json(502, { error: "UPSTREAM_ERROR" });
  }
  if (upstream.status === 401) return json(422, { error: "INVALID_KEY" });
  if (!upstream.ok) return json(502, { error: "UPSTREAM_ERROR" });

  const remainingHeader = upstream.headers.get("x-requests-remaining");
  const remaining = remainingHeader === null ? null : parseInt(remainingHeader, 10);
  if (remaining !== null && !Number.isNaN(remaining) && remaining <= 0) {
    return json(422, { error: "OUT_OF_CREDITS" });
  }

  const { error: upsertError } = await adminClient
    .from("platform_secrets")
    .upsert({
      name: SECRET_NAME,
      value: apiKey,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    }, { onConflict: "name" });
  if (upsertError) return json(500, { error: "STORE_FAILED" });

  return json(200, { ok: true, key_id: await keyFingerprint(apiKey), remaining });
});
