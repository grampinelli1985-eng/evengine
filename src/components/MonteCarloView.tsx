/**
 * MonteCarloView.tsx — Simulação de Ruína via Monte Carlo
 * Mostra ao usuário a probabilidade de falência e a distribuição de retorno
 * baseada no histórico real de apostas.
 */

import { useState, useCallback, useEffect } from 'react';
import { Dices, ShieldAlert, TrendingUp, TrendingDown, RefreshCw, Info, AlertTriangle } from 'lucide-react';
import { runMonteCarlo, MonteCarloResult, MonteCarloParams } from '../services/monteCarloService';
import { Bet, fetchBets } from '../services/betService';

interface MonteCarloViewProps {
  bancaAtual: number;
  plan: string;
  bets?: Bet[];
}

function calcDefaultParams(bets: Bet[], bancaAtual: number): Omit<MonteCarloParams, 'numApostas' | 'limiarRuina'> {
  const resolved = bets.filter(b => b.status !== 'pending' && b.status !== 'void');
  if (resolved.length < 5) {
    return { bancaInicial: bancaAtual || 1000, hitRate: 52, avgOdd: 1.85, avgStakePct: 2.5 };
  }
  const wins = resolved.filter(b => b.status === 'green').length;
  const hitRate = (wins / resolved.length) * 100;
  const avgOdd = resolved.reduce((s, b) => s + b.odd_taken, 0) / resolved.length;
  const avgStake = resolved.reduce((s, b) => s + b.stake_amount, 0) / resolved.length;
  const avgStakePct = bancaAtual > 0 ? (avgStake / bancaAtual) * 100 : 2.5;
  return {
    bancaInicial: bancaAtual || 1000,
    hitRate: parseFloat(hitRate.toFixed(1)),
    avgOdd: parseFloat(avgOdd.toFixed(2)),
    avgStakePct: parseFloat(Math.min(avgStakePct, 10).toFixed(2)),
  };
}

function RiskBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const isLow = value <= thresholds[0];
  const isHigh = value > thresholds[1];
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
      isLow ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
      isHigh ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
      'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
    }`}>
      {isLow ? 'Baixo' : isHigh ? 'Alto' : 'Médio'}
    </span>
  );
}

function MiniChart({ mediana, pessimista, otimista, banca }: {
  mediana: number[];
  pessimista: number[];
  otimista: number[];
  banca: number;
}) {
  if (mediana.length === 0) return null;
  const allVals = [...mediana, ...pessimista, ...otimista, banca];
  const minV = Math.min(...allVals) * 0.95;
  const maxV = Math.max(...allVals) * 1.05;
  const range = maxV - minV || 1;
  const W = 560;
  const H = 120;
  const pts = mediana.length;
  const toX = (i: number) => (i / (pts - 1)) * W;
  const toY = (v: number) => H - ((v - minV) / range) * H;
  const pathD = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const baselineY = toY(banca);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }}>
      {/* Baseline */}
      <line x1="0" y1={baselineY} x2={W} y2={baselineY} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" strokeWidth="1" />
      {/* Faixa pessimista–otimista */}
      <path
        d={`${pathD(otimista)} L${toX(pts - 1).toFixed(1)},${toY(pessimista[pts - 1]).toFixed(1)} ${[...pessimista].reverse().map((v, i) => `L${toX(pts - 1 - i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')} Z`}
        fill="rgba(59,130,246,0.08)"
      />
      {/* Linha pessimista */}
      <path d={pathD(pessimista)} fill="none" stroke="rgba(239,68,68,0.5)" strokeWidth="1" strokeDasharray="3 3" />
      {/* Linha otimista */}
      <path d={pathD(otimista)} fill="none" stroke="rgba(34,197,94,0.5)" strokeWidth="1" strokeDasharray="3 3" />
      {/* Linha mediana */}
      <path d={pathD(mediana)} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {/* Ponto final mediana */}
      <circle cx={toX(pts - 1)} cy={toY(mediana[pts - 1])} r="3" fill="#3b82f6" />
    </svg>
  );
}

