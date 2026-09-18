/**
 * supabase/functions/odds-proxy/index.ts
 * Auth-gated proxy for The Odds API (api.the-odds-api.com). ODDS_API_KEY stays
 * server-side only — the browser never sees the platform key.
 *
 * Sharp-plan users may supply their own Odds API key (profiles.api_key_own);
 * this function resolves per-caller which key to use so the "bring your own
 * key" feature keeps working without exposing either key to the client.
 *
 * Usage: GET {SUPABASE_URL}/functions/v1/odds-proxy/sports/soccer_epl/odds/?bookmakers=...
 *        Authorization: Bearer <user_jwt>
 *
 * Forwards the upstream status code and the x-requests-remaining/
 * x-requests-used headers unchanged so existing client-side quota/error
 * handling (401/429/422) keeps working. Returns 401 when no key could be
 * resolved (no platform key configured and the caller has none of their
 * own) — callers already treat 401 as "invalid key" and fall back to mock
 * data, so no new status code is needed.
 *
 * Deploy: supabase functions deploy odds-proxy --no-verify-jwt
 * Secret: supabase secrets set ODDS_API_KEY=<platform key>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UPSTREAM_BASE = "https://api.the-odds-api.com/v4";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization header" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: profile } = await adminClient
    .from("profiles")
    .select("plan, api_key_own")
    .eq("id", user.id)
    .single();

  const platformKey = Deno.env.get("ODDS_API_KEY") ?? "";
  const effectiveKey = (profile?.plan === "sharp" && profile?.api_key_own)
    ? profile.api_key_own as string
    : platformKey;

  if (!effectiveKey) {
    return new Response(JSON.stringify({ error: "NO_API_KEY" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const cleanPath = url.pathname.split("/odds-proxy")[1] ?? "";
  const qs = new URLSearchParams(url.search);
  qs.set("apiKey", effectiveKey);

  try {
    const upstreamRes = await fetch(`${UPSTREAM_BASE}${cleanPath}?${qs.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = await upstreamRes.text();

    return new Response(body, {
      status: upstreamRes.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": upstreamRes.headers.get("content-type") ?? "application/json",
        "x-requests-remaining": upstreamRes.headers.get("x-requests-remaining") ?? "",
        "x-requests-used": upstreamRes.headers.get("x-requests-used") ?? "",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Proxy error", detail: String(err) }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
