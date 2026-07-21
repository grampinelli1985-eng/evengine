import { useEffect, useState } from 'react';
import { fetchRecentAnalyses, fetchStats } from '../services/telemetryService';
import { supabase } from '../services/supabaseClient';
import { BarChart3, Clock, Target, AlertTriangle, ShieldCheck, Activity, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';

interface TelemetryViewProps {
  onBack: () => void;
}

export default function TelemetryView({ onBack }: TelemetryViewProps) {
  const [rawAnalyses, setRawAnalyses] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'TODOS' | 'APROVADO' | 'BLOQUEADO'>('TODOS');

  async function loadData() {
    setLoading(true);
    const [recent, statsData] = await Promise.all([
      fetchRecentAnalyses(300), // fetch more to allow deduplication and filtering
      fetchStats(7)
    ]);
    
    // Remove duplicates (keep only the most recent analysis per match)
    const uniqueMatches = new Map();
    recent.forEach((row: any) => {
      const matchKey = `${row.home_team}-${row.away_team}`;
      if (!uniqueMatches.has(matchKey)) {
        uniqueMatches.set(matchKey, row);
      }
    });

    setRawAnalyses(Array.from(uniqueMatches.values()));
    setStats(statsData);
    setLoading(false);
  }

  const displayAnalyses = rawAnalyses
    .filter(a => filter === 'TODOS' || a.status === filter)
    .slice(0, 50);

  useEffect(() => {
    loadData();
  }, []);

  if (!supabase) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] text-white flex flex-col items-center justify-center p-6">
        <AlertTriangle size={48} className="text-amber-500 mb-4" />
        <h2 className="text-xl font-bold uppercase tracking-widest mb-2">Telemetria Indisponível</h2>
        <p className="text-white/40 text-sm">Verifique as configurações do Supabase no arquivo .env</p>
        <button 
          onClick={onBack}
          className="mt-8 px-6 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white/10"
        >
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-[#e1e1e3] p-4 sm:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-10">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tighter italic">Telemetria <span className="text-blue-500">Persistida</span></h1>
              <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest mt-1">Sincronizado com Supabase-SP</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[9px] font-black text-green-500 uppercase tracking-widest">Live Monitoring</span>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <div className="w-10 h-10 border-t-2 border-blue-500 rounded-full animate-spin" />
            <p className="text-white/20 font-mono text-[10px] uppercase tracking-widest">Acessando banco de dados...</p>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard 
                label="Total Análises" 
                value={stats?.total || 0} 
                sub="Últimos 7 dias"
                icon={<BarChart3 className="text-blue-500" size={18} />}
              />
              <StatCard 
                label="Taxa Aprovação" 
                value={`${(100 - (stats?.taxaBloqueio || 0)).toFixed(1)}%`} 
                sub={`${stats?.aprovados || 0} aprovadas`}
                icon={<ShieldCheck className="text-green-500" size={18} />}
              />
              <StatCard 
                label="Motivo Veto Top" 
                value={stats?.motivosTop?.[0]?.reason || 'N/A'}
                sub={`${stats?.motivosTop?.[0]?.count || 0} ocorrências`}
                icon={<AlertTriangle className="text-rose-500" size={18} />}
              />
              <StatCard 
                label="Liga Dominante" 
                value={stats?.ligasTop?.[0]?.league?.replace('soccer_', '') || 'N/A'}
                sub={`${stats?.ligasTop?.[0]?.count || 0} análises`}
                icon={<Activity className="text-purple-500" size={18} />}
              />
            </div>

            {/* Main Table */}
            <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] overflow-hidden shadow-2xl">
              <div className="px-8 py-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                  <Clock size={16} className="text-white/40" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Log de Análises (Últimas 50)</h3>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex bg-white/5 rounded-lg p-1 mr-4">
                    {(['TODOS', 'APROVADO', 'BLOQUEADO'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                          filter === f 
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                            : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <button 
                    onClick={() => loadData()}
                    className="text-[9px] font-black text-white/20 hover:text-white uppercase tracking-widest transition-colors flex items-center gap-2"
                  >
                    Atualizar
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02]">
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Data/Hora</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Jogo</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Liga</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Mercado</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">EV</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Kelly</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Score</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Status</th>
                      <th className="px-6 py-4 text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">Motivos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {displayAnalyses.map((row) => (
                      <tr key={row.id} className="hover:bg-white/[0.01] transition-colors">
                        <td className="px-6 py-4 text-[10px] font-mono text-white/40">
                          {new Date(row.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          <div className="text-[8px] opacity-50">{new Date(row.created_at).toLocaleDateString('pt-BR')}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-[11px] font-bold text-white/80">{row.home_team} vs {row.away_team}</div>
                        </td>
                        <td className="px-6 py-4 text-[10px] text-white/40 uppercase font-bold tracking-tighter">
                          {row.league.replace('soccer_', '')}
                        </td>
                        <td className="px-6 py-4 text-[10px] font-black text-blue-400 uppercase">
                          {row.market}
                        </td>
                        <td className={`px-6 py-4 text-[10px] font-mono font-bold ${row.ev_execution >= 3 ? 'text-green-500' : 'text-white/20'}`}>
                          {row.ev_execution ? `${row.ev_execution.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-6 py-4 text-[10px] font-mono text-white/60">
                          {row.kelly_calculated ? `${row.kelly_calculated.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-1 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500" style={{ width: `${row.composite_score}%` }} />
                            </div>
                            <span className="text-[10px] font-mono font-bold text-white/60">{row.composite_score}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                            row.gate_status === 'APROVADO' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                          }`}>
                            {row.gate_status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {row.block_reasons?.map((r: string) => (
                              <span key={r} className="px-1.5 py-0.5 bg-white/5 rounded text-[7px] font-bold text-white/40 uppercase">
                                {r}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {displayAnalyses.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-6 py-20 text-center text-white/10 text-xs font-black uppercase tracking-widest">
                          Nenhuma análise registrada no Supabase.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: any) {
  return (
    <div className="bg-[#141416] border border-white/[0.08] p-6 rounded-[1.5rem] relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        {icon}
      </div>
      <span className="text-[10px] text-white/20 uppercase font-black tracking-[0.2em] mb-2 block">{label}</span>
      <div 
        className={`font-mono font-black text-white tracking-tighter mb-1 ${typeof value === 'string' && value.length > 15 ? 'text-base sm:text-lg line-clamp-3 leading-tight mt-2' : 'text-3xl'}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
      <span className="text-[9px] font-bold text-white/10 uppercase tracking-widest italic">{sub}</span>
    </div>
  );
}
