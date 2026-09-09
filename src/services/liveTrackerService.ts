/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serviço de rastreamento automático de resultados ao vivo.
 *
 * Fonte primária: The Odds API /scores (já integrada, gratuita, 500 req/mês)
 * Fallback: API-Football /fixtures (quando disponível)
 *
 * Lógica de economia de quota:
 *  - Só faz polling quando existe ao menos uma partida rastreada que já começou
 *  - 1 request por ciclo cobre todas as partidas de todos os sports_keys necessários
 *  - Intervalo padrão: 10 minutos (máx ~144 req/dia, na prática ~20-40)
 *  - Para o polling automaticamente quando todas as partidas têm resultado
 */

const STORAGE_KEY = 'evengine_live_tracker';
const API_BASE_URL = '/api/football';

// The Odds API sports keys para futebol (cobrem as principais ligas analisadas)
const ODDS_API_SOCCER_KEYS = [
  'soccer_brazil_campeonato',
  'soccer_spain_la_liga',
  'soccer_germany_bundesliga',
  'soccer_italy_serie_a',
  'soccer_france_ligue_one',
  'soccer_epl',
  'soccer_netherlands_eredivisie',
  'soccer_portugal_primeira_liga',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
  'soccer_conmebol_copa_libertadores',
  'soccer_conmebol_copa_sudamericana',
  'soccer_argentina_primera_division',
  'soccer_mexico_ligamx',
  'soccer_turkey_super_league',
  'soccer_sweden_allsvenskan',
];

// Status da API-Football que indicam jogo encerrado
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
// Status que indicam jogo em andamento
const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

// ─── Tipos ───────────────────────────────────────────────────

export interface TrackedMatch {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  resolved: boolean;
  resolvedAt?: string;
  placar?: string;
}

export interface LiveResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  placar: string;
  statusShort: string;
  homeGoals: number;
  awayGoals: number;
  finished: true;
}

export interface LiveScore {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  placar: string;
  minuto: number;
  statusShort: string;
  finished: false;
}

export type LiveUpdate = LiveResult | LiveScore;

export type ApiErrorKind = 'suspended' | 'quota' | 'network';

export interface ApiErrorInfo {
  kind: ApiErrorKind;
  statusCode?: number;
  detail?: string;
}

export type ApiErrorType = ApiErrorInfo | null;

// ─── Sistema de eventos de erro de API ───────────────────────

type ErrorListener = (error: ApiErrorType) => void;
const errorListeners: Set<ErrorListener> = new Set();

export function onApiError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

function emitApiError(error: ApiErrorType): void {
  errorListeners.forEach(fn => fn(error));
}

// Banner só aparece após 2+ falhas consecutivas.
// Erros únicos (transitório 500, StrictMode double-invoke) são silenciados.
let _consecutiveFailures = 0;
let _pendingErrorTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleError(error: ApiErrorInfo): void {
  _consecutiveFailures++;
  if (_pendingErrorTimer) clearTimeout(_pendingErrorTimer);
  if (_consecutiveFailures < 2) {
    // primeira falha: aguarda próximo ciclo sem mostrar banner
    return;
  }
  _pendingErrorTimer = setTimeout(() => {
    _pendingErrorTimer = null;
    emitApiError(error);
  }, 300);
}

function cancelAndClearError(): void {
  _consecutiveFailures = 0;
  if (_pendingErrorTimer) {
    clearTimeout(_pendingErrorTimer);
    _pendingErrorTimer = null;
  }
  emitApiError(null);
}

function parseApiError(errors: Record<string, string>): ApiErrorKind {
  const values = Object.values(errors).join(' ').toLowerCase();
  if (values.includes('suspended') || values.includes('access')) return 'suspended';
  if (values.includes('request') || values.includes('limit') || values.includes('rate')) return 'quota';
  return 'network';
}

// ─── Aliases de seleções nacionais (PT/ES → EN) ──────────────

