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
  acertou?: boolean;
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
const ODDS_API_KEY = import.meta.env.VITE_ODDS_API_KEY;
let isOddsApiUnauthorized = false;

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
    // Aguarda 3h: 90min de jogo + prorrogação/pênaltis + margem de segurança.
    // 2h era insuficiente para jogos com tempo extra.
    const tresHorasDepois = new Date(
      jogoTime.getTime() + 3 * 60 * 60 * 1000
    );
    return agora > tresHorasDepois;
  });

  for (const previsao of pendentes) {
    try {
      const resultado = await buscarResultadoAPI(
        previsao.homeTeam,
        previsao.awayTeam,
        previsao.commenceTime,
        previsao.sportKey
      );
      
      if (resultado) {
        previsao.resultadoReal = resultado.vencedor;
        previsao.acertou = avaliarAcerto(
          previsao.resultadoPrevisto,
          resultado,
          previsao.mercadoPrevisto
        );
        previsao.status = previsao.acertou ? 'WIN' : 'RED';
        previsao.resolvidoEm = new Date().toISOString();
      }
    } catch (e) {
      console.error('Erro ao resolver previsão:', previsao.id, e);
    }
  }

  recalibrarLimiares(state);
  salvarState(state);
}

// Buscar resultado na The Odds API (scores endpoint)
async function buscarResultadoAPI(
  homeTeam: string,
  awayTeam: string,
  commenceTime: string,
  sportKey?: string
): Promise<{ vencedor: string; placarCasa: number; placarFora: number } | null> {
  
  if (isOddsApiUnauthorized) {
    return null;
  }

  if (!ODDS_API_KEY || ODDS_API_KEY.trim() === '' || ODDS_API_KEY === 'YOUR_ODDS_API_KEY') {
    console.warn('Odds API Key não configurada ou vazia. Ignorando consulta automática.');
    isOddsApiUnauthorized = true;
    return null;
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

  // Se sportKey for fornecido, limitamos a busca apenas a essa liga para economizar quota
  const defaultLigas = sportKey ? [sportKey] : [
    'soccer_epl', 'soccer_italy_serie_a', 'soccer_spain_la_liga',
    'soccer_germany_bundesliga', 'soccer_france_ligue_one',
    'soccer_brazil_campeonato', 'soccer_uefa_champs_league',
    'soccer_conmebol_copa_sudamericana'
  ];

  // Filtrar apenas ligas monitoradas (Gate 1)
  const ligas = defaultLigas.filter(l => selectedLeagues.includes(l));
  if (ligas.length === 0) {
    return null; // Skip total (zero req)
  }

  const SCORES_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

  for (const liga of ligas) {
    try {
      const cacheKey = `scores_cache_${liga}`;
      const cached = sessionStorage.getItem(cacheKey);
      let jogos = [];
      
      // Gate 2: Usar cache válido se disponível (zero req)
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < SCORES_CACHE_TTL) {
            jogos = data;
          }
        } catch {}
      }

      // Gate 3: Consumir cota da API apenas se não houver cache
      if (jogos.length === 0) {
        const url = `https://api.the-odds-api.com/v4/sports/${liga}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
        const res = await fetch(url);
        
        if (res.status === 401 || res.status === 429) {
          console.warn(`Chave do Odds API não autorizada ou sem cota (${res.status}). Interrompendo chamadas subsequentes.`);
          isOddsApiUnauthorized = true;
          break;
        }

        if (!res.ok) continue;
        
        jogos = await res.json();
        
        if (Array.isArray(jogos) && jogos.length > 0) {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            data: jogos,
            timestamp: Date.now()
          }));
        }
      }
      
      const jogo = jogos.find((j: any) =>
        j.home_team === homeTeam &&
        j.away_team === awayTeam &&
        j.completed === true
      );

      if (jogo?.scores) {
        const scoreCasa = jogo.scores.find(
          (s: any) => s.name === homeTeam
        )?.score ?? 0;
        const scoreFora = jogo.scores.find(
          (s: any) => s.name === awayTeam
        )?.score ?? 0;
        
        const vencedor = parseInt(scoreCasa, 10) > parseInt(scoreFora, 10)
          ? 'Home'
          : parseInt(scoreFora, 10) > parseInt(scoreCasa, 10)
          ? 'Away'
          : 'Draw';

        return {
          vencedor,
          placarCasa: parseInt(scoreCasa, 10),
          placarFora: parseInt(scoreFora, 10)
        };
      }
    } catch { continue; }
  }
  return null;
}

// Avaliar se previsão acertou baseado no mercado
function avaliarAcerto(
  resultadoPrevisto: string,
  resultado: { vencedor: string; placarCasa: number; placarFora: number },
  mercado: string
): boolean {
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
    default:
      return false;
  }
}

// Recalibrar limiares baseado no histórico real
function recalibrarLimiares(state: CalibracaoState): void {
  const resolvidos = state.previsoes
    .filter(p => p.status === 'WIN' || p.status === 'RED');

  if (resolvidos.length === 0) return;

  // Calcular taxa por faixa de confiança
  const faixas = {
    faixa60a70: resolvidos.filter(p =>
      p.confiancaEstimada >= 60 && p.confiancaEstimada < 70),
    faixa70a80: resolvidos.filter(p =>
      p.confiancaEstimada >= 70 && p.confiancaEstimada < 80),
    faixa80a90: resolvidos.filter(p =>
      p.confiancaEstimada >= 80 && p.confiancaEstimada < 90),
    faixa90mais: resolvidos.filter(p =>
      p.confiancaEstimada >= 90),
  };

  state.limiaresPorFaixa = {
    faixa60a70: calcularFaixa(faixas.faixa60a70),
    faixa70a80: calcularFaixa(faixas.faixa70a80),
    faixa80a90: calcularFaixa(faixas.faixa80a90),
    faixa90mais: calcularFaixa(faixas.faixa90mais),
  };

  // Taxa geral
  const totalAcertos = resolvidos.filter(p => p.acertou).length;
  state.taxaAcerto = parseFloat(
    ((totalAcertos / resolvidos.length) * 100).toFixed(1)
  );
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
    existente.acertou = dados.resultado === 'WIN';
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
      acertou: dados.resultado === 'WIN',
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
