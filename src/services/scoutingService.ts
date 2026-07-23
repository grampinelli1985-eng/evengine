/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ScoutingReport, JogoComData } from '../types';
import { GEMINI_MODEL } from '../config/ai';
import { trackGeminiCall, trackPrecheckSkip } from "./telemetryService";
import { hasQuota, trackRequest } from './apiQuotaService';
import { getSportmonksTeamId, getSeasonId, getTeamXgLast5, getTeamPpdaLast5, SPORTMONKS_LEAGUE_BY_NAME } from './sportmonksService';
import { supabase } from './supabaseClient';

import { GoogleGenAI } from "@google/genai";

const TEAM_ID_CACHE = new Map<string, number>();

export const ALIAS_TIMES_HOLANDESES: Record<string, string[]> = {
  'AFC Ajax': ['Ajax', 'AFC Ajax', 'Ajax Amsterdam'],
  'Feyenoord': ['Feyenoord', 'Feyenoord Rotterdam'],
  'PSV Eindhoven': ['PSV', 'PSV Eindhoven'],
  'AZ Alkmaar': ['AZ', 'AZ Alkmaar'],
  'FC Twente': ['Twente', 'FC Twente', 'Twente Enschede'],
  'FC Utrecht': ['Utrecht', 'FC Utrecht'],
  'SC Heerenveen': ['Heerenveen', 'SC Heerenveen'],
  'FC Groningen': ['Groningen', 'FC Groningen'],
  'NEC Nijmegen': ['NEC', 'NEC Nijmegen'],
  'Sparta Rotterdam': ['Sparta', 'Sparta Rotterdam'],
  'PEC Zwolle': ['Zwolle', 'PEC Zwolle'],
  'Go Ahead Eagles': ['Go Ahead Eagles', 'GA Eagles'],
  'Fortuna Sittard': ['Fortuna', 'Fortuna Sittard'],
  'RKC Waalwijk': ['RKC', 'Waalwijk', 'RKC Waalwijk'],
  'Heracles Almelo': ['Heracles', 'Heracles Almelo'],
  'NAC Breda': ['NAC', 'NAC Breda'],
  'FC Volendam': ['Volendam', 'FC Volendam'],
  'Almere City FC': ['Almere City', 'Almere'],
};

