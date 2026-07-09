/**
 * AHCard.tsx — Card de equivalentes Asian Handicap para AnalysisView
 *
 * Uso em AnalysisView.tsx (adicionar após o bloco de Value Bets):
 *
 *   import AHCard from './AHCard';
 *
 *   // No JSX, onde result.asianHandicap estiver disponível:
 *   {result.asianHandicap && (
 *     <AHCard analysis={result.asianHandicap} />
 *   )}
 *
 * O campo result.asianHandicap é preenchido automaticamente pelo EngineApp.tsx
 * após análises aprovadas no plano Pro/Sharp.
 */

import { AsianHandicapAnalysis, MarketEquivalent } from '../../services/asianHandicapService';
import { Scale, CheckCircle2, AlertTriangle } from 'lucide-react';

interface AHCardProps {
  analysis: AsianHandicapAnalysis;
}

function MarketRow({ m }: { m: MarketEquivalent }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${m.recomendado ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-white/5 border border-white/5'}`}>
      <div className="min-w-0">
        <p className={`text-xs font-semibold truncate ${m.recomendado ? 'text-emerald-300' : 'text-gray-300'}`}>
          {m.recomendado && <CheckCircle2 className="inline w-3 h-3 mr-1 mb-0.5" />}
          {m.mercado}
        </p>
        <p className="text-[11px] text-gray-500 truncate">{m.descricao}</p>
      </div>
      <div className="text-right ml-3 shrink-0">
        <p className="text-white font-mono text-sm font-bold">{m.oddEquivalente.toFixed(2)}</p>
        <p className={`text-[11px] font-mono ${m.overround <= 2 ? 'text-emerald-400' : m.overround <= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
          OR {m.overround.toFixed(1)}%
        </p>
        {m.economiaVsH2H > 0 && (
          <p className="text-emerald-400 text-[10px]">-{m.economiaVsH2H.toFixed(1)}% margem</p>
        )}
      </div>
    </div>
  );
}

export default function AHCard({ analysis }: AHCardProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-white">Equivalentes de Mercado (AH)</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
          analysis.overroundH2H > 5
            ? 'bg-red-500/10 text-red-400 border-red-500/30'
            : 'bg-white/5 text-gray-400 border-white/10'
        }`}>
          H2H OR {analysis.overroundH2H.toFixed(1)}%
        </span>
      </div>

      {/* Alerta */}
      {analysis.alerta && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-blue-300 text-xs">{analysis.alerta}</p>
        </div>
      )}

      {/* Mercados Casa */}
      <div>
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">
          {analysis.homeTeam} (Casa)
        </p>
        <div className="space-y-1.5">
          {analysis.equivalentesCasa.map((m, i) => (
            <MarketRow key={i} m={m} />
          ))}
        </div>
      </div>

      {/* Mercados Visitante */}
      <div>
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">
          {analysis.awayTeam} (Visitante)
        </p>
        <div className="space-y-1.5">
          {analysis.equivalentesVisitante.map((m, i) => (
            <MarketRow key={i} m={m} />
          ))}
        </div>
      </div>
    </div>
  );
}
