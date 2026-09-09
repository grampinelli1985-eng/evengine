// supabase/functions/asaas-checkout/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY')!;
const ASAAS_BASE_URL = Deno.env.get('ASAAS_API_URL') ?? 'https://api.asaas.com/v3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

const PLAN_CONFIG = {
  pro:   { value: 147.00, description: 'Evengine AI - Plano PRO' },
  sharp: { value: 247.00, description: 'Evengine AI - Plano Sharp' },
};

async function asaas(path: string, method: string, body?: unknown) {
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    method,
    headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.errors?.[0]?.description ?? JSON.stringify(data));
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Autentica o usuario
  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user }, error: authError } = await anonClient.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { plan, cpfCnpj, phone, paymentMethod, cardData } = body;
  if (!plan || !PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG]) {
    return new Response('Plano invalido', { status: 400 });
  }
  if (!cpfCnpj) return new Response('CPF obrigatorio', { status: 400 });

  const config = PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG];
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Busca perfil
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, asaas_customer_id')
      .eq('id', user.id)
      .single();

    let customerId: string = profile?.asaas_customer_id ?? '';

    // Cria cliente no Asaas se nao existir
    if (!customerId) {
      const cpfLimpo = cpfCnpj.replace(/\D/g, '');

      // Tenta buscar pelo CPF antes de criar
      const search = await asaas(`/customers?cpfCnpj=${cpfLimpo}`, 'GET');
      if (search?.data?.length > 0) {
        customerId = search.data[0].id;
      } else {
        const customer = await asaas('/customers', 'POST', {
          name: profile?.full_name ?? user.email?.split('@')[0] ?? 'Usuario',
          email: user.email,
          cpfCnpj: cpfLimpo,
          phone: phone?.replace(/\D/g, ''),
          externalReference: user.id,
        });
        customerId = customer.id;
      }

      // Salva o customer ID para reutilizar
      await supabase.from('profiles').update({ asaas_customer_id: customerId }).eq('id', user.id);
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    // BOLETO
    if (paymentMethod === 'BOLETO') {
      const payment = await asaas('/payments', 'POST', {
        customer: customerId,
        billingType: 'BOLETO',
        value: config.value,
        dueDate: dueDateStr,
        description: config.description,
        externalReference: user.id,
      });

      return new Response(JSON.stringify({
        ok: true,
        paymentMethod: 'BOLETO',
        paymentId: payment.id,
        boletoUrl: payment.bankSlipUrl,
        boletoBarCode: payment.nossoNumero ?? payment.barCode,
        dueDate: payment.dueDate,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 });
    }

    // CARTAO DE CREDITO
    if (paymentMethod === 'CREDIT_CARD') {
      if (!cardData) return new Response('Dados do cartao obrigatorios', { status: 400 });

      const payment = await asaas('/payments', 'POST', {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: config.value,
        dueDate: dueDateStr,
        description: config.description,
        externalReference: user.id,
        creditCard: {
          holderName: cardData.holderName,
          number: cardData.number.replace(/\s/g, ''),
          expiryMonth: cardData.expiryMonth,
          expiryYear: cardData.expiryYear,
          ccv: cardData.ccv,
        },
        creditCardHolderInfo: {
          name: cardData.holderName,
          email: user.email,
          cpfCnpj: cpfCnpj.replace(/\D/g, ''),
          postalCode: cardData.postalCode?.replace(/\D/g, ''),
          phone: phone?.replace(/\D/g, ''),
        },
      });

      return new Response(JSON.stringify({
        ok: true,
        paymentMethod: 'CREDIT_CARD',
        paymentId: payment.id,
        status: payment.status,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 });
    }

    return new Response('Metodo de pagamento invalido', { status: 400 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ASAAS checkout] Erro:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});