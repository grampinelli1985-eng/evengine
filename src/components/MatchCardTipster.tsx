import React, { useState, useEffect } from 'react';

// Tipos exportados
interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  date: string;
  resultado_registrado?: boolean;
  resultado_placar?: string;
  resultado_data?: string;
  resultado_ignorado?: boolean;
  sportKey?: string;
}


interface Stats {
  bankroll: number;
}

interface PickAnalysis {
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  ev: number;
  confidence: number;
  fairOdds: number;
  impliedProb: number;
  kellyStake: number;
  tipsterEngine?: any;
}

export type { Match, Stats, PickAnalysis };

export interface MatchCardTipsterProps {
  match: Match;
  initialStats?: Stats;
  onAnalysisComplete?: (analysis: PickAnalysis) => void;
  onAction?: (match: Match, analysis: PickAnalysis) => void;
  onToggleSelection?: (id: string, selected: boolean) => void;
  isSelected?: boolean;
  className?: string;
  onRegisterResult?: (match: Match) => void;
  deepAnalysis?: any; // análise completa do Gemini/TipsterEngine (opcional)
}


import TipsterAnalysisServiceBase from '../services/tipsterAnalysisService';
import { calcularEstadoJogo } from '../services/eloService';
import { getTeamPositionInLeague } from '../services/scoutingService';
import { getLineMovement, LineMovementResult } from '../services/lineMovementService';
import SteamBadge from './SteamBadge';

const tipsterService = new TipsterAnalysisServiceBase();

// Mock adapter for the component's internal use
const TipsterAnalysisService = {
  analyze: async (input: { match: Match; stats?: Stats }): Promise<PickAnalysis> => {
    const { match, stats } = input;
    const result = tipsterService.analyzePick({
      match: {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        date: new Date().toISOString(),
      },
      market: { type: '1x2', outcome: 'Home' },
      odds: match.homeOdds,
      bankroll: stats?.bankroll || 1000,
    }, {
      winRate: 0.60,
      avgOdds: 2.0,
      roi: 0.1,
      dailyLimit: 100
    });

    return {
      tier: result.tier.name as any,
      ev: result.expectedValue * 100,
      confidence: result.confidence * 100,
      fairOdds: result.fairOdds,
      impliedProb: result.impliedProbability * 100,
      kellyStake: (result.kellyStake / (stats?.bankroll || 1000)) * 100,
    };
  },
};

