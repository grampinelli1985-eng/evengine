/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SteamMove {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  outcome: string;
  prevOdd: number;
  currOdd: number;
  probDeltaPp: number;
  direction: 'SHARP_HOME' | 'SHARP_AWAY' | 'SHARP_DRAW';
  detectedAt: string;
}

export interface SteamWatchEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  sportKey: string;
  commenceTime: string;
  odds: Record<string, number>;
  addedAt: string;
}

const LS_WATCH_KEY    = 'evengine_steam_watch';
const LS_MOVES_KEY    = 'evengine_steam_moves';
const LS_SNAPSHOT_KEY = 'evengine_steam_snapshot';

const THRESHOLD = 0.03;
const MAX_MOVES = 50;
const MOVES_TTL_MS = 48 * 60 * 60 * 1000;

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

function impliedProb(odd: number): number {
  if (odd <= 0) return 0;
  return 1 / odd;
}

function loadWatchList(): SteamWatchEntry[] {
  const raw = lsGet(LS_WATCH_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as SteamWatchEntry[]; } catch { return []; }
}

function saveWatchList(list: SteamWatchEntry[]): void {
  lsSet(LS_WATCH_KEY, JSON.stringify(list));
}

function loadMoves(): SteamMove[] {
  const raw = lsGet(LS_MOVES_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as SteamMove[]; } catch { return []; }
}

function saveMoves(moves: SteamMove[]): void {
  lsSet(LS_MOVES_KEY, JSON.stringify(moves));
}

type SnapshotStore = Record<string, Record<string, number>>;

function loadSnapshot(): SnapshotStore {
  const raw = lsGet(LS_SNAPSHOT_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as SnapshotStore; } catch { return {}; }
}

function saveSnapshot(snapshot: SnapshotStore): void {
  lsSet(LS_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function addToWatchList(
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  sportKey: string,
  commenceTime: string,
  currentOdds: Record<string, number>
): void {
  const list = loadWatchList();
  const exists = list.some(e => e.matchId === matchId);
  if (!exists) {
    const entry: SteamWatchEntry = {
      matchId,
      homeTeam,
      awayTeam,
      sportKey,
      commenceTime,
      odds: { ...currentOdds },
      addedAt: new Date().toISOString(),
    };
    list.push(entry);
    saveWatchList(list);

    const snapshot = loadSnapshot();
    snapshot[matchId] = { ...currentOdds };
    saveSnapshot(snapshot);
  }
}

export function removeFromWatchList(matchId: string): void {
  const list = loadWatchList().filter(e => e.matchId !== matchId);
  saveWatchList(list);

  const snapshot = loadSnapshot();
  delete snapshot[matchId];
  saveSnapshot(snapshot);
}

export function getWatchList(): SteamWatchEntry[] {
  return loadWatchList();
}

export function getDetectedMoves(matchId?: string): SteamMove[] {
  const moves = loadMoves();
  if (matchId) return moves.filter(m => m.matchId === matchId);
  return moves;
}

export function checkForSteamMoves(
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  currentOdds: Record<string, number>
): SteamMove[] {
  const snapshot = loadSnapshot();
  const prevOdds = snapshot[matchId];

  if (!prevOdds) {
    snapshot[matchId] = { ...currentOdds };
    saveSnapshot(snapshot);
    return [];
  }

  const newMoves: SteamMove[] = [];
  const now = new Date().toISOString();

  const allKeys = new Set([...Object.keys(prevOdds), ...Object.keys(currentOdds)]);

  for (const key of allKeys) {
    const prev = prevOdds[key];
    const curr = currentOdds[key];

    if (prev === undefined || curr === undefined) continue;
    if (prev <= 0 || curr <= 0) continue;

    const prevProb = impliedProb(prev);
    const currProb = impliedProb(curr);
    const delta = currProb - prevProb;

    if (Math.abs(delta) < THRESHOLD) continue;

    // Determine direction
    // key format expected: "<market>_<outcome>" e.g. "h2h_home", "h2h_away", "h2h_draw"
    // or just the team name / "Draw" if flat structure
    const keyLower = key.toLowerCase();
    let direction: SteamMove['direction'];

    if (
      keyLower.includes('draw') ||
      keyLower.includes('empate')
    ) {
      direction = 'SHARP_DRAW';
    } else if (
      keyLower.includes('away') ||
      keyLower.includes('visitante') ||
      keyLower === awayTeam.toLowerCase()
    ) {
      direction = delta > 0 ? 'SHARP_AWAY' : 'SHARP_HOME';
    } else {
      // home or increase in home implied probability
      direction = delta > 0 ? 'SHARP_HOME' : 'SHARP_AWAY';
    }

    // Derive market and outcome from key
    let market = 'h2h';
    let outcome = key;
    const sepIdx = key.indexOf('_');
    if (sepIdx > -1) {
      const possibleMarket = key.slice(0, sepIdx);
      if (['h2h', 'totals', 'spreads'].includes(possibleMarket)) {
        market = possibleMarket;
        outcome = key.slice(sepIdx + 1);
      }
    }

    const move: SteamMove = {
      matchId,
      homeTeam,
      awayTeam,
      market,
      outcome,
      prevOdd: prev,
      currOdd: curr,
      probDeltaPp: parseFloat((delta * 100).toFixed(2)),
      direction,
      detectedAt: now,
    };

    newMoves.push(move);
  }

  // Update snapshot
  snapshot[matchId] = { ...currentOdds };
  saveSnapshot(snapshot);

  if (newMoves.length > 0) {
    const existing = loadMoves();
    const combined = [...newMoves, ...existing].slice(0, MAX_MOVES);
    saveMoves(combined);
  }

  return newMoves;
}

export function clearOldMoves(): void {
  const cutoff = Date.now() - MOVES_TTL_MS;
  const moves = loadMoves().filter(m => new Date(m.detectedAt).getTime() >= cutoff);
  saveMoves(moves);
}
