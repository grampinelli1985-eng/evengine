// backtestService.ts
// EVEngine — Backtest service for evaluating model accuracy from localStorage data.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY_ENTRIES = 'evengine_backtest_entries';
const STORAGE_KEY_REPORT = 'evengine_backtest_report';
const MAX_AGE_DAYS = 180;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface BacktestEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  mercado: string;
  // Model predictions at time of analysis
  probPoisson: number;       // 0-1
  probGemini: number;        // 0-1
  probBlend: number;         // 0-1, weighted blend (60% Poisson + 40% Gemini)
  // Market reference
  oddPinnacle: number;
  fairOdd: number;
  ev: number;                // EV% at time of analysis
  kellyPct: number;
  // Outcome (filled after match)
  resultado: 'GREEN' | 'RED' | 'VOID' | null;
  oddFechamento: number | null;
  clvPct: number | null;
  analyzedAt: string;
}

export interface ModelAccuracy {
  model: 'poisson' | 'gemini' | 'blend';
  totalEntries: number;
  withResult: number;
  winRate: number;
  avgPredictedProb: number;
  brierScore: number;
  calibrationError: number;
  roi: number;
}

export interface BacktestReport {
  generatedAt: string;
  totalEntries: number;
  withResults: number;
  coverageRate: number;
  clvMedio: number;
  roiRealizado: number;
  modelAccuracy: ModelAccuracy[];
  bestModel: 'poisson' | 'gemini' | 'blend';
  driftAlert: boolean;
  monthlyBreakdown: Array<{
    month: string;
    entries: number;
    winRate: number;
    roi: number;
    clv: number;
  }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadEntries(): BacktestEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENTRIES);
    if (!raw) return [];
    return JSON.parse(raw) as BacktestEntry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: BacktestEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(entries));
  } catch (err) {
    console.error('[backtestService] Failed to save entries:', err);
  }
}

function invalidateReportCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_REPORT);
  } catch {
    // ignore
  }
}

function entryKey(matchId: string, mercado: string): string {
  return `${matchId}::${mercado.toLowerCase().trim()}`;
}

function toYYYYMM(isoString: string): string {
  // Returns "YYYY-MM" from an ISO date string
  return isoString.slice(0, 7);
}

