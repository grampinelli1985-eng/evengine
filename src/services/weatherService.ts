/**
 * weatherService.ts — Clima & Gramado para análise de partidas
 *
 * Usa Open-Meteo (open-meteo.com) — gratuito, sem chave de API, sem rate limit.
 * Impacto do clima no futebol é real e quantificável:
 *   - Chuva forte → menos gols, mais empates, menos escanteios
 *   - Vento forte → bolas aéreas afetadas, pressing menos eficaz
 *   - Calor extremo (>30°C) → fadiga, ritmo mais lento no 2º tempo
 *   - Frio (<5°C) → times físicos levam vantagem
 * Gramado sintético → vantagem do mandante (familiaridade), jogo mais rápido.
 */

import { Match } from '../types';

// ─── Coordenadas por time (lat, lon do estádio/cidade) ───────────────────────

const TEAM_COORDS: Record<string, [number, number]> = {
  // Premier League
  'Arsenal': [51.555, -0.108], 'Manchester City': [53.483, -2.200],
  'Manchester United': [53.463, -2.291], 'Liverpool': [53.431, -2.961],
  'Chelsea': [51.481, -0.191], 'Tottenham': [51.604, -0.066],
  'Tottenham Hotspur': [51.604, -0.066], 'Newcastle': [54.975, -1.621],
  'Newcastle United': [54.975, -1.621], 'Aston Villa': [52.509, -1.885],
  'Fulham': [51.475, -0.221], 'Brighton': [50.861, -0.083],
  'Brighton & Hove Albion': [50.861, -0.083], 'West Ham': [51.538, 0.017],
  'West Ham United': [51.538, 0.017], 'Wolves': [52.590, -2.130],
  'Wolverhampton Wanderers': [52.590, -2.130], 'Crystal Palace': [51.398, -0.086],
  'Brentford': [51.488, -0.289], 'Nottingham Forest': [52.940, -1.133],
  'Everton': [53.438, -2.966], 'Leicester': [52.620, -1.142],
  'Leicester City': [52.620, -1.142], 'Southampton': [50.906, -1.391],
  'Bournemouth': [50.735, -1.838], 'AFC Bournemouth': [50.735, -1.838],
  'Ipswich': [52.055, 1.145], 'Ipswich Town': [52.055, 1.145],
  'Watford': [51.650, -0.401], 'Leeds United': [53.777, -1.572],
  'Leeds': [53.777, -1.572], 'Burnley': [53.789, -2.231],
  'Middlesbrough': [54.578, -1.217], 'Sunderland': [54.914, -1.388],
  'Sheffield United': [53.370, -1.471], 'West Brom': [52.509, -1.964],
  'Stoke City': [52.988, -2.175],

  // La Liga
  'Real Madrid': [40.453, -3.688], 'Barcelona': [41.381, 2.123],
  'FC Barcelona': [41.381, 2.123], 'Atletico Madrid': [40.436, -3.600],
  'Sevilla': [37.384, -5.970], 'Villarreal': [39.944, -0.104],
  'Real Sociedad': [43.301, -1.974], 'Athletic Club': [43.264, -2.949],
  'Athletic Bilbao': [43.264, -2.949], 'Valencia': [39.474, -0.358],
  'Betis': [37.356, -5.981], 'Osasuna': [42.798, -1.637],
  'Girona': [41.980, 2.819], 'Mallorca': [39.590, 2.651],

  // Bundesliga
  'Bayern Munich': [48.219, 11.625], 'Borussia Dortmund': [51.493, 7.452],
  'RB Leipzig': [51.346, 12.348], 'Bayer Leverkusen': [51.038, 6.984],
  'Eintracht Frankfurt': [50.069, 8.645], 'Freiburg': [47.988, 7.894],
  'Union Berlin': [52.457, 13.568], 'Wolfsburg': [52.432, 10.804],
  'Borussia Mönchengladbach': [51.174, 6.386],

  // Serie A
  'Juventus': [45.110, 7.641], 'Inter': [45.478, 9.124], 'AC Milan': [45.478, 9.124],
  'Napoli': [40.828, 14.193], 'Roma': [41.934, 12.455], 'AS Roma': [41.934, 12.455],
  'Lazio': [41.934, 12.455], 'SS Lazio': [41.934, 12.455],
  'Atalanta': [45.709, 9.677], 'Fiorentina': [43.780, 11.283],
  'Torino': [45.044, 7.650], 'Bologna': [44.492, 11.309],

  // Ligue 1
  'PSG': [48.841, 2.253], 'Marseille': [43.270, 5.396], 'Lyon': [45.765, 4.833],
  'Monaco': [43.728, 7.416], 'Lille': [50.612, 3.131], 'Nice': [43.705, 7.192],
  'Rennes': [48.107, -1.712], 'Lens': [50.432, 2.815],

  // Primeira Liga
  'Benfica': [38.752, -9.184], 'SL Benfica': [38.752, -9.184],
  'Sporting CP': [38.761, -9.160], 'Porto': [41.162, -8.583],
  'FC Porto': [41.162, -8.583], 'Braga': [41.561, -8.388],
  'Vitória SC': [41.443, -8.299], 'Gil Vicente': [41.642, -8.310],

  // Eredivisie
  'Ajax': [52.314, 4.942], 'AFC Ajax': [52.314, 4.942],
  'Feyenoord': [51.893, 4.524], 'PSV': [51.442, 5.467],
  'PSV Eindhoven': [51.442, 5.467], 'AZ': [52.626, 4.765],
  'FC Twente': [52.237, 6.851], 'Utrecht': [52.079, 5.117],

  // Brasileirão A (calor/umidade variam por região)
  'Flamengo': [-22.912, -43.230], 'Fluminense': [-22.912, -43.230],
  'Vasco da Gama': [-22.912, -43.230], 'Vasco': [-22.912, -43.230],
  'Botafogo': [-22.912, -43.230], 'Palmeiras': [-23.546, -46.474],
  'Corinthians': [-23.546, -46.474], 'São Paulo': [-23.546, -46.474],
  'Santos': [-23.960, -46.333],
  'Atlético Mineiro': [-19.866, -43.972], 'Atlético-MG': [-19.866, -43.972],
  'Cruzeiro': [-19.866, -43.972], 'América Mineiro': [-19.866, -43.972],
  'Grêmio': [-30.065, -51.228], 'Internacional': [-30.065, -51.228],
  'Bahia': [-12.970, -38.511], 'Vitória': [-12.970, -38.511],
  'Fortaleza': [-3.717, -38.543], 'Ceará': [-3.717, -38.543],
  'Athletico Paranaense': [-25.448, -49.276],
  'Athletico-PR': [-25.448, -49.276], 'Coritiba': [-25.448, -49.276],
  'Bragantino': [-22.958, -46.544], 'Red Bull Bragantino': [-22.958, -46.544],

  // Brasileirão B
  'Sport Recife': [-8.059, -34.873], 'Sport': [-8.059, -34.873],
  'Goiás': [-16.687, -49.264], 'Avaí': [-27.596, -48.549],
  'Chapecoense': [-27.102, -52.616], 'Ponte Preta': [-22.909, -47.063],
  'Operário PR': [-25.414, -49.240],
};

