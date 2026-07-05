import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import https from 'https';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = 3001;

// CORS setup
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'apikey']
}));

// Body parser middlewares for local APIs and Stripe webhook
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Supabase Admin client on the server using service role key
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

// Middleware for Supabase JWT verification
const requireAuth = async (req: any, res: any, next: any) => {
  if (!supabaseAdmin) {
    console.error('[Auth Middleware] Cliente Admin do Supabase não inicializado.');
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação ausente ou malformatado.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      console.warn('[Auth Middleware] Falha na validação do token JWT:', error?.message || 'Usuário nulo');
      return res.status(401).json({ error: 'Token JWT inválido ou expirado.' });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Erro interno durante validação JWT:', err);
    return res.status(500).json({ error: 'Erro interno ao validar token' });
  }
};

// Standard proxy route for API-Football (protected by JWT authentication)
app.get('/api/football/*', requireAuth, (req, res) => {
  const path = req.params[0];
  const queryString = new URLSearchParams(req.query as any).toString();
  const url = `https://v3.football.api-sports.io/${path}?${queryString}`;
  
  console.log(`[Proxy] Forwarding to: ${url}`);
  
  const options = {
    headers: {
      'x-apisports-key': process.env.API_FOOTBALL_KEY!,
      'User-Agent': 'EVEngine/1.0',
      'Accept': 'application/json'
    },
    timeout: 10000
  };

  const request = https.get(url, options, (apiRes) => {
    let rawData = '';
    
    apiRes.on('data', (chunk) => {
      rawData += chunk;
    });
    
    apiRes.on('end', () => {
      try {
        if (apiRes.statusCode && apiRes.statusCode >= 400) {
          console.error(`[Proxy] API-Football error: ${apiRes.statusCode} - ${rawData}`);
          res.status(apiRes.statusCode).send(rawData);
        } else {
          res.json(JSON.parse(rawData));
        }
      } catch (e) {
        console.error(`[Proxy] JSON parse error:`, e);
        res.status(500).json({ error: 'Erro no parse de dados da API-Football' });
      }
    });
  });

  request.on('error', (err) => {
    console.error(`[Proxy] Critical error (HTTPS):`, err);
    res.status(500).json({ error: String(err) });
  });

  request.on('timeout', () => {
    request.destroy();
    res.status(504).json({ error: 'Timeout de conexão com API-Football' });
  });
});

/**
 * Asaas Checkout creation route
 */
app.post('/api/checkout', async (req, res) => {
  const { plan, userId, email } = req.body;
  const asaasApiKey = process.env.ASAAS_API_KEY;
  const asaasApiUrl = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/v3';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (!asaasApiKey) {
    console.warn('[Asaas] API Key não configurada. Simulando redirecionamento para fins de desenvolvimento.');
    // Simulated redirect success
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
    // Create a Payment Link (which asks for the customer's name, email, and CPF/CNPJ on the Asaas secure hosted checkout page)
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
    
    // linkData.url is the hosted checkout page where they can choose Pix, Boleto, or Credit Card and enter their info
    res.json({ url: linkData.url });
  } catch (err: any) {
    console.error('[Asaas] Erro ao criar checkout:', err);
    res.status(500).json({ error: err.message || 'Erro ao iniciar pagamento' });
  }
});

/**
 * Asaas Webhook route to handle payment received events
 */
app.post('/api/webhook/asaas', async (req, res) => {
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

  // 1. Validação do Webhook (Token asaas-access-token ou Assinatura HMAC)
  const incomingToken = req.headers['asaas-access-token'] as string;
  const incomingSignature = (req.headers['x-asaas-signature'] || req.headers['asaas-signature']) as string;
  let isValid = false;

  // 1.1. Tentar validar via assinatura HMAC-SHA256 se o cabeçalho de assinatura estiver presente
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

  // 1.2. Fallback para validação do Token de Acesso direto (Timing-Safe)
  if (!isValid && incomingToken) {
    try {
      const tokenBuffer = Buffer.from(incomingToken);
      const secretBuffer = Buffer.from(webhookSecret);

      if (tokenBuffer.length === secretBuffer.length && crypto.timingSafeEqual(tokenBuffer, secretBuffer)) {
        isValid = true;
      }
    } catch (err) {
      // Ignorar erros de buffer
    }
  }

  if (!isValid) {
    console.warn('[Asaas Webhook] Tentativa de acesso não autorizada: Token ou HMAC inválidos.');
    return res.status(401).send('Não autorizado');
  }

  const { event, payment } = req.body;

  // We look for payment received or confirmed events
  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    const externalReference = payment?.externalReference;
    if (!externalReference || !externalReference.includes(':')) {
      console.warn('[Asaas Webhook] externalReference inválido ou ausente:', externalReference);
      return res.status(200).json({ received: true });
    }

    const [userId, plan] = externalReference.split(':');
    
    // Set plan duration to 30 days
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

  res.json({ received: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend Proxy rodando em http://0.0.0.0:${PORT}`);
  console.log(`Configurado para redirecionar para v3.football.api-sports.io`);
});
