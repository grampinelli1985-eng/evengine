const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('.env file not found at ' + envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
const lines = envContent.split(/\r?\n/);

const envs = ['production', 'preview', 'development'];

for (let line of lines) {
  line = line.trim();
  if (!line || line.startsWith('#')) {
    continue;
  }
  const equalsIndex = line.indexOf('=');
  if (equalsIndex === -1) {
    continue;
  }
  const key = line.slice(0, equalsIndex).trim();
  let value = line.slice(equalsIndex + 1).trim();

  // Strip wrapping quotes if they exist
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }

  for (const env of envs) {
    console.log(`Setting environment variable: ${key} for ${env}...`);
    const cmd = `npx vercel env add "${key}" "${env}" --value "${value.replace(/"/g, '\\"')}" --yes --force`;
    
    try {
      // Run with 15 seconds timeout
      const output = execSync(cmd, { 
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8' 
      });
      console.log(output);
      console.log(`Successfully added ${key} to ${env}`);
    } catch (err) {
      const out = err.stdout ? err.stdout.toString() : '';
      const errMsg = err.stderr ? err.stderr.toString() : '';
      if (out.includes('✓') || out.includes('Overrode') || out.includes('Added')) {
        console.log(out);
        console.log(`Successfully added ${key} to ${env} (completed during timeout/completion check)`);
      } else {
        console.error(`Failed/Timed out setting ${key} for ${env}. Error:`, err.message);
        console.error('Stdout:', out);
        console.error('Stderr:', errMsg);
      }
    }
  }
}

console.log('Environment variables configuration completed.');