const NATIONAL_TEAM_ALIASES: Record<string, string[]> = {
  'ivory coast': ['costa do marfim', 'cote d ivoire', 'côte d\'ivoire'],
  'south korea': ['coreia do sul', 'korea republic', 'korea rep'],
  'north korea': ['coreia do norte'],
  'united states': ['estados unidos', 'usa', 'us'],
  'czech republic': ['republica tcheca', 'czechia'],
  'republic of ireland': ['irlanda', 'ireland'],
  'saudi arabia': ['arabia saudita'],
  'south africa': ['africa do sul'],
  'new zealand': ['nova zelandia', 'nueva zelanda'],
  'cape verde': ['cabo verde'],
  'trinidad & tobago': ['trinidad e tobago', 'trinidad tobago'],
  'bosnia herzegovina': ['bosnia e herzegovina', 'bosnia & herzegovina'],
  'northern ireland': ['irlanda do norte'],
  'dem. rep. congo': ['republica democratica do congo', 'dr congo', 'congo dr'],
  'central african rep.': ['republica centro-africana'],
  'equatorial guinea': ['guine equatorial'],
  'guinea-bissau': ['guine-bissau'],
  'switzerland': ['suica', 'suíça'],
  'germany': ['alemanha'],
  'france': ['franca', 'frança'],
  'spain': ['espanha'],
  'england': ['inglaterra'],
  'portugal': ['portugal'],
  'netherlands': ['holanda', 'paises baixos'],
  'brazil': ['brasil'],
  'argentina': ['argentina'],
  'japan': ['japao', 'japão'],
  'australia': ['australia', 'austrália'],
  'mexico': ['mexico', 'méxico'],
  'morocco': ['marrocos'],
  'senegal': ['senegal'],
  'cameroon': ['camaroões', 'camaroes'],
  'nigeria': ['nigeria', 'nigéria'],
  'ghana': ['gana'],
  'egypt': ['egito'],
  'algeria': ['argelia', 'argélia'],
  'tunisia': ['tunisia', 'tunísia'],
  'colombia': ['colombia', 'colômbia'],
  'venezuela': ['venezuela'],
  'ecuador': ['equador'],
  'paraguay': ['paraguai'],
  'uruguay': ['uruguai'],
  'chile': ['chile'],
  'peru': ['peru'],
  'bolivia': ['bolivia', 'bolívia'],
  'turkey': ['turquia'],
  'ukraine': ['ucrania', 'ucrânia'],
  'poland': ['polonia', 'polônia'],
  'sweden': ['suecia', 'suécia'],
  'norway': ['noruega'],
  'denmark': ['dinamarca'],
  'finland': ['finlandia', 'finlândia'],
  'greece': ['grecia', 'grécia'],
  'romania': ['romenia', 'romênia'],
  'hungary': ['hungria'],
  'slovakia': ['eslovaquia', 'eslováquia'],
  'slovenia': ['eslovenia', 'eslovênia'],
  'croatia': ['croacia', 'croácia'],
  'serbia': ['servia', 'sérvia'],
  'austria': ['austria', 'áustria'],
  'belgium': ['belgica', 'bélgica'],
  'iran': ['ira', 'irã'],
  'china': ['china'],
  'india': ['india', 'índia'],
  'iraq': ['iraque'],
  'qatar': ['catar'],
};

/** Normaliza nome para comparação: remove acentos, prefixos e pontuação */
function normTeam(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|cf|ac|sc|afc|rcd|rc|ud|cd|fk|sk|bk|if|ik|sv|vfl|vfb|tsg|1\.|2\.)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve aliases de seleções nacionais → nome canônico em inglês */
function resolveAlias(name: string): string {
  const n = normTeam(name);
  for (const [canonical, aliases] of Object.entries(NATIONAL_TEAM_ALIASES)) {
    if (n === normTeam(canonical) || aliases.some(a => normTeam(a) === n)) return canonical;
  }
  return n;
}

/**
 * Chave pública para lookup de placares — baseada em nomes dos times resolvidos.
 * Exportada para uso em qualquer componente que precise exibir placares.
 */
export function buildLiveKey(homeTeam: string, awayTeam: string): string {
  return `${resolveAlias(homeTeam)}|${resolveAlias(awayTeam)}`;
}

/** Compara nomes de times com tolerância a variações e traduções */
function isSameTeam(a: string, b: string): boolean {
  const ra = resolveAlias(a);
  const rb = resolveAlias(b);
  if (ra === rb) return true;
  if (ra.length > 3 && rb.includes(ra)) return true;
  if (rb.length > 3 && ra.includes(rb)) return true;
  const wordsA = ra.split(' ').filter(w => w.length > 2);
  const wordsB = new Set(rb.split(' ').filter(w => w.length > 2));
  const common = wordsA.filter(w => wordsB.has(w)).length;
  return common >= Math.min(2, Math.ceil(wordsA.length * 0.6));
}

