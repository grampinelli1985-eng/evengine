import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const fullPath = req.url || '';
  // Extrair o path após /api/football/
  const pathPart = fullPath.split('/api/football/')[1] || '';
  if (!pathPart) {
    return res.status(400).json({ error: 'Missing path' });
  }

  // O req.url já inclui a query string
  const url = `https://v3.football.api-sports.io/${pathPart}`;
  
  console.log(`[Vercel Proxy] Forwarding to: ${url}`);
  
  try {
    const apiKey = process.env.API_FOOTBALL_KEY || process.env.VITE_APIFOOTBALL_KEY || '';
    const response = await fetch(url, {
      headers: { 
        'x-apisports-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io',
        'User-Agent': 'EVEngine/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }
    
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error(`[Vercel Proxy] Error:`, err);
    res.status(500).json({ error: String(err) });
  }
}
