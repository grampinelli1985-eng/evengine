import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import https from 'https';

const app = express();
const PORT = 3001;

app.use(cors()); // Permitir que o frontend (porta 3000) acesse o proxy

app.get('/api/football/*', (req, res) => {
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

app.listen(PORT, () => {
  console.log(`🚀 Backend Proxy rodando em http://localhost:${PORT}`);
  console.log(`Configurado para redirecionar para v3.football.api-sports.io`);
});
