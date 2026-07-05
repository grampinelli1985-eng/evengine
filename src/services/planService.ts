import { supabase } from './supabaseClient';

export interface UserProfile {
  id: string;
  email: string;
  plan: 'free' | 'pro' | 'sharp';
  plan_expires_at: string | null;
  analyses_today: number;
  analyses_reset_at: string;
  api_key_own: string | null;
  created_at: string;
}

let currentProfile: UserProfile | null = null;
const LISTENERS = new Set<(profile: UserProfile | null) => void>();

// Ligas Tier-A reconhecidas pelo engine
const TIER_A_LEAGUES = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one'
];

export function getCachedProfile(): UserProfile | null {
  if (!currentProfile) {
    const stored = localStorage.getItem('evengine_cached_profile');
    if (stored) {
      try {
        currentProfile = JSON.parse(stored);
      } catch (e) {
        currentProfile = null;
      }
    }
  }
  return currentProfile;
}

export function subscribeToProfile(listener: (profile: UserProfile | null) => void) {
  LISTENERS.add(listener);
  listener(currentProfile);
  return () => {
    LISTENERS.delete(listener);
  };
}

function notifyListeners() {
  localStorage.setItem('evengine_cached_profile', JSON.stringify(currentProfile));
  LISTENERS.forEach(listener => listener(currentProfile));
}

export function setCachedProfile(profile: UserProfile | null) {
  currentProfile = profile;
  notifyListeners();
}

/**
 * Loads the user profile from Supabase profiles table,
 * initializing it if it doesn't exist, and resetting the daily count if midnight has passed.
 */
export async function fetchProfile(userId: string, email: string): Promise<UserProfile | null> {
  if (!supabase) {
    const mockProfile: UserProfile = {
      id: userId,
      email: email,
      plan: 'free',
      plan_expires_at: null,
      analyses_today: 0,
      analyses_reset_at: new Date().toISOString(),
      api_key_own: null,
      created_at: new Date().toISOString()
    };
    setCachedProfile(mockProfile);
    return mockProfile;
  }

  try {
    let { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[Supabase] Erro ao carregar perfil (tabela profiles ausente). Retornando perfil local temporário.', error);
      const fallbackProfile: UserProfile = {
        id: userId,
        email: email,
        plan: 'free',
        plan_expires_at: null,
        analyses_today: 0,
        analyses_reset_at: new Date().toISOString(),
        api_key_own: null,
        created_at: new Date().toISOString()
      };
      setCachedProfile(fallbackProfile);
      return fallbackProfile;
    }

    if (!data) {
      const newProfile = {
        id: userId,
        email: email,
        plan: 'free',
        plan_expires_at: null,
        analyses_today: 0,
        analyses_reset_at: new Date().toISOString(),
        api_key_own: null
      };
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .insert(newProfile)
        .select()
        .single();

      if (insertError) {
        // Handle race condition where another parallel request created the profile first
        if (insertError.code === '23505' || String((insertError as any).status) === '409') {
          const { data: reFetched, error: reFetchError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

          if (!reFetchError && reFetched) {
            data = reFetched;
          } else {
            throw insertError;
          }
        } else {
          throw insertError;
        }
      } else {
        data = inserted;
      }
    }

    // [INC-P3 FIX] Compara apenas datas (strings YYYY-MM-DD) para evitar reset imediato
    // em perfis recém-criados onde analyses_reset_at = now()
    const resetDate = new Date(data.analyses_reset_at).toDateString();
    const today = new Date().toDateString();
    const needsReset = today !== resetDate;

    if (needsReset) {
      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 0, 0);

      const { data: updated, error: updateError } = await supabase
        .from('profiles')
        .update({
          analyses_today: 0,
          analyses_reset_at: nextMidnight.toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (!updateError && updated) {
        data = updated;
      }
    }

    const profile: UserProfile = data;
    setCachedProfile(profile);
    return profile;
  } catch (err) {
    console.error('Erro ao buscar/criar perfil no Supabase:', err);
    const fallbackProfile: UserProfile = {
      id: userId,
      email: email,
      plan: 'free',
      plan_expires_at: null,
      analyses_today: 0,
      analyses_reset_at: new Date().toISOString(),
      api_key_own: null,
      created_at: new Date().toISOString()
    };
    setCachedProfile(fallbackProfile);
    return fallbackProfile;
  }
}

/**
 * Increments user analyses count today
 */
export async function incrementAnalysesToday(): Promise<UserProfile | null> {
  const profile = getCachedProfile();
  if (!profile) return null;

  const nextCount = profile.analyses_today + 1;
  profile.analyses_today = nextCount;
  setCachedProfile({ ...profile });

  if (profile.id === 'demo_user') {
    localStorage.setItem('evengine_demo_analyses_today', nextCount.toString());
    return profile;
  }

  if (!supabase) return profile;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ analyses_today: nextCount })
      .eq('id', profile.id)
      .select()
      .single();

    if (!error && data) {
      setCachedProfile(data);
      return data;
    }
  } catch (err) {
    console.error('Erro ao incrementar análises:', err);
  }

  return profile;
}

