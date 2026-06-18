/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Match, AnalysisResponse } from '../types';
import { 
  ChevronRight, ChevronDown, ChevronUp, 
  Check, PieChart, Zap, TrendingUp, AlertTriangle
} from 'lucide-react';
import { motion } from 'motion/react';
import { calcularEstadoJogo } from '../services/eloService';

interface MatchCardProps {
  match: Match;
  analysis?: AnalysisResponse;
  loading?: boolean;
  onAnalyze: (match: Match) => void;
  onViewDeepAnalysis: (match: Match, analysis: AnalysisResponse) => void;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
  onRegisterResult?: (match: Match) => void;
}

export default function MatchCard({ 
  match, 
  analysis, 
  loading, 
  onAnalyze, 
  onViewDeepAnalysis,
  isSelected,
  onToggleSelection,
  onRegisterResult
}: MatchCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const date = new Date(match.commence_time);
  const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const toggleExpand = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.deep-analysis-btn') || 
        (e.target as HTMLElement).closest('.selection-trigger')) {
      return;
    }
    setIsExpanded(!isExpanded);
  };

  // Logic for Confidence Badge
  const getConfidenceLevel = () => {
    if (!analysis) return null;
    const maxProb = Math.max(
      analysis.probabilidades_ml?.casa ?? 0,
      analysis.probabilidades_ml?.empate ?? 0,
      analysis.probabilidades_ml?.fora ?? 0,
      analysis.gols?.over15?.probabilidade ?? 0,
      analysis.dupla_chance?.['1X']?.probabilidade ?? 0
    );

    if (maxProb >= 75) return { color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20', text: 'ALTA', prob: maxProb };
    if (maxProb >= 60) return { color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'MÉDIA', prob: maxProb };
    return { color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'BAIXA', prob: maxProb };
  };

  const confidence = getConfidenceLevel();
  const estado = calcularEstadoJogo(match);
  const kickoff = new Date(match.commence_time);
  const minutosDecorridos = Math.max(0, Math.floor((new Date().getTime() - kickoff.getTime()) / 60000));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
      layout
      onClick={toggleExpand}
      className={`bg-[#0d0d0f] border rounded-[2.5rem] p-6 transition-all group cursor-pointer shadow-sm ${
        estado === 'ao_vivo'
          ? 'border-rose-500/50 shadow-[0_0_20px_rgba(244,67,54,0.15)] animate-pulse-border'
          : isExpanded
          ? 'border-blue-500/30'
          : 'border-white/[0.08] hover:border-white/20'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelection?.(match.id);
            }}
            className={`selection-trigger w-7 h-7 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${isSelected ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-transparent hover:border-white/20'}`}
          >
            <Check size={14} strokeWidth={3} />
          </div>
          <div className="px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full">
            <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest whitespace-nowrap">
              {match.sport_title || 'SOCCER'}
            </span>
          </div>
          
          {/* Steam Badge */}
          {(() => { try { return JSON.parse(localStorage.getItem('evengine_line_movement') || '{}')[match.id]?.tem_steam; } catch { return false; } })() && (
            <div className="px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full flex items-center gap-2">
              <TrendingUp size={12} className="text-orange-500" />
              <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest">STEAM</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3 text-[10px] font-mono font-bold tracking-widest">
          {estado === 'ao_vivo' ? (
            <div className="flex items-center gap-2">
              <span className="text-rose-500 font-black animate-pulse flex items-center gap-1 shrink-0">
                🔴 AO VIVO
              </span>
              <span className="text-white/40 font-mono">
                ({minutosDecorridos}min)
              </span>
            </div>
          ) : estado === 'aguardando_resultado' ? (
            <span className="text-amber-500 font-black uppercase tracking-wider flex items-center gap-1 shrink-0">
              ⏳ AGUARDA RESULTADO
            </span>
          ) : (
            <>
              <span className="text-white/30">{dateStr}</span>
              <span className="text-white/10">|</span>
              <span className="text-white/60">{timeStr}</span>
            </>
          )}
          {isExpanded ? <ChevronUp size={14} className="text-white/30" /> : <ChevronDown size={14} className="text-white/30" />}
        </div>
      </div>

      {/* Top Badges */}
      {analysis && (
        <div className="flex items-center gap-2 mb-8 flex-wrap">
          <div className="px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-lg">
             <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest">ELO Δ {analysis.elo?.raw_delta || 0}</span>
          </div>
          {analysis.elo?.calibrando && (
            <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-1.5">
              <AlertTriangle size={10} className="text-amber-500" />
              <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">CALIBRANDO</span>
            </div>
          )}
          <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg">
             <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">λ {analysis.poisson?.home_expected.toFixed(1)}-{analysis.poisson?.away_expected.toFixed(1)}</span>
          </div>
          <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-1.5">
             <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
             <span className="text-[9px] font-black text-green-500 uppercase tracking-widest">Q {analysis.qualidade || 90}</span>
          </div>
        </div>
      )}

      <div className="bg-[#0a0a0b] border border-white/[0.04] rounded-[2rem] p-6 sm:p-8 mb-8">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] sm:text-base font-black text-white mb-1 leading-tight" title={match.home_team}>{match.home_team}</h3>
            <span className="text-[9px] text-white/20 font-bold uppercase tracking-widest">HOME</span>
          </div>

          <div className="px-2 sm:px-4 shrink-0">
            <span className="text-white/10 font-black text-xs italic">vs</span>
          </div>

          <div className="flex-1 text-right min-w-0">
            <h3 className="text-[13px] sm:text-base font-black text-white mb-1 leading-tight" title={match.away_team}>{match.away_team}</h3>
            <span className="text-[9px] text-white/20 font-bold uppercase tracking-widest">AWAY</span>
          </div>
        </div>
      </div>

      {/* Analysis Results */}
      {analysis && confidence ? (
        <div className="flex flex-col items-center gap-6 mt-4">
          <div className="flex flex-col items-center gap-4 w-full">
            {/* Confidence Badge */}
            <div className={`px-8 py-2.5 ${confidence.bg} border ${confidence.border} rounded-full flex items-center gap-3`}>
              <div className={`w-1.5 h-1.5 rounded-full ${confidence.color.replace('text-', 'bg-')} animate-pulse`} />
              <span className={`text-[10px] font-black ${confidence.color} uppercase tracking-[0.1em]`}>
                CONFIANÇA {confidence.text} — {confidence.prob}%
              </span>
            </div>

            {/* Recommendation */}
            {analysis.dica_principal && (
                <div className="flex items-start gap-3 px-2 text-center justify-center">
                  <Zap size={14} className="text-yellow-500 fill-yellow-500 shrink-0 mt-0.5" />
                  <span className="text-[9px] font-black text-yellow-500 uppercase tracking-[0.1em] leading-relaxed max-w-[90%]">
                    {analysis.dica_principal}
                  </span>
               </div>
            )}
          </div>
          
            {estado === 'aguardando_resultado' ? (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onRegisterResult?.(match);
                }}
                className="w-full py-4 bg-amber-500 hover:bg-amber-400 rounded-2xl text-[10px] font-black text-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-xl"
              >
                REGISTRAR RESULTADO
                <ChevronRight size={14} />
              </button>
            ) : estado === 'ao_vivo' ? (
              <div className="flex gap-3 w-full">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewDeepAnalysis(match, analysis);
                  }}
                  className="deep-analysis-btn flex-1 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-[10px] font-black text-white uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  RELATÓRIO
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegisterResult?.(match);
                  }}
                  className="flex-1 py-4 bg-amber-500 hover:bg-amber-400 rounded-2xl text-[10px] font-black text-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
                >
                  RESULTADO
                </button>
              </div>
            ) : (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDeepAnalysis(match, analysis);
                }}
                className="deep-analysis-btn w-full py-4 bg-white hover:bg-white/90 rounded-2xl text-[10px] font-black text-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-xl"
              >
                RELATÓRIO PROFUNDO
                <ChevronRight size={14} />
              </button>
            )}
        </div>
      ) : (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onAnalyze(match);
          }}
          disabled={loading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded-2xl text-[10px] font-black text-white uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-600/20"
        >
          {loading ? (
            <>
              <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Processando IA...
            </>
          ) : (
            <>
              <PieChart size={14} />
              Iniciar Análise Preditiva
            </>
          )}
        </button>
      )}
    </motion.div>
  );
}