export default function MonteCarloView({ bets: propBets, bancaAtual, plan }: MonteCarloViewProps) {
  const [loadedBets, setLoadedBets] = useState<Bet[]>(propBets ?? []);

  useEffect(() => {
    if (!propBets) {
      fetchBets({}).then(all => setLoadedBets(all)).catch(() => {});
    }
  }, [propBets]);

  const bets = propBets ?? loadedBets;
  const defaults = calcDefaultParams(bets, bancaAtual);
  const hasHistory = bets.filter(b => b.status !== 'pending' && b.status !== 'void').length >= 5;

  const [hitRate, setHitRate] = useState(defaults.hitRate);
  const [avgOdd, setAvgOdd] = useState(defaults.avgOdd);
  const [avgStakePct, setAvgStakePct] = useState(defaults.avgStakePct);
  const [numApostas, setNumApostas] = useState(200);
  const [limiarRuina, setLimiarRuina] = useState(30);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MonteCarloResult | null>(null);

  const runSim = useCallback(() => {
    setRunning(true);
    // setTimeout para liberar o render antes do cálculo pesado
    setTimeout(() => {
      const res = runMonteCarlo({
        bancaInicial: bancaAtual || 1000,
        hitRate,
        avgOdd,
        avgStakePct,
        numApostas,
        limiarRuina,
        numSimulacoes: 1000,
      });
      setResult(res);
      setRunning(false);
    }, 50);
  }, [bancaAtual, hitRate, avgOdd, avgStakePct, numApostas, limiarRuina]);

  const isSharp = plan === 'pro' || plan === 'sharp';

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-purple-600/20 border border-purple-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
          <Dices size={20} className="text-purple-400" />
        </div>
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest text-white">Simulação de Ruína</h2>
          <p className="text-xs text-white/40 mt-0.5">Monte Carlo · 1.000 sequências simuladas</p>
        </div>
      </div>

      {!isSharp && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0" />
          <p className="text-xs text-yellow-300/80">Disponível nos planos Pro e Sharp. Você pode explorar a ferramenta com parâmetros manuais.</p>
        </div>
      )}

      {hasHistory && isSharp && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <Info size={14} className="text-blue-400 flex-shrink-0" />
          <p className="text-xs text-blue-300/80">Parâmetros calculados automaticamente do seu histórico de {bets.filter(b => b.status !== 'pending').length} apostas resolvidas.</p>
        </div>
      )}

      {/* Parâmetros */}
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6">
        <h3 className="text-xs font-black uppercase tracking-widest text-white/50 mb-5">Parâmetros da Simulação</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">Taxa de Acerto (%)</label>
            <input
              type="number"
              min={10} max={90} step={0.5}
              value={hitRate}
              onChange={e => setHitRate(parseFloat(e.target.value) || 52)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">Odd Média</label>
            <input
              type="number"
              min={1.1} max={10} step={0.05}
              value={avgOdd}
              onChange={e => setAvgOdd(parseFloat(e.target.value) || 1.85)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">Stake Média (% banca)</label>
            <input
              type="number"
              min={0.5} max={10} step={0.5}
              value={avgStakePct}
              onChange={e => setAvgStakePct(parseFloat(e.target.value) || 2.5)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">Apostas a Simular</label>
            <select
              value={numApostas}
              onChange={e => setNumApostas(parseInt(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              {[100, 200, 500, 1000].map(n => <option key={n} value={n}>{n} apostas</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">Limiar de Ruína (%)</label>
            <select
              value={limiarRuina}
              onChange={e => setLimiarRuina(parseInt(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              {[20, 30, 40, 50].map(n => <option key={n} value={n}>Perder {n}% da banca</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={runSim}
              disabled={running}
              className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900/40 text-white rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
            >
              {running ? <RefreshCw size={13} className="animate-spin" /> : <Dices size={13} />}
              {running ? 'Simulando...' : 'Simular'}
            </button>
          </div>
        </div>
      </div>

      {/* Resultados */}
      {result && (
        <div className="space-y-4">
          {/* EV indicator */}
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${result.ev >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
            {result.ev >= 0
              ? <TrendingUp size={16} className="text-green-400 flex-shrink-0" />
              : <TrendingDown size={16} className="text-red-400 flex-shrink-0" />}
            <div>
              <span className={`text-xs font-black ${result.ev >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                EV por aposta: {result.ev >= 0 ? '+' : ''}{result.ev}%
              </span>
              <span className="text-xs text-white/40 ml-3">
                Edge sobre o mercado: {result.edgeNecessario >= 0 ? '+' : ''}{result.edgeNecessario}%
              </span>
            </div>
          </div>

          {/* Cards de risco */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <ShieldAlert size={14} className={result.probRuina <= 5 ? 'text-green-400' : result.probRuina <= 15 ? 'text-yellow-400' : 'text-red-400'} />
                <RiskBadge value={result.probRuina} thresholds={[5, 15]} />
              </div>
              <div className="text-2xl font-black text-white font-mono">{result.probRuina}%</div>
              <div className="text-[10px] text-white/40 mt-0.5 uppercase tracking-wider">Risco de Ruína</div>
              <div className="text-[9px] text-white/20 mt-1">Perder &gt;{limiarRuina}% da banca</div>
            </div>

            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <TrendingDown size={14} className="text-orange-400" />
                <RiskBadge value={result.probDrawdown20} thresholds={[20, 40]} />
              </div>
              <div className="text-2xl font-black text-white font-mono">{result.probDrawdown20}%</div>
              <div className="text-[10px] text-white/40 mt-0.5 uppercase tracking-wider">Drawdown &gt;20%</div>
              <div className="text-[9px] text-white/20 mt-1">Máx médio: {result.maxDrawdownMedio}%</div>
            </div>

            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <TrendingUp size={14} className="text-blue-400" />
              </div>
              <div className={`text-2xl font-black font-mono ${result.medianaRetorno >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {result.medianaRetorno >= 0 ? '+' : ''}{result.medianaRetorno}%
              </div>
              <div className="text-[10px] text-white/40 mt-0.5 uppercase tracking-wider">Retorno Mediano</div>
              <div className="text-[9px] text-white/20 mt-1">Em {numApostas} apostas</div>
            </div>

            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <Dices size={14} className="text-purple-400" />
              </div>
              <div className="text-2xl font-black text-white font-mono">{result.apostasAteBreakeven}</div>
              <div className="text-[10px] text-white/40 mt-0.5 uppercase tracking-wider">Apostas p/ Breakeven</div>
              <div className="text-[9px] text-white/20 mt-1">Mediana das simulações</div>
            </div>
          </div>

          {/* Gráfico de distribuição */}
          <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-white/50">Distribuição de Banca ao Longo das Apostas</h3>
              <div className="flex items-center gap-4 text-[10px] text-white/30">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500/50 inline-block"></span>90th %ile</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span>Mediana</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500/50 inline-block"></span>10th %ile</span>
              </div>
            </div>
            <MiniChart
              mediana={result.curvaMediana}
              pessimista={result.curvaPessimista}
              otimista={result.curvaOtimista}
              banca={bancaAtual || 1000}
            />
            <div className="flex justify-between text-[10px] text-white/20 mt-2 font-mono">
              <span>0</span>
              <span>{numApostas / 2} apostas</span>
              <span>{numApostas}</span>
            </div>
          </div>

          {/* Cenários */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Pior Cenário (5th)', val: result.retorno5, color: 'text-red-400' },
              { label: 'Cenário Mediano', val: result.medianaRetorno, color: result.medianaRetorno >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: 'Melhor Cenário (95th)', val: result.retorno95, color: 'text-green-400' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white/[0.02] border border-white/10 rounded-xl p-4 text-center">
                <div className={`text-xl font-black font-mono ${color}`}>
                  {val >= 0 ? '+' : ''}{val}%
                </div>
                <div className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">{label}</div>
              </div>
            ))}
          </div>

          {/* Interpretação */}
          <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-white/50 mb-3">Interpretação Sharp</h3>
            <div className="space-y-2 text-xs text-white/60 leading-relaxed">
              {result.probRuina <= 5 && result.ev > 0 && (
                <p className="text-green-400/80">✓ Risco de ruína baixo com EV positivo. Estratégia dentro dos parâmetros de um apostador profissional.</p>
              )}
              {result.probRuina > 15 && (
                <p className="text-red-400/80">⚠ Risco de ruína elevado. Reduza o stake médio ou aumente a exigência de edge mínimo antes de escalar a banca.</p>
              )}
              {result.ev < 0 && (
                <p className="text-red-400/80">⚠ EV negativo com esses parâmetros. A estratégia perde valor esperado no longo prazo. Revise seleção de mercados.</p>
              )}
              {result.maxDrawdownMedio > 20 && (
                <p className="text-yellow-400/80">⚠ Drawdown médio de {result.maxDrawdownMedio}% é alto. Considere reduzir o stake médio para {(avgStakePct * 0.6).toFixed(1)}% para manter drawdown abaixo de 15%.</p>
              )}
              <p className="text-white/30 text-[11px]">
                Baseado em 1.000 sequências de {numApostas} apostas com hit rate de {hitRate}% e odd média de {avgOdd}x.
                Resultados são probabilísticos, não determinísticos.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