function normalizarNomeTime(nome: string): string {
  const semAcentos = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  return semAcentos
    .replace(/^(1\.|2\.|3\.)\s*(FC|fc|FC\s|fc\s)/gi, '')
    .replace(/^(FC|AFC|SC|RKC|NEC|PEC)\s/gi, '')
    .replace(/\s(FC|CF|AC|SC|e\.V\.|RCD|RC|Stade|CFR|FK|AZ|PSV|UD|CD|Club|Club de Futbol)\s?$/gi, '')
    .replace(/^(Borussia|VfL|VfB|TSG|SV|SC|RCD|RC|Stade)\s/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const API_BASE_URL = '/api/football';
const ODDS_API_KEY = import.meta.env.VITE_ODDS_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

export const TEAM_NAME_MAP: Record<string, number> = {
  // Eredivisie
  'AFC Ajax': 194, 'Ajax': 194, 'Ajax Amsterdam': 194,
  'Feyenoord': 197, 'Feyenoord Rotterdam': 197,
  'PSV Eindhoven': 201, 'PSV': 201,
  'AZ Alkmaar': 203, 'AZ': 203,
  'FC Twente': 200, 'Twente': 200, 'Twente Enschede': 200,
  'FC Utrecht': 204, 'Utrecht': 204,
  'SC Heerenveen': 199, 'Heerenveen': 199,
  'FC Groningen': 198, 'Groningen': 198,
  'NEC Nijmegen': 207, 'NEC': 207,
  'Sparta Rotterdam': 205, 'Sparta': 205,
  'PEC Zwolle': 206, 'Zwolle': 206,
  'Go Ahead Eagles': 208, 'GA Eagles': 208,
  'Fortuna Sittard': 209, 'Fortuna': 209,
  'RKC Waalwijk': 210, 'RKC': 210, 'Waalwijk': 210,
  'Heracles Almelo': 202, 'Heracles': 202,
  'NAC Breda': 211, 'NAC': 211,
  'FC Volendam': 213, 'Volendam': 213,
  'Almere City FC': 212, 'Almere City': 212, 'Almere': 212,
  'Willem II': 196,

  // Brasileirão (20 times)
  'Flamengo': 127, 'Palmeiras': 121, 'Corinthians': 131,
  'São Paulo': 126, 'Santos': 128, 'Grêmio': 130,
  'Internacional': 119, 
  'Atlético Mineiro': 1062, 'Atlético-MG': 1062, 'Atletico MG': 1062,
  'Fluminense': 124, 
  'Vasco da Gama': 133, 'Vasco': 133, 
  'Botafogo': 129,
  'Bahia': 118, 'Fortaleza': 1025, 'Cruzeiro': 120,
  'Athletico Paranaense': 123, 'Athletico-PR': 123, 'Athletico PR': 123,
  'Bragantino': 2376, 'Bragantino-SP': 2376, 'Red Bull Bragantino': 2376, 'RB Bragantino': 2376,
  'Vitória': 1932, 'Juventude': 1165, 'Cuiabá': 2472,
  'Mirassol': 2541,

  // Premier League
  'Arsenal': 42, 'Manchester City': 50, 'Manchester United': 33,
  'Liverpool': 40, 'Chelsea': 49, 'Tottenham': 47, 'Tottenham Hotspur': 47,
  'Newcastle': 34, 'Newcastle United': 34, 'Aston Villa': 66, 'Fulham': 36,
  'Brighton': 51, 'Brighton & Hove Albion': 51, 'West Ham': 48, 'West Ham United': 48,
  'Wolves': 39, 'Wolverhampton Wanderers': 39, 'Wolverhampton': 39,
  'Crystal Palace': 52, 'Brentford': 55,
  'Nottingham Forest': 65, 'Everton': 45,
  'Leicester': 46, 'Leicester City': 46, 'Ipswich': 57, 'Ipswich Town': 57,
  'Southampton': 41, 'Bournemouth': 35, 'AFC Bournemouth': 35,

  // Outros principais
  'Real Madrid': 541, 'Barcelona': 529, 'FC Barcelona': 529, 'Atletico Madrid': 530, 'Athletic Club': 531, 'Athletic Bilbao': 531,
  'Juventus': 496, 'Inter': 505, 'AC Milan': 489, 'Napoli': 492,
  'Bayern Munich': 157, 'Borussia Dortmund': 165,
  'RB Leipzig': 173, 'Bayer Leverkusen': 168,
  'PSG': 85, 'Marseille': 81, 'Lyon': 80, 'Monaco': 91,

  // Copa Libertadores
  'River Plate': 541, 'Boca Juniors': 405,
  'Racing Club': 406, 'Independiente': 408,
  'Olimpia': 437, 'Cerro Porteño': 438,
  'Peñarol': 433, 'Nacional': 434,
  'Colo Colo': 470, 'Universidad de Chile': 469,
  'LDU Quito': 1440, 'Universitario': 1444,
  'Alianza Lima': 1443, 'Sporting Cristal': 1445,

  // Copa Sul-Americana
  'Godoy Cruz': 449, 'Newell\'s Old Boys': 450, 'Banfield': 452,
  'Arsenal de Sarandí': 453, 'Rosario Central': 430,
  'Goiás': 1375, 'Sport Recife': 2294, 'Avaí': 1370,
  'Chapecoense': 134, 'Ponte Preta': 2293,
  'Palestino': 2352, 'Audax Italiano': 2355, 'Unión La Calera': 2357,
  'Santa Fe': 1167, 'Tolima': 1168, 'Once Caldas': 1169,
  'Bucaramanga': 1170, 'La Equidad': 1171,
  'Aucas': 1446, 'Universidad Católica': 1447, 'Delfín': 1448,
  'Sportivo Ameliano': 1452, 'General Caballero': 1453,
  'Melgar': 1449, 'Cienciano': 1450,
  'Cerro Largo': 2836, 'Wanderers': 2837,
  'Zamora FC': 2116, 'Always Ready': 1454, 'Blooming': 1455,
};

const AUTO_MAP_KEY = 'evengine_team_auto_map';
const FIXTURES_CACHE_KEY = 'evengine_fixtures_preload_date';

let dailyFixturesLoaded = false;
let isPreloading = false;

async function preloadDailyFixtures() {
  if (dailyFixturesLoaded || isPreloading) return;

  // Persiste entre reloads: só faz a chamada uma vez por dia UTC
  const today = new Date().toISOString().split('T')[0];
  const lastLoaded = localStorage.getItem(FIXTURES_CACHE_KEY);
  if (lastLoaded === today) {
    dailyFixturesLoaded = true;
    return;
  }

  isPreloading = true;
  try {
    if (!hasQuota(1)) return;
    const res = await fetch(`${API_BASE_URL}/fixtures?date=${today}`, {
      signal: AbortSignal.timeout(12000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.response && data.response.length > 0) {
        const autoMap = getAutoMap();
        data.response.forEach((f: any) => {
          if (f.teams?.home) autoMap[f.teams.home.name] = f.teams.home.id;
          if (f.teams?.away) autoMap[f.teams.away.name] = f.teams.away.id;
        });
        saveAutoMap(autoMap);
        localStorage.setItem(FIXTURES_CACHE_KEY, today);
      }
    }
  } catch (e) {
    console.warn('Falha no preload da grade diária:', e);
  } finally {
    dailyFixturesLoaded = true;
    isPreloading = false;
  }
}

function getAutoMap(): Record<string, number> {
  const stored = localStorage.getItem(AUTO_MAP_KEY);
  if (!stored) return {};
  try { return JSON.parse(stored); } catch { return {}; }
}

function saveAutoMap(map: Record<string, number>) {
  localStorage.setItem(AUTO_MAP_KEY, JSON.stringify(map));
}

export function getSeasonForLeague(leagueId?: number): number {
  const now = new Date();
  const year = now.getFullYear();
  const calendarYearLeagues = [71, 13, 11, 253]; // Brasileirão, Libertadores, Sul-Americana, MLS
  if (leagueId && calendarYearLeagues.includes(leagueId)) {
    return year;
  }
  return now.getMonth() < 6 ? year - 1 : year; // Winter leagues: July starts new season registry
}


export async function getTeamIdAsync(teamName: string): Promise<number> {
  if (TEAM_NAME_MAP[teamName]) return TEAM_NAME_MAP[teamName];

  const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const normalizedQuery = normalize(teamName);

  for (const [realName, aliases] of Object.entries(ALIAS_TIMES_HOLANDESES)) {
    if (
      normalize(realName) === normalizedQuery ||
      aliases.some(alias => normalize(alias) === normalizedQuery)
    ) {
      if (TEAM_NAME_MAP[realName]) return TEAM_NAME_MAP[realName];
    }
  }

  for (const [name, id] of Object.entries(TEAM_NAME_MAP)) {
    if (normalize(name) === normalizedQuery) return id;
    if (normalize(name).includes(normalizedQuery)) return id;
  }

  const autoMap = getAutoMap();
  if (autoMap[teamName]) return autoMap[teamName];

  if (!dailyFixturesLoaded) {
    await preloadDailyFixtures();
  }

  const updatedAutoMap = getAutoMap();
  if (updatedAutoMap[teamName]) return updatedAutoMap[teamName];

  for (const [gradeName, id] of Object.entries(updatedAutoMap)) {
    const normGrade = normalize(gradeName);
    if (
      normGrade === normalizedQuery ||
      normGrade.includes(normalizedQuery) ||
      normalizedQuery.includes(normGrade)
    ) {
      updatedAutoMap[teamName] = id;
      saveAutoMap(updatedAutoMap);
      return id;
    }
  }

  console.warn(`Time não encontrado na Grade/API-Football: ${teamName}`);
  registrarTimeNaoMapeado(teamName, 'getTeamIdAsync');
  return -1;
}

export async function registrarTimeNaoMapeado(nomeTentado: string, contexto: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data: existing } = await supabase
      .from('unmapped_teams')
      .select('id, ocorrencias')
      .eq('nome_tentado', nomeTentado)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('unmapped_teams')
        .update({
          ocorrencias: existing.ocorrencias + 1,
          ultima_ocorrencia: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('unmapped_teams')
        .insert({ nome_tentado: nomeTentado, contexto });
    }
  } catch (e) {
    // Não deixar essa telemetria quebrar o fluxo principal — falha aqui é silenciosa
    console.warn('[Telemetry] Falha ao registrar time não mapeado:', e);
  }
}

function normalizeResult(res: string): string {
  const r = res?.toLowerCase();
  if (r === 'w' || r === 'win') return 'V';
  if (r === 'd' || r === 'draw') return 'E';
  if (r === 'l' || r === 'loss' || r === 'lost') return 'D';
  return '?';
}

async function fetchGolsRecentes(teamId: number): Promise<{ jogos: JogoComData[] } | null> {
  if (teamId === -1 || !hasQuota(1)) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/fixtures?team=${teamId}&last=5`, {
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    trackRequest();
    const data = await responseToJson(res);
    if (data?.errors && Object.keys(data.errors).length > 0) return null;

    const fixtures = data?.response || [];
    const jogos: JogoComData[] = [];

    fixtures.forEach((f: any) => {
      const isHome = f.teams?.home?.id === teamId;
      const golsFor = isHome ? f.goals?.home : f.goals?.away;
      const golsAgainst = isHome ? f.goals?.away : f.goals?.home;
      const dataJogo = f.fixture?.date; // já vem no payload, ISO 8601
      if (golsFor != null && golsAgainst != null && dataJogo) {
        jogos.push({ gols_for: Number(golsFor), gols_against: Number(golsAgainst), data: dataJogo });
      }
    });

    if (jogos.length < 3) return null;
    return { jogos };
  } catch (e) {
    console.warn(`[Scout API] Falha ao buscar gols recentes para team ${teamId}:`, e);
    return null;
  }
}

function extrairGolsDoPlacar(
  resultados: Array<{ resultado: 'W'|'D'|'L', placar: string }>
): { jogos: JogoComData[] } | null {
  const jogos: JogoComData[] = [];
  resultados.forEach(r => {
    const match = r.placar.match(/^(\d+)-(\d+)$/);
    if (match) {
      const g1 = parseInt(match[1], 10);
      const g2 = parseInt(match[2], 10);
      const golsFor = r.resultado === 'W' ? Math.max(g1, g2) : r.resultado === 'L' ? Math.min(g1, g2) : g1;
      const golsAgainst = r.resultado === 'W' ? Math.min(g1, g2) : r.resultado === 'L' ? Math.max(g1, g2) : g2;
      jogos.push({ gols_for: golsFor, gols_against: golsAgainst, data: '' }); // sem data confiável
    }
  });
  if (jogos.length < 3) return null;
  return { jogos };
}

interface PreCheckResultado {
  prosseguirComGemini: boolean;
  motivo?: string;
  homeGols?: { jogos: JogoComData[] } | null;
  awayGols?: { jogos: JogoComData[] } | null;
}

async function precheckSuficienciaDados(
  homeId: number,
  awayId: number,
  homeTeam: string,
  awayTeam: string,
  sportKey?: string
): Promise<PreCheckResultado> {
  let [homeGols, awayGols] = await Promise.all([
    fetchGolsRecentes(homeId),
    fetchGolsRecentes(awayId)
  ]);

  if ((!homeGols || homeGols.jogos.length < 3) && sportKey) {
     const res = await buscarResultadosRecentes(homeTeam, sportKey);
     const oddsAPI = extrairGolsDoPlacar(res);
     if (oddsAPI) homeGols = oddsAPI;
  }

  if ((!awayGols || awayGols.jogos.length < 3) && sportKey) {
     const res = await buscarResultadosRecentes(awayTeam, sportKey);
     const oddsAPI = extrairGolsDoPlacar(res);
     if (oddsAPI) awayGols = oddsAPI;
  }

  const homeTemDadoMinimo = homeGols && homeGols.jogos.length >= 3;
  const awayTemDadoMinimo = awayGols && awayGols.jogos.length >= 3;

  if (!homeTemDadoMinimo && !awayTemDadoMinimo) {
    return { prosseguirComGemini: false, motivo: 'Ambos os times sem histórico mínimo na API-Football', homeGols, awayGols };
  }

  return { prosseguirComGemini: true, homeGols, awayGols };
}

export async function fetchRealScouting(homeTeam: string, awayTeam: string, leagueId?: number, sportKey?: string): Promise<ScoutingReport> {
  const homeId = await getTeamIdAsync(homeTeam);
  const awayId = await getTeamIdAsync(awayTeam);

  const precheck = await precheckSuficienciaDados(homeId, awayId, homeTeam, awayTeam, sportKey);

  const fetchForm = async (id: number, teamName: string, allowGeminiFallback: boolean = true) => {
    const season = getSeasonForLeague(leagueId);

    if (id !== -1 && hasQuota(1)) {
      try {
        const res = await fetch(`${API_BASE_URL}/teams/statistics?league=${leagueId || 71}&season=${season}&team=${id}`, {
          signal: AbortSignal.timeout(12000)
        });

        if (!res.ok) throw new Error('Response not ok');
        trackRequest();
        const data = await responseToJson(res);
        if (data?.errors && Object.keys(data.errors).length > 0) {
          console.error('[Scout API] Erro no payload da API-Football:', data.errors);
          throw new Error(`API-Football error: ${JSON.stringify(data.errors)}`);
        }
        const form = data?.response?.form || '';
        if (form.length >= 3) {
          const results = form.split('').slice(-5).map(normalizeResult);
          while (results.length < 5) results.unshift('?');
          return results;
        }
      } catch (e) {
        console.warn(`API-Football form fetch failed for ${teamName}. Trying TheOddsAPI...`);
      }
    }

    // [FIX] Tenta The Odds API antes de apelar para Gemini Search
    if (sportKey) {
      const resultadosAPI = await buscarResultadosRecentes(teamName, sportKey);
      if (resultadosAPI.length > 0) {
        const results = resultadosAPI.map(r => r.resultado === 'W' ? 'V' : r.resultado === 'D' ? 'E' : 'D');
        while (results.length < 5) results.unshift('?');
        return results;
      }
    }

    if (!allowGeminiFallback) {
      return ['?', '?', '?', '?', '?'];
    }

    console.warn(`TheOddsAPI fetch failed for ${teamName}. Trying Gemini search...`);
    return await fetchFormaRecenteViaGeminiSearch(teamName);
  };

  const fetchH2H = async (h: number, a: number, allowGeminiFallback: boolean = true) => {
    if (h === -1 || a === -1) return [];
    if (!hasQuota(1)) return [];
    try {
      const h2hUrl = `${API_BASE_URL}/fixtures/headtohead?h2h=${h}-${a}&last=10`;
      const res = await fetch(h2hUrl, {
        signal: AbortSignal.timeout(12000)
      });

      if (!res.ok) throw new Error('Response not ok');
      trackRequest();
      const data = await responseToJson(res);
      if (data?.errors && Object.keys(data.errors).length > 0) {
        console.error('[H2H API] Erro no payload da API-Football:', data.errors);
        throw new Error(`API-Football error: ${JSON.stringify(data.errors)}`);
      }
      const rawH2H = data?.response || [];

      const sortedH2H = [...rawH2H].sort((a: any, b: any) => {
        const timeA = a.fixture?.timestamp ? a.fixture.timestamp * 1000 : new Date(a.fixture?.date || 0).getTime();
        const timeB = b.fixture?.timestamp ? b.fixture.timestamp * 1000 : new Date(b.fixture?.date || 0).getTime();
        return timeB - timeA;
      });

      return sortedH2H.map((f: any) => ({
        date: f.fixture.date.split('T')[0],
        score: `${f.goals.home}-${f.goals.away}`,
        winner: f.teams.home.winner ? f.teams.home.name : (f.teams.away.winner ? f.teams.away.name : 'Empate')
      }));
    } catch (e) {
      return [];
    }
  };

  const fetchGoalsForTeam = async (id: number, teamName: string, precheckedGols?: { jogos: JogoComData[] } | null) => {
    // 1ª tentativa: API-Football fixtures reais (reaproveitada do pre-check se existir)
    if (precheckedGols !== undefined) {
      if (precheckedGols) return precheckedGols;
    } else {
      const viaApiFootball = await fetchGolsRecentes(id);
      if (viaApiFootball) return viaApiFootball;
    }

    // 2ª tentativa: parsear placar do The Odds API scores
    if (sportKey) {
      const resultadosAPI = await buscarResultadosRecentes(teamName, sportKey);
      const viaOddsApi = extrairGolsDoPlacar(resultadosAPI);
      if (viaOddsApi) return viaOddsApi;
    }

    return null; // sem dado real — tipsterEngine cairá em mapFormToGoals corretamente
  };

  if (!precheck.prosseguirComGemini) {
    trackPrecheckSkip(precheck.motivo || 'Dado insuficiente');
    
    const [homeForm, awayForm, h2h] = await Promise.all([
      fetchForm(homeId, homeTeam, false),
      fetchForm(awayId, awayTeam, false),
      fetchH2H(homeId, awayId, false)
    ]);
    
    return {
      home_form: homeForm,
      away_form: awayForm,
      h2h: h2h,
      home_goals: undefined,
      away_goals: undefined,
      scout_summary: 'Dado insuficiente — análise seguirá com nível de confiança reduzido.',
      data_source: 'unavailable',
      confiavel: false
    };
  }

  try {
    const [homeForm, awayForm, h2h, homeGoals, awayGoals] = await Promise.all([
      fetchForm(homeId, homeTeam, true),
      fetchForm(awayId, awayTeam, true),
      fetchH2H(homeId, awayId, true),
      fetchGoalsForTeam(homeId, homeTeam, precheck.homeGols),
      fetchGoalsForTeam(awayId, awayTeam, precheck.awayGols)
    ]);

    const hasRealForm = homeForm.some(r => r !== '?') || awayForm.some(r => r !== '?');
    const isConfiavel = hasRealForm || h2h.length > 0;

    return {
      home_form: homeForm,
      away_form: awayForm,
      h2h: h2h,
      home_goals: homeGoals ?? undefined,
      away_goals: awayGoals ?? undefined,
      scout_summary: `Confronto analisado. Forma H: ${homeForm.join('')}, A: ${awayForm.join('')}.`,
      data_source: hasRealForm ? 'real' : 'unavailable',
      confiavel: isConfiavel
    };
  } catch (e) {
    return {
      home_form: ['?', '?', '?', '?', '?'],
      away_form: ['?', '?', '?', '?', '?'],
      h2h: [],
      scout_summary: 'Erro ao buscar dados reais.',
      data_source: 'unavailable',
      confiavel: false
    };
  }
}

async function responseToJson(res: Response) {
  try { return await res.json(); } catch (e) { return null; }
}

export async function fetchInjuries(teamName: string, leagueId: number): Promise<string[]> {
  const teamId = await getTeamIdAsync(teamName);
  if (teamId === -1 || !hasQuota(1)) return [];

  const cacheKey = `injuries_${teamId}_${leagueId}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < 3 * 60 * 60 * 1000) return data;
    } catch { sessionStorage.removeItem(cacheKey); }
  }

  const season = getSeasonForLeague(leagueId);

  try {
    const res = await fetch(`${API_BASE_URL}/injuries?team=${teamId}&league=${leagueId}&season=${season}`, {
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) return [];
    trackRequest();
    const data = await responseToJson(res);
    if (data?.errors && Object.keys(data.errors).length > 0) {
      console.error('[Injuries API] Erro no payload da API-Football:', data.errors);
      return [];
    }
    const injuries = (data?.response || []).map((i: any) => i.player.name);
    sessionStorage.setItem(cacheKey, JSON.stringify({ data: injuries, timestamp: Date.now() }));
    return injuries;
  } catch (e) {
    return [];
  }
}

