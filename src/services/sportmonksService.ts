/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const BASE_URL = 'https://api.sportmonks.com/v3/football';

export interface SportmonksFixtureStats {
  fixture_id: number;
  home_xg: number | null;
  away_xg: number | null;
  home_ppda: number | null;
  away_ppda: number | null;
  home_shots_on_target: number | null;
  away_shots_on_target: number | null;
  home_xg_last5: number | null;
  away_xg_last5: number | null;
}

const seasonCache = new Map<string, number>();
let lastCacheClear = Date.now();

export const SPORTMONKS_LEAGUE_MAP: Record<string, number> = {
  'soccer_epl': 8,
  'soccer_spain_la_liga': 564,
  'soccer_italy_serie_a': 384,
  'soccer_germany_bundesliga': 82,
  'soccer_france_ligue_one': 809,
  'soccer_uefa_champs_league': 2,
  'soccer_brazil_campeonato': 648,
  'soccer_netherlands_eredivisie': 72,
  'soccer_conmebol_copa_libertadores': 1122,
  'soccer_conmebol_copa_sudamericana': 1125,
};

export const SPORTMONKS_LEAGUE_BY_NAME: Record<string, number> = {
  'Premier League': 8,
  'La Liga': 564,
  'Serie A': 384,
  'Bundesliga': 82,
  'Ligue 1': 809,
  'UEFA Champions League': 2,
  'Brasileirão': 648,
  'Campeonato Brasileiro': 648,
  'Eredivisie': 72,
  'Copa Libertadores': 1122,
  'Copa Sudamericana': 1125,
};

