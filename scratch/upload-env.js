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

  console.log(`Setting environment variable: ${key}`);
  for (const env of ['production', 'preview', 'development']) {
    try {
      // Use execSync. Since we are in powershell, we should be careful. 
      // Instead of relying on string replacement, let's run it.
      const cmd = `npx vercel env add "${key}" "${env}" --value "${value.replace(/"/g, '\\"')}" --yes --force`;
      execSync(cmd, { stdio: 'inherit' });
      console.log(`Successfully added/updated ${key} in ${env}`);
    } catch (err) {
      console.error(`Failed to add ${key} to ${env}:`, err.message);
    }
  }
}

console.log('Environment variables configuration completed.');
