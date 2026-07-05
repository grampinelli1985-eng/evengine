import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToProfile,
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
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    // Load initial profile data
    fetchProfile(userIdClean(user.id), user.email || '');

    // Subscribe to profile changes (local updates and syncs)
    const unsubscribe = subscribeToProfile((prof) => {
      setProfile(prof);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  // Support clean ids (remove prefix if auth provider attaches any format)
  function userIdClean(id: string) {
    return id;
  }

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
