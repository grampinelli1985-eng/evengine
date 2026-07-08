const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error(`.env file not found at ${envPath}`);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
const lines = envContent.split(/\r?\n/);

const variables = [];

for (let line of lines) {
  line = line.trim();
  if (!line || line.startsWith('#')) {
    continue;
  }
  const equalIdx = line.indexOf('=');
  if (equalIdx === -1) {
    continue;
  }
  const key = line.substring(0, equalIdx).trim();
  let value = line.substring(equalIdx + 1).trim();

  // Strip wrapping quotes if any
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.substring(1, value.length - 1);
  }

  variables.push({ key, value });
}

console.log(`Found ${variables.length} environment variables to sync.`);

const TARGET_ENVIRONMENTS = ['production', 'preview', 'development'];

for (const { key, value } of variables) {
  console.log(`\n========================================`);
  console.log(`Processing variable: ${key}`);
  console.log(`========================================`);

  for (const env of TARGET_ENVIRONMENTS) {
    console.log(`[${env}] Removing existing variable if any...`);
    // Remove if exists
    const rmResult = spawnSync('vercel', ['env', 'rm', key, env, '-y'], {
      stdio: 'inherit',
      shell: true
    });

    console.log(`[${env}] Adding variable...`);
    // Add variable
    const addResult = spawnSync('vercel', ['env', 'add', key, env], {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true
    });

    if (addResult.status !== 0) {
      console.warn(`[WARNING] Failed to add ${key} to ${env}. Exit code: ${addResult.status}`);
    } else {
      console.log(`[${env}] Successfully added ${key}`);
    }
  }
}

console.log('\nAll done!');
