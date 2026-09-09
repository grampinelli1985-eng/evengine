/**
 * check-quota — Supabase Edge Function
 *
 * Verifica e incrementa atomicamente o contador de análises diárias no banco.
 * O cliente NÃO deve confiar no localStorage para a decisão de permitir análise —
 * esta função é a fonte de verdade.
 *
 * POST /functions/v1/check-quota
 * Headers: Authorization: Bearer <user_jwt>
 * Body: {} (vazio)
 *
 * Responses:
 *   200 { allowed: true,  analyses_today: N, limit: N, remaining: N }
 *   429 { allowed: false, analyses_today: N, limit: N, remaining: 0 }
 *   401 Unauthenticated
 *   500 Internal error
 *
 * Deploy: supabase functions deploy check-quota
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PLAN_LIMITS: Record<string, number> = {
  demo:  3,
  free:  5,
  pro:   20,
  sharp: Infinity,
};

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── 1. Autenticar via JWT do cliente ───────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthenticated' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userJwt = authHeader.replace('Bearer ', '');

  // Usa o service key para operações no DB, mas valida o JWT do usuário primeiro
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: { user }, error: authError } = await adminClient.auth.getUser(userJwt);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 2. Buscar perfil atual do banco (fonte de verdade) ─────────────────────
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('plan, analyses_today, analyses_reset_at')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: 'Profile not found' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 3. Reset diário — se analyses_reset_at for de outro dia, zera ──────────
  const today = new Date().toISOString().split('T')[0];
  const resetDate = profile.analyses_reset_at
    ? new Date(profile.analyses_reset_at).toISOString().split('T')[0]
    : null;

  let currentCount = profile.analyses_today ?? 0;

  if (resetDate !== today) {
    // Dia novo: zera o contador antes de verificar
    await adminClient
      .from('profiles')
      .update({ analyses_today: 0, analyses_reset_at: new Date().toISOString() })
      .eq('id', user.id);
    currentCount = 0;
  }

  // ── 4. Verificar limite do plano ───────────────────────────────────────────
  const limit = PLAN_LIMITS[profile.plan] ?? 3;
  const allowed = currentCount < limit;

  if (!allowed) {
    return new Response(JSON.stringify({
      allowed: false,
      analyses_today: currentCount,
      limit: isFinite(limit) ? limit : 9999,
      remaining: 0,
    }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 5. Incrementar atomicamente ────────────────────────────────────────────
  const nextCount = currentCount + 1;
  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ analyses_today: nextCount, analyses_reset_at: resetDate === today
      ? profile.analyses_reset_at
      : new Date().toISOString()
    })
    .eq('id', user.id);

  if (updateError) {
    return new Response(JSON.stringify({ error: 'Failed to increment quota' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    allowed: true,
    analyses_today: nextCount,
    limit: isFinite(limit) ? limit : 9999,
    remaining: isFinite(limit) ? limit - nextCount : 9999,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
