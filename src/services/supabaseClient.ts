import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { clearBancaOnSignOut } from './bancaService';
import { clearCLVOnSignOut } from './clvService';
import { clearAnalyzedLog } from './analysisCacheService';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://xzaaogfesxfwwjpeewiz.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_QwOhqyV6K4Evp99SobxsUA_vLaScEt_';

export const supabase: SupabaseClient | null = (url && key)
  ? createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: 'evengine_auth',
      },
    })
  : null;

if (!supabase) {
  if (import.meta.env.DEV) console.warn('[Supabase] Cliente não inicializado. Telemetria desabilitada.');
} else {
  let lastKnownUserId = '';

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user?.id) {
      lastKnownUserId = session.user.id;
    }
    if (event === 'SIGNED_OUT') {
      const userId = lastKnownUserId;
      lastKnownUserId = '';
      if (userId) {
        clearBancaOnSignOut(userId);
        clearCLVOnSignOut(userId);
        clearAnalyzedLog(userId);
        localStorage.removeItem('evengine_cached_profile');
      }
    }
  });
}
