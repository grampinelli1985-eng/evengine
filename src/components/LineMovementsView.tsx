import React from 'react';
import { Activity, RefreshCw, Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface LineMovementRecord {
  id: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  variationHome: number;
  temSteam: boolean;
  timestamp: string;
}

interface LineMovementsViewProps {
  records: LineMovementRecord[];
  plan: string;
  onRefresh: () => void;
  onGoToMatch: (matchId: string) => void;
}

const LineMovementsView: React.FC<LineMovementsViewProps> = ({ records, plan, onRefresh, onGoToMatch }) => {
  const isPro = plan === 'pro' || plan === 'sharp';

  const sorted = [...records].sort((a, b) => {
    if (a.temSteam && !b.temSteam) return -1;
    if (!a.temSteam && b.temSteam) return 1;
    return Math.abs(b.variationHome) - Math.abs(a.variationHome);
  });

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '--:--';
    }
  };

  const getVariationIcon = (v: number) => {
    if (v > 0) return <TrendingUp size={14} className="text-emerald-400" />;
    if (v < 0) return <TrendingDown size={14} className="text-red-400" />;
    return <Minus size={14} className="text-zinc-400" />;
  };

  const getVariationColor = (v: number) => {
    if (Math.abs(v) >= 10) return 'text-red-400';
    if (Math.abs(v) >= 5) return 'text-amber-400';
    return 'text-emerald-400';
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-emerald-400" />
          <h2 className="text-base font-black uppercase tracking-widest text-white">Line Movements</h2>
          {records.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400">
              {records.length}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition-colors"
        >
          <RefreshCw size={13} />
          Atualizar
        </button>
      </div>

      {/* Lock for non-pro */}
      {!isPro && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
          <p className="text-amber-400 text-sm font-bold">🔒 Disponível nos planos Pro e Sharp</p>
          <p className="text-zinc-400 text-xs mt-1">Monitore movimentos de odds e Steam Moves em tempo real.</p>
        </div>
      )}

      {/* Empty state */}
      {isPro && records.length === 0 && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-8 text-center">
          <Activity size={32} className="text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm font-bold">Nenhum movimento detectado</p>
          <p className="text-zinc-500 text-xs mt-1">Variações de odds ≥ 3% aparecerão aqui automaticamente.</p>
        </div>
      )}

      {/* Records */}
      {isPro && sorted.map(rec => (
        <button
          key={rec.id}
          onClick={() => onGoToMatch(rec.matchId)}
          className="w-full text-left rounded-xl border border-zinc-700/50 bg-zinc-900/80 hover:bg-zinc-800/80 p-4 transition-colors group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                {rec.temSteam && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-black uppercase tracking-widest shrink-0">
                    <Zap size={10} />
                    Steam
                  </span>
                )}
                <span className="text-white text-sm font-bold truncate">
                  {rec.homeTeam} vs {rec.awayTeam}
                </span>
              </div>
              <span className="text-zinc-500 text-[11px] uppercase tracking-wider">{rec.league}</span>
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className={`flex items-center gap-1 text-sm font-black ${getVariationColor(rec.variationHome)}`}>
                {getVariationIcon(rec.variationHome)}
                {rec.variationHome > 0 ? '+' : ''}{rec.variationHome.toFixed(1)}%
              </div>
              <span className="text-zinc-600 text-[10px]">{formatTime(rec.timestamp)}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};

export default LineMovementsView;