async function fetchSportmonks(endpoint: string): Promise<any> {
  const TOKEN = import.meta.env.VITE_SPORTMONKS_TOKEN;
  if (!TOKEN) return null;

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) return await response.json();

      if ((response.status === 429 || response.status === 503) && attempt < 3) {
        console.warn(`[Sportmonks] Status ${response.status}. Retrying in ${delays[attempt]}ms... (${attempt + 1}/3)`);
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        continue;
      }

      console.error(`[Sportmonks] Request failed status ${response.status} for ${url}`);
      return null;
    } catch (error) {
      if (attempt < 3) {
        console.warn(`[Sportmonks] Fetch error. Retrying in ${delays[attempt]}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        continue;
      }
      console.error(`[Sportmonks] Request failed for ${url}:`, error);
      return null;
    }
  }
  return null;
}

export async function getFixtureStatsById(fixtureId: number): Promise<SportmonksFixtureStats | null> {
  try {
    const response = await fetchSportmonks(`/fixtures/${fixtureId}?include=statistics;participants`);
    if (!response?.data) return null;

    const data = response.data;
    const stats = data.statistics || [];
    const participants = data.participants || [];

    const homeParticipant = participants.find((p: any) => p.meta?.location === 'home');
    const awayParticipant = participants.find((p: any) => p.meta?.location === 'away');
    const seasonId = data.season_id;

    const home_xg = stats.find((s: any) => s.location === 'home' && s.type?.developer_name === 'expected-goals')?.data?.value ?? null;
    const away_xg = stats.find((s: any) => s.location === 'away' && s.type?.developer_name === 'expected-goals')?.data?.value ?? null;
    const home_ppda = stats.find((s: any) => s.location === 'home' && s.type?.developer_name === 'passes-per-defensive-action')?.data?.value ?? null;
    const away_ppda = stats.find((s: any) => s.location === 'away' && s.type?.developer_name === 'passes-per-defensive-action')?.data?.value ?? null;
    const home_shots_on_target = stats.find((s: any) => s.location === 'home' && s.type?.developer_name === 'shots-on-target')?.data?.value ?? null;
    const away_shots_on_target = stats.find((s: any) => s.location === 'away' && s.type?.developer_name === 'shots-on-target')?.data?.value ?? null;

    // [OPT-SM-1 FIX] Paralelizar as duas chamadas last5 em vez de sequencial
    let home_xg_last5: number | null = null;
    let away_xg_last5: number | null = null;

    if (seasonId) {
      [home_xg_last5, away_xg_last5] = await Promise.all([
        homeParticipant?.id ? getTeamXgLast5(homeParticipant.id, seasonId) : Promise.resolve(null),
        awayParticipant?.id ? getTeamXgLast5(awayParticipant.id, seasonId) : Promise.resolve(null),
      ]);
    }

    return {
      fixture_id: fixtureId,
      home_xg: home_xg != null ? Number(home_xg) : null,
      away_xg: away_xg != null ? Number(away_xg) : null,
      home_ppda: home_ppda != null ? Number(home_ppda) : null,
      away_ppda: away_ppda != null ? Number(away_ppda) : null,
      home_shots_on_target: home_shots_on_target != null ? Number(home_shots_on_target) : null,
      away_shots_on_target: away_shots_on_target != null ? Number(away_shots_on_target) : null,
      home_xg_last5,
      away_xg_last5,
    };
  } catch (error) {
    console.error(`[Sportmonks] Error in getFixtureStatsById for fixture ${fixtureId}:`, error);
    return null;
  }
}

export async function getTeamXgLast5(teamId: number, season: number): Promise<number | null> {
  try {
    const response = await fetchSportmonks(`/fixtures?filters=teamId:${teamId};seasonId:${season}&include=statistics&per_page=5&sort=-starting_at`);
    if (!response?.data || !Array.isArray(response.data)) return null;

    const xgValues = response.data
      .map((f: any) => {
        const stats = f.statistics || [];
        const teamStat = stats.find((s: any) => s.participant_id === teamId && s.type?.developer_name === 'expected-goals');
        return teamStat?.data?.value != null ? Number(teamStat.data.value) : null;
      })
      .filter((val: any): val is number => val !== null);

    if (xgValues.length < 3) return null;

    const sum = xgValues.reduce((a: number, b: number) => a + b, 0);
    return parseFloat((sum / xgValues.length).toFixed(3));
  } catch (error) {
    console.error(`[Sportmonks] Error in getTeamXgLast5 for team ${teamId} season ${season}:`, error);
    return null;
  }
}

export async function getSeasonId(leagueId: number, year: number): Promise<number | null> {
  try {
    if (Date.now() - lastCacheClear > 24 * 60 * 60 * 1000) {
      seasonCache.clear();
      lastCacheClear = Date.now();
    }

    const cacheKey = `${leagueId}:${year}`;
    if (seasonCache.has(cacheKey)) return seasonCache.get(cacheKey) ?? null;

    const response = await fetchSportmonks(`/seasons?filters=leagueId:${leagueId}`);
    if (!response?.data || !Array.isArray(response.data)) return null;

    const matchingSeason = response.data.find((s: any) => s.name?.includes(String(year)));
    if (matchingSeason) {
      seasonCache.set(cacheKey, matchingSeason.id);
      return matchingSeason.id;
    }

    return null;
  } catch (error) {
    console.error(`[Sportmonks] Error in getSeasonId for league ${leagueId} year ${year}:`, error);
    return null;
  }
}

const teamIdCache = new Map<string, number>();

export async function getSportmonksTeamId(teamName: string): Promise<number | null> {
  if (teamIdCache.has(teamName)) return teamIdCache.get(teamName) ?? null;
  try {
    const response = await fetchSportmonks(`/teams/search/${encodeURIComponent(teamName)}`);
    if (response?.data?.length > 0) {
      const id = response.data[0].id;
      teamIdCache.set(teamName, id);
      return id;
    }
  } catch (error) {
    console.error(`[Sportmonks] Error searching team ${teamName}:`, error);
  }
  return null;
}

export async function getTeamPpdaLast5(teamId: number, season: number): Promise<number | null> {
  try {
    const response = await fetchSportmonks(`/fixtures?filters=teamId:${teamId};seasonId:${season}&include=statistics&per_page=5&sort=-starting_at`);
    if (!response?.data || !Array.isArray(response.data)) return null;

    const ppdaValues = response.data
      .map((f: any) => {
        const stats = f.statistics || [];
        const teamStat = stats.find((s: any) => s.participant_id === teamId && s.type?.developer_name === 'passes-per-defensive-action');
        return teamStat?.data?.value != null ? Number(teamStat.data.value) : null;
      })
      .filter((val: any): val is number => val !== null);

    if (ppdaValues.length < 3) return null;

    const sum = ppdaValues.reduce((a: number, b: number) => a + b, 0);
    return parseFloat((sum / ppdaValues.length).toFixed(3));
  } catch (error) {
    console.error(`[Sportmonks] Error in getTeamPpdaLast5 for team ${teamId} season ${season}:`, error);
    return null;
  }
}
