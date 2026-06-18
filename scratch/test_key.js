import fs from 'fs';

async function testKey() {
  const apiKey = '21d0741408c62b66716deadb320878ab';
  try {
    const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?apiKey=${apiKey}&regions=us&markets=h2h`;
    console.log('Fetching:', url);
    const response = await fetch(url);
    const text = await response.text();
    const result = {
      status: response.status,
      statusText: response.statusText,
      remainingRequests: response.headers.get('x-requests-remaining'),
      usedRequests: response.headers.get('x-requests-used'),
      body: text
    };
    fs.writeFileSync('scratch/result.json', JSON.stringify(result, null, 2));
    console.log('Result written to scratch/result.json');
  } catch (err) {
    fs.writeFileSync('scratch/result.json', JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
    console.log('Error written to scratch/result.json');
  }
}

testKey();
