/**
 * squadImpactService.ts — Impacto de Escalação por Importância do Jogador
 *
 * Problema: o modelo anterior trata todos os desfalques igual.
 * Perder Salah ≠ perder o 3º goleiro reserva.
 *
 * Solução: pondera cada ausência por:
 *   1. Posição (atacante > meio > defensor > goleiro em termos de gols)
 *   2. Nível do jogador (estrela, titular, rotação, reserva)
 *   3. Profundidade do elenco (clube com 2 atacantes = impacto 2× de um com 5)
 *   4. Acúmulo (3+ desfalques em mesma posição = efeito cascata)
 *
 * Output: score 0-100 por time + texto para o prompt da IA.
 */

import { InjuryDetail } from './scoutingService';

// ─── Base de estrelas por time ────────────────────────────────────────────────
// Apenas jogadores cujo impacto é inequivocamente "tier 1" na liga.
// Mantida compacta — o algoritmo de posição cobre o resto.

const STAR_PLAYERS: Record<string, number> = {
  // Premier League
  'Salah': 95, 'Haaland': 97, 'De Bruyne': 93, 'Saka': 88, 'Bukayo Saka': 88,
  'Son': 85, 'Heung-Min Son': 85, 'Bruno Fernandes': 84, 'Rashford': 80,
  'Trent Alexander-Arnold': 87, 'Virgil van Dijk': 88, 'Alisson': 86,
  'Ederson': 85, 'Pickford': 78, 'Raya': 78, 'Flekken': 75,
  'Palmer': 86, 'Nicolas Jackson': 78, 'Isak': 84,
  'Watkins': 82, 'Emery': 79,

  // La Liga
  'Vinícius Júnior': 93, 'Vinicius Junior': 93, 'Bellingham': 92,
  'Mbappé': 94, 'Kylian Mbappé': 94, 'Lewandowski': 88, 'Yamal': 89,
  'Lamine Yamal': 89, 'Pedri': 87, 'Gavi': 84, 'Ter Stegen': 86,
  'Oblak': 87, 'Griezmann': 85, 'Morata': 80,

  // Bundesliga
  'Harry Kane': 91, 'Müller': 80, 'Neuer': 83, 'Kimmich': 88,
  'Wirtz': 90, 'Florian Wirtz': 90, 'Adeyemi': 82, 'Reus': 78,

  // Serie A
  'Osimhen': 89, 'Kvara': 87, 'Kvaratskhelia': 87,
  'Lautaro Martínez': 90, 'Barella': 86, 'Theo Hernandez': 84,
  'Leao': 86, 'Rafael Leão': 86, 'Dybala': 83, 'Immobile': 80,

  // Ligue 1
  'Hakimi': 85, 'Doué': 83, 'Lacazette': 78, 'Fofana': 80,

  // Brasileirão
  'Gabigol': 82, 'Pedro': 84, 'Arrascaeta': 86, 'Gerson': 83,
  'Dudu': 78, 'Endrick': 84, 'Hulk': 76, 'Paulinho': 78,
  'Cano': 80, 'Germán Cano': 80, 'Yerry Mina': 75,
  'Renato Gaúcho': 70, 'Suárez': 79, 'Luis Suárez': 79,

  // Eredivisie
  'Brobbey': 80, 'Bergwijn': 78, 'Gimenez': 84, 'Santiago Gimenez': 84,
  'Til': 76,
};

// ─── Peso por posição ──────────────────────────────────────────────────────────
// Impacto em probabilidade de gol: atacante pesa mais, GK pesa em conceder
const POSITION_WEIGHT: Record<string, number> = {
  'Attacker': 1.0,
  'Midfielder': 0.7,
  'Defender': 0.5,
  'Goalkeeper': 0.6,  // GK ruim = mais gols sofridos
  'Unknown': 0.4,
};

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type SquadImpactLevel = 'CRITICO' | 'ALTO' | 'MODERADO' | 'LEVE' | 'NEUTRO';