const LIGAS_SUPORTADAS = [
  'soccer_epl', 'soccer_serie_a', 'soccer_spain_la_liga',
  'soccer_germany_bundesliga', 'soccer_france_ligue_one',
  'soccer_brazil_campeonato', 'soccer_uefa_champs_league',
  'soccer_conmebol_copa_sudamericana',
  'soccer_conmebol_copa_libertadores',
  'soccer_spain_segunda_division',
  'soccer_netherlands_eredivisie'
];

async function buscarResultadosRecentes(
  teamName: string,
  sportKey: string
): Promise<Array<{ resultado: 'W'|'D'|'L'; placar: string; adversario: string }>> {
  try {
    if (!ODDS_API_KEY) return [];
    let jogos: any = [];
    const cacheKey = `scores_cache_${sportKey}`;
    const SCORES_CACHE_TTL = 30 * 60 * 1000;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < SCORES_CACHE_TTL) {
          jogos = data;
        }
      } catch {}
    }

    if (!jogos || jogos.length === 0) {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
      const res = await fetch(url);

      if (res.status === 422) {
        console.warn(`[The Odds API] Erro 422: Janela de dias inválida para ${sportKey}.`);
        return [];
      }

      if (!res.ok) return [];

      jogos = await res.json();
      if (Array.isArray(jogos) && jogos.length > 0) {
        localStorage.setItem(cacheKey, JSON.stringify({
          data: jogos,
          timestamp: Date.now()
        }));
      }
    }
    const jogosDoTime = jogos
      .filter((j: any) =>
        j.completed === true &&
        (j.home_team === teamName || j.away_team === teamName) &&
        j.scores?.length >= 2
      )
      .slice(-5);

    return jogosDoTime.map((j: any) => {
      const ehCasa = j.home_team === teamName;
      const scoreTime = parseInt(j.scores?.find((s: any) => s.name === teamName)?.score ?? '0', 10);
      const adversario = ehCasa ? j.away_team : j.home_team;
      const scoreAdv = parseInt(j.scores?.find((s: any) => s.name === adversario)?.score ?? '0', 10);
      const resultado: 'W'|'D'|'L' = scoreTime > scoreAdv ? 'W' : scoreTime === scoreAdv ? 'D' : 'L';
      return {
        resultado,
        placar: ehCasa ? `${scoreTime}-${scoreAdv}` : `${scoreAdv}-${scoreTime}`,
        adversario
      };
    });
  } catch {
    return [];
  }
}

