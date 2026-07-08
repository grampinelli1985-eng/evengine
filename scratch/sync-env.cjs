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

for (let i = 0; i < variables.length; i++) {
  const { key, value } = variables[i];
  console.log(`\n[${i + 1}/${variables.length}] Synchronizing ${key}...`);

  for (const env of TARGET_ENVIRONMENTS) {
    const addResult = spawnSync('vercel', ['env', 'add', key, env, '--value', value, '--yes', '--force'], {
      stdio: 'ignore', // Prevents hanging on open streams from Vercel's background update checks
      shell: true
    });

    if (addResult.status !== 0) {
      console.error(`  - [${env}] FAILED to configure. Exit code: ${addResult.status}`);
    } else {
      console.log(`  - [${env}] Configured successfully`);
    }
  }
}

console.log('\nAll done!');