// ─── Persistência ────────────────────────────────────────────

function loadTracked(): TrackedMatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTracked(list: TrackedMatch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { }
}

// ─── API Pública ─────────────────────────────────────────────

export function registerMatchForTracking(
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  commenceTime: string
): void {
  const list = loadTracked();
  const exists = list.some(m => m.matchId === matchId);
  if (exists) return;

  list.push({ matchId, homeTeam, awayTeam, commenceTime, resolved: false });

  const cutoff = Date.now() - 36 * 60 * 60 * 1000;
  const clean = list.filter(m => new Date(m.commenceTime).getTime() > cutoff);
  saveTracked(clean);
  console.info(`[LiveTracker] Rastreando: ${homeTeam} x ${awayTeam}`);
}

export function getPendingTrackedMatches(): TrackedMatch[] {
  return loadTracked().filter(m => !m.resolved);
}

export function markMatchResolved(matchId: string, placar: string): void {
  const list = loadTracked().map(m =>
    m.matchId === matchId
      ? { ...m, resolved: true, resolvedAt: new Date().toISOString(), placar }
      : m
  );
  saveTracked(list);
}

export function hasPendingLiveMatches(): boolean {
  const now = Date.now();
  return getPendingTrackedMatches().some(m => {
    const start = new Date(m.commenceTime).getTime();
    return start <= now + 5 * 60 * 1000;
  });
}

// IDs das ligas Copa do Mundo FIFA na API-Football
// Filtragem client-side (o plano free não permite ?league= com season > 2024)
const WC_LEAGUE_IDS = new Set([1, 9]); // 1=World Cup, 9=Confederations Cup / variantes

/**
 * Busca placares via The Odds API /scores (fonte primária, gratuita).
 * Retorna mapa de chave normalizada → { homeGoals, awayGoals, completed, live }.
 * Consome 1 request por sport_key com daysFrom=2 (cobre jogos das últimas 48h).
 */
