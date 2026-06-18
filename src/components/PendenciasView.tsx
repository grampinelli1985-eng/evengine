import React from 'react';
import { Match, AnalysisResponse } from '../types';
import { calcularEstadoJogo } from '../services/eloService';
import { AlertCircle, CheckCircle2, ChevronRight, Eye, Trash2, Trophy, Zap } from 'lucide-react';
import { motion } from 'motion/react';

interface PendenciasViewProps {
  matches: Match[];
  analyzedMatches: Record<string, AnalysisResponse>;
  onRegisterResult: (match: Match) => void;
  onIgnoreMatch: (match: Match) => void;
}

export default function PendenciasView({
  matches,
  analyzedMatches,
  onRegisterResult,
  onIgnoreMatch
}: PendenciasViewProps) {
  // Filtra as partidas que estão em estado de pendência
  const pendingMatches = matches.filter(m => calcularEstadoJogo(m) === 'pendencia');

  return (
    <div translate="no" className="space-y-12">
      {/* Intro Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
        <div className="flex-grow">
          <div className="flex items-center gap-2 mb-4">
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="px-3 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-full uppercase tracking-[0.2em] border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)] flex items-center gap-2"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>Auditoria de Resultados ELO</span>
            </motion.div>
          </div>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight leading-none uppercase">
            ⏳ Registrar <span className="text-white/20 italic">Resultados</span>
          </h2>
          <p className="text-white/40 text-xs sm:text-sm font-medium max-w-2xl leading-relaxed">
            Aqui estão listados os confrontos iniciados há mais de 6 horas que ainda não possuem um resultado de placar gravado no sistema. Registre os placares para atualizar dinamicamente o ranking ELO das equipes.
          </p>
        </div>

        <div className="flex-shrink-0 flex items-center gap-3 bg-amber-500/5 px-6 py-4 rounded-2xl border border-amber-500/10 backdrop-blur-md">
          <Trophy size={14} className="text-amber-500 animate-bounce" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">
            {pendingMatches.length} Pendentes
          </span>
        </div>
      </div>

      {pendingMatches.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-[#0d0d0f] border border-white/5 rounded-[2.5rem] p-16 text-center max-w-2xl mx-auto flex flex-col items-center justify-center gap-6"
        >
          <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.1)]">
            <CheckCircle2 size={32} />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-black text-white uppercase tracking-wider">Tudo em Dia!</h3>
            <p className="text-white/40 text-xs sm:text-sm font-medium leading-relaxed">
              Não existem partidas pendentes no momento. Todos os resultados recentes foram devidamente catalogados ou ignorados.
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {pendingMatches.map(match => {
            const date = new Date(match.commence_time);
            const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const analysis = analyzedMatches[match.id];

            return (
              <motion.div
                key={match.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -5 }}
                className="bg-[#0d0d0f] border border-white/[0.08] hover:border-amber-500/30 rounded-[2.5rem] p-6 transition-all group relative overflow-hidden shadow-sm flex flex-col justify-between"
              >
                {/* Background Glow */}
                <div className="absolute -inset-px bg-gradient-to-br from-amber-500/5 to-purple-500/5 rounded-[2.5rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between gap-4 mb-6 relative z-10">
                    <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center gap-1.5">
                      <div className="w-1 h-1 rounded-full bg-amber-500" />
                      <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest whitespace-nowrap">
                        Aguardando Auditoria
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-white/30 font-mono font-bold tracking-widest">
                      <span>{dateStr}</span>
                      <span className="text-white/10">|</span>
                      <span>{timeStr}</span>
                    </div>
                  </div>

                  {/* Teams info */}
                  <div className="bg-[#0a0a0b] border border-white/[0.04] rounded-[2rem] p-5 mb-6 relative z-10">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs sm:text-sm font-black text-white mb-0.5 truncate">{match.home_team}</h4>
                        <span className="text-[8px] text-white/20 font-bold uppercase tracking-wider">HOME</span>
                      </div>
                      <div className="shrink-0 px-2">
                        <span className="text-white/10 font-black text-xs italic">vs</span>
                      </div>
                      <div className="flex-1 text-right min-w-0">
                        <h4 className="text-xs sm:text-sm font-black text-white mb-0.5 truncate">{match.away_team}</h4>
                        <span className="text-[8px] text-white/20 font-bold uppercase tracking-wider">AWAY</span>
                      </div>
                    </div>
                  </div>

                  {/* Recommendation summary if analyzed */}
                  {analysis && (
                    <div className="px-4 py-3.5 bg-white/[0.02] border border-white/5 rounded-2xl mb-6 flex items-center justify-between gap-3 relative z-10">
                      <div className="flex items-center gap-2.5">
                        <Zap size={14} className="text-yellow-500 fill-yellow-500" />
                        <div>
                          <p className="text-[8px] font-black text-white/20 uppercase tracking-wider">Dica Indicada</p>
                          <p className="text-[9px] font-bold text-yellow-500 truncate max-w-[180px] uppercase">
                            {analysis.dica_principal || 'Análise de ML'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] font-black text-white/20 uppercase tracking-wider">Confiança</p>
                        <p className="text-[10px] font-black text-white/70">{analysis.qualidade || 80}%</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center gap-3 relative z-10 mt-2">
                  <button
                    onClick={() => onIgnoreMatch(match)}
                    className="h-12 w-12 rounded-2xl flex items-center justify-center transition-all bg-white/5 border border-white/10 text-white/40 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/10"
                    title="Ignorar Partida"
                  >
                    <Trash2 size={16} />
                  </button>

                  <button
                    onClick={() => onRegisterResult(match)}
                    className="flex-1 h-12 bg-white hover:bg-neutral-200 text-black rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-white/5"
                  >
                    Registrar Resultado
                    <ChevronRight size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
