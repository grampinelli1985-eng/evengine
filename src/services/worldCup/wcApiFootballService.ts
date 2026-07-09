/**
 * wcApiFootballService.ts — API-Football data for Copa do Mundo / torneios internacionais
 * Uses the existing /api/football proxy (VITE_API_FOOTBALL_KEY handled server-side).
 * Free plan: 100 req/day — all results cached 30 min in sessionStorage.
 */

import { hasQuota, trackRequest } from '../apiQuotaService';

const API_BASE = '/api/football';

// Liga IDs no API-Football para torneios internacionais
export const WC_LEAGUE_IDS: Record<string, number> = {
  soccer_fifa_world_cup: 1,                             // Copa do Mundo FIFA
  soccer_conmebol_copa_america: 9,                      // Copa América
  soccer_fifa_world_cup_qualifiers_south_america: 31,   // Eliminatórias CONMEBOL
  soccer_fifa_world_cup_qualifiers_europe: 32,          // Eliminatórias UEFA
  soccer_euros: 4,                                      // Euro
  soccer_concacaf_nations_league: 30,                   // Nations League CONCACAF
};

export interface WCTeamForm {
  teamId: number;
  teamName: string;
  last5: Array<{ result: 'W' | 'D' | 'L'; goals: number; conceded: number; opponent: string }>;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  winRate: number;
  formScore: number; // 0-100
}

export interface WCInjury {
  playerName: string;
  position: string;
  reason: string;
  status: string; // 'Doubtful' | 'Out'
}

export interface WCHeadToHead {
  played: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  homeGoals: number;
  awayGoals: number;
  lastMeetings: Array<{ date: string; homeScore: number; awayScore: number; neutral: boolean }>;
}

export interface WCApiFootballData {
  homeForm: WCTeamForm | null;
  awayForm: WCTeamForm | null;
  homeInjuries: WCInjury[];
  awayInjuries: WCInjury[];
  headToHead: WCHeadToHead | null;
  fixtureId: number | null;
  fetchedAt: string;
}

// ─── Cache helpers ──────────────────────────────────────────────────────────

function cacheGet<T>(key: string, ttlMs = 30 * 60 * 1000): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > ttlMs) { localStorage.removeItem(key); return null; }
    return data as T;
  } catch { return null; }
}

function cacheSet(key: string, data: unknown): void {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch { /* quota */ }
}

// ─── Team ID resolution ──────────────────────────────────────────────────────

const KNOWN_TEAM_IDS: Record<string, number> = {
  'Brazil': 6, 'Argentina': 26, 'France': 2, 'England': 10, 'Spain': 9,
  'Germany': 25, 'Portugal': 38, 'Netherlands': 1118, 'Italy': 768,
  'Colombia': 239, 'Uruguay': 631, 'Mexico': 16, 'USA': 2415,
  'Belgium': 1, 'Croatia': 3, 'Senegal': 7, 'Morocco': 798,
  'Japan': 27, 'South Korea': 348, 'Australia': 20, 'Canada': 26 /* placeholder */,
  'Poland': 23, 'Switzerland': 15, 'Serbia': 22, 'Denmark': 21,
  'Ecuador': 635, 'Cameroon': 44, 'Ghana': 19, 'Tunisia': 7,
  'Qatar': 13, 'Saudi Arabia': 305, 'Iran': 273, 'Wales': 702,
  'Chile': 5, 'Peru': 17, 'Venezuela': 7, 'Bolivia': 8,
  'Paraguay': 7, 'Costa Rica': 11, 'Panama': 14,
};

