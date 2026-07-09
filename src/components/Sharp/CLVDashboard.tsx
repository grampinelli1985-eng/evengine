/**
 * CLVDashboard.tsx — Painel de Closing Line Value para plano Sharp
 *
 * Exibe o histórico de CLV, resumo estatístico e exportação CSV.
 * Disponível apenas para usuários com plano 'sharp'.
 */

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Download, RefreshCw, Star } from 'lucide-react';
import { getCLVSummary, getEntradasCLV, exportarCLVcsv, CLVEntry, CLVSummary } from '../../services/clvService';

interface CLVDashboardProps {
  plan: string;
}

function clvColor(pct: number | null): string {
  if (pct === null) return 'text-gray-400';
  if (pct >= 1.5) return 'text-emerald-400';
  if (pct >= 0) return 'text-yellow-400';
  return 'text-red-400';
}

function clvIcon(pct: number | null) {
  if (pct === null) return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  if (pct >= 0) return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
}

function ResultBadge({ resultado }: { resultado: CLVEntry['resultado'] }) {
  const map: Record<string, string> = {
    GREEN: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    RED: 'bg-red-500/20 text-red-400 border-red-500/30',
    VOID: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    PENDENTE: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border ${map[resultado] ?? map['PENDENTE']}`}>
      {resultado}
    </span>
  );
}

export default function CLVDashboard({ plan }: CLVDashboardProps) {
  const [summary, setSummary] = useState<CLVSummary | null>(null);
  const [entries, setEntries] = useState<CLVEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    try {
      setSummary(getCLVSummary());
      setEntries(getEntradasCLV().slice().reverse()); // mais recente primeiro
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleExport = () => {
    const csv = exportarCLVcsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evengine_clv_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (plan !== 'sharp') {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-6 text-center">
        <Star className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
        <p className="text-yellow-300 font-semibold">Painel CLV — Plano Sharp</p>
        <p className="text-gray-400 text-sm mt-1">Rastreamento de Closing Line Value disponível no plano Sharp.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Closing Line Value
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            CLV% = (Odd Usada / Odd Fechamento − 1) × 100. Positivo = você bateu o mercado.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="p-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {entries.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm hover:bg-emerald-500/20 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-gray-400">Entradas</p>
            <p className="text-2xl font-bold text-white mt-1">{summary.totalEntradas}</p>
            <p className="text-xs text-gray-500">{summary.comCLV} com fechamento</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-gray-400">CLV Médio</p>
            <p className={`text-2xl font-bold mt-1 ${clvColor(summary.clvMedioGeral)}`}>
              {summary.comCLV > 0 ? `${summary.clvMedioGeral > 0 ? '+' : ''}${summary.clvMedioGeral.toFixed(2)}%` : '—'}
            </p>
            <p className="text-xs text-gray-500">todas as entradas</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-gray-400">CLV Positivo</p>
            <p className={`text-2xl font-bold mt-1 ${summary.positivoCLVRate >= 55 ? 'text-emerald-400' : 'text-gray-300'}`}>
              {summary.comCLV > 0 ? `${summary.positivoCLVRate.toFixed(0)}%` : '—'}
            </p>
            <p className="text-xs text-gray-500">das entradas</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-gray-400">Status</p>
            {summary.isSharp ? (
              <div className="mt-1 flex items-center gap-1">
                <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                <span className="text-yellow-300 font-bold text-sm">SHARP</span>
              </div>
            ) : (
              <p className="text-gray-400 text-sm mt-1">
                {summary.comCLV < 10 ? `${10 - summary.comCLV} entradas p/ avaliar` : 'Sem edge'}
              </p>
            )}
            <p className="text-xs text-gray-500">CLV ≥ +1.5% (10+ entradas)</p>
          </div>
        </div>
      )}

      {/* Entries Table */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <TrendingUp className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Nenhuma entrada CLV ainda.</p>
          <p className="text-gray-500 text-sm mt-1">As entradas são registradas automaticamente ao aprovar análises.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400 text-xs">
                  <th className="text-left px-3 py-2.5">Data</th>
                  <th className="text-left px-3 py-2.5">Partida</th>
                  <th className="text-left px-3 py-2.5">Mercado</th>
                  <th className="text-right px-3 py-2.5">Odd Usada</th>
                  <th className="text-right px-3 py-2.5">Odd Fech.</th>
                  <th className="text-right px-3 py-2.5">CLV%</th>
                  <th className="text-center px-3 py-2.5">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr
                    key={`${e.matchId}_${e.mercado}_${i}`}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors"
                  >
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {e.analyzedAt.split('T')[0]}
                    </td>
                    <td className="px-3 py-2 text-white whitespace-nowrap">
                      <span className="text-xs">{e.homeTeam} × {e.awayTeam}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-300 text-xs">{e.mercado}</td>
                    <td className="px-3 py-2 text-right text-white font-mono">{e.oddUtilizada.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-gray-300 font-mono">
                      {e.oddFechamento !== null ? e.oddFechamento.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">
                      <span className={`flex items-center justify-end gap-1 ${clvColor(e.clvPct)}`}>
                        {clvIcon(e.clvPct)}
                        {e.clvPct !== null
                          ? `${e.clvPct > 0 ? '+' : ''}${e.clvPct.toFixed(2)}%`
                          : '—'
                        }
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ResultBadge resultado={e.resultado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
