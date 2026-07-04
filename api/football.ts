/**
 * Vercel Serverless Function — proxy seguro para API-Football (api-sports.io)
 * Rota: /api/football/* → https://v3.football.api-sports.io/*
 *
 * A chave API_FOOTBALL_KEY fica apenas no servidor (process.env),
 * nunca exposta ao browser.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE = 'https://v3.football.api-sports.io';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.API_FOOTBALL_KEY || '';

  if (!apiKey) {
    return res.status(500).json({ error: 'API_FOOTBALL_KEY não configurada no servidor' });
  }

  // Extrai o subpath após /api/football e mantém a query string completa
  const fullUrl = req.url || '';
  const afterBase = fullUrl.replace(/^\/api\/football\/?/, '');
  const targetUrl = `${API_BASE}/${afterBase}`;

  try {
    const apiRes = await fetch(targetUrl, {
      method: req.method || 'GET',
      headers: {
        'x-apisports-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD'
        ? JSON.stringify(req.body)
        : undefined,
    });

    const data = await apiRes.json();

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(apiRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error', detail: String(err) });
  }
}