async function resolveTeamId(teamName: string, leagueId: number): Promise<number | null> {
  if (KNOWN_TEAM_IDS[teamName]) return KNOWN_TEAM_IDS[teamName];

  const cacheKey = `wc_team_id_${teamName.toLowerCase().replace(/\s/g, '_')}`;
  const cached = cacheGet<number>(cacheKey, 24 * 60 * 60 * 1000); // 24h for team IDs
  if (cached) return cached;

  if (!hasQuota(1)) return null;
  try {
    trackRequest();
    const res = await fetch(
      `${API_BASE}/teams?name=${encodeURIComponent(teamName)}&league=${leagueId}&season=2026`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const id: number | null = json?.response?.[0]?.team?.id ?? null;
    if (id) cacheSet(cacheKey, id);
    return id;
  } catch { return null; }
}

// ─── Team Form ────────────────────────────────────────────────────────────────

async function fetchTeamForm(teamName: string, leagueId: number): Promise<WCTeamForm | null> {
  const cacheKey = `wc_form_${leagueId}_${teamName.toLowerCase().replace(/\s/g, '_')}`;
  const cached = cacheGet<WCTeamForm>(cacheKey);
  if (cached) return cached;

  const teamId = await resolveTeamId(teamName, leagueId);
  if (!teamId || !hasQuota(1)) return null;

  try {
    trackRequest();
    const res = await fetch(
      `${API_BASE}/fixtures?team=${teamId}&league=${leagueId}&season=2026&last=5&status=FT`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const fixtures: any[] = json?.response ?? [];

    if (!fixtures.length) return null;

    const last5 = fixtures.map((f: any) => {
      const isHome = f.teams.home.id === teamId;
      const teamGoals = isHome ? f.goals.home : f.goals.away;
      const opponentGoals = isHome ? f.goals.away : f.goals.home;
      const opponent = isHome ? f.teams.away.name : f.teams.home.name;
      const result: 'W' | 'D' | 'L' =
        teamGoals > opponentGoals ? 'W' : teamGoals === opponentGoals ? 'D' : 'L';
      return { result, goals: teamGoals ?? 0, conceded: opponentGoals ?? 0, opponent };
    });

    const wins = last5.filter(m => m.result === 'W').length;
    const avgFor = last5.reduce((s, m) => s + m.goals, 0) / last5.length;
    const avgAgainst = last5.reduce((s, m) => s + m.conceded, 0) / last5.length;
    const winRate = wins / last5.length;
    // Form score: weighted by recency, goals scored, goals conceded
    const formScore = Math.min(100, Math.round(
      winRate * 50 + Math.min(avgFor * 10, 25) + Math.max(0, (2 - avgAgainst) * 12.5)
    ));

    const form: WCTeamForm = { teamId, teamName, last5, avgGoalsFor: avgFor, avgGoalsAgainst: avgAgainst, winRate, formScore };
    cacheSet(cacheKey, form);
    return form;
  } catch { return null; }
}

// ─── Injuries ─────────────────────────────────────────────────────────────────

async function fetchTeamInjuries(teamName: string, leagueId: number): Promise<WCInjury[]> {
  const cacheKey = `wc_injuries_${leagueId}_${teamName.toLowerCase().replace(/\s/g, '_')}`;
  const cached = cacheGet<WCInjury[]>(cacheKey);
  if (cached) return cached;

  const teamId = await resolveTeamId(teamName, leagueId);
  if (!teamId || !hasQuota(1)) return [];

  try {
    trackRequest();
    const season = new Date().getFullYear();
    const res = await fetch(
      `${API_BASE}/injuries?team=${teamId}&league=${leagueId}&season=${season}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const injuries: WCInjury[] = (json?.response ?? []).slice(0, 10).map((i: any) => ({
      playerName: i.player?.name ?? 'Unknown',
      position: i.player?.type ?? '',
      reason: i.player?.reason ?? '',
      status: i.player?.reason?.toLowerCase().includes('doubtful') ? 'Doubtful' : 'Out',
    }));
    cacheSet(cacheKey, injuries);
    return injuries;
  } catch { return []; }
}

// ─── Head-to-Head ─────────────────────────────────────────────────────────────

async function fetchHeadToHead(homeTeam: string, awayTeam: string): Promise<WCHeadToHead | null> {
  const pairKey = [homeTeam, awayTeam].sort().join('_').toLowerCase().replace(/\s/g, '_');
  const cacheKey = `wc_h2h_${pairKey}`;
  const cached = cacheGet<WCHeadToHead>(cacheKey);
  if (cached) return cached;

  const [homeId, awayId] = await Promise.all([
    resolveTeamId(homeTeam, 1),
    resolveTeamId(awayTeam, 1),
  ]);
  if (!homeId || !awayId || !hasQuota(1)) return null;

  try {
    trackRequest();
    const res = await fetch(
      `${API_BASE}/fixtures/headtohead?h2h=${homeId}-${awayId}&last=10`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const fixtures: any[] = json?.response ?? [];
    if (!fixtures.length) return null;

    let homeWins = 0, awayWins = 0, draws = 0, homeGoals = 0, awayGoals = 0;
    const lastMeetings = fixtures.slice(0, 5).map((f: any) => {
      const isHomeTeam = f.teams.home.name === homeTeam;
      const hg = f.goals.home ?? 0;
      const ag = f.goals.away ?? 0;
      if (hg > ag) isHomeTeam ? homeWins++ : awayWins++;
      else if (hg < ag) isHomeTeam ? awayWins++ : homeWins++;
      else draws++;
      homeGoals += isHomeTeam ? hg : ag;
      awayGoals += isHomeTeam ? ag : hg;
      return {
        date: f.fixture.date?.split('T')[0] ?? '',
        homeScore: isHomeTeam ? hg : ag,
        awayScore: isHomeTeam ? ag : hg,
        neutral: f.fixture.venue?.name?.toLowerCase().includes('neutral') ?? false,
      };
    });

    const h2h: WCHeadToHead = {
      played: fixtures.length,
      homeWins, awayWins, draws, homeGoals, awayGoals, lastMeetings,
    };
    cacheSet(cacheKey, h2h);
    return h2h;
  } catch { return null; }
}

// ─── Fixture ID ───────────────────────────────────────────────────────────────

async function findFixtureId(homeTeam: string, awayTeam: string, commenceTime: string): Promise<number | null> {
  const cacheKey = `wc_fixture_id_${homeTeam}_${awayTeam}_${commenceTime.split('T')[0]}`;
  const cached = cacheGet<number>(cacheKey, 6 * 60 * 60 * 1000); // 6h
  if (cached) return cached;

  const [homeId, awayId] = await Promise.all([
    resolveTeamId(homeTeam, 1),
    resolveTeamId(awayTeam, 1),
  ]);
  if (!homeId || !awayId || !hasQuota(1)) return null;

  try {
    trackRequest();
    const date = commenceTime.split('T')[0];
    const res = await fetch(
      `${API_BASE}/fixtures?date=${date}&team=${homeId}&league=1&season=2026`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const match = (json?.response ?? []).find(
      (f: any) => f.teams.away.id === awayId
    );
    const id: number | null = match?.fixture?.id ?? null;
    if (id) cacheSet(cacheKey, id);
    return id;
  } catch { return null; }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetches all available API-Football data for a WC match.
 * Gracefully returns partial data if quota is low or API errors occur.
 * Budget: ~4-6 requests per match (team form x2, injuries x2, H2H, fixture ID).
 */
export async function fetchWCApiFootballData(
  homeTeam: string,
  awayTeam: string,
  sportKey: string,
  commenceTime: string
): Promise<WCApiFootballData> {
  const leagueId = WC_LEAGUE_IDS[sportKey] ?? 1;

  const [homeForm, awayForm, homeInjuries, awayInjuries, headToHead, fixtureId] =
    await Promise.allSettled([
      fetchTeamForm(homeTeam, leagueId),
      fetchTeamForm(awayTeam, leagueId),
      fetchTeamInjuries(homeTeam, leagueId),
      fetchTeamInjuries(awayTeam, leagueId),
      fetchHeadToHead(homeTeam, awayTeam),
      findFixtureId(homeTeam, awayTeam, commenceTime),
    ]);

  return {
    homeForm:     homeForm.status === 'fulfilled'     ? homeForm.value     : null,
    awayForm:     awayForm.status === 'fulfilled'     ? awayForm.value     : null,
    homeInjuries: homeInjuries.status === 'fulfilled' ? homeInjuries.value : [],
    awayInjuries: awayInjuries.status === 'fulfilled' ? awayInjuries.value : [],
    headToHead:   headToHead.status === 'fulfilled'   ? headToHead.value   : null,
    fixtureId:    fixtureId.status === 'fulfilled'    ? fixtureId.value    : null,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Converts API-Football form data into a confidence adjustment (-15 to +15 pts).
 * Used by wcTipsterEngine to enrich the B-CONF gate.
 */
export function computeFormConfidenceAdjustment(
  data: WCApiFootballData,
  favoriteIsHome: boolean
): number {
  let adj = 0;
  const favForm = favoriteIsHome ? data.homeForm : data.awayForm;
  const dogForm = favoriteIsHome ? data.awayForm : data.homeForm;
  const favInjuries = favoriteIsHome ? data.homeInjuries : data.awayInjuries;

  if (favForm) {
    // Form advantage
    adj += Math.round((favForm.formScore - 50) * 0.2); // ±10 pts
    // High-scoring attack bonus
    if (favForm.avgGoalsFor >= 2.0) adj += 3;
    // Defensive fragility penalty
    if (favForm.avgGoalsAgainst >= 2.0) adj -= 3;
  }

  if (dogForm && favForm) {
    // Relative form difference
    const formDiff = favForm.formScore - dogForm.formScore;
    adj += Math.round(formDiff * 0.1); // ±5 pts additional
  }

  // Key injury penalty on favorite
  const keyMissing = favInjuries.filter(i => i.status === 'Out' && i.position === 'Attacker').length;
  adj -= keyMissing * 2;

  // H2H bias
  if (data.headToHead) {
    const h2h = data.headToHead;
    const favWinRate = favoriteIsHome
      ? (h2h.homeWins / Math.max(1, h2h.played))
      : (h2h.awayWins / Math.max(1, h2h.played));
    if (favWinRate >= 0.6) adj += 3;
    else if (favWinRate <= 0.3) adj -= 3;
  }

  return Math.max(-15, Math.min(15, adj));
}

/**
 * Returns a scouting summary string for the analysis card.
 */
export function buildWCScoutingText(data: WCApiFootballData, homeTeam: string, awayTeam: string): string {
  const lines: string[] = [];

  if (data.homeForm) {
    const last5 = data.homeForm.last5.map(m => m.result).join('');
    lines.push(`${homeTeam}: últimos 5 = ${last5} | Média ${data.homeForm.avgGoalsFor.toFixed(1)} gols/jogo`);
  }
  if (data.awayForm) {
    const last5 = data.awayForm.last5.map(m => m.result).join('');
    lines.push(`${awayTeam}: últimos 5 = ${last5} | Média ${data.awayForm.avgGoalsFor.toFixed(1)} gols/jogo`);
  }

  const allInjuries = [
    ...data.homeInjuries.filter(i => i.status === 'Out').slice(0, 2).map(i => `${homeTeam}: ${i.playerName} (Out)`),
    ...data.awayInjuries.filter(i => i.status === 'Out').slice(0, 2).map(i => `${awayTeam}: ${i.playerName} (Out)`),
  ];
  if (allInjuries.length) lines.push('Lesões: ' + allInjuries.join(' | '));

  if (data.headToHead && data.headToHead.played >= 3) {
    const h2h = data.headToHead;
    lines.push(`H2H (${h2h.played} jogos): ${homeTeam} ${h2h.homeWins}V-${h2h.draws}E-${h2h.awayWins}D ${awayTeam}`);
  }

  return lines.join('\n') || 'Dados API-Football não disponíveis para este jogo.';
}
