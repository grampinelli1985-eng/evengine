import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToProfile,
  getCachedProfile,
  UserProfile,
  fetchProfile,
  canAnalyzeToday,
  canAccessLeague,
  canAccessWorldCup,
  canViewHistory,
  canTrackCLV,
  canExportCSV,
  canUseOwnApiKey,
  canAddBanca,
  getRemainingAnalysesToday
} from '../services/planService';

export function useUserPlan() {
  const { user } = useAuth();
  // Inicializa com o perfil em cache (cobre demo mode que já foi setado antes do mount)
  const [profile, setProfile] = useState<UserProfile | null>(getCachedProfile());

  useEffect(() => {
    // Sempre assina alterações de perfil — cobre tanto usuários reais quanto modo demo
    const unsubscribe = subscribeToProfile((prof) => {
      setProfile(prof);
    });

    // Só busca no Supabase se houver usuário autenticado real
    if (user) {
      fetchProfile(user.id, user.email || '');
    }

    return () => {
      unsubscribe();
    };
  }, [user]);

  return {
    profile,
    plan: profile?.plan || 'free',
    planExpiresAt: profile?.plan_expires_at,
    analysesToday: profile?.analyses_today || 0,
    apiKeyOwn: profile?.api_key_own || null,
    canAnalyzeToday: canAnalyzeToday(),
    canAccessLeague: (leagueKey: string) => canAccessLeague(leagueKey),
    canAccessWorldCup: canAccessWorldCup(),
    canViewHistory: (daysAgo: number) => canViewHistory(daysAgo),
    canTrackCLV: canTrackCLV(),
    canExportCSV: canExportCSV(),
    canUseOwnApiKey: canUseOwnApiKey(),
    canAddBanca: (currentBancasCount: number) => canAddBanca(currentBancasCount),
    getRemainingAnalysesToday: getRemainingAnalysesToday()
  };
}