export interface AbsentPlayer {
  name: string;
  position: string;
  reason: string;
  tier: 'star' | 'key' | 'rotation' | 'fringe';
  impactScore: number;  // 0-100 contribuição individual
}

export interface SquadImpactResult {
  team: string;
  level: SquadImpactLevel;
  score: number;              // 0-100 impacto total
  absentPlayers: AbsentPlayer[];
  positionGaps: string[];     // ex: ['Atacante', 'Goleiro']
  goalsBias: number;          // ajuste esperado nos gols do time (-1.0..0)
  defenseBias: number;        // ajuste em gols sofridos (0..+1.0)
  insight: string;
}

export interface MatchSquadImpact {
  home: SquadImpactResult;
  away: SquadImpactResult;
  deltaScore: number;         // home.score - away.score
  insight: string;
}

// ─── Lógica core ────────────────────────────────────────────────────────────

function findStarRating(name: string): number | null {
  if (STAR_PLAYERS[name]) return STAR_PLAYERS[name];
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(name);
  for (const [k, v] of Object.entries(STAR_PLAYERS)) {
    if (norm(k) === q || norm(k).includes(q) || q.includes(norm(k))) return v;
  }
  return null;
}

function classifyPlayer(name: string, position: string): { tier: AbsentPlayer['tier']; impactScore: number } {
  const starRating = findStarRating(name);
  const posWeight = POSITION_WEIGHT[position] ?? 0.4;

  if (starRating && starRating >= 85) {
    return { tier: 'star', impactScore: Math.round(starRating * posWeight * 0.7) };
  }
  if (starRating && starRating >= 75) {
    return { tier: 'key', impactScore: Math.round(starRating * posWeight * 0.55) };
  }
  // Jogador desconhecido — impacto baseado apenas na posição
  const base = position === 'Attacker' ? 30 : position === 'Midfielder' ? 22 : position === 'Goalkeeper' ? 25 : 18;
  return { tier: 'rotation', impactScore: base };
}

