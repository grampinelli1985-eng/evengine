/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { hasQuota, trackRequest } from './apiQuotaService';
import { getTeamIdAsync } from './scoutingService';

// Removido API_FOOTBALL_KEY do frontend por segurança (via Proxy)
const API_BASE_URL = '/api/football';


export const LEAGUE_ID_MAP: Record<string, number> = {
  'soccer_epl': 39,
  'soccer_spain_la_liga': 140,
  'soccer_italy_serie_a': 135,
  'soccer_germany_bundesliga': 78,
  'soccer_france_ligue_one': 61,
  'soccer_uefa_champs_league': 2,
  'soccer_brazil_campeonato': 71,
  'soccer_netherlands_eredivisie': 88,
  'soccer_conmebol_copa_libertadores': 13,
  'soccer_conmebol_copa_sudamericana': 11,
};

export async function fetchTeamAvgStats(teamName: string, leagueId: number) {
  const teamId = await getTeamIdAsync(teamName);
  if (teamId === -1 || !hasQuota(1)) return null;


  try {
    trackRequest();
    const res = await fetch(`${API_BASE_URL}/fixtures?team=${teamId}&league=${leagueId}&season=${new Date().getFullYear()}&last=5`, {
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.response ?? null;
  } catch (e) {
    return null;
  }
}

export async function fetchMatchStats(homeTeam: string, awayTeam: string, leagueId: number) {
  const [homeData, awayData] = await Promise.all([
    fetchTeamAvgStats(homeTeam, leagueId),
    fetchTeamAvgStats(awayTeam, leagueId)
  ]);

  return { home: homeData, away: awayData };
}