const formCache = new Map<string, string[]>();

export async function fetchFormaRecenteViaGeminiSearch(teamName: string): Promise<string[]> {
  if (formCache.has(teamName)) return formCache.get(teamName)!;

  if (!genAI) {
    console.warn("Gemini genAI instance not initialized, cannot run search.");
    return ['?', '?', '?', '?', '?'];
  }

  const currentYear = new Date().getFullYear();
  const query = `"${teamName}" futebol ultimos 5 jogos resultados placar ${currentYear}`;

  try {
    const systemInstruction = `Você é um agente de busca esportiva (Scout).
Sua PRIORIDADE MÁXIMA é obter a forma recente (últimos 5 jogos concluídos) do time informado.
Você DEVE obrigatoriamente usar a ferramenta Google Search para buscar informações reais e atualizadas de 2026.
Analise os resultados encontrados e retorne exatamente os últimos 5 jogos em ordem cronológica (o mais antigo primeiro, o mais recente por último).
Retorne as informações como um JSON no formato:
{
  "forma": ["V", "D", "E", "V", "V"], // Sendo 'V' para vitória, 'E' para empate, 'D' para derrota
  "sucesso": true
}
Se você não conseguir determinar com certeza os resultados reais de todos os 5 jogos, retorne:
{
  "forma": ["?", "?", "?", "?", "?"],
  "sucesso": false
}
Responda APENAS com o JSON, sem markdown ou explicações.`;

    const userMessage = `Por favor, encontre a forma recente dos últimos 5 jogos do time "${teamName}" em 2026 usando a busca: ${query}`;

    let response;
    try {
      trackGeminiCall('fetchFormaRecenteViaGeminiSearch - Principal');
      response = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          tools: [{ googleSearch: {} }]
        }
      });
    } catch (e: any) {
      if (e?.message?.includes("not found") || e?.status === 404 || e?.code === 404) {
        const { GEMINI_MODEL_FALLBACK } = await import("../config/ai");
        console.warn(`[Scout] Modelo "${GEMINI_MODEL}" indisponível, tentando fallback "${GEMINI_MODEL_FALLBACK}"`);
        trackGeminiCall('fetchFormaRecenteViaGeminiSearch - Fallback');
        response = await genAI.models.generateContent({
          model: GEMINI_MODEL_FALLBACK,
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: {
            systemInstruction,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
            tools: [{ googleSearch: {} }]
          }
        });
      } else {
        throw e;
      }
    }

    const text = response.text || '';
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed && parsed.sucesso && Array.isArray(parsed.forma) && parsed.forma.length === 5 &&
      parsed.forma.every((c: string) => ['V', 'E', 'D', '?'].includes(c)) &&
      parsed.forma.some((c: string) => c !== '?')) {
      formCache.set(teamName, parsed.forma);
      return parsed.forma;
    }
  } catch (err) {
    console.error(`[Scout Search] Erro na Query para ${teamName}:`, err);
  }

  console.error(`[Scout Search] ❌ A busca do Gemini falhou para o time: ${teamName}`);
  const fallback = ['?', '?', '?', '?', '?'];
  formCache.set(teamName, fallback);
  return fallback;
}

