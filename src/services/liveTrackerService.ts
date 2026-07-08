/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serviço de rastreamento automático de resultados ao vivo.
 *
 * Lógica de economia de quota:
 *  - Só faz polling quando existe ao menos uma partida rastreada que já começou
 *  - Usa 1 request por ciclo (busca por data, não por partida individual)
 *  - Intervalo padrão: 10 minutos (máx ~144 req/dia, mas na prática ~20-40)
 *  - Para o polling automaticamente quando todas as partidas têm resultado
 *
 * Dependência: proxy /api/football (mesmo usado pelo scoutingService)
 */

const STORAGE_KEY = 'evengine_live_tracker';
const API_BASE_URL = '/api/football';

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
 * Realiza um ciclo de polling.
 *
 * Modo normal: cruza fixtures do dia com partidas pré-registradas.
 * Modo Copa (forceToday=true): filtra apenas fixtures da Copa do Mundo FIFA 2026
 * para não exibir resultados de outras ligas.
 */
export async function pollLiveResults(forceToday = false): Promise<LiveUpdate[]> {
  const pending = getPendingTrackedMatches().filter(m => {
    const start = new Date(m.commenceTime).getTime();
    return start <= Date.now() + 5 * 60 * 1000;
  });

  if (!forceToday && pending.length === 0) return [];

  // Só faz poll no modo Copa se houver jogo ao vivo ou iniciando em ≤90 min
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
  const today = new Date().toISOString().split('T')[0];
  const dates = forceToday
    ? [today]
    : [...new Set(pending.map(m => new Date(m.commenceTime).toISOString().split('T')[0]))];

  const updates: LiveUpdate[] = [];

  for (const date of dates) {
    try {
      // Busca por data (sem filtro de liga — plano free não suporta ?season=2026)
      // Filtragem por league.id é feita client-side logo abaixo
      const url = `${API_BASE_URL}/fixtures?date=${date}`;
      console.info(`[LiveTracker] Polling → ${url}`);
      const res = await fetch(url, {
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
      });

      if (!res.ok) {
        const detail = `HTTP ${res.status} ${res.statusText}`;
        console.warn(`[LiveTracker] ${detail} para ${url}`);
        if (res.status === 429) scheduleError({ kind: 'quota', statusCode: res.status, detail });
        else if (res.status === 401 || res.status === 403) scheduleError({ kind: 'suspended', statusCode: res.status, detail });
        else scheduleError({ kind: 'network', statusCode: res.status, detail });
        continue;
      }

      const data = await res.json();
      const fixtures: any[] = data.response ?? [];

      if (data.errors && Object.keys(data.errors).length > 0) {
        const detail = Object.values(data.errors as Record<string, string>).join(' · ');
        const kind = parseApiError(data.errors as Record<string, string>);
        // Em modo Copa (forceToday), erros de acesso/suspended são esperados no plano gratuito
        // (Copa 2026 requer plano pago) — silenciar o banner vermelho neste contexto
        if (forceToday && kind === 'suspended') {
          console.warn(`[LiveTracker] Acesso negado no modo Copa (plano gratuito) — sem banner:`, data.errors);
          continue;
        }
        console.error(`[LiveTracker] Erro da API Football:`, data.errors);
        scheduleError({ kind, detail });
        continue;
      }

      // Cancela qualquer erro pendente e limpa o banner
      cancelAndClearError();

      // Em modo Copa: filtra client-side para só processar fixtures da Copa do Mundo
      const fixturesParaProcessar = forceToday
        ? fixtures.filter(f => WC_LEAGUE_IDS.has(f.league?.id))
        : fixtures;

      console.info(`[LiveTracker] ${fixtures.length} fixture(s) recebidos para ${date}${forceToday ? ` → ${fixturesParaProcessar.length} da Copa` : ''}`);

      for (const fixture of fixturesParaProcessar) {
        const status: string = fixture.fixture?.status?.short ?? '';
        const minuto: number = fixture.fixture?.status?.elapsed ?? 0;
        const homeGoals: number = fixture.goals?.home ?? 0;
        const awayGoals: number = fixture.goals?.away ?? 0;
        const apiHome: string = fixture.teams?.home?.name ?? '';
        const apiAway: string = fixture.teams?.away?.name ?? '';

        if (!LIVE_STATUSES.has(status) && !FINISHED_STATUSES.has(status)) continue;

        const placar = `${homeGoals}-${awayGoals}`;

        if (forceToday) {
          if (FINISHED_STATUSES.has(status)) {
            updates.push({
              matchId: buildLiveKey(apiHome, apiAway),
              homeTeam: apiHome,
              awayTeam: apiAway,
              placar,
              statusShort: status,
              homeGoals,
              awayGoals,
              finished: true,
            });
          } else {
            updates.push({
              matchId: buildLiveKey(apiHome, apiAway),
              homeTeam: apiHome,
              awayTeam: apiAway,
              placar,
              minuto,
              statusShort: status,
              finished: false,
            });
          }
        } else {
          const match = pending.find(m =>
            !m.resolved &&
            isSameTeam(m.homeTeam, apiHome) &&
            isSameTeam(m.awayTeam, apiAway)
          );
          if (!match) continue;

          if (FINISHED_STATUSES.has(status)) {
            updates.push({
              matchId: match.matchId,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              placar,
              statusShort: status,
              homeGoals,
              awayGoals,
              finished: true,
            });
            markMatchResolved(match.matchId, placar);
            console.info(`[LiveTracker] FT: ${match.homeTeam} ${placar} ${match.awayTeam}`);
          } else {
            updates.push({
              matchId: match.matchId,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              placar,
              minuto,
              statusShort: status,
              finished: false,
            });
            console.info(`[LiveTracker] ${minuto}': ${match.homeTeam} ${placar} ${match.awayTeam}`);
          }
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`[LiveTracker] Erro ao consultar fixtures de ${date}:`, err);
      scheduleError({ kind: 'network', detail });
    }
  }

  return updates;
}
