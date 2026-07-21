import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as crypto from 'crypto';

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

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookSecret = process.env.ASAAS_WEBHOOK_SECRET;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Asaas Webhook] Variáveis de ambiente Supabase faltando.');
    return res.status(500).send('Servidor não configurado para webhooks');
  }

  if (!webhookSecret) {
    console.error('[Asaas Webhook] Variável de ambiente ASAAS_WEBHOOK_SECRET não configurada.');
    return res.status(500).send('Webhook sem segredo de validação configurado');
  }

  const incomingToken = req.headers['asaas-access-token'] as string;
  const incomingSignature = (req.headers['x-asaas-signature'] || req.headers['asaas-signature']) as string;
  let isValid = false;

  if (incomingSignature) {
    try {
      const computedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

      const incomingSigBuffer = Buffer.from(incomingSignature);
      const computedSigBuffer = Buffer.from(computedSignature);

      if (incomingSigBuffer.length === computedSigBuffer.length && crypto.timingSafeEqual(incomingSigBuffer, computedSigBuffer)) {
        isValid = true;
      }
    } catch (err) {
      console.error('[Asaas Webhook] Erro ao processar assinatura HMAC:', err);
    }
  }

  if (!isValid && incomingToken) {
    try {
      const tokenBuffer = Buffer.from(incomingToken);
      const secretBuffer = Buffer.from(webhookSecret);

      if (tokenBuffer.length === secretBuffer.length && crypto.timingSafeEqual(tokenBuffer, secretBuffer)) {
        isValid = true;
      }
    } catch (err) {
      // Ignore buffer errors
    }
  }

  if (!isValid) {
    console.warn('[Asaas Webhook] Tentativa de acesso não autorizada: Token ou HMAC inválidos.');
    return res.status(401).send('Não autorizado');
  }

  const { event, payment } = req.body;

  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    const externalReference = payment?.externalReference;
    if (!externalReference || !externalReference.includes(':')) {
      console.warn('[Asaas Webhook] externalReference inválido ou ausente:', externalReference);
      return res.status(200).json({ received: true });
    }

    const [userId, plan] = externalReference.split(':');
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    try {
      console.log(`[Asaas Webhook] Atualizando plano do usuário ${userId} para ${plan}...`);
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          plan: plan,
          plan_expires_at: expiresAt.toISOString()
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ao atualizar Supabase: ${errorText}`);
      }

      console.log(`[Asaas Webhook] Plano do usuário ${userId} atualizado com sucesso!`);
    } catch (err) {
      console.error('[Asaas Webhook] Erro ao atualizar plano no Supabase:', err);
      return res.status(500).send('Erro interno do servidor');
    }
  }

  return res.json({ received: true });
}
