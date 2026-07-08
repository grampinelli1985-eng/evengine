// supabase/functions/asaas-checkout/index.ts
// Cria cliente + assinatura no ASAAS com externalReference = userId do Supabase
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY')!;
const ASAAS_BASE_URL = Deno.env.get('ASAAS_API_URL') ?? 'https://api.asaas.com/v3';

const PLAN_CONFIG = {
  pro: { value: 147.00, description: 'Evengine AI — Plano PRO' },
  sharp: { value: 247.00, description: 'Evengine AI — Plano Sharp' },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Valida JWT do usuário Supabase
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!);

  const { data: { user }, error: authError } = await anonClient.auth.getUser(
    authHeader.replace('Bearer ', '')
  );

  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { plan } = body as { plan: 'pro' | 'sharp' };
  if (!plan || !PLAN_CONFIG[plan]) {
    return new Response('Invalid plan', { status: 400 });
  }

  const config = PLAN_CONFIG[plan];

  try {
    // 1. Verifica se já existe cliente ASAAS para este usuário
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, asaas_customer_id')
      .eq('id', user.id)
      .single();

    let customerId: string = profile?.asaas_customer_id ?? '';

    // 2. Cria cliente no ASAAS se não existir
    if (!customerId) {
      const customerRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': ASAAS_API_KEY,
        },
        body: JSON.stringify({
          name: user.email?.split('@')[0] ?? 'Usuário Evengine',
          email: user.email,
          externalReference: user.id, // UUID do Supabase
        }),
      });

      const customer = await customerRes.json();
      if (!customerRes.ok || !customer.id) {
        console.error('[ASAAS checkout] Erro ao criar cliente:', customer);
        return new Response('Failed to create ASAAS customer', { status: 500 });
      }

      customerId = customer.id;

      // Salva o customer ID no perfil para reutilizar
      await supabase
        .from('profiles')
        .update({ asaas_customer_id: customerId })
        .eq('id', user.id);
    }

    // 3. Cria assinatura recorrente mensal
    const subRes = await fetch(`${ASAAS_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_API_KEY,
      },
      body: JSON.stringify({
        customer: customerId,
        billingType: 'CREDIT_CARD', // ou 'PIX', 'BOLETO'
        value: config.value,
        nextDueDate: new Date().toISOString().split('T')[0],
        cycle: 'MONTHLY',
        description: config.description,
        externalReference: user.id, // também no nível da assinatura
      }),
    });

    const subscription = await subRes.json();
    if (!subRes.ok || !subscription.id) {
      console.error('[ASAAS checkout] Erro ao criar assinatura:', subscription);
      return new Response('Failed to create subscription', { status: 500 });
    }

    // 4. Busca o link de pagamento da primeira cobrança
    const paymentsRes = await fetch(
      `${ASAAS_BASE_URL}/payments?subscription=${subscription.id}`,
      { headers: { 'access_token': ASAAS_API_KEY } }
    );
    const payments = await paymentsRes.json();
    const firstPayment = payments?.data?.[0];
    const paymentLink = firstPayment?.invoiceUrl ?? firstPayment?.bankSlipUrl ?? null;

    return new Response(
      JSON.stringify({
        ok: true,
        subscriptionId: subscription.id,
        customerId,
        paymentLink, // frontend redireciona o usuário para esta URL
      }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, status: 200 }
    );
  } catch (err) {
    console.error('[ASAAS checkout] Erro interno:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
});