export interface FormResult {
  data: Array<{ resultado: 'W'|'D'|'L'; placar: string; adversario: string }>;
  source: 'api_football' | 'football_data' | 'the_odds_api' | 'unavailable' | 'gemini_search';
  confiavel: boolean;
}

export async function getFormaRecente(
  teamName: string,
  sportKey: string,
  liga: string,
  teamId?: number,
  allowGeminiFallback: boolean = false
): Promise<FormResult> {
  const resolvedId = teamId && teamId !== -1 ? teamId : await getTeamIdAsync(teamName);
  if (resolvedId && resolvedId !== -1) {
    try {
      const league_id_calculated = LEAGUE_ID_MAP[sportKey] || 71;
      const season = getSeasonForLeague(league_id_calculated);
      const res = await fetch(`${API_BASE_URL}/teams/statistics?league=${league_id_calculated}&season=${season}&team=${resolvedId}`, {
        signal: AbortSignal.timeout(12000)
      });
      // [INC-SC-2 FIX] Verificar res.ok antes de chamar .json()
      if (!res.ok) throw new Error(`API-Football status ${res.status}`);
      const data = await res.json();
      if (data?.errors && Object.keys(data.errors).length > 0) {
        console.error('[Scout API] Erro no payload da API-Football:', data.errors);
        throw new Error(`API-Football error: ${JSON.stringify(data.errors)}`);
      }
      const formStr = data?.response?.form || '';
      if (formStr.length >= 3) {
        const results = formStr.split('').slice(-5).map((r: string) => {
          const norm = normalizeResult(r); // retorna 'V'/'E'/'D'/'?'
          const resultado: 'W'|'D'|'L' = norm === 'V' ? 'W' : norm === 'E' ? 'D' : 'L';
          return { resultado, placar: 'N/A', adversario: 'N/A' };
        });
        return { data: results, source: 'api_football', confiavel: true };
      }
    } catch (e) { /* fallback */ }
  }

  const resultadosAPI = await buscarResultadosRecentes(teamName, sportKey);
  if (resultadosAPI.length > 0) {
    return { data: resultadosAPI, source: 'the_odds_api', confiavel: true };
  }

  try {
    if (allowGeminiFallback) {
      const geminiForm = await fetchFormaRecenteViaGeminiSearch(teamName);
      if (geminiForm.some(r => r !== '?')) {
        const mapped = geminiForm
          .filter(r => r !== '?')
          .map(r => ({
            resultado: (r === 'V' ? 'W' : r === 'E' ? 'D' : 'L') as 'W'|'D'|'L',
            placar: 'N/A',
            adversario: 'N/A'
          }));
        return { data: mapped, source: 'gemini_search', confiavel: true };
      }
    }
  } catch (e) {
    console.warn(`Gemini Search agent failed for ${teamName}:`, e);
  }

  return { data: [], source: 'unavailable', confiavel: false };
}

