import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Require a valid Supabase session and only ever create a checkout for the
  // caller's own account — a userId taken straight from the request body
  // would let anyone generate (and, if paid, apply) a plan change for any
  // other user's id.
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Checkout] Variáveis de ambiente Supabase faltando.');
    return res.status(500).json({ error: 'Servidor não configurado' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação ausente' });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) {
    return res.status(401).json({ error: 'Token JWT inválido ou expirado' });
  }

  const { plan } = req.body;
  const userId = user.id;
  const email = user.email;
  const asaasApiKey = process.env.ASAAS_API_KEY;
  const asaasApiUrl = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/v3';
  
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const frontendUrl = process.env.FRONTEND_URL || `${protocol}://${host}`;

  if (!asaasApiKey) {
    console.warn('[Asaas] API Key não configurada. Simulando redirecionamento para fins de desenvolvimento.');
    return res.json({ 
      url: `${frontendUrl}/?payment=success&mock_plan=${plan}&mock_user=${userId}` 
    });
  }

  const values: Record<string, number> = {
    pro: 147.00,
    sharp: 247.00
  };

  const planValue = values[plan];
  if (!planValue) {
    return res.status(400).json({ error: 'Plano inválido' });
  }

  try {
    const linkResponse = await fetch(`${asaasApiUrl}/paymentLinks`, {
      method: 'POST',
      headers: {
        'access_token': asaasApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `Evengine AI - Plano ${plan.toUpperCase()}`,
        value: planValue,
        billingType: 'UNDEFINED',
        chargeType: 'DETACHED',
        dueDateLimitDays: 3,
        externalReference: `${userId}:${plan}`
      })
    });

    if (!linkResponse.ok) {
      const errText = await linkResponse.text();
      throw new Error(`Erro ao criar link de pagamento no Asaas: ${errText}`);
    }

    const linkData: any = await linkResponse.json();
    return res.json({ url: linkData.url });
  } catch (err: any) {
    console.error('[Asaas] Erro ao criar checkout:', err);
    return res.status(500).json({ error: err.message || 'Erro ao iniciar pagamento' });
  }
}