// ─── Gramado por estádio ─────────────────────────────────────────────────────

const SYNTHETIC_TURF_TEAMS = new Set([
  // EFL Championship / League One — muitos estádios com sintético
  'Queens Park Rangers', 'QPR', 'Oldham', 'Sunderland',
  // Eredivisie
  'FC Twente', 'Twente', 'NEC', 'NEC Nijmegen', 'AZ', 'AZ Alkmaar',
  'Heracles', 'Heracles Almelo', 'Zwolle', 'PEC Zwolle', 'Almere City',
  // Portugal
  'Vitória SC', 'Vitória de Guimarães', 'Famalicão',
  // EFL Championship
  'Luton Town', 'Luton', 'Coventry City', 'Coventry',
]);

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type WeatherImpact = 'SEVERO' | 'MODERADO' | 'LEVE' | 'NEUTRO';
export type TurfType = 'natural' | 'synthetic';

export interface WeatherSnapshot {
  temperature: number;   // °C
  precipitation: number; // mm/h
  windSpeed: number;     // km/h
  humidity: number;      // %
  condition: string;     // "Chuva forte" | "Vento forte" | "Calor" | "Frio" | "Bom tempo"
}

export interface WeatherResult {
  weather: WeatherSnapshot | null;
  turf: TurfType;
  impact: WeatherImpact;
  goalsBias: number;       // ajuste esperado em gols totais (-0.5..+0.3)
  drawBias: number;        // ajuste na prob de empate (-5..+10 pontos %)
  homeBias: number;        // vantagem extra do mandante por sintético ou condição (-5..+5)
  tags: string[];          // badges para a UI
  insight: string;
  source: 'api' | 'fallback';
}

