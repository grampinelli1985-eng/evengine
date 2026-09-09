import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, TrendingUp, TrendingDown, Target, Activity, Check, XCircle, MinusCircle, Lock } from 'lucide-react';
import { getHistoricoStats, resolverAposta } from '../services/historicoService';
import { getBancaAtual } from '../services/bancaService';

interface HistoricoModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan?: string;
}

function getPlanLimitDays(plan?: string): number {
  if (plan === 'sharp') return 90;
  if (plan === 'pro') return 30;
  return 7;
}

export default function HistoricoModal({ isOpen, onClose, plan }: HistoricoModalProps) {
  const [stats, setStats] = useState(getHistoricoStats());

  useEffect(() => {
    if (isOpen) {
      setStats(getHistoricoStats());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const limitDays = getPlanLimitDays(plan);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - limitDays);
  cutoffDate.setHours(0, 0, 0, 0); // normaliza para meia-noite — evita exclusão de apostas do dia-limite por horário de acesso

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const handleResolve = (id: string, result: 'WIN' | 'RED' | 'VOID') => {
    const currentBanca = getBancaAtual();
    resolverAposta(id, result, currentBanca);
    setStats(getHistoricoStats());
  };

  // Filtrar por limite de dias do plano, excluindo IGNORADO (não devem afetar estatísticas)
  const registrosOrdenados = [...stats.registros]
    .filter(r => new Date(r.data) >= cutoffDate && r.resultado !== 'IGNORADO')
    .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());

  const resolvidos = registrosOrdenados.filter(r => r.resultado !== 'PENDENTE' && r.resultado !== 'VOID');

  // Recalcular stats apenas com registros filtrados
  const totalWins = registrosOrdenados.filter(r => r.resultado === 'WIN').length;
  const totalReds = registrosOrdenados.filter(r => r.resultado === 'RED').length;
  // WinRate usa apenas apostas liquidadas (WIN + RED), excluindo VOID e PENDENTE do denominador
  const totalSettled = totalWins + totalReds;
  const lucroTotal = resolvidos.reduce((acc, r) => acc + (r.lucro || 0), 0);

  const maiorSerie = (() => {
    let best = { tipo: 'WIN' as 'WIN' | 'RED', quantidade: 0 };
    let cur = { tipo: 'WIN' as 'WIN' | 'RED', quantidade: 0 };
    for (const r of registrosOrdenados) {
      if (r.resultado === 'PENDENTE') continue;
      if (r.resultado === 'VOID') continue; // VOID não interrompe nem contribui para streaks
      const tipo = r.resultado === 'WIN' ? 'WIN' : 'RED';
      if (cur.quantidade === 0 || cur.tipo === tipo) {
        cur = { tipo, quantidade: cur.quantidade + 1 };
      } else {
        cur = { tipo, quantidade: 1 };
      }
      if (cur.quantidade > best.quantidade) best = { ...cur };
    }
    return best;
  })();

  const winRate = totalSettled > 0 ? ((totalWins / totalSettled) * 100).toFixed(1) : '0.0';

  // Ponto inicial do gráfico: banca no início do período filtrado, não a banca all-time
  const initialBank = stats.bancaInicial || 1000;
  const periodStartBank = resolvidos.length > 0 ? ((resolvidos[0] as any).bancaAntes ?? initialBank) : initialBank;
  const historyPoints = [periodStartBank, ...resolvidos.map(r => r.bancaDepois)];
  const minBank = historyPoints.length > 0 ? Math.min(...historyPoints, periodStartBank * 0.9) : periodStartBank * 0.9;
  const maxBank = historyPoints.length > 0 ? Math.max(...historyPoints, periodStartBank * 1.1) : periodStartBank * 1.1;
  const range = maxBank - minBank || 1;

  const planLabel = plan === 'sharp' ? 'Sharp (90 dias)' : plan === 'pro' ? 'Pro (30 dias)' : 'Free (7 dias)';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-4xl max-h-[90vh] bg-[#050508] border border-white/10 rounded-3xl overflow-hidden flex flex-col font-mono"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                📊 HISTÓRICO P&L
              </h2>
              <p className="text-[10px] text-white/30 mt-1 uppercase tracking-widest">{planLabel}</p>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">

            {/* Aviso de limite de plano */}
            {plan !== 'sharp' && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-yellow-400 text-xs">
                <Lock size={14} className="shrink-0" />
                <span>
                  Seu plano exibe os últimos <strong>{limitDays} dias</strong>.
                  {plan !== 'pro' && ' Faça upgrade para Pro (30 dias) ou Sharp (90 dias) para mais histórico.'}
                  {plan === 'pro' && ' Faça upgrade para Sharp para acessar 90 dias de histórico.'}
                </span>
              </div>
            )}

            {/* Cards 2x2 Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#0d0d1a] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                <Target size={18} className="text-white/20 mb-2" />
                <span className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Taxa Acerto</span>
                <span className="text-xl font-black text-white">{winRate}%</span>
                <span className="text-[9px] text-white/30">{totalWins}W - {totalReds}L ({totalSettled})</span>
              </div>

              <div className="bg-[#0d0d1a] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                {lucroTotal >= 0 ? <TrendingUp size={18} className="text-emerald-500 mb-2" /> : <TrendingDown size={18} className="text-rose-500 mb-2" />}
                <span className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Lucro Total</span>
                <span className={`text-xl font-black ${lucroTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  R$ {lucroTotal >= 0 ? '+' : ''}{lucroTotal.toFixed(2)}
                </span>
              </div>

              <div className="bg-[#0d0d1a] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                <div className="mb-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] bg-white/5 text-white/40 border border-white/10 font-bold">!</div>
                <span className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Maior Série</span>
                {maiorSerie.quantidade > 0 ? (
                  <span className={`text-xl font-black ${maiorSerie.tipo === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {maiorSerie.quantidade} {maiorSerie.tipo}
                  </span>
                ) : (
                  <span className="text-xl font-black text-white/20">-</span>
                )}
              </div>
            </div>

            {/* Evolução de Banca Chart */}
            <div className="bg-[#0d0d1a] border border-white/5 p-6 rounded-2xl">
              <h3 className="text-[10px] font-black uppercase text-white/40 tracking-[0.2em] mb-6">Evolução de Banca</h3>
              <div className="h-32 flex items-end gap-1 w-full border-b border-white/10 pb-2 relative">
                {historyPoints.map((point, index) => {
                  const heightPercent = Math.max(5, ((point - minBank) / range) * 100);
                  const isPositive = point >= initialBank;
                  return (
                    <div
                      key={index}
                      title={`R$ ${point.toFixed(2)}`}
                      className={`flex-1 rounded-t-sm transition-all hover:opacity-80 ${isPositive ? 'bg-emerald-500/50' : 'bg-rose-500/50'}`}
                      style={{ height: `${heightPercent}%` }}
                    />
                  );
                })}
                <div
                  className="absolute left-0 right-0 border-t border-white/20 border-dashed"
                  style={{ bottom: `calc(${Math.max(0, ((initialBank - minBank) / range) * 100)}% + 8px)` }}
                />
              </div>
            </div>

            {/* Lista de Apostas */}
            <div className="bg-[#0d0d1a] border border-white/5 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-white/5 bg-white/[0.02]">
                <h3 className="text-[10px] font-black uppercase text-white/40 tracking-[0.2em]">Registro de Apostas</h3>
              </div>
              <div className="divide-y divide-white/5 max-h-80 overflow-y-auto custom-scrollbar">
                {registrosOrdenados.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <div className="text-white/20 text-xs">Nenhum registro nos últimos {limitDays} dias.</div>
                    {plan !== 'sharp' && stats.registros.some((r: any) => new Date(r.data) < cutoffDate) && (
                      <div className="text-[11px] text-yellow-400/70">
                        Você tem apostas registradas fora deste período.{' '}
                        <span className="underline cursor-pointer">{plan === 'pro' ? 'Upgrade para Sharp (90 dias)' : 'Upgrade para Pro ou Sharp'}</span> para acessá-las.
                      </div>
                    )}
                  </div>
                ) : (
                  [...registrosOrdenados].reverse().map(reg => (
                    <div key={reg.id} className="p-4 flex flex-col md:flex-row items-center gap-4 hover:bg-white/[0.02] transition-colors">
                      <div className="w-24 text-[10px] text-white/30">{formatDate(reg.data)}</div>

                      <div className="flex-1">
                        <div className="text-xs font-bold text-white mb-1 truncate">
                          {reg.homeTeam} <span className="text-white/20 mx-1">vs</span> {reg.awayTeam}
                        </div>
                        <div className="text-[10px] text-white/40 uppercase">{reg.liga} • {reg.mercado} @ {reg.odd.toFixed(2)}</div>
                      </div>

                      <div className="w-24 text-right">
                        <div className="text-[10px] text-white/40 uppercase mb-1">Stake</div>
                        <div className="text-xs font-bold text-white">R$ {reg.stake.toFixed(2)}</div>
                      </div>

                      <div className="w-24 flex justify-center">
                        {reg.resultado === 'WIN' && <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-black rounded-md border border-emerald-500/20">WIN</span>}
                        {reg.resultado === 'RED' && <span className="px-2 py-1 bg-rose-500/10 text-rose-400 text-[10px] font-black rounded-md border border-rose-500/20">RED</span>}
                        {reg.resultado === 'VOID' && <span className="px-2 py-1 bg-white/10 text-white/40 text-[10px] font-black rounded-md border border-white/10">VOID</span>}
                        {reg.resultado === 'PENDENTE' && <span className="px-2 py-1 bg-white/5 text-white/30 text-[10px] font-black rounded-md border border-white/5">PENDENTE</span>}
                      </div>

                      <div className="w-24 text-right">
                        {reg.resultado === 'PENDENTE' ? (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => handleResolve(reg.id, 'WIN')} className="w-6 h-6 rounded bg-emerald-500/10 text-emerald-500 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors" title="WIN"><Check size={12} /></button>
                            <button onClick={() => handleResolve(reg.id, 'RED')} className="w-6 h-6 rounded bg-rose-500/10 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-colors" title="RED"><XCircle size={12} /></button>
                            <button onClick={() => handleResolve(reg.id, 'VOID')} className="w-6 h-6 rounded bg-white/10 text-white/40 flex items-center justify-center hover:bg-white/30 hover:text-white transition-colors" title="VOID"><MinusCircle size={12} /></button>
                          </div>
                        ) : (
                          <>
                            <div className="text-[10px] text-white/40 uppercase mb-1">P&L</div>
                            <div className={`text-xs font-bold ${(reg.lucro ?? 0) > 0 ? 'text-emerald-400' : (reg.lucro ?? 0) < 0 ? 'text-rose-400' : 'text-white/50'}`}>
                              {(reg.lucro ?? 0) > 0 ? '+' : ''}{(reg.lucro ?? 0).toFixed(2)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
