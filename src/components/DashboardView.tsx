import React, { useEffect, useState, useMemo } from 'react';
import { Match, AnalysisResponse } from '../types';
import { 
  Activity, CheckCircle2, Ban, Calendar, ChevronRight, 
  TrendingUp, Award, Clock, DollarSign, HelpCircle, 
  AlertCircle, Shield
} from 'lucide-react';
import { getBanca } from '../services/bancaService';
import { supabase } from '../services/supabaseClient';
import { isLigaOperavel } from '../config/leagues';

interface DashboardViewProps {
  matches: Match[];
  analyzedMatches: Record<string, AnalysisResponse>;
  onAnalyze: (match: Match) => void;
  onNavigateToMatches: () => void;
  onNavigateToDocs?: () => void;
  modoOperacao?: boolean;
  setModoOperacao?: (v: boolean) => void;
}

export default function DashboardView({ 
  matches, 
  analyzedMatches, 
  onAnalyze, 
  onNavigateToMatches,
  onNavigateToDocs,
  modoOperacao = true,
  setModoOperacao
}: DashboardViewProps) {
  const banca = getBanca();
  const [dbStats, setDbStats] = useState<{
    total: number;
    aprovados: number;
    bloqueados: number;
    blockReasons: Record<string, number>;
  } | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // 1. Carregar estatísticas do Supabase para o dia de hoje
  useEffect(() => {
    async function loadTodayStats() {
      if (!supabase) {
        setLoadingStats(false);
        return;
      }
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data, error } = await supabase
          .from('analyses')
          .select('gate_status, block_reasons')
          .gte('created_at', today.toISOString());

        if (error) {
          console.warn('[Dashboard] Erro ao buscar análises:', error.message);
          setLoadingStats(false);
          return;
        }

        if (data) {
          const total = data.length;
          const aprovados = data.filter(d => d.gate_status === 'APROVADO').length;
          const bloqueados = total - aprovados;

          const blockReasons: Record<string, number> = {
            'B1_ev_baixo': 0,
            'B3_convergencia': 0,
            'B-DADOS': 0,
            'B-NO-REF': 0
          };

          data.forEach(d => {
            const reasons = d.block_reasons || [];
            reasons.forEach((r: string) => {
              const mapped = r === 'B8_convergencia' ? 'B3_convergencia' : r;
              if (mapped in blockReasons) {
                blockReasons[mapped]++;
              } else {
                // Outros motivos
                blockReasons[mapped] = (blockReasons[mapped] || 0) + 1;
              }
            });
          });

          setDbStats({ total, aprovados, bloqueados, blockReasons });
        }
      } catch (err) {
        console.warn('[Dashboard] Erro inesperado ao carregar stats:', err);
      } finally {
        setLoadingStats(false);
      }
    }

    loadTodayStats();
  }, []);

  // 2. Calcular estatísticas locais em tempo real (fallback/mescladas)
  const localStats = useMemo(() => {
    const localAnalyses = Object.values(analyzedMatches);
    const total = localAnalyses.length;
    const aprovados = localAnalyses.filter(a => a?.tipsterEngine?.status === 'APROVADO').length;
    const bloqueados = total - aprovados;

    const blockReasons: Record<string, number> = {
      'B1_ev_baixo': 0,
      'B3_convergencia': 0,
      'B-DADOS': 0,
      'B-NO-REF': 0
    };

    localAnalyses.forEach(a => {
      const status = a?.tipsterEngine?.status;
      if (status !== 'APROVADO' && a?.tipsterEngine?.bloqueio?.codigo) {
        const codigo = a.tipsterEngine.bloqueio.codigo;
        const mappedKey = codigo === 'B1' ? 'B1_ev_baixo' :
                          (codigo === 'B3' || codigo === 'B8') ? 'B3_convergencia' :
                          codigo;
        if (mappedKey in blockReasons) {
          blockReasons[mappedKey]++;
        }
      }
    });

    return { total, aprovados, bloqueados, blockReasons };
  }, [analyzedMatches]);

  // Mesclar dados do DB e Local para garantir frescor
  const stats = useMemo(() => {
    const activeStats = dbStats || localStats;
    // Se o banco tiver menos que o local (por delay ou offline), usar o maior
    const total = Math.max(activeStats.total, localStats.total);
    const aprovados = Math.max(activeStats.aprovados, localStats.aprovados);
    const bloqueados = total - aprovados;

    const blockReasons: Record<string, number> = {};
    const keys = ['B1_ev_baixo', 'B3_convergencia', 'B-DADOS', 'B-NO-REF'];
    keys.forEach(k => {
      blockReasons[k] = Math.max(activeStats.blockReasons[k] || 0, localStats.blockReasons[k] || 0);
    });

    return { total, aprovados, bloqueados, blockReasons };
  }, [dbStats, localStats]);

  const pctAprovados = stats.total > 0 ? Math.round((stats.aprovados / stats.total) * 100) : 0;

  // 3. Filtrar próximos jogos aprovados das próximas 48h
  const proximosJogosAprovados = useMemo(() => {
    const now = new Date();
    const limit48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    return matches
      .filter(m => {
        const startTime = new Date(m.commence_time);
        // Exibir jogos futuros dentro da janela de 48h
        if (startTime < now || startTime > limit48h) return false;

        const analysis = analyzedMatches[m.id];
        return analysis?.tipsterEngine?.status === 'APROVADO';
      })
      .map(m => {
        const analysis = analyzedMatches[m.id];
        const te = analysis.tipsterEngine;
        
        const marketName = te.mercado?.nome || 'Over 1.5 Gols';
        const referenceOdd = te.mercado?.odd || 1.80;
        const ev = te.evExecution !== undefined ? te.evExecution : te.ev || 0;
        const kelly = te.stake?.stake_final || 0;
        const stakeMoney = (banca.total * kelly) / 100;

        return {
          match: m,
          marketName,
          referenceOdd,
          ev,
          kelly,
          stakeMoney
        };
      })
      .sort((a, b) => new Date(a.match.commence_time).getTime() - new Date(b.match.commence_time).getTime());
  }, [matches, analyzedMatches, banca.total]);

  return (
    <div className="space-y-10 animate-in fade-in duration-500 text-left">
      
      {/* Hero Welcome banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/10 via-purple-600/5 to-transparent border border-white/10 rounded-[2.5rem] p-8 sm:p-10">
        <div className="absolute right-0 top-0 w-96 h-96 bg-blue-600/10 rounded-full filter blur-[100px] pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-600/10 border border-blue-500/20 rounded-full text-[10px] font-black uppercase tracking-widest text-blue-400">
              <Award size={12} />
              <span>PAINEL OPERACIONAL</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-tight">
              Bem-vindo ao <span className="text-blue-500">EVEngine AI</span>
            </h1>
            <p className="text-xs sm:text-sm text-white/50 max-w-xl font-medium leading-relaxed">
              Monitore a integridade do seu bankroll, gerencie operações estatísticas diárias e execute apostas baseadas em desvios de valor validados pelo Gate v2.4.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0 w-full sm:w-auto">
            <button
              onClick={() => onNavigateToDocs?.()}
              className="w-full sm:w-auto px-6 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 group shrink-0 cursor-pointer"
            >
              <span>Manual & Suporte</span>
              <HelpCircle size={14} className="text-blue-400 group-hover:scale-110 transition-transform" />
            </button>

            <button
              onClick={onNavigateToMatches}
              className="w-full sm:w-auto px-6 py-3.5 bg-blue-500 hover:bg-blue-400 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 flex items-center justify-center gap-2 group shrink-0 cursor-pointer"
            >
              <span>Ver Todas as Partidas</span>
              <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>

      {/* SEÇÃO TOGGLE LIGAS OPERÁVEIS */}
      {setModoOperacao && (
        <section className="bg-[#0f0f11] border border-white/5 rounded-3xl p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <Shield size={20} className="text-blue-500" />
              <h2 className="text-lg font-black text-white uppercase tracking-wider">Filtro de Ligas Operáveis</h2>
            </div>
            {(() => {
              const hojeMidnight = new Date();
              hojeMidnight.setHours(23, 59, 59, 999);
              
              const jogosHoje = matches.filter(m => {
                const d = new Date(m.commence_time);
                // considera os de hoje pre-jogo ou andamento
                return d <= hojeMidnight && m.status !== 'completed';
              });
              const operaveisHoje = jogosHoje.filter(m => isLigaOperavel(m.sport_title || m.sport_key));
              const naoOperaveisHoje = jogosHoje.length - operaveisHoje.length;
              return (
                <div className="space-y-1">
                  <p className="text-[12px] text-white/50 font-medium max-w-xl leading-relaxed">
                    Operação séria foca em liquidez. Ligas de várzea ou com baixa cobertura de dados são ocultadas na grade.
                  </p>
                  <p className="text-[11px] text-white font-bold tracking-wide mt-2">
                    Jogos disponíveis hoje: <span className="text-blue-400 font-black text-sm">{operaveisHoje.length}</span> 
                    {naoOperaveisHoje > 0 && (
                      <span className="text-white/40 ml-1">({naoOperaveisHoje} filtrados como não-operáveis)</span>
                    )}
                  </p>
                </div>
              );
            })()}
          </div>

          <div className="relative z-10 flex bg-[#0a0a0b] border border-white/10 p-1 rounded-xl shrink-0 self-stretch lg:self-auto flex-col sm:flex-row">
            <button
              onClick={() => setModoOperacao(true)}
              className={`px-5 py-3 sm:py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                modoOperacao 
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' 
                  : 'text-white/40 hover:text-white/80'
              }`}
            >
              Operação (Recomendado)
            </button>
            <button
              onClick={() => setModoOperacao(false)}
              className={`px-5 py-3 sm:py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                !modoOperacao 
                  ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/20' 
                  : 'text-white/40 hover:text-white/80'
              }`}
            >
              Auditoria (Tudo)
            </button>
          </div>
        </section>
      )}

      {/* SEÇÃO HOJE */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-blue-500" />
          <h2 className="text-lg font-black text-white uppercase tracking-wider">Métricas de Operação Diária</h2>
          <div className="h-[1px] bg-white/10 grow" />
          <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Hoje</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card: Jogos Analisados */}
          <div className="bg-[#0f0f11] border border-white/5 p-6 rounded-2xl flex items-center justify-between group hover:border-white/10 transition-all">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block">Jogos Analisados</span>
              <span className="text-3xl font-mono font-black text-white block">{stats.total}</span>
            </div>
            <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-white/60 group-hover:scale-105 transition-transform">
              <Calendar size={20} />
            </div>
          </div>

          {/* Card: Aprovados */}
          <div className="bg-[#0f0f11] border border-green-500/10 p-6 rounded-2xl flex items-center justify-between group hover:border-green-500/20 transition-all">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-green-500/60 uppercase tracking-widest block">Aprovados</span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-mono font-black text-green-400">{stats.aprovados}</span>
                <span className="text-xs font-mono font-bold text-green-500/60">({pctAprovados}%)</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center text-green-400 group-hover:scale-105 transition-transform">
              <CheckCircle2 size={20} />
            </div>
          </div>

          {/* Card: Bloqueados */}
          <div className="bg-[#0f0f11] border border-white/5 p-6 rounded-2xl flex items-center justify-between group hover:border-white/10 transition-all">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest block">Bloqueados</span>
              <span className="text-3xl font-mono font-black text-white/50 block">{stats.bloqueados}</span>
            </div>
            <div className="w-12 h-12 bg-white/[0.02] rounded-xl flex items-center justify-center text-white/30 group-hover:scale-105 transition-transform">
              <Ban size={20} />
            </div>
          </div>
        </div>

        {/* Motivos de Bloqueio Chart */}
        <div className="bg-[#0f0f11] border border-white/5 p-6 rounded-3xl space-y-6">
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">Funil de Bloqueios Gate v2.4</h3>
            <p className="text-[10px] text-white/30 uppercase font-bold tracking-wider mt-1">
              Fatores impeditivos de segurança que bloquearam análises hoje
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { type: 'B1_ev_baixo', name: 'EV Insuficiente', color: 'bg-rose-500', desc: 'EV < 3%' },
              { type: 'B3_convergencia', name: 'Poisson Divergente', color: 'bg-amber-500', desc: 'Desvio IA×Poisson > 15pp' },
              { type: 'B-DADOS', name: 'Dados Insuficientes', color: 'bg-purple-500', desc: 'Scouting indisponível' },
              { type: 'B-NO-REF', name: 'Sem Referência Sharp', color: 'bg-blue-500', desc: 'Odds de referência ausentes' }
            ].map(item => {
              const count = stats.blockReasons[item.type] || 0;
              const totalBlocks = stats.bloqueados || 1;
              const barPct = stats.bloqueados > 0 ? (count / totalBlocks) * 100 : 0;

              return (
                <div key={item.type} className="p-4 bg-white/[0.02] border border-white/[0.03] rounded-xl space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-[10px] font-black text-white/70 uppercase tracking-widest">{item.name}</h4>
                      <p className="text-[8px] font-mono font-bold text-white/20 uppercase tracking-tighter mt-0.5">{item.desc}</p>
                    </div>
                    <span className="text-lg font-mono font-black text-white/80">{count}</span>
                  </div>
                  
                  {/* CSS bar graph */}
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${item.color} transition-all duration-500`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[8px] font-mono text-white/30 font-bold uppercase tracking-tighter">
                    <span>Funil</span>
                    <span>{stats.bloqueados > 0 ? Math.round(barPct) : 0}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PRÓXIMOS JOGOS APROVADOS (48h) */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Clock size={18} className="text-emerald-500" />
          <h2 className="text-lg font-black text-white uppercase tracking-wider">Próximos Confrontos Aprovados</h2>
          <div className="h-[1px] bg-white/10 grow" />
          <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Próximas 48 Horas</span>
        </div>

        {proximosJogosAprovados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 bg-[#0f0f11] border border-dashed border-white/10 rounded-3xl text-center space-y-4">
            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-white/20">
              <Calendar size={24} />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Nenhum Confronto Aprovado</h3>
              <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mt-1 max-w-xs mx-auto leading-relaxed">
                Nenhum jogo das próximas 48h foi analisado e aprovado pelo Gate de segurança ainda hoje.
              </p>
            </div>
            <button
              onClick={onNavigateToMatches}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-black text-white uppercase tracking-wider transition-all"
            >
              Analisar Partidas
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {proximosJogosAprovados.map(({ match, marketName, referenceOdd, ev, kelly, stakeMoney }) => {
              const gameDate = new Date(match.commence_time);
              const formattedTime = gameDate.toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit' 
              });
              const formattedDate = gameDate.toLocaleDateString('pt-BR', { 
                day: '2-digit', 
                month: '2-digit' 
              });

              return (
                <div 
                  key={match.id}
                  className="bg-[#0f0f11] border border-emerald-500/10 hover:border-emerald-500/20 rounded-3xl p-6 flex flex-col justify-between gap-6 transition-all hover:shadow-[0_0_30px_rgba(16,185,129,0.02)] group"
                >
                  <div className="space-y-4">
                    {/* Header: League and commence time */}
                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5 pb-3">
                      <span>{match.sport_title}</span>
                      <div className="flex items-center gap-1.5 font-mono text-emerald-400">
                        <Clock size={10} />
                        <span>{formattedDate} - {formattedTime}</span>
                      </div>
                    </div>

                    {/* Matchup */}
                    <div>
                      <h3 className="text-base font-black text-white tracking-tight uppercase group-hover:text-emerald-400 transition-colors">
                        {match.home_team} <span className="text-white/20 font-bold mx-1">vs</span> {match.away_team}
                      </h3>
                    </div>

                    {/* Palpite e Odd */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-white/[0.02] border border-white/[0.03] rounded-xl">
                        <span className="text-[8px] text-white/20 uppercase font-black tracking-widest block mb-1">Palpite Recom.</span>
                        <span className="text-[11px] font-black text-white uppercase tracking-wider block truncate">{marketName}</span>
                      </div>

                      <div className="p-3 bg-white/[0.02] border border-white/[0.03] rounded-xl">
                        <span className="text-[8px] text-white/20 uppercase font-black tracking-widest block mb-1">Odd Referência</span>
                        <span className="text-[11px] font-mono font-black text-emerald-400 block">{referenceOdd.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* EV, Kelly & Stake Allocation */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 bg-white/[0.02] border border-white/[0.03] rounded-xl text-center">
                        <span className="text-[8px] text-white/20 uppercase font-black tracking-widest block mb-1">EV Advantage</span>
                        <span className="text-xs font-mono font-black text-emerald-400">+{ev.toFixed(1)}%</span>
                      </div>

                      <div className="p-3 bg-white/[0.02] border border-white/[0.03] rounded-xl text-center">
                        <span className="text-[8px] text-white/20 uppercase font-black tracking-widest block mb-1">Kelly Stake</span>
                        <span className="text-xs font-mono font-black text-white/80">{kelly.toFixed(1)}%</span>
                      </div>

                      <div className="p-3 bg-white/[0.02] border border-white/[0.03] rounded-xl text-center">
                        <span className="text-[8px] text-white/20 uppercase font-black tracking-widest block mb-1">Valor R$</span>
                        <span className="text-xs font-mono font-black text-emerald-400">R$ {stakeMoney.toFixed(0)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Button */}
                  <button
                    onClick={() => onAnalyze(match)}
                    className="w-full py-3 bg-white/5 hover:bg-[#00e676] text-white hover:text-[#0d0d1a] border border-white/10 hover:border-transparent font-black text-[10px] uppercase tracking-[0.2em] rounded-xl transition-all shadow-md group-hover:shadow-[#00e676]/10 flex items-center justify-center gap-2"
                  >
                    <span>Analisar Agora</span>
                    <ChevronRight size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SEÇÃO CENTRAL DE AJUDA & MATEMÁTICA */}
      <section className="bg-gradient-to-br from-blue-950/20 via-purple-950/10 to-transparent border border-white/5 rounded-3xl p-6 sm:p-8 space-y-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/5 rounded-full filter blur-[80px] pointer-events-none group-hover:bg-blue-600/10 transition-colors duration-500" />
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-white/5">
          <div className="space-y-1">
            <h3 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Shield size={18} className="text-blue-400" />
              Central de Inteligência Quantitativa
            </h3>
            <p className="text-[11px] text-white/50 font-medium font-sans">
              Aprenda a ciência estatística que governa a operação de apostas de valor do EVEngine AI.
            </p>
          </div>
          <button
            onClick={() => onNavigateToDocs?.()}
            className="px-4 py-2 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer flex items-center gap-2 group/btn"
          >
            <span>Acessar Documentação</span>
            <ChevronRight size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="p-4 bg-white/[0.01] border border-white/[0.03] rounded-2xl hover:border-white/10 hover:bg-white/[0.02] transition-all duration-300 space-y-2 flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-2xl">📊</span>
              <h4 className="text-xs font-black text-white uppercase tracking-wider">Modelos Poisson & ELO</h4>
              <p className="text-[10px] text-white/40 leading-relaxed font-mono">
                Entenda como projetamos a distribuição de gols esperada e determinamos a força relativa limpa livre de comissões de casas.
              </p>
            </div>
            <button
              onClick={() => {
                if (onNavigateToDocs) {
                  onNavigateToDocs();
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('evengine_navigate_docs', { detail: { sectionId: 'como-funciona' } }));
                  }, 100);
                }
              }}
              className="text-left text-[9px] font-black text-blue-400 uppercase tracking-wider hover:underline pt-2 cursor-pointer"
            >
              Ver Fórmulas →
            </button>
          </div>

          <div className="p-4 bg-white/[0.01] border border-white/[0.03] rounded-2xl hover:border-white/10 hover:bg-white/[0.02] transition-all duration-300 space-y-2 flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-2xl">🛡️</span>
              <h4 className="text-xs font-black text-white uppercase tracking-wider">Os 9 Gates de Risco</h4>
              <p className="text-[10px] text-white/40 leading-relaxed font-mono">
                Conheça as 9 travas automáticas que barram palpites sem valor, divergências e mitigam o viés otimista de zebras de IA.
              </p>
            </div>
            <button
              onClick={() => {
                if (onNavigateToDocs) {
                  onNavigateToDocs();
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('evengine_navigate_docs', { detail: { sectionId: 'os-9-gates' } }));
                  }, 100);
                }
              }}
              className="text-left text-[9px] font-black text-blue-400 uppercase tracking-wider hover:underline pt-2 cursor-pointer"
            >
              Entender Trava de Zebras →
            </button>
          </div>

          <div className="p-4 bg-white/[0.01] border border-white/[0.03] rounded-2xl hover:border-white/10 hover:bg-white/[0.02] transition-all duration-300 space-y-2 flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-2xl">📋</span>
              <h4 className="text-xs font-black text-white uppercase tracking-wider">Manual de Paper Trading</h4>
              <p className="text-[10px] text-white/40 leading-relaxed font-mono">
                Consulte o guia científico de 30 dias de simulação estrita e aprenda a auditar e validar seu CLV (Closing Line Value).
              </p>
            </div>
            <button
              onClick={() => {
                if (onNavigateToDocs) {
                  onNavigateToDocs();
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('evengine_navigate_docs', { detail: { sectionId: 'paper-trading' } }));
                  }, 100);
                }
              }}
              className="text-left text-[9px] font-black text-blue-400 uppercase tracking-wider hover:underline pt-2 cursor-pointer"
            >
              Auditar Meu Timing →
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
