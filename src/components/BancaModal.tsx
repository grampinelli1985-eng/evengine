import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, RefreshCw } from 'lucide-react';
import { getBanca, resetarContadores, carregarStopLossState } from '../services/bancaService';
import { getCalibracaoStats, resolverPrevisoesPendentes } from '../services/calibrationService';

interface BancaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (banca: number) => void;
  kellyPercent?: number;
}

export default function BancaModal({ isOpen, onClose, onSave, kellyPercent = 1.5 }: BancaModalProps) {
  const [bancaValue, setBancaValue] = useState<number>(0);
  const [showSaved, setShowSaved] = useState(false);
  const [bancaState, setBancaState] = useState(getBanca());
  const [stats, setStats] = useState(getCalibracaoStats());
  const [isUpdatingCalibration, setIsUpdatingCalibration] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const state = getBanca();
      setBancaState(state);
      setBancaValue(state.bancaAtual ?? state.total ?? 1000);
      setStats(getCalibracaoStats());
    }
  }, [isOpen]);

  const handleUpdateCalibration = async () => {
    setIsUpdatingCalibration(true);
    await resolverPrevisoesPendentes();
    setStats(getCalibracaoStats());
    setIsUpdatingCalibration(false);
  };

  const handleSave = () => {
    onSave(bancaValue);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const handleFastAdd = (val: number) => {
    setBancaValue(prev => Math.max(0, prev + val));
  };

  const handleResetContadores = () => {
    if (window.confirm("Tem certeza? Isso reseta a proteção diária.")) {
      resetarContadores();
      setBancaState(getBanca());
    }
  };

  const kellyConservador = (kellyPercent * 0.5 * bancaValue) / 100;
  const kellyRecomendado = (kellyPercent * bancaValue) / 100;
  const kellyMaximo = (Math.min(kellyPercent, 3.0) * bancaValue) / 100;

  const reds = carregarStopLossState().redStreakAtual;
  const apostas = bancaState.apostasHoje ?? 0;
  const stopLoss = bancaState.stops?.loss ?? false;

  return (
    <AnimatePresence>
      {isOpen && (
        <div translate="no" className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-full max-w-[400px] max-h-[90vh] bg-[#0d0d1a] border border-[#1e1e3e] rounded-[16px] overflow-hidden shadow-2xl flex flex-col font-mono"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#1e1e3e] bg-[#141428] flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xl">💰</span>
                <h2 className="text-[13px] font-bold text-white uppercase tracking-wider">Gerenciador de Banca</h2>
              </div>
              <button 
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-6 overflow-y-auto custom-scrollbar">
              {/* Seção 1 - Saldo Atual */}
              <div className="space-y-3">
                <label className="text-[10px] text-white/50 uppercase font-bold tracking-widest block">Banca Atual</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-bold text-xl">R$</span>
                  <input 
                    type="number"
                    value={bancaValue}
                    onChange={(e) => setBancaValue(Number(e.target.value))}
                    className="w-full bg-[#141428] border border-[#1e1e3e] rounded-xl pl-12 pr-4 py-4 text-[28px] font-bold text-white outline-none focus:border-green-500/50 transition-colors"
                  />
                </div>
                
                <div className="flex flex-wrap gap-2 pt-2">
                  {[100, 500, 1000].map(val => (
                    <button key={`add-${val}`} onClick={() => handleFastAdd(val)} className="flex-1 min-w-[60px] py-2 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg text-[11px] font-bold transition-colors">
                      +{val}
                    </button>
                  ))}
                  {[-100, -500].map(val => (
                    <button key={`sub-${val}`} onClick={() => handleFastAdd(val)} className="flex-1 min-w-[60px] py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-[11px] font-bold transition-colors">
                      {val}
                    </button>
                  ))}
                </div>

                <div className="pt-2">
                  <button 
                    onClick={handleSave}
                    className="w-full py-4 bg-green-500 hover:bg-green-400 text-black rounded-xl font-bold uppercase tracking-wider transition-colors relative overflow-hidden"
                  >
                    {showSaved ? (
                      <span className="flex items-center justify-center gap-2">
                        <Check size={18} /> Banca Atualizada
                      </span>
                    ) : (
                      'Salvar Banca'
                    )}
                  </button>
                </div>
              </div>

              {/* Seção 2 - Stake Automático */}
              <div className="p-4 bg-[#141428] border border-[#1e1e3e] rounded-xl space-y-3">
                <label className="text-[10px] text-white/50 uppercase font-bold tracking-widest block">Stake por Entrada</label>
                <div className="space-y-2 text-[12px]">
                  <div className="flex justify-between items-center text-white/70">
                    <span>Kelly conservador (50%)</span>
                    <span className="font-bold">R$ {kellyConservador.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-green-400">
                    <span>Kelly recomendado</span>
                    <span className="font-bold">R$ {kellyRecomendado.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-rose-400">
                    <span>Kelly máximo (3% cap)</span>
                    <span className="font-bold">R$ {kellyMaximo.toFixed(2)}</span>
                  </div>
                </div>
                <p className="text-[9px] text-white/30 italic pt-2 border-t border-white/5">
                  * Stake calculado automaticamente pelo Gate v2.0
                </p>
              </div>

              {/* Seção 3 - Proteção Ativa */}
              <div className="p-4 bg-[#141428] border border-[#1e1e3e] rounded-xl space-y-4">
                <label className="text-[10px] text-white/50 uppercase font-bold tracking-widest block">Proteção Ativa</label>
                
                <div className="space-y-2 text-[12px]">
                  <div className="flex justify-between items-center">
                    <span className="text-white/70">REDs consecutivos</span>
                    <span className={`font-bold px-2 py-0.5 rounded-md ${
                      reds === 0 ? 'bg-green-500/20 text-green-400' : 
                      reds < 3 ? 'bg-yellow-500/20 text-yellow-400' : 
                      'bg-red-500/20 text-red-400'
                    }`}>{reds}/3</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/70">Apostas hoje</span>
                    <span className={`font-bold px-2 py-0.5 rounded-md ${
                      apostas <= 1 ? 'bg-green-500/20 text-green-400' : 
                      apostas === 2 ? 'bg-yellow-500/20 text-yellow-400' : 
                      'bg-red-500/20 text-red-400'
                    }`}>{apostas}/3</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/70">Stop loss ativo</span>
                    <span className={`font-bold px-2 py-0.5 rounded-md ${
                      stopLoss ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-green-500/20 text-green-400'
                    }`}>{stopLoss ? 'SIM' : 'NÃO'}</span>
                  </div>
                </div>

                <button 
                  onClick={handleResetContadores}
                  className="w-full py-2.5 mt-2 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-colors border border-white/5"
                >
                  Resetar Contadores
                </button>
              </div>

              {/* Seção 4 - Calibração */}
              <div className="p-4 bg-[#141428] border border-[#1e1e3e] rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-white/50 uppercase font-bold tracking-widest block">📊 Calibração do Modelo</label>
                  <button 
                    onClick={handleUpdateCalibration}
                    disabled={isUpdatingCalibration}
                    className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-colors"
                  >
                    <RefreshCw size={14} className={isUpdatingCalibration ? "animate-spin" : ""} />
                  </button>
                </div>
                
                <div className="space-y-2 text-[12px]">
                  <div className="flex justify-between items-center">
                    <span className="text-white/70">Previsões registradas</span>
                    <span className="font-bold text-white">{stats.totalResolvidos}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/70">Taxa de acerto real</span>
                    <span className={`font-bold px-2 py-0.5 rounded-md ${
                      stats.taxaAcerto >= 55 ? 'bg-green-500/20 text-green-400' :
                      stats.taxaAcerto >= 45 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>{stats.taxaAcerto}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/70">Limiar recomendado</span>
                    <span className="font-bold text-blue-400">{stats.limiarRecomendado}%</span>
                  </div>
                </div>

                <div className="mt-4 border border-white/5 rounded-lg overflow-hidden text-[10px]">
                  <div className="grid grid-cols-4 bg-white/5 p-2 font-bold text-white/50 text-center">
                    <span>Faixa</span>
                    <span>Prev</span>
                    <span>Acerto</span>
                    <span>Taxa</span>
                  </div>
                  {[
                    { label: '60-70%', data: stats.limiaresPorFaixa.faixa60a70 },
                    { label: '70-80%', data: stats.limiaresPorFaixa.faixa70a80 },
                    { label: '80-90%', data: stats.limiaresPorFaixa.faixa80a90 },
                    { label: '90%+', data: stats.limiaresPorFaixa.faixa90mais },
                  ].map((row, i) => (
                    <div key={i} className="grid grid-cols-4 p-2 border-t border-white/5 text-center text-white/80">
                      <span className="font-bold">{row.label}</span>
                      <span>{row.data.total}</span>
                      <span>{row.data.acertos}</span>
                      <span className={row.data.taxa >= 55 ? 'text-green-400' : row.data.taxa > 0 ? 'text-red-400' : 'text-white/30'}>
                        {row.data.taxa}%
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-[9px] text-white/30 italic pt-2 border-t border-white/5">
                  * Mínimo 10 previsões por faixa para calibração confiável. Dados insuficientes até lá.
                </p>
              </div>

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
