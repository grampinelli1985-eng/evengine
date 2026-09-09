/**
 * mustWinService.ts — Índice de Necessidade de Vitória (Must-Win)
 *
 * Quantifica a assimetria de motivação entre os dois times num confronto.
 * Times em zonas críticas (rebaixamento, título, vaga europeia) jogam com
 * intensidade diferente — info que o mercado recreativo subestima sistematicamente.
 *
 * Fonte: classificação via fetchLeagueStandings (API-Football, com cache 6h).
 * Fallback puro local quando a API não responde.
 */

import { Match } from '../types';
import { fetchLeagueStandings, getSeasonForLeague } from './scoutingService';

// Mapa sport_key → ID de liga na API-Football
const SPORT_KEY_TO_LEAGUE_ID: Record<string, number> = {
  soccer_epl: 39,
  soccer_spain_la_liga: 140,
  soccer_germany_bundesliga: 78,
  soccer_italy_serie_a: 135,
  soccer_france_ligue_one: 61,
  soccer_portugal_primeira_liga: 94,
  soccer_efl_champ: 40,
  soccer_brazil_campeonato: 71,
  soccer_brazil_serie_b: 72,
  soccer_netherlands_eredivisie: 88,
  soccer_uefa_champs_league: 2,
  soccer_uefa_europa_league: 3,
};

// Número padrão de rebaixados por liga
const RELEGATION_SPOTS: Record<number, number> = {
  39: 3, 40: 3, 71: 4, 72: 4, 94: 2, 88: 3,
  140: 3, 78: 3, 135: 3, 61: 3,
};

// Vagas europeias (UCL + UEL + UECL) por liga
const EUROPEAN_SPOTS: Record<number, number> = {
  39: 6, 140: 5, 78: 6, 135: 6, 61: 4, 94: 3, 88: 3,
};

export type MustWinZone =
  | 'title_fight'       // disputa pelo título (top 2)
  | 'champions_league'  // luta por UCL
  | 'european_spot'     // luta por vaga europeia
  | 'midtable'          // meio de tabela (sem pressão)
  | 'relegation_fight'  // luta para não cair (zona risco)
  | 'relegated'         // já na zona de rebaixamento
  | 'unknown';          // sem dados de tabela

export interface TeamMustWin {
  score: number;           // 0–100
  zone: MustWinZone;
  label: string;           // texto curto para a UI
  emoji: string;
}

export interface MustWinResult {
  home: TeamMustWin;
  away: TeamMustWin;
  delta: number;           // home.score - away.score (positivo = casa mais motivada)
  insight: string;         // frase de 1 linha para o modelo de IA e UI
  source: 'api' | 'fallback';
}

const CACHE = new Map<string, { result: MustWinResult; ts: number }>();
const TTL = 6 * 60 * 60 * 1000; // 6 horas

// ─── Helpers ────────────────────────────────────────────────────────────────

function zoneScore(zone: MustWinZone, seasonsProgress: number): number {
  // seasonsProgress: 0.0 (início) → 1.0 (última rodada)
  const urgency = 0.5 + seasonsProgress * 0.5; // urgência cresce com o tempo
  switch (zone) {
    case 'relegated':        return Math.min(95, Math.round(85 * urgency));
    case 'relegation_fight': return Math.min(85, Math.round(70 * urgency));
    case 'title_fight':      return Math.min(90, Math.round(75 * urgency));
    case 'champions_league': return Math.min(80, Math.round(65 * urgency));
    case 'european_spot':    return Math.min(65, Math.round(50 * urgency));
    case 'midtable':         return Math.round(25 * (1 - seasonsProgress * 0.3));
    default:                 return 40;
  }
}

function zoneLabel(zone: MustWinZone): { label: string; emoji: string } {
  switch (zone) {
    case 'relegated':        return { label: 'Zona de Rebaixamento', emoji: '🔴' };
    case 'relegation_fight': return { label: 'Luta contra Rebaixamento', emoji: '🟠' };
    case 'title_fight':      return { label: 'Disputa pelo Título', emoji: '🏆' };
    case 'champions_league': return { label: 'Luta por UCL', emoji: '⭐' };
    case 'european_spot':    return { label: 'Luta por Europa', emoji: '🟡' };
    case 'midtable':         return { label: 'Meio de Tabela', emoji: '⚪' };
    default:                 return { label: 'Sem dados', emoji: '❓' };
  }
}

function classifyTeam(
  pos: number,
  totalTeams: number,
  leagueId: number
): MustWinZone {
  const relSpots = RELEGATION_SPOTS[leagueId] ?? 3;
  const euSpots  = EUROPEAN_SPOTS[leagueId] ?? 5;

  if (pos <= 2) return 'title_fight';
  if (pos <= 4) return 'champions_league';
  if (pos <= euSpots) return 'european_spot';
  if (pos > totalTeams - relSpots) return 'relegated';
  if (pos > totalTeams - relSpots - 2) return 'relegation_fight';
  return 'midtable';
}

