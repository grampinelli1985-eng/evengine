import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  const { plan, userId, email } = req.body;
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
