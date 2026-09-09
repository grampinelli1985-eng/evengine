import { useState, useEffect } from 'react';
import {
  getEntradasCLV,
  getCLVSummary,
  exportarCLVcsv,
  limparEntradasAntigas,
  CLVEntry,
  CLVSummary,
} from '../services/clvService';

interface Props {
  onBack: () => void;
}

export default function CLVDashboardView({ onBack }: Props) {
  const [entries, setEntries] = useState<CLVEntry[]>([]);
  const [summary, setSummary] = useState<CLVSummary | null>(null);
  const [filter, setFilter] = useState<'all' | 'GREEN' | 'RED' | 'PENDENTE'>('all');

  useEffect(() => {
    limparEntradasAntigas();
    setEntries(getEntradasCLV());
    setSummary(getCLVSummary());
  }, []);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.resultado === filter);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime()
  );

  function handleExport() {
    const csv = exportarCLVcsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clv_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const clvColor = (v: number | null) => {
    if (v === null) return 'text-gray-400';
    if (v > 0) return 'text-emerald-400';
    if (v < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  const resultadoBadge = (r: CLVEntry['resultado']) => {
    const map: Record<CLVEntry['resultado'], string> = {
      GREEN: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      RED: 'bg-red-500/20 text-red-400 border-red-500/30',
      VOID: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      PENDENTE: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    };
    return map[r];
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-xl hover:bg-white/10 transition-colors"
          aria-label="Voltar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-lg leading-tight">CLV Dashboard</h1>
          <p className="text-xs text-gray-400">Closing Line Value — rastreador de edge</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          CSV
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SummaryCard
              label="Entradas rastreadas"
              value={String(summary.totalEntradas)}
              sub={`${summary.comCLV} com fechamento`}
            />
            <SummaryCard
              label="CLV médio geral"
              value={summary.comCLV > 0 ? `${summary.clvMedioGeral > 0 ? '+' : ''}${summary.clvMedioGeral}%` : '—'}
              valueClass={summary.clvMedioGeral > 0 ? 'text-emerald-400' : summary.clvMedioGeral < 0 ? 'text-red-400' : 'text-gray-300'}
              sub="vs. odd de fechamento"
            />
            <SummaryCard
              label="Taxa CLV positivo"
              value={summary.comCLV > 0 ? `${summary.positivoCLVRate}%` : '—'}
              sub="entradas acima da linha"
            />
            <SummaryCard
              label="CLV médio (GREENs)"
              value={summary.clvMedioAprovadas > 0 ? `+${summary.clvMedioAprovadas}%` : summary.clvMedioAprovadas < 0 ? `${summary.clvMedioAprovadas}%` : '—'}
              valueClass={summary.clvMedioAprovadas > 0 ? 'text-emerald-400' : 'text-gray-300'}
              sub="apostas vencedoras"
            />
            <div className={`col-span-2 sm:col-span-2 rounded-2xl border p-4 flex items-center gap-4 ${summary.isSharp ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}>
              <div className="text-3xl">{summary.isSharp ? '⚡' : '📊'}</div>
              <div>
                <div className={`font-bold text-sm ${summary.isSharp ? 'text-emerald-400' : 'text-gray-300'}`}>
                  {summary.isSharp ? 'Perfil Sharp detectado' : 'Ainda não é Sharp'}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {summary.isSharp
                    ? 'CLV médio ≥ 1,5% com ≥ 10 entradas'
                    : `Precisa CLV médio ≥ 1,5% e ≥ 10 entradas (atual: ${summary.comCLV})`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(['all', 'GREEN', 'RED', 'PENDENTE'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors border ${
                filter === f
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
              }`}
            >
              {f === 'all' ? 'Todas' : f}
              <span className="ml-1 opacity-60">
                ({f === 'all' ? entries.length : entries.filter(e => e.resultado === f).length})
              </span>
            </button>
          ))}
        </div>

        {/* Entries Table */}
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-4xl mb-3">📉</div>
            <div className="font-medium">Nenhuma entrada CLV</div>
            <div className="text-sm mt-1">As entradas aparecem ao aprovar análises</div>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((e, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {e.homeTeam} × {e.awayTeam}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">
                      {e.mercado} · {new Date(e.analyzedAt).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium ${resultadoBadge(e.resultado)}`}>
                    {e.resultado}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Stat label="Odd usada" value={e.oddUtilizada.toFixed(2)} />
                  <Stat label="Odd fechamento" value={e.oddFechamento !== null ? e.oddFechamento.toFixed(2) : '—'} />
                  <Stat
                    label="CLV%"
                    value={e.clvPct !== null ? `${e.clvPct > 0 ? '+' : ''}${e.clvPct}%` : '—'}
                    valueClass={clvColor(e.clvPct)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  valueClass = 'text-gray-100',
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass = 'text-gray-200',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-white/5 rounded-xl px-2 py-1.5">
      <div className="text-gray-500 text-[10px] mb-0.5">{label}</div>
      <div className={`font-mono font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}
