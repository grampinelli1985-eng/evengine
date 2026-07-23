import { registrarResultadoDiario, registrarResultado, registrarEntradaAprovada } from './bancaService';

interface RegistroAposta {
  id: string;
  data: string;
  homeTeam: string;
  awayTeam: string;
  liga: string;
  mercado: string;
  odd: number;
  stake: number;
  resultado: 'WIN' | 'RED' | 'VOID' | 'PENDENTE';
  lucro: number;
  bancaAntes: number;
  bancaDepois: number;
  gateScore: number;
  confianca: number;
  ev: number;
}

interface HistoricoState {
  registros: RegistroAposta[];
  totalApostas: number;
  totalWins: number;
  totalReds: number;
  lucroTotal: number;
  roiTotal: number;
  bancaInicial: number;
  bancaAtual: number;
  maiorSerie: { tipo: 'WIN' | 'RED'; quantidade: number };
  melhorAposta: RegistroAposta | null;
  piorAposta: RegistroAposta | null;
}

const STORAGE_KEY = 'evengine_historico';

export function registrarAposta(dados: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  liga: string;
  mercado: string;
  odd: number;
  stake: number;
  gateScore: number;
  confianca: number;
  ev: number;
  bancaAtual: number;
}): string {
  const state = getHistoricoState();
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${dados.matchId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  const registro: RegistroAposta = {
    id,
    data: new Date().toISOString(),
    homeTeam: dados.homeTeam,
    awayTeam: dados.awayTeam,
    liga: dados.liga,
    mercado: dados.mercado,
    odd: dados.odd,
    stake: dados.stake,
    resultado: 'PENDENTE',
    lucro: 0,
    bancaAntes: dados.bancaAtual,
    bancaDepois: dados.bancaAtual,
    gateScore: dados.gateScore,
    confianca: dados.confianca,
    ev: dados.ev
  };

  state.registros.push(registro);
  salvarState(state);
  registrarEntradaAprovada(); // NOVO — conta para o limite de 3/dia
  return id;
}

export function resolverAposta(
  id: string,
  resultado: 'WIN' | 'RED' | 'VOID',
  bancaAtual: number
): void {
  const state = getHistoricoState();
  const reg = state.registros.find(r => r.id === id);
  if (!reg) return;

  reg.resultado = resultado;
  reg.bancaDepois = bancaAtual;

  if (resultado === 'WIN') {
    reg.lucro = parseFloat(
      (reg.stake * (reg.odd - 1)).toFixed(2)
    );
  } else if (resultado === 'RED') {
    reg.lucro = -reg.stake;
  } else {
    reg.lucro = 0;
  }

  // NOVO — conecta ao bancaService, mesmo mapeamento de status usado em betService.resolveBet
  const statusBanca = resultado === 'WIN' ? 'green' : resultado === 'RED' ? 'red' : 'void';
  registrarResultadoDiario(reg.lucro);
  registrarResultado({ resultado: statusBanca });

  recalcularStats(state);
  salvarState(state);
}

function recalcularStats(state: HistoricoState): void {
  const resolvidos = state.registros.filter(
    r => r.resultado !== 'PENDENTE'
  );
  const resolvidos_validos = resolvidos.filter(r => r.resultado !== 'VOID');
  
  state.totalApostas = resolvidos_validos.length;
  state.totalWins = resolvidos.filter(r => r.resultado === 'WIN').length;
  state.totalReds = resolvidos.filter(r => r.resultado === 'RED').length;
  state.lucroTotal = parseFloat(
    resolvidos.reduce((a, r) => a + r.lucro, 0).toFixed(2)
  );
  
  const totalInvestido = resolvidos_validos.reduce((a, r) => a + r.stake, 0);
  state.roiTotal = totalInvestido > 0
    ? parseFloat(((state.lucroTotal / totalInvestido) * 100).toFixed(1))
    : 0;

  // Maior série
  let serieAtual = { tipo: resolvidos_validos[0]?.resultado as 'WIN'|'RED', qtd: 0 };
  let maiorSerie = { tipo: 'WIN' as 'WIN'|'RED', quantidade: 0 };
  resolvidos_validos.forEach(r => {
    if (r.resultado === serieAtual.tipo) {
      serieAtual.qtd++;
      if (serieAtual.qtd > maiorSerie.quantidade) {
        maiorSerie = { tipo: serieAtual.tipo, quantidade: serieAtual.qtd };
      }
    } else {
      serieAtual = { tipo: r.resultado as 'WIN'|'RED', qtd: 1 };
    }
  });
  state.maiorSerie = maiorSerie;

  // Melhor e pior aposta
  state.melhorAposta = resolvidos.reduce(
    (best, r) => (!best || r.lucro > best.lucro) ? r : best,
    null as RegistroAposta | null
  );
  state.piorAposta = resolvidos.reduce(
    (worst, r) => (!worst || r.lucro < worst.lucro) ? r : worst,
    null as RegistroAposta | null
  );
}

function getHistoricoState(): HistoricoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    registros: [], totalApostas: 0, totalWins: 0,
    totalReds: 0, lucroTotal: 0, roiTotal: 0,
    bancaInicial: 1000, bancaAtual: 1000,
    maiorSerie: { tipo: 'WIN', quantidade: 0 },
    melhorAposta: null, piorAposta: null
  };
}

function salvarState(state: HistoricoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getHistoricoStats() {
  return getHistoricoState();
}

export function getRegistrosPendentes() {
  return getHistoricoState().registros
    .filter(r => r.resultado === 'PENDENTE');
}