export async function buscarEstatisticasMedias(
  homeTeam: string,
  awayTeam: string,
  liga: string
): Promise<any> {
  let baseResult: any;
  try {
    if (!genAI) throw new Error('API key not initialized');
    const prompt = `Você é um banco de dados estatístico de futebol.

Para a partida ${homeTeam} vs ${awayTeam} na ${liga},
baseado nos últimos 5 jogos de cada time, retorne APENAS
este JSON exato sem markdown sem explicações:

{
  "escanteios": {
    "media_home": 5.2,
    "media_away": 4.8,
    "total_min": 8,
    "total_max": 12,
    "probabilidade": 80
  },
  "finalizacoes": {
    "media_home": 13.4,
    "media_away": 11.2,
    "total_min": 22,
    "total_max": 28,
    "probabilidade": 75
  }
}

Onde:
- media_home: média de escanteios/finalizações do time da casa nos últimos 5 jogos
- media_away: média do visitante nos últimos 5 jogos
- total_min: soma mínima esperada para a partida
- total_max: soma máxima esperada para a partida
- probabilidade: % de chance do total ficar dentro do range min-max

Use dados reais conhecidos. Se incerto, use médias conservadoras
baseadas no estilo de jogo típico dos times na liga.
Retorne APENAS o JSON.`;

    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: 'Responda APENAS com JSON válido. Sem markdown, sem texto adicional.',
        responseMimeType: 'application/json'
      }
    });

    const text = response.text || '';
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    baseResult = { ...parsed, fonte: 'gemini_inferido', confiavel: false };
  } catch {
    baseResult = {
      escanteios: { media_home: 5.0, media_away: 4.5, total_min: 8, total_max: 11, probabilidade: 70 },
      finalizacoes: { media_home: 12.0, media_away: 10.0, total_min: 20, total_max: 26, probabilidade: 70 },
      fonte: 'unavailable',
      confiavel: false
    };
  }

  // ENRICH WITH SPORTMONKS
  let xg_home_last5: number | null = null;
  let xg_away_last5: number | null = null;
  let ppda_home: number | null = null;
  let ppda_away: number | null = null;
  let pressao_alta_home = false;
  let pressao_alta_away = false;

  const hasSportmonksToken = !!import.meta.env.VITE_SPORTMONKS_TOKEN;
  if (hasSportmonksToken) {
    try {
      const leagueKey = Object.keys(SPORTMONKS_LEAGUE_BY_NAME).find(
        k => liga.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(liga.toLowerCase())
      );
      const leagueId = leagueKey ? SPORTMONKS_LEAGUE_BY_NAME[leagueKey] : null;

      if (leagueId) {
        const year = getSeasonForLeague(leagueId);
        const seasonId = await getSeasonId(leagueId, year);

        if (seasonId) {
          const [homeId, awayId] = await Promise.all([
            getSportmonksTeamId(homeTeam),
            getSportmonksTeamId(awayTeam)
          ]);

          const fetches = [];
          if (homeId) {
            fetches.push(getTeamXgLast5(homeId, seasonId).then(val => { xg_home_last5 = val; }));
            fetches.push(getTeamPpdaLast5(homeId, seasonId).then(val => {
              ppda_home = val;
              if (val !== null && val < 8) pressao_alta_home = true;
            }));
          }
          if (awayId) {
            fetches.push(getTeamXgLast5(awayId, seasonId).then(val => { xg_away_last5 = val; }));
            fetches.push(getTeamPpdaLast5(awayId, seasonId).then(val => {
              ppda_away = val;
              if (val !== null && val < 8) pressao_alta_away = true;
            }));
          }

          if (fetches.length > 0) await Promise.all(fetches);
        }
      }
    } catch (e) {
      console.warn('[Sportmonks] Error enriching statistics:', e);
    }
  }

  return {
    ...baseResult,
    xg_home_last5,
    xg_away_last5,
    ppda_home,
    ppda_away,
    pressao_alta_home,
    pressao_alta_away
  };
}

function verificarCorrespondenciaTime(nomeFixture: string, nomeDesejado: string): boolean {
  const normFixture = normalizarNomeTime(nomeFixture);
  const normDesejado = normalizarNomeTime(nomeDesejado);
  if (normFixture === normDesejado) return true;
  if (normFixture.includes(normDesejado) || normDesejado.includes(normFixture)) return true;
  return false;
}

function validarLoteH2H(fixtures: any[], homeTeam: string, awayTeam: string): boolean {
  if (!fixtures || fixtures.length === 0) return false;
  const f = fixtures[0];
  const homeFixture = f.teams?.home?.name;
  const awayFixture = f.teams?.away?.name;
  if (!homeFixture || !awayFixture) return false;
  const envolveHome = verificarCorrespondenciaTime(homeFixture, homeTeam) || verificarCorrespondenciaTime(awayFixture, homeTeam);
  const envolveAway = verificarCorrespondenciaTime(homeFixture, awayTeam) || verificarCorrespondenciaTime(awayFixture, awayTeam);
  return envolveHome && envolveAway;
}

function mapearConfrontos(fixtures: any[], homeTeam: string, awayTeam: string) {
  const confrontos = fixtures.slice(0, 5).map((f: any) => {
    const homeGoals = f.goals.home ?? 0;
    const awayGoals = f.goals.away ?? 0;
    const vencedor = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'draw';
    return {
      data: f.fixture.date?.substring(0, 10),
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      placar: `${homeGoals}-${awayGoals}`,
      vencedor,
      totalGols: homeGoals + awayGoals
    };
  });

  const vitorias_home = confrontos.filter(c =>
    (c.vencedor === 'home' && verificarCorrespondenciaTime(c.homeTeam, homeTeam)) ||
    (c.vencedor === 'away' && verificarCorrespondenciaTime(c.awayTeam, homeTeam))
  ).length;

  const vitorias_away = confrontos.filter(c =>
    (c.vencedor === 'home' && verificarCorrespondenciaTime(c.homeTeam, awayTeam)) ||
    (c.vencedor === 'away' && verificarCorrespondenciaTime(c.awayTeam, awayTeam))
  ).length;

  const empates = confrontos.filter(c => c.vencedor === 'draw').length;
  const totalGols = confrontos.reduce((a, c) => a + c.totalGols, 0);
  const over25 = confrontos.filter(c => c.totalGols > 2).length;

  return {
    confrontos,
    resumo: {
      vitorias_home,
      empates,
      vitorias_away,
      media_gols_home: parseFloat(
        (confrontos.reduce((a, c) => {
          if (verificarCorrespondenciaTime(c.homeTeam, homeTeam)) return a + parseInt(c.placar.split('-')[0], 10);
          return a + parseInt(c.placar.split('-')[1], 10);
        }, 0) / (confrontos.length || 1)).toFixed(1)
      ),
      media_gols_away: parseFloat(
        (confrontos.reduce((a, c) => {
          if (verificarCorrespondenciaTime(c.awayTeam, awayTeam)) return a + parseInt(c.placar.split('-')[1], 10);
          return a + parseInt(c.placar.split('-')[0], 10);
        }, 0) / (confrontos.length || 1)).toFixed(1)
      ),
      over25_percentual: Math.round((over25 / (confrontos.length || 1)) * 100)
    },
    fonte: 'api-football'
  };
}

