import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  normalizeMercado,
  h2hSide,
  isTotalsMercado,
  isSpreadMercado,
  isDuplaChanceMercado,
  classifyMercado,
  requiredMarkets,
} from './mercado.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClvEntry {
  id: string;
  match_id: string;
  home_team: string;
  away_team: string;
  sport_key: string;
  commence_time: string;
  mercado: string;
  odd_utilizada: number;
  odd_fechamento: number | null;
  clv_pct: number | null;
  resultado: 'PENDENTE' | 'GREEN' | 'RED' | 'VOID';
  analyzed_at: string;
  closed_at: string | null;
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

interface CaptureResult {
  id: string;
  match_id: string;
  mercado: string;
  odd_fechamento: number | null;
  clv_pct: number | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the closing odd for a given mercado from the Pinnacle bookmaker data.
 */
function extractClosingOdd(
  mercado: string,
  homeTeam: string,
  awayTeam: string,
  bookmakers: OddsApiBookmaker[],
): number | null {
  const pinnacle = bookmakers.find((b) => b.key === 'pinnacle');
  if (!pinnacle) return null;

  const m = normalizeMercado(mercado);

  // Mercados sem odd de fechamento extraível (BTTS, DNB, escanteios...) — ver mercado.ts.
  if (classifyMercado(mercado) === 'unsupported') return null;

  // ---- H2H ----------------------------------------------------------------
  const { isHomeWin, isAwayWin, isDraw } = h2hSide(m);

  if (isHomeWin || isAwayWin || isDraw) {
    const h2h = pinnacle.markets.find((mk) => mk.key === 'h2h');
    if (!h2h) return null;
    if (isHomeWin) {
      const outcome = h2h.outcomes.find(
        (o) => o.name.toLowerCase() === homeTeam.toLowerCase(),
      );
      return outcome?.price ?? null;
    }
    if (isAwayWin) {
      const outcome = h2h.outcomes.find(
        (o) => o.name.toLowerCase() === awayTeam.toLowerCase(),
      );
      return outcome?.price ?? null;
    }
    // draw
    const outcome = h2h.outcomes.find(
      (o) => o.name.toLowerCase() === 'draw',
    );
    return outcome?.price ?? null;
  }

  // ---- Totals (Over / Under) -----------------------------------------------
  const isOver = m.includes('over') || m.includes('mais de') || m.includes('acima');
  const isUnder = m.includes('under') || m.includes('menos de') || m.includes('abaixo');

  if (isTotalsMercado(m)) {
    const totals = pinnacle.markets.find((mk) => mk.key === 'totals');
    if (!totals) return null;

    // Try to extract a line number from the mercado string, e.g. "Over 2.5"
    const lineMatch = mercado.match(/(\d+(?:[.,]\d+)?)/);
    const lineNumber = lineMatch ? parseFloat(lineMatch[1].replace(',', '.')) : null;

    const targetName = isOver ? 'over' : 'under';

    let outcome: OddsApiOutcome | undefined;

    if (lineNumber !== null) {
      // Prefer the exact line
      outcome = totals.outcomes.find(
        (o) =>
          o.name.toLowerCase() === targetName &&
          o.point !== undefined &&
          Math.abs(o.point - lineNumber) < 0.01,
      );
    }

    // Fallback: first matching name
    if (!outcome) {
      outcome = totals.outcomes.find(
        (o) => o.name.toLowerCase() === targetName,
      );
    }

    return outcome?.price ?? null;
  }

  // ---- Spreads -------------------------------------------------------------
  if (isSpreadMercado(m)) {
    const spreads = pinnacle.markets.find((mk) => mk.key === 'spreads');
    if (!spreads) return null;

    const isHomeSpread = m.includes('casa') || m.includes('home') || m.includes('1');
    const targetTeam = isHomeSpread ? homeTeam : awayTeam;

    const outcome = spreads.outcomes.find(
      (o) => o.name.toLowerCase() === targetTeam.toLowerCase(),
    );
    return outcome?.price ?? null;
  }

  // ---- Dupla Chance --------------------------------------------------------
  if (isDuplaChanceMercado(m)) {
    const h2h = pinnacle.markets.find((mk) => mk.key === 'h2h');
    if (!h2h) return null;

    const homeOutcome = h2h.outcomes.find(
      (o) => o.name.toLowerCase() === homeTeam.toLowerCase(),
    );
    const awayOutcome = h2h.outcomes.find(
      (o) => o.name.toLowerCase() === awayTeam.toLowerCase(),
    );
    const drawOutcome = h2h.outcomes.find(
      (o) => o.name.toLowerCase() === 'draw',
    );

    const homeProb = homeOutcome ? 1 / homeOutcome.price : 0;
    const awayProb = awayOutcome ? 1 / awayOutcome.price : 0;
    const drawProb = drawOutcome ? 1 / drawOutcome.price : 0;

    // 1X (home or draw)
    if (m.includes('1x') || (m.includes('1') && m.includes('x'))) {
      const combinedProb = homeProb + drawProb;
      return combinedProb > 0 ? parseFloat((1 / combinedProb).toFixed(4)) : null;
    }

    // X2 (draw or away)
    if (m.includes('x2') || (m.includes('x') && m.includes('2'))) {
      const combinedProb = drawProb + awayProb;
      return combinedProb > 0 ? parseFloat((1 / combinedProb).toFixed(4)) : null;
    }

    // 12 (home or away)
    if (m.includes('12')) {
      const combinedProb = homeProb + awayProb;
      return combinedProb > 0 ? parseFloat((1 / combinedProb).toFixed(4)) : null;
    }

    return null;
  }

  // Unknown mercado
  return null;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

// Estado best-effort por instância da Edge Function (o cron reaproveita o isolate; se ele
// for reciclado a entrada só é tentada de novo, sem prejuízo de correção). Conta falhas de
// mapeamento por entrada: a Pinnacle pode ainda não ter publicado o mercado nos primeiros
// minutos da janela, então só desiste após MAX_UNMAPPED_ATTEMPTS tentativas seguidas.
const MAX_UNMAPPED_ATTEMPTS = 3;
const unmappedAttempts = new Map<string, number>();
const gaveUp = (id: string) => (unmappedAttempts.get(id) ?? 0) >= MAX_UNMAPPED_ATTEMPTS;

async function captureCLV(): Promise<{
  processed: number;
  captured: number;
  skipped: number;
  errors: string[];
}> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const oddsApiKey = Deno.env.get('ODDS_API_KEY');

  if (!supabaseUrl || !serviceRoleKey || !oddsApiKey) {
    throw new Error(
      'Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ODDS_API_KEY',
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 1. Query pending entries in the capture window
  const { data: pendingEntries, error: queryError } = await supabase
    .from('clv_entries')
    .select('*')
    .eq('resultado', 'PENDENTE')
    .is('odd_fechamento', null)
    .gte('commence_time', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .lte('commence_time', new Date(Date.now() + 5 * 60 * 1000).toISOString());

  if (queryError) {
    throw new Error(`Failed to query clv_entries: ${queryError.message}`);
  }

  const allEntries = (pendingEntries ?? []) as ClvEntry[];

  // Entradas que nunca terão fechamento extraível (BTTS, DNB, escanteios...) ou que já falharam MAX_UNMAPPED_ATTEMPTS vezes no mapeamento nesta instância
  // não justificam chamar a Odds API:
  // continuariam aparecendo na query acima a cada 5 min pela janela inteira de 35 min.
  const entries = allEntries.filter(
    (e) => classifyMercado(e.mercado) !== 'unsupported' && !gaveUp(e.id),
  );

  if (entries.length === 0) {
    return { processed: allEntries.length, captured: 0, skipped: allEntries.length, errors: [] };
  }

  // 2. Group by sport_key
  const bySport = new Map<string, ClvEntry[]>();
  for (const entry of entries) {
    const group = bySport.get(entry.sport_key) ?? [];
    group.push(entry);
    bySport.set(entry.sport_key, group);
  }

  const results: CaptureResult[] = [];
  const errors: string[] = [];

  // 3. Fetch odds per sport, then extract closing odd per entry
  for (const [sportKey, sportEntries] of bySport) {
    let oddsData: OddsApiEvent[] = [];

    try {
      // Custo = 1 crédito por mercado pedido: só os que as entradas deste esporte usam
      // (antes: sempre h2h,totals,spreads = 3 créditos por esporte por execução).
      const markets = requiredMarkets(sportEntries.map((e) => e.mercado)).join(',');
      if (!markets) continue;
      const url =
        `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/` +
        `?apiKey=${oddsApiKey}` +
        `&bookmakers=pinnacle` +
        `&markets=${markets}` +
        `&oddsFormat=decimal`;

      const response = await fetch(url);

      if (!response.ok) {
        const body = await response.text();
        errors.push(
          `Odds API error for sport ${sportKey}: ${response.status} ${body.slice(0, 200)}`,
        );
        // Mark all entries for this sport as skipped
        for (const entry of sportEntries) {
          results.push({
            id: entry.id,
            match_id: entry.match_id,
            mercado: entry.mercado,
            odd_fechamento: null,
            clv_pct: null,
            error: `Odds API error: ${response.status}`,
          });
        }
        continue;
      }

      oddsData = (await response.json()) as OddsApiEvent[];
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      errors.push(`Fetch failed for sport ${sportKey}: ${msg}`);
      for (const entry of sportEntries) {
        results.push({
          id: entry.id,
          match_id: entry.match_id,
          mercado: entry.mercado,
          odd_fechamento: null,
          clv_pct: null,
          error: `Fetch failed: ${msg}`,
        });
      }
      continue;
    }

    // Build a lookup map by event id
    const eventMap = new Map<string, OddsApiEvent>(
      oddsData.map((e) => [e.id, e]),
    );

    for (const entry of sportEntries) {
      try {
        const event = eventMap.get(entry.match_id);

        if (!event) {
          results.push({
            id: entry.id,
            match_id: entry.match_id,
            mercado: entry.mercado,
            odd_fechamento: null,
            clv_pct: null,
            error: `Event ${entry.match_id} not found in API response`,
          });
          continue;
        }

        const closingOdd = extractClosingOdd(
          entry.mercado,
          event.home_team,
          event.away_team,
          event.bookmakers,
        );

        if (closingOdd === null) {
          // Pinnacle cotou o evento mas não esse mercado/desfecho. (Evento ausente e erro
          // de rede não contam: continuam sendo tentados normalmente.)
          if (event.bookmakers.some((b) => b.key === 'pinnacle')) {
            unmappedAttempts.set(entry.id, (unmappedAttempts.get(entry.id) ?? 0) + 1);
          }
          results.push({
            id: entry.id,
            match_id: entry.match_id,
            mercado: entry.mercado,
            odd_fechamento: null,
            clv_pct: null,
            error: `Could not map mercado "${entry.mercado}" to an API outcome`,
          });
          continue;
        }

        unmappedAttempts.delete(entry.id);
        const clvPct =
          parseFloat(
            (((entry.odd_utilizada / closingOdd) - 1) * 100).toFixed(2),
          );

        results.push({
          id: entry.id,
          match_id: entry.match_id,
          mercado: entry.mercado,
          odd_fechamento: closingOdd,
          clv_pct: clvPct,
        });
      } catch (entryErr) {
        const msg = entryErr instanceof Error ? entryErr.message : String(entryErr);
        errors.push(
          `Error processing entry ${entry.id} (${entry.match_id}): ${msg}`,
        );
        results.push({
          id: entry.id,
          match_id: entry.match_id,
          mercado: entry.mercado,
          odd_fechamento: null,
          clv_pct: null,
          error: msg,
        });
      }
    }
  }

  // 4. Batch-update rows that have a closing odd
  const captured = results.filter((r) => r.odd_fechamento !== null);
  const skipped = results.filter((r) => r.odd_fechamento === null);

  const now = new Date().toISOString();

  // Update in individual upserts grouped in parallel batches (Supabase doesn't have
  // native batch-update by list of ids with different values, so we do row-by-row
  // but fire them concurrently for speed).
  const updatePromises = captured.map(async (r) => {
    const { error: updateError } = await supabase
      .from('clv_entries')
      .update({
        odd_fechamento: r.odd_fechamento,
        clv_pct: r.clv_pct,
        closed_at: now,
      })
      .eq('id', r.id);

    if (updateError) {
      errors.push(`Update failed for entry ${r.id}: ${updateError.message}`);
    }
  });

  await Promise.allSettled(updatePromises);

  return {
    processed: entries.length,
    captured: captured.length,
    skipped: skipped.length,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Edge Function handler (HTTP + cron)
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Allow manual GET/POST triggers
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await captureCLV();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[clv-capture] Fatal error:', message);
    return new Response(
      JSON.stringify({ error: message, processed: 0, captured: 0, skipped: 0, errors: [message] }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
});

// ---------------------------------------------------------------------------
// Cron registration — runs every 5 minutes
// ---------------------------------------------------------------------------

Deno.cron('clv-capture-cron', '*/5 * * * *', async () => {
  try {
    const result = await captureCLV();
    console.log('[clv-capture] Cron run complete:', JSON.stringify(result));
  } catch (err) {
    console.error('[clv-capture] Cron run failed:', err instanceof Error ? err.message : String(err));
  }
});
