// ── INTERFACES ────────────────────────────────────────
interface PrevisaoRegistrada {
  id: string;                    // matchId único
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;          // ISO date do jogo
  mercadoPrevisto: string;       // ex: "Vitória Casa"
  resultadoPrevisto: string;     // ex: "Home"
  confiancaEstimada: number;     // 0-100 ex: 65
  evEstimado: number;            // ex: 24.1
  oddUtilizada: number;          // ex: 1.85
  scoreGate: number;             // score do Gate v2.0
  status: 'PENDENTE' | 'WIN' | 'RED' | 'VOID';
  resultadoReal?: string;        // preenchido após o jogo
  acertou?: boolean | null;
  registradoEm: string;          // ISO date do registro
  resolvidoEm?: string;          // ISO date da resolução
  sportKey?: string;             // Opcional para otimização de cota
}

interface CalibracaoState {
  previsoes: PrevisaoRegistrada[];
  totalPendentes: number;
  totalResolvidos: number;
  taxaAcerto: number;            // % real de acertos
  limiaresPorFaixa: {
    faixa60a70: { total: number; acertos: number; taxa: number };
    faixa70a80: { total: number; acertos: number; taxa: number };
    faixa80a90: { total: number; acertos: number; taxa: number };
    faixa90mais: { total: number; acertos: number; taxa: number };
  };
  limiarRecomendado: number;     // calculado pelo sistema
  ultimaAtualizacao: string;
}

const STORAGE_KEY = 'evengine_calibracao';
let isOddsApiUnauthorized = false;

function cleanTeamName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(fc|afc|sc|rkc|nec|pec|cf|ac|rcd|rc|fk|az|psv|ud|cd|club|vfl|vfb|tsg|sv)\s+/gi, '')
    .replace(/\s+(fc|cf|ac|sc|e\.v\.|rcd|rc|cfr|fk|az|psv|ud|cd|club|club de futbol)$/gi, '')
    .replace(/[-\s]+/g, ' ')
    .trim();
}

function matchTeams(nameA: string, nameB: string): boolean {
  const cleanA = cleanTeamName(nameA);
  const cleanB = cleanTeamName(nameB);
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  const withCommonAbbreviations = (s: string) => {
    return s
      .replace(/\bmineiro\b/g, 'mg')
      .replace(/\bparanaense\b/g, 'pr')
      .replace(/\bgoiano\b/g, 'go')
      .replace(/\bsp\b/g, 'sao paulo')
      .replace(/\s+/g, '');
  };
  return withCommonAbbreviations(cleanA) === withCommonAbbreviations(cleanB);
}

// ── FUNÇÕES PRINCIPAIS ────────────────────────────────

// Registrar previsão quando Gate APROVA uma entrada
export function registrarPrevisao(dados: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  mercadoPrevisto: string;
  resultadoPrevisto: string;
  confiancaEstimada: number;
  evEstimado: number;
  oddUtilizada: number;
  scoreGate: number;
  sportKey?: string;
}): void {
  const state = getCalibracaoState();
  const previsao: PrevisaoRegistrada = {
    id: dados.matchId,
    ...dados,
    status: 'PENDENTE',
    registradoEm: new Date().toISOString()
  };
  state.previsoes.push(previsao);
  state.totalPendentes = state.previsoes
    .filter(p => p.status === 'PENDENTE').length;
  salvarState(state);
}

