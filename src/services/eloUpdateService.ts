/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ELO-08: Auto-update ELO ratings from API-Football finished Copa do Mundo 2026 results.
 */

import { atualizarEloPartida, resolveTeamName } from './eloService';

const API_BASE_URL = '/api/football';

const STORAGE_KEY_PROCESSED = 'evengine_elo_processed_fixtures';
const STORAGE_KEY_LAST_RUN  = 'evengine_elo_last_run_date';

const WC_LEAGUE_ID  = 1;
const WC_SEASON     = 2026;

export interface EloUpdateReport {
  runDate: string;
  updatedCount: number;
  skippedCount: number;
  unresolvedTeams: string[];
  errors: string[];
  skippedToday: boolean;
}

interface ApiFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string };
  };
  teams: {
    home: { name: string };
    away: { name: string };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

interface ApiResponse {
  response: ApiFixture[];
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getProcessedIds(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROCESSED);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function saveProcessedIds(ids: Set<number>): void {
  localStorage.setItem(STORAGE_KEY_PROCESSED, JSON.stringify(Array.from(ids)));
}

function scoreToResultado(homeGoals: number, awayGoals: number): '1' | 'X' | '2' {
  if (homeGoals > awayGoals) return '1';
  if (awayGoals > homeGoals) return '2';
  return 'X';
}

async function fetchFinishedFixtures(): Promise<ApiFixture[]> {
  // Usa ?endpoint= para que o proxy /api/football capture a rota corretamente
  const url = `${API_BASE_URL}?endpoint=fixtures&league=${WC_LEAGUE_ID}&season=${WC_SEASON}&status=FT`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Proxy error: ${res.status} ${res.statusText}`);
  }

  const data: ApiResponse = await res.json();

  if (!Array.isArray(data?.response)) {
    throw new Error('API-Football: campo "response" ausente ou inválido');
  }

  return data.response;
}

export async function autoUpdateEloFromResults(force = false): Promise<EloUpdateReport> {
  const today = todayDateString();
  const report: EloUpdateReport = {
    runDate: today,
    updatedCount: 0,
    skippedCount: 0,
    unresolvedTeams: [],
    errors: [],
    skippedToday: false,
  };

  if (!force) {
    const lastRun = localStorage.getItem(STORAGE_KEY_LAST_RUN);
    if (lastRun === today) {
      report.skippedToday = true;
      return report;
    }
  }

  let fixtures: ApiFixture[];
  try {
    fixtures = await fetchFinishedFixtures();
  } catch (err) {
    report.errors.push(String(err));
    return report;
  }

  const processed = getProcessedIds();

  const PRESET_NAMES = new Set<string>([
    'Argentina', 'France', 'England', 'Spain', 'Brazil', 'Belgium', 'Portugal',
    'Netherlands', 'Germany', 'Italy', 'Croatia', 'Uruguay', 'Denmark', 'Switzerland',
    'Colombia', 'Mexico', 'United States', 'Senegal', 'Morocco', 'Japan', 'South Korea',
    'Australia', 'Serbia', 'Poland', 'Ukraine', 'Turkey', 'Austria', 'Ecuador', 'Chile',
    'Paraguay', 'Peru', 'Venezuela', 'Bolivia', 'Nigeria', 'Ivory Coast', 'Ghana',
    'Cameroon', 'Egypt', 'Algeria', 'Tunisia', 'South Africa', 'Saudi Arabia', 'Iran',
    'Qatar', 'Canada', 'Costa Rica', 'Panama', 'Honduras', 'Jamaica',
    'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Slovenia', 'Bosnia Herzegovina',
    'North Korea', 'New Zealand', 'Cape Verde', 'Guinea-Bissau', 'Equatorial Guinea',
  ]);

  for (const fixture of fixtures) {
    const fixtureId = fixture.fixture.id;

    if (processed.has(fixtureId)) {
      report.skippedCount++;
      continue;
    }

    if (fixture.fixture.status.short !== 'FT') {
      report.skippedCount++;
      continue;
    }

    const homeGoals = fixture.goals.home;
    const awayGoals = fixture.goals.away;

    if (homeGoals === null || awayGoals === null) {
      report.errors.push(`Fixture ${fixtureId}: placar nulo — ignorado`);
      processed.add(fixtureId);
      continue;
    }

    const apiHome = fixture.teams.home.name;
    const apiAway = fixture.teams.away.name;

    const canonHome = resolveTeamName(apiHome);
    const canonAway = resolveTeamName(apiAway);

    if (!PRESET_NAMES.has(canonHome)) {
      report.unresolvedTeams.push(`${apiHome} → "${canonHome}" (não reconhecido)`);
    }
    if (!PRESET_NAMES.has(canonAway)) {
      report.unresolvedTeams.push(`${apiAway} → "${canonAway}" (não reconhecido)`);
    }

    try {
      const resultado = scoreToResultado(homeGoals, awayGoals);
      atualizarEloPartida(apiHome, apiAway, resultado, 'copa');
      processed.add(fixtureId);
      report.updatedCount++;
    } catch (err) {
      report.errors.push(`Fixture ${fixtureId} (${apiHome} vs ${apiAway}): ${String(err)}`);
    }
  }

  saveProcessedIds(processed);
  localStorage.setItem(STORAGE_KEY_LAST_RUN, today);

  return report;
}

export function resetEloUpdateState(): void {
  localStorage.removeItem(STORAGE_KEY_PROCESSED);
  localStorage.removeItem(STORAGE_KEY_LAST_RUN);
}

export function getEloUpdateStatus(): {
  lastRunDate: string | null;
  processedCount: number;
  ranToday: boolean;
} {
  const lastRunDate = localStorage.getItem(STORAGE_KEY_LAST_RUN);
  const processedCount = getProcessedIds().size;
  const ranToday = lastRunDate === todayDateString();
  return { lastRunDate, processedCount, ranToday };
}
