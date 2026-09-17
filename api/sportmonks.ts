/**
 * Vercel Serverless Function — proxy seguro para Sportmonks Football API
 * Rota: /api/sportmonks/{endpoint} → https://api.sportmonks.com/v3/football/{endpoint}
 *
 * Uso: /api/sportmonks/fixtures/12345?include=statistics;participants
 *
 * O token Sportmonks fica apenas no servidor (process.env),
 * nunca exposto ao browser.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE = 'https://api.sportmonks.com/v3/football';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = process.env.SPORTMONKS_TOKEN || process.env.VITE_SPORTMONKS_TOKEN || '';

  if (!token) {
    return res.status(500).json({ error: 'SPORTMONKS_TOKEN não configurado no servidor' });
  }

  const fullUrl = req.url || '';
  const cleanPath = fullUrl.replace(/^\/api\/sportmonks/, '');
  const targetUrl = `${API_BASE}${cleanPath}`;

  try {
    const apiRes = await fetch(targetUrl, {
      method: req.method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error', detail: String(err) });
  }
}