// Buscar resultado via API após jogo encerrar
export async function resolverPrevisoesPendentes(): Promise<void> {
  const state = getCalibracaoState();
  const agora = new Date();
  
  const pendentes = state.previsoes.filter(p => {
    if (p.status !== 'PENDENTE') return false;
    const jogoTime = new Date(p.commenceTime);
    // Verificar apenas jogos que começaram há pelo menos 3 horas (180 min)
    const tresHorasDepois = new Date(jogoTime.getTime() + 3 * 60 * 60 * 1000);
    return agora > tresHorasDepois;
  });

  if (pendentes.length === 0) return;

  const porLiga: Record<string, PrevisaoRegistrada[]> = {};
  for (const p of pendentes) {
    const liga = p.sportKey || 'unknown';
    if (!porLiga[liga]) porLiga[liga] = [];
    porLiga[liga].push(p);
  }

  for (const [liga, prevs] of Object.entries(porLiga)) {
    if (liga === 'unknown') continue;
    const jogos = await fetchScoresForLeague(liga);
    if (!jogos || jogos.length === 0) continue;

    for (const previsao of prevs) {
      const jogo = jogos.find((j: any) =>
        matchTeams(j.home_team, previsao.homeTeam) &&
        matchTeams(j.away_team, previsao.awayTeam) &&
        j.completed === true
      );

      if (jogo?.scores) {
        const scoreCasa = jogo.scores.find((s: any) => matchTeams(s.name, previsao.homeTeam))?.score ?? 0;
        const scoreFora = jogo.scores.find((s: any) => matchTeams(s.name, previsao.awayTeam))?.score ?? 0;
        
        const vencedor = parseInt(scoreCasa, 10) > parseInt(scoreFora, 10)
          ? 'Home'
          : parseInt(scoreFora, 10) > parseInt(scoreCasa, 10)
          ? 'Away'
          : 'Draw';

        const resultado = {
          vencedor,
          placarCasa: parseInt(scoreCasa, 10),
          placarFora: parseInt(scoreFora, 10)
        };

        previsao.resultadoReal = resultado.vencedor;
        const acerto = avaliarAcerto(
          previsao.resultadoPrevisto,
          resultado,
          previsao.mercadoPrevisto
        );
        previsao.acertou = acerto;
        previsao.status = acerto === null ? 'VOID' : (acerto ? 'WIN' : 'RED');
        previsao.resolvidoEm = new Date().toISOString();
      }
    }
  }

  recalibrarLimiares(state);
  salvarState(state);
}