const CACHE = new Map<string, { result: WeatherResult; ts: number }>();
const TTL = 3 * 60 * 60 * 1000; // 3 horas

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findCoords(teamName: string): [number, number] | null {
  if (TEAM_COORDS[teamName]) return TEAM_COORDS[teamName];
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(teamName);
  for (const [k, v] of Object.entries(TEAM_COORDS)) {
    if (norm(k).includes(q) || q.includes(norm(k))) return v;
  }
  return null;
}

function classifyCondition(w: WeatherSnapshot): string {
  if (w.precipitation >= 5) return 'Chuva forte';
  if (w.precipitation >= 1) return 'Chuva moderada';
  if (w.windSpeed >= 50) return 'Vento forte';
  if (w.windSpeed >= 30) return 'Vento moderado';
  if (w.temperature >= 32) return 'Calor extremo';
  if (w.temperature >= 27) return 'Calor';
  if (w.temperature <= 2) return 'Frio extremo';
  if (w.temperature <= 8) return 'Frio';
  return 'Bom tempo';
}

function calcImpact(w: WeatherSnapshot, condition: string): {
  impact: WeatherImpact; goalsBias: number; drawBias: number; homeBias: number; tags: string[];
} {
  let goalsBias = 0;
  let drawBias = 0;
  let homeBias = 0;
  const tags: string[] = [];

  if (w.precipitation >= 5) {
    goalsBias -= 0.4; drawBias += 8; tags.push('🌧️ Chuva Forte');
  } else if (w.precipitation >= 1) {
    goalsBias -= 0.2; drawBias += 4; tags.push('🌦️ Chuva');
  }

  if (w.windSpeed >= 50) {
    goalsBias -= 0.3; drawBias += 5; tags.push('💨 Vento Extremo');
  } else if (w.windSpeed >= 30) {
    goalsBias -= 0.1; drawBias += 2; tags.push('💨 Vento Forte');
  }

  if (w.temperature >= 32) {
    goalsBias -= 0.25; drawBias += 4; tags.push('🔥 Calor Extremo');
  } else if (w.temperature >= 27) {
    goalsBias -= 0.1; tags.push('☀️ Calor');
  } else if (w.temperature <= 2) {
    goalsBias += 0.1; homeBias += 2; tags.push('🥶 Frio Extremo');
  } else if (w.temperature <= 8) {
    homeBias += 1; tags.push('❄️ Frio');
  }

  const severity = Math.abs(goalsBias) + Math.abs(drawBias / 10);
  const impact: WeatherImpact =
    severity >= 0.6 ? 'SEVERO' : severity >= 0.3 ? 'MODERADO' : severity > 0 ? 'LEVE' : 'NEUTRO';

  return { impact, goalsBias: parseFloat(goalsBias.toFixed(2)), drawBias: parseFloat(drawBias.toFixed(1)), homeBias, tags };
}

function buildInsight(weather: WeatherSnapshot | null, turf: TurfType, impact: WeatherImpact, tags: string[], drawBias: number, goalsBias: number): string {
  const parts: string[] = [];

  if (impact === 'SEVERO' || impact === 'MODERADO') {
    if (weather?.precipitation && weather.precipitation >= 3) {
      parts.push(`Chuva intensa prevista (${weather.precipitation.toFixed(1)}mm/h) — favorece menos gols e maior chance de empate.`);
    }
    if (weather?.windSpeed && weather.windSpeed >= 35) {
      parts.push(`Vento forte (${weather.windSpeed.toFixed(0)}km/h) — prejudica jogo aéreo e bolas longas.`);
    }
    if (weather?.temperature && weather.temperature >= 30) {
      parts.push(`Calor acima de ${weather.temperature.toFixed(0)}°C — fadiga acelera no 2º tempo, mercados de BTTS e Over favorecidos nas fases finais.`);
    }
  }

  if (turf === 'synthetic') {
    parts.push('Gramado sintético — mandante familiarizado, jogo mais rápido e técnico.');
  }

  if (parts.length === 0) return 'Condições climáticas favoráveis. Sem impacto relevante no modelo.';
  return parts.join(' ');
}

