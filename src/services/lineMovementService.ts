/**
 * lineMovementService.ts — Rastreador de Movimentação de Linha + Steam Move Detector
 *
 * Sharp money detection via:
 *  - Steam Move: queda abrupta de odd em curto período (sinal de dinheiro profissional)
 *  - Gradual Move: tendência direcional sustentada
 *  - Reverse Line Move: odds caem mas % de apostas vai para o lado contrário
 */

import { Match } from '../types';

export type LineMovementType = 'STEAM_MOVE' | 'GRADUAL' | 'ESTAVEL' | 'ADVERSO' | 'REVERSE';
export type LineMovementDirection = 'FAVOR' | 'CONTRA' | 'NEUTRO';

export interface OddsSnapshot {
  ts: number;           // timestamp do snapshot
  home: number;
  draw: number;
  away: number;
}

export interface LineMovementResult {
  matchId: string;
  home_team: string;
  away_team: string;
  snapshots: OddsSnapshot[];
  variation: {
    home: number;   // % de variação desde o snapshot inicial
    draw: number;
    away: number;
  };
  tem_steam: boolean;
  steam_side: 'home' | 'draw' | 'away' | null;
  tipo: LineMovementType;
  direcao: LineMovementDirection;
  alerta: string | null;
  sharpScore: number; // 0-100: confiança de que é sharp money
}

// Configurações de detecção (ajustáveis)
const STEAM_THRESHOLD_PCT = 5;      // queda >= 5% em <= 60 min = Steam Move
const STEAM_WINDOW_MS = 60 * 60 * 1000; // 1 hora
const GRADUAL_THRESHOLD_PCT = 3;    // queda >= 3% = Gradual move
const ADVERSE_THRESHOLD_PCT = 3;    // alta >= 3% = mercado indo contra

const STORAGE_KEY = 'evengine_line_movement';
const OPENING_ODDS_KEY = 'evengine_opening_odds';

// ─── Persistência ──────────────────────────────────────────────────────────

