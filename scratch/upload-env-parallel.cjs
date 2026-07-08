const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('.env file not found at ' + envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
const lines = envContent.split(/\r?\n/);

const envs = ['production', 'preview', 'development'];
const tasks = [];

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
    tasks.push({ key, env, value });
  }
}

async function runTask({ key, env, value }) {
  return new Promise((resolve) => {
    const cmd = `npx vercel env add "${key}" "${env}" --value "${value.replace(/"/g, '\\"')}" --yes --force`;
    console.log(`Starting: ${key} for ${env}`);
    
    exec(cmd, { timeout: 25000 }, (error, stdout, stderr) => {
      const out = stdout ? stdout.toString() : '';
      const err = stderr ? stderr.toString() : '';
      const combined = out + '\n' + err;
      
      if (combined.includes('✓') || combined.includes('Overrode') || combined.includes('Added')) {
        console.log(`Success: ${key} for ${env}`);
      } else if (error) {
        console.error(`Failed: ${key} for ${env}. Error: ${error.message}. Combined Output: ${combined}`);
      } else {
        console.log(`Success: ${key} for ${env}`);
      }
      resolve();
    });
  });
}

async function main() {
  const concurrency = 6;
  const active = [];
  for (const task of tasks) {
    const promise = runTask(task).then(() => {
      active.splice(active.indexOf(promise), 1);
    });
    active.push(promise);
    if (active.length >= concurrency) {
      await Promise.race(active);
    }
  }
  await Promise.all(active);
  console.log('All environment variables processed.');
}

main();