// ─── Fetch Open-Meteo ────────────────────────────────────────────────────────

async function fetchOpenMeteo(lat: number, lon: number, matchTime: Date): Promise<WeatherSnapshot | null> {
  try {
    const isoDate = matchTime.toISOString().split('T')[0];
    const hour = matchTime.getUTCHours().toString().padStart(2, '0');
    const startHour = `${isoDate}T${hour}:00`;
    // +2h para cobrir a duração da partida
    const endDate = new Date(matchTime.getTime() + 2 * 60 * 60 * 1000);
    const endHour = `${endDate.toISOString().split('T')[0]}T${endDate.getUTCHours().toString().padStart(2, '0')}:00`;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&hourly=precipitation,wind_speed_10m,temperature_2m,relative_humidity_2m`
      + `&timezone=UTC&start_hour=${startHour}&end_hour=${endHour}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();

    const hourly = data?.hourly;
    if (!hourly?.temperature_2m?.length) return null;

    // Média das horas da partida
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const temperature = parseFloat(avg(hourly.temperature_2m).toFixed(1));
    const precipitation = parseFloat(avg(hourly.precipitation).toFixed(2));
    const windSpeed = parseFloat(avg(hourly.wind_speed_10m).toFixed(1));
    const humidity = parseFloat(avg(hourly.relative_humidity_2m ?? [60]).toFixed(0));

    const snap: WeatherSnapshot = { temperature, precipitation, windSpeed, humidity, condition: '' };
    snap.condition = classifyCondition(snap);
    return snap;
  } catch {
    return null;
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

export async function getWeatherForMatch(match: Match): Promise<WeatherResult> {
  const cacheKey = match.id;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.result;

  const turf: TurfType = SYNTHETIC_TURF_TEAMS.has(match.home_team) ? 'synthetic' : 'natural';
  const matchTime = new Date(match.commence_time);
  const coords = findCoords(match.home_team);

  let weather: WeatherSnapshot | null = null;
  let source: 'api' | 'fallback' = 'fallback';

  // Só busca clima para partidas dentro de 10 dias (Open-Meteo limita previsão)
  const daysUntilMatch = (matchTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (coords && daysUntilMatch >= 0 && daysUntilMatch <= 10) {
    weather = await fetchOpenMeteo(coords[0], coords[1], matchTime);
    if (weather) source = 'api';
  }

  const impacts = weather
    ? calcImpact(weather, weather.condition)
    : { impact: 'NEUTRO' as WeatherImpact, goalsBias: 0, drawBias: 0, homeBias: 0, tags: [] };

  if (turf === 'synthetic') {
    impacts.homeBias += 3;
    impacts.tags.push('🏟️ Gramado Sintético');
  }

  const result: WeatherResult = {
    weather,
    turf,
    impact: impacts.impact,
    goalsBias: impacts.goalsBias,
    drawBias: impacts.drawBias,
    homeBias: impacts.homeBias,
    tags: impacts.tags,
    insight: buildInsight(weather, turf, impacts.impact, impacts.tags, impacts.drawBias, impacts.goalsBias),
    source,
  };

  CACHE.set(cacheKey, { result, ts: Date.now() });
  return result;
}

export function getWeatherCached(matchId: string): WeatherResult | null {
  const cached = CACHE.get(matchId);
  if (cached && Date.now() - cached.ts < TTL) return cached.result;
  return null;
}

export function formatWeatherForPrompt(result: WeatherResult): string {
  if (result.source === 'fallback' && result.turf === 'natural' && result.tags.length === 0) return '';

  const lines = ['CLIMA & GRAMADO:'];
  if (result.weather) {
    const w = result.weather;
    lines.push(`  Condição: ${w.condition} | ${w.temperature}°C | Chuva: ${w.precipitation}mm/h | Vento: ${w.windSpeed}km/h | Umidade: ${w.humidity}%`);
    lines.push(`  Impacto: ${result.impact} — gols esperados: ${result.goalsBias > 0 ? '+' : ''}${result.goalsBias} | draw bias: ${result.drawBias > 0 ? '+' : ''}${result.drawBias}%`);
  }
  lines.push(`  Gramado: ${result.turf === 'synthetic' ? 'Sintético (+vantagem mandante)' : 'Natural'}`);
  lines.push(`  Insight: ${result.insight}`);
  return lines.join('\n');
}