function loadAllMovements(): Record<string, LineMovementResult> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveAllMovements(data: Record<string, LineMovementResult>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

function loadOpeningOdds(): Record<string, OddsSnapshot> {
  try {
    const raw = localStorage.getItem(OPENING_ODDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveOpeningOdds(data: Record<string, OddsSnapshot>): void {
  try { localStorage.setItem(OPENING_ODDS_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractPinnacleH2H(match: Match): { home: number; draw: number; away: number } | null {
  const bk = match.bookmakers?.find(b => b.key === 'pinnacle') ?? match.bookmakers?.[0];
  if (!bk) return null;
  const h2h = bk.markets?.find(m => m.key === 'h2h');
  if (!h2h) return null;
  const home = h2h.outcomes.find(o => o.name === match.home_team)?.price ?? 0;
  const away = h2h.outcomes.find(o => o.name === match.away_team)?.price ?? 0;
  const draw = h2h.outcomes.find(o => o.name === 'Draw')?.price ?? 0;
  if (!home || !away) return null;
  return { home, draw, away };
}

function pctChange(from: number, to: number): number {
  if (!from || from === 0) return 0;
  return parseFloat((((to - from) / from) * 100).toFixed(2));
}

function classifyMovement(
  variation: { home: number; draw: number; away: number },
  snapshots: OddsSnapshot[]
): { tipo: LineMovementType; direcao: LineMovementDirection; tem_steam: boolean; steam_side: 'home' | 'draw' | 'away' | null; alerta: string | null; sharpScore: number } {

  const { home, away } = variation;

  // Detectar Steam: queda >= threshold em snapshots dentro da janela de 1h
  let tem_steam = false;
  let steam_side: 'home' | 'draw' | 'away' | null = null;

  if (snapshots.length >= 2) {
    const recent = snapshots.filter(s => Date.now() - s.ts <= STEAM_WINDOW_MS);
    if (recent.length >= 2) {
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      const steamHome = pctChange(oldest.home, newest.home);
      const steamAway = pctChange(oldest.away, newest.away);
      const steamDraw = pctChange(oldest.draw, newest.draw);

      if (steamHome <= -STEAM_THRESHOLD_PCT) { tem_steam = true; steam_side = 'home'; }
      else if (steamAway <= -STEAM_THRESHOLD_PCT) { tem_steam = true; steam_side = 'away'; }
      else if (steamDraw <= -STEAM_THRESHOLD_PCT) { tem_steam = true; steam_side = 'draw'; }
    }
  }

  if (tem_steam) {
    const side = steam_side === 'home' ? 'Casa' : steam_side === 'away' ? 'Visitante' : 'Empate';
    return {
      tipo: 'STEAM_MOVE',
      direcao: steam_side === 'home' ? 'FAVOR' : 'CONTRA',
      tem_steam: true,
      steam_side,
      alerta: `🔥 STEAM MOVE detectado — Odd ${side} caindo rapidamente. Sharp money entrando.`,
      sharpScore: 85
    };
  }

  // Gradual / Adverso / Estável
  if (home <= -GRADUAL_THRESHOLD_PCT) {
    return { tipo: 'GRADUAL', direcao: 'FAVOR', tem_steam: false, steam_side: null, alerta: `📉 Linha em queda gradual para Casa (${home.toFixed(1)}%). Pressão de mercado detectada.`, sharpScore: 55 };
  }
  if (away <= -GRADUAL_THRESHOLD_PCT) {
    return { tipo: 'GRADUAL', direcao: 'CONTRA', tem_steam: false, steam_side: null, alerta: `📉 Linha em queda para Visitante (${away.toFixed(1)}%). Possível sharp no visitante.`, sharpScore: 50 };
  }
  if (home >= ADVERSE_THRESHOLD_PCT) {
    return { tipo: 'ADVERSO', direcao: 'CONTRA', tem_steam: false, steam_side: null, alerta: `⚠️ Linha subindo para Casa (${home.toFixed(1)}%). Mercado vai contra a entrada.`, sharpScore: 20 };
  }

  return { tipo: 'ESTAVEL', direcao: 'NEUTRO', tem_steam: false, steam_side: null, alerta: null, sharpScore: 0 };
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Registra as odds de abertura de um match (chamado uma vez ao carregar partidas).
 * Não sobrescreve se já existir snapshot para este match.
 */
export function registerOpeningOdds(matches: Match[]): void {
  const stored = loadOpeningOdds();
  const all = loadAllMovements();
  let changed = false;

  matches.forEach(match => {
    if (stored[match.id]) return; // já registrado
    const odds = extractPinnacleH2H(match);
    if (!odds) return;

    const snap: OddsSnapshot = { ts: Date.now(), ...odds };
    stored[match.id] = snap;

    all[match.id] = {
      matchId: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      snapshots: [snap],
      variation: { home: 0, draw: 0, away: 0 },
      tem_steam: false,
      steam_side: null,
      tipo: 'ESTAVEL',
      direcao: 'NEUTRO',
      alerta: null,
      sharpScore: 0
    };
    changed = true;
  });

  if (changed) {
    saveOpeningOdds(stored);
    saveAllMovements(all);
  }
}

/**
 * Detecta movimentação de linha para um match com odds atuais.
 * Retorna o resultado ou null se não houver dados suficientes.
 */
export function detectLineMovement(match: Match): LineMovementResult | null {
  const odds = extractPinnacleH2H(match);
  if (!odds) return null;

  const openingOdds = loadOpeningOdds();
  const opening = openingOdds[match.id];
  if (!opening) return null;

  const all = loadAllMovements();
  const existing = all[match.id] ?? {
    matchId: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
    snapshots: [opening],
    variation: { home: 0, draw: 0, away: 0 },
    tem_steam: false,
    steam_side: null,
    tipo: 'ESTAVEL' as LineMovementType,
    direcao: 'NEUTRO' as LineMovementDirection,
    alerta: null,
    sharpScore: 0
  };

  // Adicionar novo snapshot se odds mudaram
  const lastSnap = existing.snapshots[existing.snapshots.length - 1];
  const oddsChanged = Math.abs(lastSnap.home - odds.home) > 0.01 ||
                      Math.abs(lastSnap.away - odds.away) > 0.01 ||
                      Math.abs(lastSnap.draw - odds.draw) > 0.01;

  if (oddsChanged) {
    existing.snapshots.push({ ts: Date.now(), ...odds });
    // Manter só últimos 50 snapshots para não explodir localStorage
    if (existing.snapshots.length > 50) existing.snapshots = existing.snapshots.slice(-50);
  }

  // Variação total desde abertura
  existing.variation = {
    home: pctChange(opening.home, odds.home),
    draw:  opening.draw ? pctChange(opening.draw, odds.draw) : 0,
    away: pctChange(opening.away, odds.away),
  };

  const classified = classifyMovement(existing.variation, existing.snapshots);
  Object.assign(existing, classified);

  all[match.id] = existing;
  saveAllMovements(all);

  return existing;
}

/**
 * Retorna todos os Steam Moves detectados atualmente.
 */
export function getActiveSteamMoves(): LineMovementResult[] {
  const all = loadAllMovements();
  return Object.values(all).filter(r => r.tem_steam);
}

/**
 * Retorna movimentação para um match específico (sem update).
 */
export function getLineMovement(matchId: string): LineMovementResult | null {
  const all = loadAllMovements();
  return all[matchId] ?? null;
}

/**
 * Limpa dados de movimentação para matches antigos (> 3 dias).
 */
export function cleanOldLineMovements(): void {
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const all = loadAllMovements();
  const opening = loadOpeningOdds();
  let changed = false;

  Object.keys(all).forEach(id => {
    const snaps = all[id].snapshots;
    if (snaps.length > 0 && snaps[snaps.length - 1].ts < cutoff) {
      delete all[id];
      delete opening[id];
      changed = true;
    }
  });

  if (changed) {
    saveAllMovements(all);
    saveOpeningOdds(opening);
  }
}
