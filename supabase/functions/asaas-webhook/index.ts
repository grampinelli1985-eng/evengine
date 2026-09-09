// supabase/functions/asaas-webhook/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASAAS_WEBHOOK_TOKEN = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '';

const PLAN_BY_VALUE: Record<number, 'pro' | 'sharp'> = {
  147: 'pro',
  247: 'sharp',
};

const EVENTS_OK = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RESTORED'];
const EVENTS_FAIL = [
  'SUBSCRIPTION_DELETED', 'PAYMENT_DELETED', 'PAYMENT_OVERDUE',
  'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE',
];

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  if (ASAAS_WEBHOOK_TOKEN) {
    const token = req.headers.get('asaas-access-token') ?? req.headers.get('authorization') ?? '';
    if (!token.includes(ASAAS_WEBHOOK_TOKEN)) {
      console.warn('[ASAAS] Token invalido');
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { event, payment } = body;
  console.log(`[ASAAS] Evento: ${event}`, JSON.stringify(payment ?? {}));

  if (!event || !payment) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no event or payment' }), { status: 200 });
  }

  const userId: string | null = payment?.externalReference ?? null;
  if (!userId) {
    console.warn('[ASAAS] externalReference ausente:', payment?.id);
    return new Response(JSON.stringify({ ok: true, skipped: 'no externalReference' }), { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    if (EVENTS_OK.includes(event)) {
      const plan = PLAN_BY_VALUE[Math.round(Number(payment?.value ?? 0))] ?? 'pro';
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const { error } = await supabase
        .from('profiles')
        .update({ plan, plan_expires_at: expiresAt.toISOString(), analyses_today: 0 })
        .eq('id', userId);

      if (error) { console.error('[ASAAS] Erro DB:', error); return new Response('DB error', { status: 500 }); }
      console.log(`[ASAAS] Usuario ${userId} -> plano ${plan.toUpperCase()} ate ${expiresAt.toISOString()}`);
    }

    if (EVENTS_FAIL.includes(event)) {
      const { error } = await supabase
        .from('profiles')
        .update({ plan: 'free', plan_expires_at: null })
        .eq('id', userId);

      if (error) { console.error('[ASAAS] Erro DB:', error); return new Response('DB error', { status: 500 }); }
      console.log(`[ASAAS] Usuario ${userId} -> FREE (evento: ${event})`);
    }

    return new Response(JSON.stringify({ ok: true, event, userId }), {
      headers: { 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (err) {
    console.error('[ASAAS] Erro interno:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
});