import fs from 'fs';

const filePath = 'c:/Users/gleidson.rampinelli/Downloads/BetGuru/BetGuru/src/data/documentation/betguru-docs.json';

try {
  const content = fs.readFileSync(filePath, 'utf8');
  console.log('Original content length:', content.length);
  
  try {
    JSON.parse(content);
    console.log('Valid!');
  } catch (err) {
    const match = err.message.match(/position (\d+)/);
    if (match) {
      const pos = parseInt(match[1], 10);
      console.log('Error at position:', pos);
      const start = Math.max(0, pos - 20);
      const end = Math.min(content.length, pos + 20);
      const slice = content.substring(start, end);
      console.log('Slice:', JSON.stringify(slice));
      console.log('Characters around error:');
      for (let i = start; i < end; i++) {
        const marker = i === pos ? ' ---> ' : '      ';
        console.log(`${marker}[${i}]: '${content[i]}' (code: ${content.charCodeAt(i)})`);
      }
    }
  }
} catch (e) {
  console.error(e);
}