const MatchCardTipster: React.FC<MatchCardTipsterProps> = ({
  match,
  initialStats,
  onAnalysisComplete,
  onAction,
  onToggleSelection,
  isSelected: isSelectedProp = false,
  className = '',
  onRegisterResult,
  deepAnalysis,
}) => {
  const [analysis, setAnalysis] = useState<PickAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localSelected, setLocalSelected] = useState(isSelectedProp);
  const [homeRank, setHomeRank] = useState<number | null>(null);
  const [awayRank, setAwayRank] = useState<number | null>(null);
  const [lineMovement, setLineMovement] = useState<LineMovementResult | null>(() => getLineMovement(match.id));

  const estado = calcularEstadoJogo(match);
  const kickoff = new Date(match.date);
  const minutosDecorridos = Math.max(0, Math.floor((new Date().getTime() - kickoff.getTime()) / 60000));

  useEffect(() => {
    setLocalSelected(isSelectedProp);
  }, [isSelectedProp]);

  useEffect(() => {
    setLineMovement(getLineMovement(match.id));
  }, [match.id]);

  useEffect(() => {
    let active = true;
    const fetchPositions = async () => {
      if (!match.sportKey) return;
      try {
        const [hPos, aPos] = await Promise.all([
          getTeamPositionInLeague(match.homeTeam, match.sportKey),
          getTeamPositionInLeague(match.awayTeam, match.sportKey)
        ]);
        if (active) {
          setHomeRank(hPos);
          setAwayRank(aPos);
        }
      } catch (err) {
        console.warn('Erro ao carregar classificação dos times:', err);
      }
    };
    fetchPositions();
    return () => {
      active = false;
    };
  }, [match.homeTeam, match.awayTeam, match.sportKey]);


  useEffect(() => {
    let active = true;
    const performAnalysis = async () => {
      try {
        setLoading(true);
        setError(null);
        const stats = initialStats || { bankroll: 1000 };
        const result = await TipsterAnalysisService.analyze({ match, stats });
        if (!active) return;
        setAnalysis(result);
        onAnalysisComplete?.(result);
      } catch (err) {
        if (active) setError('Erro ao realizar análise do tipster');
      } finally {
        if (active) setLoading(false);
      }
    };

    performAnalysis();
    return () => { active = false; };
  }, [match, initialStats]); // onAnalysisComplete deliberately omitted — unstable prop reference causes loop

  const getTierColor = (tier: string): string => {
    switch (tier) {
      case 'S':
      case 'A':
        return 'bg-green-500 text-white border-green-600';
      case 'B':
        return 'bg-blue-600 text-white border-blue-700';
      case 'C':
        return 'bg-yellow-500 text-black border-yellow-600';
      case 'D':
        return 'bg-red-500 text-white border-red-600';
      default:
        return 'bg-gray-500 text-white border-gray-600';
    }

  };

  const getAction = (tier: string): string => {
    switch (tier) {
      case 'S':
      case 'A':
        return '🟢 APOSTE';
      case 'B':
        return '🟢 APOSTE';
      case 'C':
        return '🟡 MONITORAR';
      case 'D':
        return '🔴 EVITAR';
      default:
        return '⚪ AVALIAR';
    }

  };

  const isGoodTier = (tier: string) => ['S', 'A', 'B'].includes(tier as any);


  if (loading) {
    return (
      <div translate="no" className={`bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6 shadow-lg animate-pulse ${className}`}>
        <div key="skeleton-title" className="h-6 bg-gray-700 rounded mb-4"></div>
        <div key="skeleton-grid" className="grid grid-cols-2 gap-4 h-20">
          <div key="skeleton-1" className="h-4 bg-gray-700 rounded"></div>
          <div key="skeleton-2" className="h-4 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }


  if (error || !analysis) {
    return (
      <div className={`bg-red-900/50 border border-red-500 text-red-100 p-6 rounded-xl shadow-lg ${className}`}>
        <span>⚠️ {
          (analysis as any)?.tipsterEngine?.bloqueio?.motivo 
          ?? error 
          ?? 'Erro ao realizar análise do tipster — verifique as configurações'
        }</span>
      </div>
    );
  }

  return (
    <div translate="no" className={`bg-[#141416] border rounded-3xl p-5 sm:p-8 relative overflow-hidden group transition-all duration-500 ${
      estado === 'ao_vivo'
        ? 'border-rose-500/50 shadow-[0_0_20px_rgba(244,67,54,0.15)] animate-pulse-border'
        : 'border-white/5 hover:border-blue-500/20 hover:bg-white/[0.01]'
    } ${localSelected ? 'ring-2 ring-blue-500/50 shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)]' : ''} ${className}`}>


      {/* Background Glow */}
      <div className="absolute -inset-px bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      {/* Header */}
      <div className="relative flex justify-between items-start mb-5">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
             {estado === 'ao_vivo' ? (
               <>
                 <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                 <span className="text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] animate-pulse">🔴 Live Match</span>
               </>
             ) : estado === 'aguardando_resultado' ? (
               <>
                 <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                 <span className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em]">⏳ Finalizado</span>
               </>
             ) : (
               <>
                 <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                 <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Match Analytics</span>
               </>
             )}
          </div>

          {lineMovement?.tem_steam && (
            <div className="mb-2">
              <SteamBadge steamSide={lineMovement.steam_side} sharpScore={lineMovement.sharpScore} compact />
            </div>
          )}

          <h3 className="text-lg font-black text-white leading-tight uppercase tracking-tight flex flex-wrap items-center gap-x-1.5">
            <span>{match.homeTeam}</span>
            {homeRank !== null && (
              <span className="text-[11px] text-emerald-400 font-black font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/15 normal-case">
                {homeRank}º
              </span>
            )}
            <span className="text-white/20 mx-0.5">vs</span>
            <span>{match.awayTeam}</span>
            {awayRank !== null && (
              <span className="text-[11px] text-rose-400 font-black font-mono bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/15 normal-case">
                {awayRank}º
              </span>
            )}
          </h3>

          <div className="flex gap-1.5 mt-2">
            {[
              { label: 'C', val: match.homeOdds },
              { label: 'E', val: match.drawOdds },
              { label: 'F', val: match.awayOdds }
            ].map(o => (
              <span key={o.label} className="px-2 py-0.5 bg-white/[0.03] border border-white/[0.05] rounded-md text-[10px] font-bold text-white/40">
                <span>{o.label}</span>: <span>{o.val.toFixed(2)}</span>
              </span>

            ))}
          </div>
        </div>
        
        {/* Tier & Time */}
        <div className="flex flex-col items-end gap-2">
          <div className={`px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg ${getTierColor(analysis.tier)}`}>
             Tier {analysis.tier}
          </div>
          {estado === 'ao_vivo' ? (
            <span className="text-[10px] font-black text-rose-400 uppercase tracking-[0.2em] flex items-center gap-1">
               <span>AO VIVO</span>
               <span className="text-white/30 font-mono">({minutosDecorridos}m)</span>
            </span>
          ) : estado === 'aguardando_resultado' ? (
            <span className="text-[9px] font-black text-amber-400 uppercase tracking-[0.2em] whitespace-nowrap">
               AGUARDA RESULTADO
            </span>
          ) : (
            <span className="text-[10px] font-black text-blue-500/50 uppercase tracking-[0.2em] flex items-center gap-1.5 whitespace-nowrap">
               <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               <span>{new Date(match.date).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}</span>
               <span className="text-white/20">•</span>
               <span>{new Date(match.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          )}
        </div>
      </div>

      {/* Action Status */}
      <div className="relative mb-5">
        <div className={`w-full py-2.5 rounded-2xl flex items-center justify-center gap-2 font-black text-[11px] uppercase tracking-[0.2em] border border-white/5 bg-white/[0.02] shadow-inner`}>
           <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_currentcolor] ${
             analysis.tier === 'S' || analysis.tier === 'A' ? 'bg-emerald-500 text-emerald-500' :
             analysis.tier === 'B' ? 'bg-blue-500 text-blue-500' :
             analysis.tier === 'C' ? 'bg-amber-500 text-amber-500' : 'bg-rose-500 text-rose-500'
           }`} />
           <span className="text-white/80">{getAction(analysis.tier).replace(/🟢|🟡|🔴|⚪/, '').trim()}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="relative grid grid-cols-3 gap-2 mb-5">
        {[
          { label: 'EV', val: analysis.ev.toFixed(1), unit: '%', color: 'text-emerald-400' },
          { label: 'Conf', val: analysis.confidence.toFixed(0), unit: '%', color: 'text-blue-400' },
          { label: 'Fair', val: analysis.fairOdds.toFixed(2), unit: '', color: 'text-purple-400' }
        ].map(s => (
          <div key={s.label} className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-3 text-center transition-colors group-hover:bg-white/[0.04]">
            <div className={`text-sm font-mono font-black mb-0.5 ${s.color}`}>
              <span>{s.val}</span>{s.unit && <span className="text-[10px] opacity-50 ml-0.5">{s.unit}</span>}
            </div>
            <div className="text-[8px] font-black text-white/20 uppercase tracking-widest"><span>{s.label}</span></div>
          </div>
        ))}

      </div>

      {/* Mercado Recomendado — só renderiza quando deepAnalysis com tipsterEngine estiver disponível */}
      {(() => {
        const te = deepAnalysis?.tipsterEngine;
        const mercadoNome = te?.mercado?.nome ?? te?.mercado_selecionado?.nome;
        // odd_referencia é exclusivamente Pinnacle; odd_api/odd são fallbacks de outros bookmakers
        const oddPinnacle: number | undefined = te?.mercado?.odd_referencia ?? te?.mercado_selecionado?.odd_referencia;
        const oddFallback: number | undefined = te?.mercado?.odd_api ?? te?.mercado?.odd;
        const odd = oddPinnacle ?? oddFallback;
        const isPinnacle = oddPinnacle !== undefined;
        if (!mercadoNome || !odd) return null;
        return (
          <div className="relative p-3 bg-white/[0.02] border border-white/[0.05] rounded-2xl mb-3">
            <div className="text-[7px] font-black text-white/20 uppercase tracking-widest mb-1.5">Mercado Recomendado</div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-white uppercase truncate pr-2">{mercadoNome}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono font-black text-emerald-400">Odd {odd.toFixed(2)}</span>
                {isPinnacle && (
                  <span className="text-[7px] font-black text-white/20 uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] rounded px-1 py-0.5">Pinnacle</span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bankroll Mini */}
      <div className="relative flex items-center justify-between p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl mb-6 group-hover:bg-emerald-500/10 transition-colors">
        <div className="flex items-center gap-3">
           <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <span className="text-xs font-black">💰</span>
           </div>
           <div>
              <p className="text-[8px] font-black text-emerald-500/50 uppercase tracking-widest">Stake Kelly</p>
              <p className="text-[10px] font-mono font-black text-emerald-400">Fração Recomendada</p>
           </div>
        </div>
        <div className="text-right">
           <span className="text-xl font-mono font-black text-emerald-400"><span>{analysis.kellyStake.toFixed(1)}</span>%</span>
        </div>

      </div>

      {/* Controls */}
      <div className="relative flex gap-3">
        {estado !== 'aguardando_resultado' && (
          <button
            onClick={() => {
              if (deepAnalysis?.tipsterEngine?.status === 'APROVADO') {
                setLocalSelected(!localSelected);
                onToggleSelection?.(match.id, !localSelected);
              }
            }}
            disabled={deepAnalysis?.tipsterEngine?.status !== 'APROVADO'}
            className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-300 border ${
              deepAnalysis?.tipsterEngine?.status !== 'APROVADO'
                ? 'bg-white/5 border-white/5 cursor-not-allowed opacity-50'
                : localSelected 
                  ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_20px_-5px_rgba(59,130,246,0.5)]' 
                  : 'bg-white/5 border-white/10 text-white/30 hover:border-white/20 hover:bg-white/10'
            }`}
          >
            <div className={`w-4 h-4 rounded-md border-2 transition-all ${
              localSelected ? 'bg-white border-white scale-75' : 'border-current'
            }`} />
          </button>
        )}

        {estado === 'aguardando_resultado' ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRegisterResult?.(match);
            }}
            className="flex-1 h-12 bg-amber-500 hover:bg-amber-400 text-black rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
          >
            Registrar Resultado
          </button>
        ) : estado === 'ao_vivo' ? (
          <div className="flex gap-2 w-full">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAction?.(match, analysis);
              }}
              className="flex-1 h-12 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-2xl font-black text-[9px] uppercase tracking-[0.1em] transition-all"
            >
              Ver Análise
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRegisterResult?.(match);
              }}
              className="flex-1 h-12 bg-amber-500 hover:bg-amber-400 text-black rounded-2xl font-black text-[9px] uppercase tracking-[0.1em] transition-all shadow-lg shadow-amber-500/10"
            >
              Resultado
            </button>
          </div>
        ) : (
          <button
            className={`flex-1 h-12 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all duration-300 flex items-center justify-center gap-2 group/btn ${
              isGoodTier(analysis.tier)
                ? 'bg-white text-black hover:bg-neutral-200 active:scale-95'
                : 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
            }`}
            disabled={!isGoodTier(analysis.tier)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAction?.(match, analysis);
            }}
          >
            {isGoodTier(analysis.tier) && <div key="btn-dot" className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse group-hover/btn:scale-125 transition-transform" />}
            <span key="btn-text">
              {isGoodTier(analysis.tier) ? <span>Visualizar Análise</span> : <span>{getAction(analysis.tier).replace(/🟢|🟡|🔴|⚪/, '').trim()}</span>}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default MatchCardTipster;