function computeModelAccuracy(
  model: 'poisson' | 'gemini' | 'blend',
  entries: BacktestEntry[],
): ModelAccuracy {
  const withResult = entries.filter((e) => e.resultado !== null && e.resultado !== undefined);

  const totalEntries = entries.length;
  const withResultCount = withResult.length;

  if (withResultCount === 0) {
    return {
      model,
      totalEntries,
      withResult: 0,
      winRate: 0,
      avgPredictedProb: 0,
      brierScore: 0,
      calibrationError: 0,
      roi: 0,
    };
  }

  const probField: keyof BacktestEntry =
    model === 'poisson' ? 'probPoisson' : model === 'gemini' ? 'probGemini' : 'probBlend';

  let winCount = 0;
  let sumPredictedProb = 0;
  let sumBrier = 0;
  let sumCalibError = 0;
  let sumROI = 0;

  for (const entry of withResult) {
    const predicted = entry[probField] as number;
    const isGreen = entry.resultado === 'GREEN';
    const actualOutcome = isGreen ? 1 : 0; // VOID counts as loss for Brier/ROI

    if (isGreen) winCount++;

    sumPredictedProb += predicted;

    // Brier score component: (predicted - actual)^2
    sumBrier += Math.pow(predicted - actualOutcome, 2);

    // Calibration error component: |predicted - actual|
    sumCalibError += Math.abs(predicted - actualOutcome);

    // ROI: bet 1 unit at implied odds (1/predicted), win if GREEN
    // Profit per bet = (1/predicted - 1) if GREEN, -1 if not
    if (predicted > 0) {
      const impliedOdds = 1 / predicted;
      const profit = isGreen ? impliedOdds - 1 : -1;
      sumROI += profit;
    }
  }

  const winRate = winCount / withResultCount;
  const avgPredictedProb = sumPredictedProb / withResultCount;
  const brierScore = parseFloat((sumBrier / withResultCount).toFixed(6));
  const calibrationError = parseFloat((sumCalibError / withResultCount).toFixed(6));
  // ROI expressed as percentage: total profit / total staked (1 unit each)
  const roi = parseFloat(((sumROI / withResultCount) * 100).toFixed(2));

  return {
    model,
    totalEntries,
    withResult: withResultCount,
    winRate: parseFloat(winRate.toFixed(4)),
    avgPredictedProb: parseFloat(avgPredictedProb.toFixed(4)),
    brierScore,
    calibrationError,
    roi,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a new backtest entry.
 * Deduplicates by matchId + mercado (last write wins on conflict).
 */
export function registrarEntradaBacktest(
  entry: Omit<BacktestEntry, 'resultado' | 'oddFechamento' | 'clvPct'>,
): void {
  const entries = loadEntries();
  const key = entryKey(entry.matchId, entry.mercado);

  const idx = entries.findIndex(
    (e) => entryKey(e.matchId, e.mercado) === key,
  );

  const fullEntry: BacktestEntry = {
    ...entry,
    resultado: null,
    oddFechamento: null,
    clvPct: null,
  };

  if (idx >= 0) {
    // Keep outcome data if already filled in
    const existing = entries[idx];
    entries[idx] = {
      ...fullEntry,
      resultado: existing.resultado,
      oddFechamento: existing.oddFechamento,
      clvPct: existing.clvPct,
    };
  } else {
    entries.push(fullEntry);
  }

  saveEntries(entries);
  invalidateReportCache();
}

/**
 * Fill in the result for an existing entry.
 */
export function atualizarResultadoBacktest(
  matchId: string,
  mercado: string,
  resultado: 'GREEN' | 'RED' | 'VOID',
  oddFechamento: number | null,
  clvPct: number | null,
): void {
  const entries = loadEntries();
  const key = entryKey(matchId, mercado);
  const idx = entries.findIndex((e) => entryKey(e.matchId, e.mercado) === key);

  if (idx === -1) {
    console.warn(
      `[backtestService] atualizarResultadoBacktest: entry not found for ${matchId} / ${mercado}`,
    );
    return;
  }

  entries[idx] = {
    ...entries[idx],
    resultado,
    oddFechamento,
    clvPct,
  };

  saveEntries(entries);
  invalidateReportCache();
}

/**
 * Return all stored backtest entries.
 */
export function getBacktestEntries(): BacktestEntry[] {
  return loadEntries();
}

/**
 * Compute and return the full backtest report.
 * Result is cached in localStorage until invalidated.
 */
export function gerarRelatorioBacktest(): BacktestReport {
  // Return cached report if available
  try {
    const cached = localStorage.getItem(STORAGE_KEY_REPORT);
    if (cached) {
      return JSON.parse(cached) as BacktestReport;
    }
  } catch {
    // ignore — regenerate
  }

  const allEntries = loadEntries();
  const withResults = allEntries.filter(
    (e) => e.resultado !== null && e.resultado !== undefined,
  );

  const totalEntries = allEntries.length;
  const withResultsCount = withResults.length;
  const coverageRate =
    totalEntries > 0
      ? parseFloat(((withResultsCount / totalEntries) * 100).toFixed(2))
      : 0;

  // CLV medio — only from entries with clvPct
  const clvEntries = withResults.filter((e) => e.clvPct !== null);
  const clvMedio =
    clvEntries.length > 0
      ? parseFloat(
          (
            clvEntries.reduce((sum, e) => sum + (e.clvPct as number), 0) /
            clvEntries.length
          ).toFixed(2),
        )
      : 0;

  // ROI realizado: from actual GREEN/RED results (not VOID)
  // 1 unit per bet, profit = (oddFechamento - 1) if GREEN else -1
  const bettingResults = withResults.filter((e) => e.resultado !== 'VOID');
  let sumRealProfit = 0;
  for (const e of bettingResults) {
    if (e.resultado === 'GREEN') {
      const odd = e.oddFechamento ?? e.fairOdd;
      sumRealProfit += odd - 1;
    } else {
      sumRealProfit -= 1;
    }
  }
  const roiRealizado =
    bettingResults.length > 0
      ? parseFloat(((sumRealProfit / bettingResults.length) * 100).toFixed(2))
      : 0;

  // Model accuracy
  const modelAccuracy: ModelAccuracy[] = [
    computeModelAccuracy('poisson', allEntries),
    computeModelAccuracy('gemini', allEntries),
    computeModelAccuracy('blend', allEntries),
  ];

  // Best model = lowest Brier score (only among models with at least 1 result)
  const modelsWithData = modelAccuracy.filter((m) => m.withResult > 0);
  let bestModel: 'poisson' | 'gemini' | 'blend' = 'blend';
  if (modelsWithData.length > 0) {
    const best = modelsWithData.reduce((prev, cur) =>
      cur.brierScore < prev.brierScore ? cur : prev,
    );
    bestModel = best.model;
  }

  // Drift alert: blend underperforms Poisson by >2pp Brier score AND ≥20 results
  const poissonAcc = modelAccuracy.find((m) => m.model === 'poisson')!;
  const blendAcc = modelAccuracy.find((m) => m.model === 'blend')!;
  const driftAlert =
    blendAcc.withResult >= 20 &&
    blendAcc.brierScore > poissonAcc.brierScore + 0.02;

  // Monthly breakdown
  const monthMap = new Map<
    string,
    { entries: number; wins: number; losses: number; sumROI: number; sumCLV: number; clvCount: number }
  >();

  for (const entry of allEntries) {
    const month = toYYYYMM(entry.analyzedAt);
    const existing = monthMap.get(month) ?? {
      entries: 0,
      wins: 0,
      losses: 0,
      sumROI: 0,
      sumCLV: 0,
      clvCount: 0,
    };

    existing.entries++;

    if (entry.resultado === 'GREEN') {
      existing.wins++;
      const odd = entry.oddFechamento ?? entry.fairOdd;
      existing.sumROI += odd - 1;
    } else if (entry.resultado === 'RED') {
      existing.losses++;
      existing.sumROI -= 1;
    }
    // VOID: skip ROI contribution

    if (entry.clvPct !== null) {
      existing.sumCLV += entry.clvPct;
      existing.clvCount++;
    }

    monthMap.set(month, existing);
  }

  const monthlyBreakdown = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => {
      const decisiveCount = data.wins + data.losses;
      return {
        month,
        entries: data.entries,
        winRate:
          decisiveCount > 0
            ? parseFloat((data.wins / decisiveCount).toFixed(4))
            : 0,
        roi:
          decisiveCount > 0
            ? parseFloat(((data.sumROI / decisiveCount) * 100).toFixed(2))
            : 0,
        clv:
          data.clvCount > 0
            ? parseFloat((data.sumCLV / data.clvCount).toFixed(2))
            : 0,
      };
    });

  const report: BacktestReport = {
    generatedAt: new Date().toISOString(),
    totalEntries,
    withResults: withResultsCount,
    coverageRate,
    clvMedio,
    roiRealizado,
    modelAccuracy,
    bestModel,
    driftAlert,
    monthlyBreakdown,
  };

  // Cache
  try {
    localStorage.setItem(STORAGE_KEY_REPORT, JSON.stringify(report));
  } catch {
    // storage full or unavailable — not critical
  }

  return report;
}

/**
 * Export all backtest entries as a CSV string.
 */
export function exportarBacktestCSV(): string {
  const entries = loadEntries();

  const headers = [
    'matchId',
    'homeTeam',
    'awayTeam',
    'commenceTime',
    'mercado',
    'probPoisson',
    'probGemini',
    'probBlend',
    'oddPinnacle',
    'fairOdd',
    'ev',
    'kellyPct',
    'resultado',
    'oddFechamento',
    'clvPct',
    'analyzedAt',
  ];

  function escapeCSV(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const rows = entries.map((e) =>
    [
      e.matchId,
      e.homeTeam,
      e.awayTeam,
      e.commenceTime,
      e.mercado,
      e.probPoisson,
      e.probGemini,
      e.probBlend,
      e.oddPinnacle,
      e.fairOdd,
      e.ev,
      e.kellyPct,
      e.resultado,
      e.oddFechamento,
      e.clvPct,
      e.analyzedAt,
    ]
      .map(escapeCSV)
      .join(','),
  );

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Remove entries older than MAX_AGE_DAYS days (based on analyzedAt).
 */
export function limparEntradasBacktest(): void {
  const entries = loadEntries();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const cutoffISO = cutoff.toISOString();

  const filtered = entries.filter((e) => e.analyzedAt >= cutoffISO);

  if (filtered.length !== entries.length) {
    saveEntries(filtered);
    invalidateReportCache();
    console.info(
      `[backtestService] Removed ${entries.length - filtered.length} entries older than ${MAX_AGE_DAYS} days.`,
    );
  }
}
