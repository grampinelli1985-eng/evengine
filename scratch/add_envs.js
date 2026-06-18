const { execSync } = require('child_process');

const envs = ['production', 'preview', 'development'];
const vars = {
  VITE_ODDS_API_KEY: '23ff93b41b58b2026a2fb9edfdab82ff',
  VITE_GEMINI_API_KEY: 'AIzaSyAtPyiPpg3KLvIMVCaLKUk4Dp_6vvgGMKs',
  API_FOOTBALL_KEY: '4bdcbcb4703a9855eb3df258be55c915',
  VITE_SUPABASE_URL: 'https://xzaaogfesxfwwjpeewiz.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_QwOhqyV6K4Evp99SobxsUA_vLaScEt_'
};

const scope = 'gleidsons-projects-e461b3fb';

for (const env of envs) {
  for (const [key, val] of Object.entries(vars)) {
    console.log(`Adding ${key} to ${env}...`);
    try {
      execSync(`vercel env add ${key} ${env} --value "${val}" --yes --scope ${scope} --force`, {
        env: { ...process.env, NO_UPDATE_NOTIFIER: '1', VERCEL_NO_UPDATE_NOTIFIER: '1' },
        stdio: 'inherit'
      });
      console.log(`Successfully added ${key} to ${env}\n`);
    } catch (error) {
      console.error(`Failed to add ${key} to ${env}: ${error.message}\n`);
    }
  }
}