function calcSquadImpact(teamName: string, injuries: InjuryDetail[]): SquadImpactResult {
  if (injuries.length === 0) {
    return {
      team: teamName, level: 'NEUTRO', score: 0, absentPlayers: [],
      positionGaps: [], goalsBias: 0, defenseBias: 0,
      insight: 'Elenco completo. Sem desfalques relevantes.',
    };
  }

  const absent: AbsentPlayer[] = injuries.map(inj => {
    const { tier, impactScore } = classifyPlayer(inj.name, inj.position);
    return { name: inj.name, position: inj.position, reason: inj.reason, tier, impactScore };
  });

  // Score total com penalidade de acumulação (cada ausência adicional vale 80% da anterior)
  const sorted = [...absent].sort((a, b) => b.impactScore - a.impactScore);
  let totalScore = 0;
  let multiplier = 1.0;
  for (const p of sorted) {
    totalScore += p.impactScore * multiplier;
    multiplier *= 0.8;
  }
  totalScore = Math.min(100, Math.round(totalScore));

  // Gaps por posição (3+ ausentes na mesma posição = gap crítico)
  const byPos: Record<string, number> = {};
  for (const p of absent) { byPos[p.position] = (byPos[p.position] ?? 0) + 1; }
  const positionGaps = Object.entries(byPos)
    .filter(([, count]) => count >= 2)
    .map(([pos, count]) => `${pos} (${count}×)`);

  // Bias em gols
  const attackers = absent.filter(p => p.position === 'Attacker');
  const defenders = absent.filter(p => p.position === 'Defender' || p.position === 'Goalkeeper');
  const goalsBias = -Math.min(0.8, attackers.reduce((s, p) => s + p.impactScore / 200, 0));
  const defenseBias = Math.min(0.7, defenders.reduce((s, p) => s + p.impactScore / 200, 0));

  const level: SquadImpactLevel =
    totalScore >= 60 ? 'CRITICO' :
    totalScore >= 40 ? 'ALTO' :
    totalScore >= 20 ? 'MODERADO' :
    totalScore >= 8  ? 'LEVE' : 'NEUTRO';

  // Insight
  const stars = absent.filter(p => p.tier === 'star').map(p => p.name);
  const keys  = absent.filter(p => p.tier === 'key').map(p => p.name);
  let insight = '';
  if (stars.length > 0) {
    insight = `Ausência crítica: ${stars.join(', ')}. Impacto imediato na qualidade ofensiva/defensiva.`;
  } else if (keys.length > 0) {
    insight = `Desfalques importantes: ${keys.join(', ')}. Time perde peças chave do esquema titular.`;
  } else if (absent.length >= 4) {
    insight = `${absent.length} jogadores ausentes — mesmo sem estrelas, o volume de desfalques reduz a eficiência do time.`;
  } else {
    insight = `Desfalques de baixo impacto (rotação/reservas). Elenco titular disponível.`;
  }

  return {
    team: teamName, level, score: totalScore, absentPlayers: absent,
    positionGaps, goalsBias: parseFloat(goalsBias.toFixed(2)),
    defenseBias: parseFloat(defenseBias.toFixed(2)), insight,
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Calcula o impacto de escalação para ambos os times a partir de dados
 * de lesões detalhados (InjuryDetail[]). Chamado de dentro do geminiService.
 */
export function calcMatchSquadImpact(
  homeTeam: string,
  awayTeam: string,
  homeInjuries: InjuryDetail[],
  awayInjuries: InjuryDetail[]
): MatchSquadImpact {
  const home = calcSquadImpact(homeTeam, homeInjuries);
  const away = calcSquadImpact(awayTeam, awayInjuries);
  const deltaScore = home.score - away.score;

  let insight = '';
  if (Math.abs(deltaScore) <= 5) {
    insight = 'Impacto de desfalques equilibrado entre os times.';
  } else {
    const moreAffected = deltaScore > 0 ? home : away;
    const side = deltaScore > 0 ? 'Casa' : 'Visitante';
    insight = `${side} mais afetado (score ${moreAffected.score}/100): ${moreAffected.insight}`;
  }

  return { home, away, deltaScore, insight };
}

/**
 * Formata o resultado para inclusão no prompt da IA.
 */
export function formatSquadImpactForPrompt(result: MatchSquadImpact): string {
  if (result.home.score === 0 && result.away.score === 0) return '';

  const formatTeam = (r: SquadImpactResult, label: string) => {
    if (r.score === 0) return `  ${label}: Elenco completo.`;
    const stars = r.absentPlayers.filter(p => p.tier === 'star' || p.tier === 'key').map(p => p.name);
    const names = stars.length > 0 ? stars.join(', ') : r.absentPlayers.slice(0, 3).map(p => p.name).join(', ');
    return `  ${label}: IMPACTO ${r.level} (${r.score}/100) — ${names}${r.absentPlayers.length > 3 ? ` +${r.absentPlayers.length - 3} outros` : ''}`;
  };

  return [
    'IMPACTO DE ESCALAÇÃO (desfalques ponderados por importância):',
    formatTeam(result.home, 'Casa'),
    formatTeam(result.away, 'Visitante'),
    `  Delta: ${result.deltaScore > 0 ? '+' : ''}${result.deltaScore} | ${result.insight}`,
  ].join('\n');
}

/**
 * Retorna badges para a UI por time.
 */
export function getSquadImpactBadge(result: SquadImpactResult): { color: string; label: string } | null {
  if (result.level === 'NEUTRO' || result.score < 8) return null;
  const color =
    result.level === 'CRITICO' ? 'red' :
    result.level === 'ALTO'    ? 'orange' :
    result.level === 'MODERADO'? 'yellow' : 'gray';
  const label = `${result.level} (${result.score})`;
  return { color, label };
}