// Buscar resultado na The Odds API (scores endpoint)
async function fetchScoresForLeague(liga: string): Promise<any[]> {
  if (isOddsApiUnauthorized) {
    return [];
  }

  const oddsApiKey = import.meta.env.VITE_ODDS_API_KEY || (typeof process !== 'undefined' ? process.env.VITE_ODDS_API_KEY : '');
  if (!oddsApiKey || oddsApiKey.trim() === '' || oddsApiKey === 'YOUR_ODDS_API_KEY') {
    console.warn('Odds API Key não configurada ou vazia. Ignorando consulta automática.');
    return [];
  }

  // Gate 1: Obter ligas monitoradas do localStorage
  let selectedLeagues: string[] = [];
  try {
    const saved = localStorage.getItem('evengine_selected_leagues');
    if (saved) {
      selectedLeagues = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Erro ao ler evengine_selected_leagues:', e);
  }

  // Filtrar apenas ligas monitoradas (Gate 1)
  if (liga !== 'unknown' && !selectedLeagues.includes(liga)) {
    return []; // Skip total (zero req)
  }

  const SCORES_CACHE_TTL = 30 * 60 * 1000; // 30 minutos
  const cacheKey = `scores_cache_${liga}`;
  const cached = sessionStorage.getItem(cacheKey);
  
  // Gate 2: Usar cache válido se disponível (zero req)
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < SCORES_CACHE_TTL) {
        return data;
      }
    } catch {}
  }

  // Gate 3: Consumir cota da API apenas se não houver cache
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${liga}/scores/?apiKey=${oddsApiKey}&daysFrom=3`;
    const res = await fetch(url);
    
    if (res.status === 401) {
      console.warn(`Chave do Odds API não autorizada (${res.status}). Interrompendo chamadas subsequentes.`);
      isOddsApiUnauthorized = true;
      return [];
    }
    if (res.status === 429) {
      console.warn(`Limite de requisições atingido na Odds API (429). Interrompendo consulta.`);
      return [];
    }

    if (!res.ok) return [];
    
    const jogos = await res.json();
    
    if (Array.isArray(jogos) && jogos.length > 0) {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        data: jogos,
        timestamp: Date.now()
      }));
    }
    return jogos;
  } catch (e) {
    console.error('Erro ao buscar scores para liga:', liga, e);
    return [];
  }
}

// Avaliar se previsão acertou baseado no mercado
function avaliarAcerto(
  resultadoPrevisto: string,
  resultado: { vencedor: string; placarCasa: number; placarFora: number; status?: string },
  mercado: string
): boolean | null {
  if (resultado.status === 'VOID') return null;
  const totalGols = resultado.placarCasa + resultado.placarFora;
  
  switch (mercado) {
    case 'Vitória Casa':
      return resultado.vencedor === 'Home';
    case 'Vitória Fora':
      return resultado.vencedor === 'Away';
    case 'Empate':
      return resultado.vencedor === 'Draw';
    case 'Dupla Chance 1X':
      return resultado.vencedor === 'Home' || resultado.vencedor === 'Draw';
    case 'Dupla Chance X2':
      return resultado.vencedor === 'Away' || resultado.vencedor === 'Draw';
    case 'Dupla Chance 12':
      return resultado.vencedor === 'Home' || resultado.vencedor === 'Away';
    case 'Mais de 1.5 Gols':
      return totalGols > 1;
    case 'Mais de 2.5 Gols':
      return totalGols > 2;
    case 'Mais de 3.5 Gols':
      return totalGols > 3;
    case 'BTTS':
    case 'Ambas Marcam':
      return resultado.placarCasa > 0 && resultado.placarFora > 0;
    default:
      return false;
  }
}

// Recalibrar limiares baseado no histórico real
function recalibrarLimiares(state: CalibracaoState): void {
  const resolvidos = state.previsoes
    .filter(p => p.status === 'WIN' || p.status === 'RED' || p.status === 'VOID');

  if (resolvidos.length === 0) return;

  const resolvidos_validos = resolvidos.filter(p => p.status !== 'VOID');

  // Calcular taxa por faixa de confiança
  const faixas = {
    faixa60a70: resolvidos_validos.filter(p =>
      p.confiancaEstimada >= 60 && p.confiancaEstimada < 70),
    faixa70a80: resolvidos_validos.filter(p =>
      p.confiancaEstimada >= 70 && p.confiancaEstimada < 80),
    faixa80a90: resolvidos_validos.filter(p =>
      p.confiancaEstimada >= 80 && p.confiancaEstimada < 90),
    faixa90mais: resolvidos_validos.filter(p =>
      p.confiancaEstimada >= 90),
  };

  state.limiaresPorFaixa = {
    faixa60a70: calcularFaixa(faixas.faixa60a70),
    faixa70a80: calcularFaixa(faixas.faixa70a80),
    faixa80a90: calcularFaixa(faixas.faixa80a90),
    faixa90mais: calcularFaixa(faixas.faixa90mais),
  };

  // Taxa geral
  const totalAcertos = resolvidos_validos.filter(p => p.acertou).length;
  state.taxaAcerto = resolvidos_validos.length > 0 ? parseFloat(
    ((totalAcertos / resolvidos_validos.length) * 100).toFixed(1)
  ) : 0;
  state.totalResolvidos = resolvidos.length;

  // Yield calculado com stake uniforme de 1 unidade por aposta.
  // Usar scoreGate como stake distorcia o cálculo: um jogo com score 80
  // teria 80x o peso de um com score 1, tornando o yield inútil como métrica.
  const calcularYieldFaixa = (prevs: PrevisaoRegistrada[]) => {
    const totalStake = prevs.length; // 1 unidade por aposta
    if (totalStake === 0) return -100;
    let totalProfit = 0;
    prevs.forEach(p => {
      if (p.status === 'WIN') {
        totalProfit += p.oddUtilizada - 1;
      } else if (p.status === 'RED') {
        totalProfit -= 1;
      }
    });
    return (totalProfit / totalStake) * 100;
  };

  const yield60a70 = calcularYieldFaixa(faixas.faixa60a70);
  const yield70a80 = calcularYieldFaixa(faixas.faixa70a80);
  const yield80a90 = calcularYieldFaixa(faixas.faixa80a90);

  // Mínimo de 30 amostras antes de recomendar limiar mais baixo — 10 era
  // insuficiente para significância estatística (IC 95% exige ~30+).
  if (yield60a70 >= 0 && faixas.faixa60a70.length >= 30) {
    state.limiarRecomendado = 60;
  } else if (yield70a80 >= 0 && faixas.faixa70a80.length >= 30) {
    state.limiarRecomendado = 70;
  } else if (yield80a90 >= 0 && faixas.faixa80a90.length >= 15) {
    state.limiarRecomendado = 80;
  } else {
    state.limiarRecomendado = 65; // padrão conservador até amostra suficiente
  }

  state.ultimaAtualizacao = new Date().toISOString();
}

function calcularFaixa(previsoes: PrevisaoRegistrada[]) {
  const total = previsoes.length;
  const acertos = previsoes.filter(p => p.acertou).length;
  return {
    total,
    acertos,
    taxa: total > 0
      ? parseFloat(((acertos / total) * 100).toFixed(1))
      : 0
  };
}

function getCalibracaoState(): CalibracaoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    previsoes: [],
    totalPendentes: 0,
    totalResolvidos: 0,
    taxaAcerto: 0,
    limiaresPorFaixa: {
      faixa60a70: { total: 0, acertos: 0, taxa: 0 },
      faixa70a80: { total: 0, acertos: 0, taxa: 0 },
      faixa80a90: { total: 0, acertos: 0, taxa: 0 },
      faixa90mais: { total: 0, acertos: 0, taxa: 0 },
    },
    limiarRecomendado: 65,
    ultimaAtualizacao: new Date().toISOString()
  };
}

function salvarState(state: CalibracaoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getCalibracaoStats() {
  return getCalibracaoState();
}

export function getLimiarRecomendado(): number {
  return getCalibracaoState().limiarRecomendado;
}

export function registrarResultadoManual(dados: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  liga: string;
  commenceTime: string;
  mercadoPrevisto: string;
  resultadoPrevisto: string;
  confiancaEstimada: number;
  evEstimado: number;
  oddUtilizada: number;
  scoreGate: number;
  placarCasa: number;
  placarFora: number;
  resultado: 'WIN' | 'RED' | 'VOID';
}): void {
  const state = getCalibracaoState();

  // Verificar se já existe
  const existente = state.previsoes.find(p => p.id === dados.matchId);

  if (existente) {
    // Atualizar existente
    existente.status = dados.resultado;
    existente.acertou = dados.resultado === 'WIN' ? true : (dados.resultado === 'RED' ? false : null);
    existente.resolvidoEm = new Date().toISOString();
    existente.resultadoReal = `${dados.placarCasa}-${dados.placarFora}`;
  } else {
    // Criar novo registro
    const previsao = {
      id: dados.matchId,
      homeTeam: dados.homeTeam,
      awayTeam: dados.awayTeam,
      commenceTime: dados.commenceTime,
      mercadoPrevisto: dados.mercadoPrevisto,
      resultadoPrevisto: dados.resultadoPrevisto,
      confiancaEstimada: dados.confiancaEstimada,
      evEstimado: dados.evEstimado,
      oddUtilizada: dados.oddUtilizada,
      scoreGate: dados.scoreGate,
      status: dados.resultado,
      acertou: dados.resultado === 'WIN' ? true : (dados.resultado === 'RED' ? false : null),
      registradoEm: new Date().toISOString(),
      resolvidoEm: new Date().toISOString(),
      resultadoReal: `${dados.placarCasa}-${dados.placarFora}`
      // lucro removido: não está na interface PrevisaoRegistrada e o cálculo
      // usava scoreGate como stake (score 0-100 não é monetário).
    };
    state.previsoes.push(previsao as PrevisaoRegistrada);
  }

  state.totalResolvidos = state.previsoes
    .filter(p => p.status !== 'PENDENTE').length;

  recalibrarLimiares(state);
  salvarState(state);

  console.log('Resultado registrado:', dados.homeTeam, 'vs',
    dados.awayTeam, '→', dados.resultado);
}