function buildTeam(zone: MustWinZone, seasonsProgress: number): TeamMustWin {
  const score = zoneScore(zone, seasonsProgress);
  const { label, emoji } = zoneLabel(zone);
  return { score, zone, label, emoji };
}

function buildInsight(home: TeamMustWin, away: TeamMustWin): string {
  const delta = home.score - away.score;
  if (Math.abs(delta) <= 10) return 'Motivação equilibrada entre os times.';

  const stronger = delta > 0 ? 'Casa' : 'Visitante';
  const strongerTeam = delta > 0 ? home : away;
  const weaker = delta > 0 ? 'Visitante' : 'Casa';

  if (Math.abs(delta) >= 40) {
    return `Assimetria crítica: ${stronger} (${strongerTeam.label}) enfrenta adversário sem pressão (${weaker}). Edge potencial no ${stronger}.`;
  }
  return `${stronger} com maior necessidade de vitória (${strongerTeam.label}). Ligeira vantagem motivacional.`;
}

function seasonsProgressFromStandings(standings: any[]): number {
  // Usa o número de jogos disputados pelo líder para estimar progresso
  try {
    const leader = standings[0]?.[0] ?? standings[0];
    const played = leader?.all?.played ?? leader?.played ?? 0;
    const totalTeams = standings[0]?.length ?? standings.length;
    const totalRounds = totalTeams * 2 - 2;
    return Math.min(1, played / totalRounds);
  } catch { return 0.5; }
}

function findTeamInStandings(
  teamName: string,
  standings: any[]
): { pos: number; total: number } | null {
  const normalize = (s: string) =>
    (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const query = normalize(teamName);

  const flat = Array.isArray(standings[0]) ? standings.flat() : standings;
  const total = flat.length;

  for (const entry of flat) {
    const name = normalize(entry?.team?.name ?? '');
    if (name === query || name.includes(query) || query.includes(name)) {
      return { pos: entry.rank, total };
    }
  }
  return null;
}

// ─── Fallback (sem dados de tabela) ─────────────────────────────────────────

function fallbackResult(): MustWinResult {
  const unknown: TeamMustWin = { score: 50, zone: 'unknown', label: 'Sem dados', emoji: '❓' };
  return {
    home: unknown,
    away: unknown,
    delta: 0,
    insight: 'Dados de classificação não disponíveis para este jogo.',
    source: 'fallback',
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Retorna o índice de necessidade de vitória para ambos os times.
 * Usa cache em memória de 6h por match.
 */
export async function getMustWinIndex(match: Match): Promise<MustWinResult> {
  const cacheKey = `${match.id}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.result;

  const leagueId = SPORT_KEY_TO_LEAGUE_ID[match.sport_key];
  if (!leagueId) return fallbackResult();

  try {
    const standings = await fetchLeagueStandings(leagueId);
    if (!standings) return fallbackResult();

    const progress = seasonsProgressFromStandings(standings);
    const flat = Array.isArray(standings[0]) ? standings.flat() : standings;
    const total = flat.length;

    const homeData = findTeamInStandings(match.home_team, standings);
    const awayData = findTeamInStandings(match.away_team, standings);

    const homeZone = homeData
      ? classifyTeam(homeData.pos, homeData.total || total, leagueId)
      : 'unknown';
    const awayZone = awayData
      ? classifyTeam(awayData.pos, awayData.total || total, leagueId)
      : 'unknown';

    const home = buildTeam(homeZone, progress);
    const away = buildTeam(awayZone, progress);
    const delta = home.score - away.score;

    const result: MustWinResult = {
      home,
      away,
      delta,
      insight: buildInsight(home, away),
      source: 'api',
    };

    CACHE.set(cacheKey, { result, ts: Date.now() });
    return result;
  } catch {
    return fallbackResult();
  }
}

/**
 * Versão síncrona para usar em contextos onde já temos os dados cacheados.
 * Retorna null se não houver cache.
 */
export function getMustWinCached(matchId: string): MustWinResult | null {
  const cached = CACHE.get(matchId);
  if (cached && Date.now() - cached.ts < TTL) return cached.result;
  return null;
}

/**
 * Formata o índice para inclusão no prompt da IA.
 */
export function formatMustWinForPrompt(result: MustWinResult): string {
  if (result.source === 'fallback') return '';
  return [
    `ÍNDICE DE NECESSIDADE DE VITÓRIA (Must-Win):`,
    `  Casa: ${result.home.score}/100 — ${result.home.label}`,
    `  Visitante: ${result.away.score}/100 — ${result.away.label}`,
    `  Delta motivacional: ${result.delta > 0 ? '+' : ''}${result.delta} (${result.delta > 0 ? 'Casa mais pressionada' : result.delta < 0 ? 'Visitante mais pressionado' : 'Equilíbrio'})`,
    `  Insight: ${result.insight}`,
  ].join('\n');
}
