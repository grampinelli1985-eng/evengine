import { supabase } from './supabaseClient';

export interface UserProfile {
  id: string;
  email: string;
  plan: 'demo' | 'free' | 'pro' | 'sharp';
  plan_expires_at: string | null;
  analyses_today: number;
  analyses_reset_at: string;
  api_key_own: string | null;
  created_at: string;
}

let currentProfile: UserProfile | null = null;
const LISTENERS = new Set<(profile: UserProfile | null) => void>();

const TIER_A_LEAGUES = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_brazil_campeonato',
  'soccer_portugal_primeira_liga',
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
  if (currentProfile) {
    const { api_key_own: _omit, ...safeProfile } = currentProfile;
    localStorage.setItem('evengine_cached_profile', JSON.stringify(safeProfile));
  } else {
    localStorage.removeItem('evengine_cached_profile');
  }
  LISTENERS.forEach(listener => listener(currentProfile));
}

export function setCachedProfile(profile: UserProfile | null) {
  currentProfile = profile;
  notifyListeners();
}

/**
 * Loads the user profile from Supabase profiles table.
 * New users start with plan='demo' (5 total analyses, non-renewable).
 * Demo plan counter never resets daily — it's a lifetime quota.
 */
export async function fetchProfile(userId: string, email: string): Promise<UserProfile | null> {
  if (!supabase) {
    const mockProfile: UserProfile = {
      id: userId,
      email: email,
      plan: 'demo',
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
      console.warn('[Supabase] Erro ao carregar perfil. Usando cache existente se disponível.', error);
      const cached = getCachedProfile();
      if (cached && cached.id === userId) return cached;
      const fallbackProfile: UserProfile = {
        id: userId,
        email: email,
        plan: 'demo',
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
      // Novo usuário — inicia no plano demo
      const newProfile = {
        id: userId,
        email: email,
        plan: 'demo',
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

    // Fallback de segurança: verifica se plano PRO/SHARP expirou
    // (o webhook do ASAAS é o mecanismo principal, este é o safety net)
    if ((data as UserProfile).plan !== 'demo') {
      const expiresAt = data.plan_expires_at ? new Date(data.plan_expires_at) : null;
      if (expiresAt && expiresAt < new Date()) {
        const { data: downgraded } = await supabase
          .from('profiles')
          .update({ plan: 'demo', plan_expires_at: null })
          .eq('id', userId)
          .select()
          .single();
        if (downgraded) data = downgraded;
        console.warn(`[planService] Plano expirado para ${userId} — downgrade para demo`);
      }
    }

    // Plano demo: cota vitalícia — nunca reseta o contador
    // Planos pagos: reseta se mudou o dia
    if ((data as UserProfile).plan !== 'demo') {
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
    }

    setCachedProfile(data as UserProfile);
    return data as UserProfile;
  } catch (err) {
    console.error('Erro ao buscar/criar perfil no Supabase:', err);
    const cached = getCachedProfile();
    if (cached && cached.id === userId) return cached;
    const fallbackProfile: UserProfile = {
      id: userId,
      email: email,
      plan: 'demo',
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

export interface QuotaResult {
  allowed: boolean;
  analyses_today: number;
  limit: number;
  remaining: number;
}

/**
 * Verifica e incrementa a quota de análises via Edge Function (server-side).
 * Retorna null se a Edge Function não estiver disponível (fallback para
 * comportamento anterior baseado em localStorage).
 */
export async function checkAndIncrementQuota(): Promise<QuotaResult | null> {
  if (!supabase) return null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const { data, error } = await supabase.functions.invoke('check-quota', {
      body: {},
    });

    if (error) {
      // 429 = limite atingido (error.context tem o body)
      if (error.context?.status === 429) {
        const body = await error.context.json().catch(() => ({}));
        return { allowed: false, analyses_today: body.analyses_today ?? 0, limit: body.limit ?? 0, remaining: 0 };
      }
      console.warn('[Quota] Edge Function indisponível, usando fallback local:', error.message);
      return null;
    }

    // Sincroniza o contador retornado com o cache local
    const profile = getCachedProfile();
    if (profile && data) {
      setCachedProfile({ ...profile, analyses_today: data.analyses_today });
    }

    return data as QuotaResult;
  } catch (err) {
    console.warn('[Quota] Falha ao verificar quota server-side:', err);
    return null;
  }
}

/**
 * Incrementa o contador localmente (fallback quando Edge Function está offline).
 */
export async function incrementAnalysesToday(): Promise<UserProfile | null> {
  const profile = getCachedProfile();
  if (!profile) return null;

  const nextCount = profile.analyses_today + 1;
  profile.analyses_today = nextCount;
  setCachedProfile({ ...profile });

  if (!supabase) return profile;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ analyses_today: nextCount })
      .eq('id', profile.id)
      .select()
      .single();

    if (!error && data) {
      setCachedProfile(data as UserProfile);
      return data as UserProfile;
    }
  } catch (err) {
    console.error('Erro ao incrementar análises:', err);
  }

  return profile;
}

/**
 * Migra usuário de qualquer plano para free/pro/sharp.
 * Zera o contador diário ao migrar (demo → plano pago).
 */
export async function updateUserPlan(userId: string, plan: 'free' | 'pro' | 'sharp'): Promise<UserProfile | null> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (plan === 'free' ? 15 : 30));

  const profile = getCachedProfile();
  if (profile) {
    setCachedProfile({
      ...profile,
      plan,
      plan_expires_at: expiresAt.toISOString(),
      analyses_today: 0,
      analyses_reset_at: new Date().toISOString()
    });
  }

  if (!supabase) return getCachedProfile();

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        plan,
        plan_expires_at: expiresAt.toISOString(),
        analyses_today: 0,
        analyses_reset_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (!error && data) {
      setCachedProfile(data as UserProfile);
      return data as UserProfile;
    }
  } catch (err) {
    console.error('Erro ao atualizar plano:', err);
  }
  return getCachedProfile();
}

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
      setCachedProfile(data as UserProfile);
      return data as UserProfile;
    }
  } catch (err) {
    console.error('Erro ao atualizar chave API:', err);
  }

  return profile;
}

export type UserPlan = 'demo' | 'free' | 'pro' | 'sharp';

export const PLAN_LIMITS = {
  demo: {
    analysesPerDay: 5,          // cota total vitalícia (não renova)
    leagueTiers: ['A', 'B', 'C', 'D'] as string[],
    wcModule: true,
    historyDays: 0,
    oddAlerts: false,
    clvTracking: false,
    exportData: false,
  },
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

export function canAccessLeague(leagueKey: string): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
  const tiers = PLAN_LIMITS[profile.plan].leagueTiers;
  if (tiers.includes('D')) return true;
  if (TIER_A_LEAGUES.includes(leagueKey)) return tiers.includes('A');
  return tiers.includes('B');
}

export function canAccessWorldCup(): boolean {
  const profile = getCachedProfile();
  if (!profile) return false;
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
  const limit = PLAN_LIMITS[profile.plan].analysesPerDay;
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - profile.analyses_today);
}

// Alias para compatibilidade com imports existentes
export const updateUserProfilePlan = updateUserPlan;
