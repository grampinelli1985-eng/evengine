/**
 * Vercel Serverless Function — proxy seguro para API-Football (api-sports.io)
 * Rota: /api/football → https://v3.football.api-sports.io/{endpoint}
 *
 * Uso: /api/football?endpoint=fixtures&league=1&season=2026&status=FT
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

  // Extrai o subpath e a query string a partir de req.url
  const fullUrl = req.url || '';
  const cleanPath = fullUrl.replace(/^\/api\/football/, '');

  let targetUrl = '';

  if (cleanPath.startsWith('/') && cleanPath !== '/' && !cleanPath.startsWith('/?')) {
    // Caso de uso: /api/football/fixtures?date=2026-07-05
    targetUrl = `${API_BASE}${cleanPath}`;
  } else {
    // Caso de uso: /api/football?endpoint=fixtures&league=1
    // Extrai o endpoint e os demais query params
    const { endpoint = '', ...queryParams } = req.query as Record<string, string>;

    if (!endpoint) {
      return res.status(400).json({ error: 'Parâmetro "endpoint" ou subpath obrigatório. Ex: /api/football/fixtures?league=1' });
    }

    const qs = new URLSearchParams(queryParams).toString();
    targetUrl = `${API_BASE}/${endpoint}${qs ? `?${qs}` : ''}`;
  }

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

    // Nunca cachear respostas com erros — a API-Football retorna status 200 mesmo em erros
    // (ex: "Your account is suspended"), o que faria o Vercel CDN cachear o erro por 5 min.
    const hasApiError = data?.errors && Object.keys(data.errors).length > 0;
    if (apiRes.ok && !hasApiError) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    res.status(apiRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error', detail: String(err) });
  }
}
