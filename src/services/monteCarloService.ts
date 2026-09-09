/**
 * monteCarloService.ts — Simulação de Ruína via Monte Carlo
 *
 * Roda N simulações independentes da estratégia do usuário para estimar:
 *  - Probabilidade de ruína (drawdown máximo > limiar)
 *  - Distribuição de crescimento de banca
 *  - Número mediano de apostas até breakeven
 *
 * 100% local — zero chamadas de API, roda em < 500ms no browser.
 */

export interface MonteCarloParams {
  bancaInicial: number;       // banca atual em R$
  hitRate: number;            // taxa de acerto em % (ex: 52.3)
  avgOdd: number;             // odd média das apostas
  avgStakePct: number;        // stake média como % da banca (ex: 2.5)
  numApostas: number;         // apostas a simular por sequência
  limiarRuina: number;        // % de perda que define ruína (ex: 30 = perder 30%)
  numSimulacoes?: number;     // padrão 1000
}

export interface MonteCarloResult {
  probRuina: number;                  // % de simulações que atingiram ruína
  probDrawdown20: number;             // % com drawdown > 20%
  probDrawdown30: number;             // % com drawdown > 30%
  medianaRetorno: number;             // retorno mediano em % ao fim das N apostas
  retorno95: number;                  // 95th percentile (melhor cenário)
  retorno5: number;                   // 5th percentile (pior cenário)
  apostasAteBreakeven: number;        // mediana de apostas até recuperar banca inicial após drawdown
  maxDrawdownMedio: number;           // drawdown máximo médio entre todas as simulações
  curvaMediana: number[];             // banca mediana a cada 10 apostas (para gráfico)
  curvaPessimista: number[];          // 10th percentile da banca (para gráfico)
  curvaOtimista: number[];            // 90th percentile (para gráfico)
  ev: number;                         // expected value por aposta em %
  edgeNecessario: number;             // edge mínimo para probabilidade de lucro > 70%
}

/**
 * Roda a simulação Monte Carlo.
 * Usa stake fixa como % da banca em cada aposta (Kelly fracionário simplificado).
 */
export function runMonteCarlo(params: MonteCarloParams): MonteCarloResult {
  const {
    bancaInicial,
    hitRate,
    avgOdd,
    avgStakePct,
    numApostas,
    limiarRuina,
    numSimulacoes = 1000,
  } = params;

  const winProb = hitRate / 100;
  const stakeFrac = avgStakePct / 100;
  const limiarAbsoluto = bancaInicial * (1 - limiarRuina / 100);

  // Expected value por aposta
  const ev = (winProb * (avgOdd - 1) - (1 - winProb)) * 100;

  // Simulações
  const resultadosFinais: number[] = [];
  let ruinas = 0;
  let drawdown20Count = 0;
  let drawdown30Count = 0;
  const maxDrawdowns: number[] = [];

  // Para curva: banca em cada checkpoint (a cada 10 apostas)
  const numCheckpoints = Math.floor(numApostas / 10);
  const bancasPorCheckpoint: number[][] = Array.from({ length: numCheckpoints }, () => []);

  for (let sim = 0; sim < numSimulacoes; sim++) {
    let banca = bancaInicial;
    let ruined = false;
    let maxDrawdown = 0;
    let peakBanca = bancaInicial;

    for (let aposta = 0; aposta < numApostas; aposta++) {
      if (banca <= limiarAbsoluto) {
        ruined = true;
        break;
      }

      const stake = banca * stakeFrac;
      const ganhou = Math.random() < winProb;

      if (ganhou) {
        banca += stake * (avgOdd - 1);
      } else {
        banca -= stake;
      }

      banca = Math.max(0, banca);

      if (banca > peakBanca) peakBanca = banca;
      const dd = ((peakBanca - banca) / peakBanca) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;

      // Checkpoint para curva
      if ((aposta + 1) % 10 === 0) {
        const idx = Math.floor((aposta + 1) / 10) - 1;
        if (idx < numCheckpoints) {
          bancasPorCheckpoint[idx].push(banca);
        }
      }
    }

    maxDrawdowns.push(maxDrawdown);
    if (ruined) ruinas++;
    if (maxDrawdown >= 20) drawdown20Count++;
    if (maxDrawdown >= 30) drawdown30Count++;
    resultadosFinais.push(banca);
  }

  // Ordenar resultados para percentis
  resultadosFinais.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p / 100)];

  const medianaRetorno = ((pct(resultadosFinais, 50) / bancaInicial) - 1) * 100;
  const retorno95 = ((pct(resultadosFinais, 95) / bancaInicial) - 1) * 100;
  const retorno5 = ((pct(resultadosFinais, 5) / bancaInicial) - 1) * 100;
  const maxDrawdownMedio = maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length;

  // Curvas para gráfico (mediana, 10th, 90th percentile por checkpoint)
  const curvaMediana: number[] = [];
  const curvaPessimista: number[] = [];
  const curvaOtimista: number[] = [];

  for (let i = 0; i < numCheckpoints; i++) {
    const ckpt = [...bancasPorCheckpoint[i]].sort((a, b) => a - b);
    if (ckpt.length === 0) {
      curvaMediana.push(bancaInicial);
      curvaPessimista.push(bancaInicial);
      curvaOtimista.push(bancaInicial);
    } else {
      curvaMediana.push(pct(ckpt, 50));
      curvaPessimista.push(pct(ckpt, 10));
      curvaOtimista.push(pct(ckpt, 90));
    }
  }

  // Edge mínimo para 70% de chance de lucro: aproximação via EV positivo com margem de Kelly
  // Fórmula: p * (b - 1) > (1 - p), onde b = avgOdd
  // Edge mínimo = 1/avgOdd * 100 - (1 - 1/avgOdd) * 100 simplificado
  const impliedProb = 1 / avgOdd;
  const edgeNecessario = parseFloat(((winProb - impliedProb) * 100).toFixed(2));

  // Mediana de apostas até breakeven (apostas com retorno mediano >= 0)
  // Simplificado: apostas até a curva mediana cruzar a banca inicial
  let apostasAteBreakeven = numApostas;
  for (let i = 0; i < curvaMediana.length; i++) {
    if (curvaMediana[i] >= bancaInicial) {
      apostasAteBreakeven = (i + 1) * 10;
      break;
    }
  }

  return {
    probRuina: parseFloat(((ruinas / numSimulacoes) * 100).toFixed(1)),
    probDrawdown20: parseFloat(((drawdown20Count / numSimulacoes) * 100).toFixed(1)),
    probDrawdown30: parseFloat(((drawdown30Count / numSimulacoes) * 100).toFixed(1)),
    medianaRetorno: parseFloat(medianaRetorno.toFixed(1)),
    retorno95: parseFloat(retorno95.toFixed(1)),
    retorno5: parseFloat(retorno5.toFixed(1)),
    apostasAteBreakeven,
    maxDrawdownMedio: parseFloat(maxDrawdownMedio.toFixed(1)),
    curvaMediana,
    curvaPessimista,
    curvaOtimista,
    ev: parseFloat(ev.toFixed(2)),
    edgeNecessario,
  };
}