async function buscarH2HviaAPIFootball(homeTeam: string, awayTeam: string): Promise<any> {
  try {
    const homeId = await getTeamIdAsync(homeTeam);
    const awayId = await getTeamIdAsync(awayTeam);

    if (homeId === -1 || awayId === -1) {
      console.warn('Time não encontrado na API-Football:', homeId === -1 ? homeTeam : awayTeam);
      return null;
    }

    const h2hUrl = `${API_BASE_URL}/fixtures/headtohead?h2h=${homeId}-${awayId}`;
    const resH2H = await fetch(h2hUrl, { signal: AbortSignal.timeout(12000) });

    // [INC-SC-1 FIX] Verificar res.ok antes de chamar .json() para evitar parse de resposta de erro
    if (!resH2H.ok) {
      console.warn(`[H2H] API-Football retornou status ${resH2H.status}`);
      return null;
    }

    const dataH2H = await resH2H.json();
    if (dataH2H?.errors && Object.keys(dataH2H.errors).length > 0) {
      console.error('[H2H API Fallback] Erro no payload da API-Football:', dataH2H.errors);
      return null;
    }
    const rawFixtures = dataH2H.response ?? [];

    const sortedFixtures = [...rawFixtures].sort((a: any, b: any) => {
      const timeA = a.fixture?.timestamp ? a.fixture.timestamp * 1000 : new Date(a.fixture?.date || 0).getTime();
      const timeB = b.fixture?.timestamp ? b.fixture.timestamp * 1000 : new Date(b.fixture?.date || 0).getTime();
      return timeB - timeA;
    });

    const fixtures = sortedFixtures.slice(0, 10);

    if (fixtures.length === 0) {
      try {
        const currentYear = new Date().getFullYear();
        const fixturesUrl = `${API_BASE_URL}/fixtures?team=${homeId}&season=${currentYear}`;
        const resFixtures = await fetch(fixturesUrl, { signal: AbortSignal.timeout(12000) });

        if (resFixtures.ok) {
          const dataFixtures = await resFixtures.json();
          if (dataFixtures?.errors && Object.keys(dataFixtures.errors).length > 0) {
            console.error('[H2H Fallback API] Erro no payload da API-Football:', dataFixtures.errors);
            return null;
          }
          const rawConfrontos = dataFixtures.response?.filter(
            (f: any) => f.teams.home.id === awayId || f.teams.away.id === awayId
          ) ?? [];

          const sortedConfrontos = [...rawConfrontos].sort((a: any, b: any) => {
            const timeA = a.fixture?.timestamp ? a.fixture.timestamp * 1000 : new Date(a.fixture?.date || 0).getTime();
            const timeB = b.fixture?.timestamp ? b.fixture.timestamp * 1000 : new Date(b.fixture?.date || 0).getTime();
            return timeB - timeA;
          });

          const confrontosEncontrados = sortedConfrontos.slice(0, 10);

          if (confrontosEncontrados.length > 0) {
            if (!validarLoteH2H(confrontosEncontrados, homeTeam, awayTeam)) {
              console.warn(`[H2H Validation Fallback] Lote rejeitado. Esperado: ${homeTeam} vs ${awayTeam}.`);
              return null;
            }
            return mapearConfrontos(confrontosEncontrados, homeTeam, awayTeam);
          }
        }
      } catch (e) {
        console.warn('Fixtures fallback falhou:', e);
      }

      console.warn('API-Football sem dados H2H para:', homeTeam, 'vs', awayTeam);
      return null;
    }

    if (!validarLoteH2H(fixtures, homeTeam, awayTeam)) {
      console.warn(`[H2H Validation] Lote rejeitado. Esperado: ${homeTeam} vs ${awayTeam}.`);
      return null;
    }

    return mapearConfrontos(fixtures, homeTeam, awayTeam);
  } catch {
    return null;
  }
}

async function buscarH2HviaGemini(homeTeam: string, awayTeam: string, liga: string): Promise<any> {
  try {
    if (!genAI) throw new Error('API key not initialized');
    const now = new Date();
    const mesAno = now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    const prompt = `Você é um banco de dados de futebol. Considere a data atual de hoje como ${mesAno}.

Liste os últimos 5 confrontos diretos mais recentes e atualizados (até Maio de 2026) entre
${homeTeam} e ${awayTeam} e retorne APENAS este JSON:

{
  "confrontos": [
    {
      "data": "2024-11",
      "homeTeam": "${homeTeam}",
      "awayTeam": "${awayTeam}",
      "placar": "2-1",
      "vencedor": "home"
    }
  ],
  "resumo": {
    "vitorias_home": 2,
    "empates": 1,
    "vitorias_away": 2,
    "media_gols_home": 1.4,
    "media_gols_away": 1.2,
    "over25_percentual": 60
  }
}

Use dados reais conhecidos. Vencedor: "home", "away" ou "draw".
Retorne APENAS o JSON, sem markdown.`;

    let response;
    try {
      trackGeminiCall('buscarH2HviaGemini - Principal');
      response = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: 'Responda APENAS com JSON válido. Sem markdown.',
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        }
      });
    } catch (e: any) {
      if (e?.message?.includes("not found") || e?.status === 404 || e?.code === 404) {
        const { GEMINI_MODEL_FALLBACK } = await import("../config/ai");
        console.warn(`[H2H] Modelo "${GEMINI_MODEL}" indisponível, tentando fallback "${GEMINI_MODEL_FALLBACK}"`);
        trackGeminiCall('buscarH2HviaGemini - Fallback');
        response = await genAI.models.generateContent({
          model: GEMINI_MODEL_FALLBACK,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction: 'Responda APENAS com JSON válido. Sem markdown.',
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 }
          }
        });
      } else {
        throw e;
      }
    }

    const text = response.text || '';
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function buscarH2H(homeTeam: string, awayTeam: string, liga: string): Promise<any> {
  const apiFootballData = await buscarH2HviaAPIFootball(homeTeam, awayTeam).catch(() => null);

  if (apiFootballData?.confrontos?.length >= 2) {
    return { ...apiFootballData, confiavel: true, fonte: 'api_football' };
  }

  try {
    const h2hGemini = await buscarH2HviaGemini(homeTeam, awayTeam, liga);
    if (h2hGemini && h2hGemini.confrontos && h2hGemini.confrontos.length > 0) {
      return { ...h2hGemini, confiavel: false, fonte: 'gemini_factual' };
    }
  } catch (geminiFallbackError: any) {
    console.warn('[H2H] Gemini fallback falhou:', geminiFallbackError?.message || String(geminiFallbackError));
  }

  return {
    confrontos: [],
    resumo: { vitorias_home: 0, empates: 0, vitorias_away: 0, media_gols_home: 0, media_gols_away: 0, over25_percentual: 0 },
    fonte: 'unavailable',
    confiavel: false
  };
}

