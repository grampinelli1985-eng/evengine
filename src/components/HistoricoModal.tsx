import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, TrendingUp, TrendingDown, Target, Activity, Check, XCircle, MinusCircle } from 'lucide-react';
import { getHistoricoStats, resolverAposta } from '../services/historicoService';
import { getBancaAtual } from '../services/bancaService';

interface HistoricoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HistoricoModal({ isOpen, onClose }: HistoricoModalProps) {
  const [stats, setStats] = useState(getHistoricoStats());

  useEffect(() => {
    if (isOpen) {
      setStats(getHistoricoStats());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const handleResolve = (id: string, result: 'WIN' | 'RED' | 'VOID') => {
    const currentBanca = getBancaAtual();
    resolverAposta(id, result, currentBanca);
    setStats(getHistoricoStats());
  };

  const winRate = stats.totalApostas > 0 ? ((stats.totalWins / stats.totalApostas) * 100).toFixed(1) : '0.0';

  // Data for chart
  const registrosOrdenados = [...stats.registros].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
  const resolvidos = registrosOrdenados.filter(r => r.resultado !== 'PENDENTE');
  const initialBank = stats.bancaInicial || 1000;
  const historyPoints = [initialBank, ...resolvidos.map(r => r.bancaDepois)];

  const minBank = historyPoints.length > 0 ? Math.min(...historyPoints, initialBank * 0.9) : initialBank * 0.9;
  const maxBank = historyPoints.length > 0 ? Math.max(...historyPoints, initialBank * 1.1) : initialBank * 1.1;
  const range = maxBank - minBank || 1;

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
            <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-3">
              📊 HISTÓRICO P&L
            </h2>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
            
            {/* Cards 2x2 Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#0d0d1a] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                <Target size={18} className="text-white/20 mb-2" />
                <span className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Taxa Acerto</span>
                <span className="text-xl font-black text-white">{winRate}%</span>
                <span className="text-[9px] text-white/30">{stats.totalWins}W - {stats.totalReds}L ({stats.totalApostas})</span>
              </div>
              
              <div className="bg-[#0d0d1a] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                {stats.lucroTotal >= 0 ? <TrendingUp size={18} className="text-emerald-500 mb-2" /> : <TrendingDown size={18} className="text-rose-500 mb-2" />}
                <span className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Lucro Total</span>
                <span className={`text-xl font-black ${stats.lucroTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  R$ {stats.lucroTotal >= 0 ? '+' : ''}{stats.lucroTotal.toFixed(2)}
                </span>
              </div>

              <div className="bg-[#0d0d1a] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                <div className="mb-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] bg-white/5 text-white/40 border border-white/10 font-bold">!</div>
                <span className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Maior Série</span>
                {stats.maiorSerie.quantidade > 0 ? (
                  <span className={`text-xl font-black ${stats.maiorSerie.tipo === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stats.maiorSerie.quantidade} {stats.maiorSerie.tipo}
                  </span>
                ) : (
                  <span className="text-xl font-black text-white/20">-</span>
                )}
              </div>
            </div>

            {/* Evolução de Banca Chart (Simple divs) */}
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
                {/* Linha da banca inicial */}
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
                  <div className="p-8 text-center text-white/20 text-xs">Nenhum registro encontrado.</div>
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
                            <div className={`text-xs font-bold ${reg.lucro > 0 ? 'text-emerald-400' : reg.lucro < 0 ? 'text-rose-400' : 'text-white/50'}`}>
                              {reg.lucro > 0 ? '+' : ''}{reg.lucro.toFixed(2)}
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