// [INC-P2 FIX] Mantida apenas updateUserPlan — updateUserProfilePlan removida (duplicata)
export async function updateUserPlan(userId: string, plan: 'free' | 'pro' | 'sharp'): Promise<UserProfile | null> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const profile = getCachedProfile();
  if (profile) {
    profile.plan = plan;
    profile.plan_expires_at = expiresAt.toISOString();
    setCachedProfile({ ...profile });
  }

  if (!supabase) return getCachedProfile();

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        plan: plan,
        plan_expires_at: expiresAt.toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (!error && data) {
      setCachedProfile(data);
      return data;
    }
  } catch (err) {
    console.error('Erro ao atualizar plano:', err);
  }
  return getCachedProfile();
}

/**
 * Updates owner own API key
 */
export async function updateApiKeyOwn(apiKey: string | null): Promise<UserProfile | null> {
  const profile = getCachedProfile();
  if (!profile) return null;

  profile.api_key_own = apiKey;
  setCachedProfile({ ...profile });

  if (!supabase) return profile;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ api_key_own: apiKey })
      .eq('id', profile.id)
      .select()
      .single();

    if (!error && data) {
      setCachedProfile(data);
      return data;
    }
  } catch (err) {
    console.error('Erro ao atualizar chave API:', err);
  }

  return profile;
}

/**
 * Standard plan feature access queries (UI Layer)
 */

export type UserPlan = 'free' | 'pro' | 'sharp';

export const PLAN_LIMITS = {
  free: {
    analysesPerDay: 3,
    leagueTiers: ['A'] as string[],
    wcModule: false,
    historyDays: 7,
    oddAlerts: false,
    clvTracking: false,
    exportData: false,
  },
  pro: {
    analysesPerDay: 30,
    leagueTiers: ['A', 'B', 'C'] as string[],
    wcModule: true,
    historyDays: 30,
    oddAlerts: true,
    clvTracking: false,
    exportData: false,
  },
  sharp: {
    analysesPerDay: Infinity,
    leagueTiers: ['A', 'B', 'C', 'D'] as string[],
    wcModule: true,
    historyDays: 90,
    oddAlerts: true,
    clvTracking: true,
    exportData: true,
  },
} as const;

export function canRunAnalysis(plan: UserPlan, usedToday: number): boolean {
  const profile = getCachedProfile();
  if (profile?.id === 'demo_user') {
    return usedToday < 5;
  }
  return usedToday < PLAN_LIMITS[plan].analysesPerDay;
}

export function hasWCAccess(plan: UserPlan): boolean {
  return PLAN_LIMITS[plan].wcModule;
}

export function hasCLVAccess(plan: UserPlan): boolean {
  return PLAN_LIMITS[plan].clvTracking;
}

export function canExport(plan: UserPlan): boolean {
  return PLAN_LIMITS[plan].exportData;
}

export function canAnalyzeToday(): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  return canRunAnalysis(profile.plan, profile.analyses_today);
}

// [INC-P1 FIX] Sharp (tier D) acessa tudo; pro acessa B+C; free só A
export function canAccessLeague(leagueKey: string): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  if (profile.id === 'demo_user') return true; // permite testar todas as ligas no demo
  const tiers = PLAN_LIMITS[profile.plan].leagueTiers;

  // Sharp tem acesso irrestrito
  if (tiers.includes('D')) return true;

  // Tier-A: ligas das 5 grandes ligas europeias
  if (TIER_A_LEAGUES.includes(leagueKey)) return tiers.includes('A');

  // Demais ligas são B (pro e sharp têm acesso)
  return tiers.includes('B');
}

export function canAccessWorldCup(): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  if (profile.id === 'demo_user') return true; // permite testar Copa no demo
  return hasWCAccess(profile.plan);
}

export function canViewHistory(daysAgo: number): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  return daysAgo <= PLAN_LIMITS[profile.plan].historyDays;
}

export function canTrackCLV(): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  return hasCLVAccess(profile.plan);
}

export function canExportCSV(): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  return canExport(profile.plan);
}

export function canUseOwnApiKey(): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  return profile.plan === 'sharp';
}

export function canAddBanca(currentBancasCount: number): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  if (profile.plan === 'sharp') return currentBancasCount < 5;
  return currentBancasCount < 1;
}

export function getRemainingAnalysesToday(): number {
  const profile = getCachedProfile();
  if (!profile) return 0;
  if (profile.id === 'demo_user') {
    return Math.max(0, 5 - profile.analyses_today);
  }
  const limit = PLAN_LIMITS[profile.plan].analysesPerDay;
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - profile.analyses_today);
}

// Alias mantido para compatibilidade com imports existentes em App.tsx
export const updateUserProfilePlan = updateUserPlan;