export const LEAGUE_ID_MAP: Record<string, number> = {
  'soccer_epl': 39,
  'soccer_spain_la_liga': 140,
  'soccer_italy_serie_a': 135,
  'soccer_germany_bundesliga': 78,
  'soccer_france_ligue_one': 61,
  'soccer_uefa_champs_league': 2,
  'soccer_brazil_campeonato': 71,
  'soccer_netherlands_eredivisie': 88,
  'soccer_conmebol_copa_libertadores': 13,
  'soccer_conmebol_copa_sudamericana': 11,
};

const STANDINGS_CACHE = new Map<string, any>();

export function clearStandingsCache() {
  STANDINGS_CACHE.clear();
}

async function fetchStandingsForSeason(leagueId: number, season: number): Promise<{ data: any[] | null; isRateLimited: boolean }> {
  if (!hasQuota(1)) return { data: null, isRateLimited: false };
  try {
    const res = await fetch(`${API_BASE_URL}/standings?league=${leagueId}&season=${season}`, {
      signal: AbortSignal.timeout(12000)
    });

    if (res.status === 429) return { data: null, isRateLimited: true };
    if (!res.ok) return { data: null, isRateLimited: false };
    trackRequest();

    const data = await res.json();
    if (data?.errors && (data.errors.rateLimit || data.errors.token || data.errors.plan)) {
      console.warn(`[Standings] Erro da API-Football (season ${season}):`, data.errors);
      const isLimit = !!(data.errors.rateLimit || data.errors.token);
      return { data: null, isRateLimited: isLimit };
    }

    const standings = data?.response?.[0]?.league?.standings;
    if (standings && standings.length > 0) return { data: standings, isRateLimited: false };
    return { data: null, isRateLimited: false };
  } catch (e) {
    console.error(`Erro ao buscar classificação para liga ${leagueId} e temporada ${season}:`, e);
    return { data: null, isRateLimited: false };
  }
}

export async function fetchLeagueStandings(leagueId: number): Promise<any[] | null> {
  const currentYear = getSeasonForLeague(leagueId);
  const cacheKey = `standings_${leagueId}`;
  const errorCacheKey = `standings_error_${leagueId}`;

  if (STANDINGS_CACHE.has(cacheKey)) return STANDINGS_CACHE.get(cacheKey);

  const lastError = sessionStorage.getItem(errorCacheKey);
  if (lastError) {
    const timestamp = parseInt(lastError, 10);
    if (Date.now() - timestamp < 5 * 60 * 1000) {
      console.log(`[Standings] Ignorando busca para liga ${leagueId} (Negative Cache).`);
      return null;
    } else {
      sessionStorage.removeItem(errorCacheKey);
    }
  }

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < 6 * 60 * 60 * 1000) {
        STANDINGS_CACHE.set(cacheKey, data);
        return data;
      }
    }
  } catch (e) {
    console.warn('Erro ao ler standings cache do sessionStorage:', e);
  }

  let standings = null;
  for (let offset = 0; offset <= 1; offset++) {
    const targetSeason = currentYear - offset;
    const result = await fetchStandingsForSeason(leagueId, targetSeason);

    if (result.isRateLimited) {
      console.warn(`[Standings] Rate limit atingido. Interrompendo loop retroativo.`);
      sessionStorage.setItem(errorCacheKey, String(Date.now()));
      break;
    }

    if (result.data) {
      standings = result.data;
      console.log(`[Standings] Classificação carregada para liga ${leagueId} temporada ${targetSeason}`);
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 400));
  }

  if (standings) {
    try {
      STANDINGS_CACHE.set(cacheKey, standings);
      sessionStorage.setItem(cacheKey, JSON.stringify({ data: standings, timestamp: Date.now() }));
    } catch (e) {
      console.warn('Erro ao salvar standings cache:', e);
    }
    return standings;
  } else {
    sessionStorage.setItem(errorCacheKey, String(Date.now()));
  }

  return null;
}

export async function getTeamPositionInLeague(teamName: string, sportKey: string): Promise<number | null> {
  const leagueId = LEAGUE_ID_MAP[sportKey];
  if (!leagueId) {
    console.warn(`[Standings] Liga não mapeada para sportKey: ${sportKey}`);
    return null;
  }

  const standings = await fetchLeagueStandings(leagueId);
  if (!standings || standings.length === 0) return null;

  const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const normalizedTeamName = normalizarNomeTime(teamName);

  for (const group of standings) {
    if (!Array.isArray(group)) continue;
    for (const row of group) {
      const rowTeamName = row?.team?.name;
      if (!rowTeamName) continue;

      const normalizedRowTeam = normalizarNomeTime(rowTeamName);
      if (normalizedRowTeam === normalizedTeamName) return row.rank;
      if (normalizedRowTeam.includes(normalizedTeamName) || normalizedTeamName.includes(normalizedRowTeam)) return row.rank;

      for (const [realName, aliases] of Object.entries(ALIAS_TIMES_HOLANDESES)) {
        const normalizedReal = normalize(realName);
        if (normalizedReal === normalizedTeamName || (aliases as string[]).some(alias => normalize(alias) === normalizedTeamName)) {
          if (normalize(rowTeamName) === normalizedReal || normalize(realName) === normalizedRowTeam) return row.rank;
        }
      }
    }
  }

  console.warn(`[Standings] Posição não encontrada para time: ${teamName} na liga: ${sportKey}`);
  return null;
}