async function fetchOddsApiScores(
  pending: TrackedMatch[]
): Promise<Map<string, { homeGoals: number; awayGoals: number; completed: boolean; live: boolean }>> {
  const oddsKey = (import.meta as any).env?.VITE_ODDS_API_KEY ?? '';
  if (!oddsKey) return new Map();

  const results = new Map<string, { homeGoals: number; awayGoals: number; completed: boolean; live: boolean }>();

  for (const sportKey of ODDS_API_SOCCER_KEYS) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${oddsKey}&daysFrom=2`;
      const res = await fetch(url, {
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 422) break; // chave inválida — parar
        continue; // liga não disponível ou rate limit — continuar
      }

      const games: any[] = await res.json();

      for (const game of games) {
        if (!game.scores || game.scores.length < 2) continue;

        const apiHome: string = game.home_team ?? '';
        const apiAway: string = game.away_team ?? '';
        const key = buildLiveKey(apiHome, apiAway);

        // Verificar se alguma partida pendente corresponde a esse jogo
        const hasPending = pending.some(m =>
          isSameTeam(m.homeTeam, apiHome) && isSameTeam(m.awayTeam, apiAway)
        );
        if (!hasPending) continue;

        // The Odds API: scores[0] = home, scores[1] = away
        const homeScore = game.scores.find((s: any) => isSameTeam(s.name, apiHome));
        const awayScore = game.scores.find((s: any) => isSameTeam(s.name, apiAway));
        const homeGoals = parseInt(homeScore?.score ?? '0', 10);
        const awayGoals = parseInt(awayScore?.score ?? '0', 10);

        results.set(key, {
          homeGoals: isNaN(homeGoals) ? 0 : homeGoals,
          awayGoals: isNaN(awayGoals) ? 0 : awayGoals,
          completed: game.completed === true,
          live: !game.completed && game.scores.length > 0,
        });
      }
    } catch {
      // falha silenciosa por sport_key — continua os demais
    }
  }

  return results;
}

/**
 * Fallback: busca fixtures via API-Football (quando disponível).
 * silent=true suprime o banner de erro — usado quando The Odds API já é a fonte primária.
 */
async function fetchApiFootballFixtures(date: string, silent = false): Promise<any[]> {
  try {
    const url = `${API_BASE_URL}/fixtures?date=${date}`;
    const res = await fetch(url, {
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    });

    if (!res.ok) {
      if (!silent) {
        const detail = `HTTP ${res.status} ${res.statusText}`;
        if (res.status === 429) scheduleError({ kind: 'quota', statusCode: res.status, detail });
        else if (res.status === 401 || res.status === 403) scheduleError({ kind: 'suspended', statusCode: res.status, detail });
        else scheduleError({ kind: 'network', statusCode: res.status, detail });
      }
      return [];
    }

    const data = await res.json();

    if (data.errors && Object.keys(data.errors).length > 0) {
      if (!silent) {
        const detail = Object.values(data.errors as Record<string, string>).join(' · ');
        const kind = parseApiError(data.errors as Record<string, string>);
        scheduleError({ kind, detail });
      }
      return [];
    }

    cancelAndClearError();
    return data.response ?? [];
  } catch {
    return [];
  }
}

/**
 * Realiza um ciclo de polling.
 *
 * Fonte primária: The Odds API /scores (gratuita).
 * Fallback: API-Football /fixtures (quando disponível).
 * Modo Copa (forceToday=true): usa API-Football filtrado por league ID.
 */
export async function pollLiveResults(forceToday = false): Promise<LiveUpdate[]> {
  const pending = getPendingTrackedMatches().filter(m => {
    const start = new Date(m.commenceTime).getTime();
    return start <= Date.now() + 5 * 60 * 1000;
  });

  if (!forceToday && pending.length === 0) return [];

  if (forceToday) {
    const now = Date.now();
    const WINDOW_MS = 90 * 60 * 1000;
    const allTracked = loadTracked();
    const hasMatchNearby = allTracked.some(m => {
      if (m.resolved) return false;
      const start = new Date(m.commenceTime).getTime();
      const elapsed = now - start;
      return (elapsed >= 0 && elapsed < 120 * 60 * 1000) || (start - now <= WINDOW_MS && start > now);
    });
    if (!hasMatchNearby) return [];
  }

  const updates: LiveUpdate[] = [];

  // ── MODO NORMAL: The Odds API como fonte primária ──────────────────────────
  if (!forceToday) {
    console.info('[LiveTracker] Polling via The Odds API scores...');
    const oddsScores = await fetchOddsApiScores(pending);

    for (const match of pending) {
      const key = buildLiveKey(match.homeTeam, match.awayTeam);
      const score = oddsScores.get(key);
      if (!score) continue;

      const placar = `${score.homeGoals}-${score.awayGoals}`;

      if (score.completed) {
        updates.push({
          matchId: match.matchId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          placar,
          statusShort: 'FT',
          homeGoals: score.homeGoals,
          awayGoals: score.awayGoals,
          finished: true,
        });
        markMatchResolved(match.matchId, placar);
        console.info(`[LiveTracker][OddsAPI] FT: ${match.homeTeam} ${placar} ${match.awayTeam}`);
      } else if (score.live) {
        updates.push({
          matchId: match.matchId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          placar,
          minuto: 0, // The Odds API não fornece minuto
          statusShort: 'LIVE',
          finished: false,
        });
        console.info(`[LiveTracker][OddsAPI] LIVE: ${match.homeTeam} ${placar} ${match.awayTeam}`);
      }
    }

    // Se The Odds API resolveu todas as partidas pendentes, retornar sem fallback
    const resolvedIds = new Set(updates.filter(u => u.finished).map(u => u.matchId));
    const stillPending = pending.filter(m => !resolvedIds.has(m.matchId));

    if (stillPending.length === 0 || updates.length > 0) {
      // Limpa banner de erro (The Odds API funcionou)
      if (oddsScores.size > 0) cancelAndClearError();
      return updates;
    }

    // Fallback: API-Football para partidas não encontradas na The Odds API
    console.info(`[LiveTracker] ${stillPending.length} partida(s) não encontrada(s) na OddsAPI — tentando fallback API-Football...`);
    const dates = [...new Set(stillPending.map(m => new Date(m.commenceTime).toISOString().split('T')[0]))];

    for (const date of dates) {
      const fixtures = await fetchApiFootballFixtures(date, true);
      if (fixtures.length === 0) continue;

      cancelAndClearError();
      console.info(`[LiveTracker][Fallback] ${fixtures.length} fixture(s) para ${date}`);

      for (const fixture of fixtures) {
        const status: string = fixture.fixture?.status?.short ?? '';
        const minuto: number = fixture.fixture?.status?.elapsed ?? 0;
        const homeGoals: number = fixture.goals?.home ?? 0;
        const awayGoals: number = fixture.goals?.away ?? 0;
        const apiHome: string = fixture.teams?.home?.name ?? '';
        const apiAway: string = fixture.teams?.away?.name ?? '';

        if (!LIVE_STATUSES.has(status) && !FINISHED_STATUSES.has(status)) continue;

        const match = stillPending.find(m =>
          !m.resolved &&
          isSameTeam(m.homeTeam, apiHome) &&
          isSameTeam(m.awayTeam, apiAway)
        );
        if (!match) continue;

        const placar = `${homeGoals}-${awayGoals}`;

        if (FINISHED_STATUSES.has(status)) {
          updates.push({ matchId: match.matchId, homeTeam: match.homeTeam, awayTeam: match.awayTeam, placar, statusShort: status, homeGoals, awayGoals, finished: true });
          markMatchResolved(match.matchId, placar);
          console.info(`[LiveTracker][Fallback] FT: ${match.homeTeam} ${placar} ${match.awayTeam}`);
        } else {
          updates.push({ matchId: match.matchId, homeTeam: match.homeTeam, awayTeam: match.awayTeam, placar, minuto, statusShort: status, finished: false });
        }
      }
    }

    return updates;
  }

  // ── MODO COPA (forceToday=true): API-Football com filtro de league ─────────
  const today = new Date().toISOString().split('T')[0];
  const fixtures = await fetchApiFootballFixtures(today);

  if (fixtures.length > 0) {
    cancelAndClearError();
    const wcFixtures = fixtures.filter((f: any) => WC_LEAGUE_IDS.has(f.league?.id));
    console.info(`[LiveTracker][Copa] ${fixtures.length} fixture(s) → ${wcFixtures.length} da Copa`);

    for (const fixture of wcFixtures) {
      const status: string = fixture.fixture?.status?.short ?? '';
      const minuto: number = fixture.fixture?.status?.elapsed ?? 0;
      const homeGoals: number = fixture.goals?.home ?? 0;
      const awayGoals: number = fixture.goals?.away ?? 0;
      const apiHome: string = fixture.teams?.home?.name ?? '';
      const apiAway: string = fixture.teams?.away?.name ?? '';
      if (!LIVE_STATUSES.has(status) && !FINISHED_STATUSES.has(status)) continue;
      const placar = `${homeGoals}-${awayGoals}`;

      if (FINISHED_STATUSES.has(status)) {
        updates.push({ matchId: buildLiveKey(apiHome, apiAway), homeTeam: apiHome, awayTeam: apiAway, placar, statusShort: status, homeGoals, awayGoals, finished: true });
      } else {
        updates.push({ matchId: buildLiveKey(apiHome, apiAway), homeTeam: apiHome, awayTeam: apiAway, placar, minuto, statusShort: status, finished: false });
      }
    }
  } else {
    // Fallback Copa: The Odds API (ligas de Copa/seleções podem estar cobertas)
    console.info('[LiveTracker][Copa] API-Football indisponível — tentando OddsAPI...');
    const oddsScores = await fetchOddsApiScores(pending);
    for (const match of pending) {
      const key = buildLiveKey(match.homeTeam, match.awayTeam);
      const score = oddsScores.get(key);
      if (!score) continue;
      const placar = `${score.homeGoals}-${score.awayGoals}`;
      if (score.completed) {
        updates.push({ matchId: match.matchId, homeTeam: match.homeTeam, awayTeam: match.awayTeam, placar, statusShort: 'FT', homeGoals: score.homeGoals, awayGoals: score.awayGoals, finished: true });
        markMatchResolved(match.matchId, placar);
      }
    }
  }

  return updates;
}
