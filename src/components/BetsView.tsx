import React, { useEffect, useState, useMemo } from 'react';
import {
  fetchBets, resolveBet, calculatePerformanceMetrics, resetBets, Bet
} from '../services/betService';
import CLVDashboard from './Sharp/CLVDashboard';
import { 
  TrendingUp, Award, DollarSign, Activity, AlertTriangle, 
  Check, X as CloseIcon, Filter, Calendar, BookOpen, 
  HelpCircle, CheckCircle2, AlertOctagon, RefreshCw, BarChart2,
  Trash2, Lock
} from 'lucide-react';
import { getBanca } from '../services/bancaService';
import { useUserPlan } from '../hooks/useUserPlan';
import { canViewHistory, canTrackCLV, canExportCSV } from '../services/planService';
import { supabase } from '../services/supabaseClient';
import { showToast } from './Toast';
import { atualizarResultadoCLV } from '../services/clvService';

interface BetsViewProps {
  onBack: () => void;
}

export default function BetsView({ onBack }: BetsViewProps) {
  const { plan } = useUserPlan();
  const banca = getBanca();
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filtros
  const [statusFilter, setStatusFilter] = useState('all');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');
  const [bookmakerFilter, setBookmakerFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState<'todas' | 'hoje' | '7d' | '30d'>('todas');

  // Modal de Resolução
  const [resolvingBet, setResolvingBet] = useState<Bet | null>(null);
  const [resStatus, setResStatus] = useState<'green' | 'red' | 'void' | 'cashout'>('green');
  const [resCashoutAmount, setResCashoutAmount] = useState('');
  const [resScore, setResScore] = useState('');
  const [resClosingOdd, setResClosingOdd] = useState('');
  const [resNotes, setResNotes] = useState('');
  const [savingResolution, setSavingResolution] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Carregar apostas
  const loadBetsData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      let data = await fetchBets({
        status: statusFilter,
        league: leagueFilter === 'all' ? undefined : leagueFilter,
        market: marketFilter === 'all' ? undefined : marketFilter,
        bookmaker: bookmakerFilter,
        period: periodFilter
      });

      // Filter by plan constraints
      const now = Date.now();
      let limitDays = 7;
      if (plan === 'sharp') limitDays = 365;
      else if (plan === 'pro') limitDays = 90;
      
      const limitMs = limitDays * 24 * 60 * 60 * 1000;
      data = data.filter(bet => {
        const betTime = new Date(bet.created_at).getTime();
        return (now - betTime) <= limitMs;
      });

      setBets(data);
    } catch (e) {
      console.warn('[BetsView] Erro ao carregar apostas:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadBetsData();
  }, [statusFilter, leagueFilter, marketFilter, bookmakerFilter, periodFilter]);

  // Lista única de ligas e mercados das apostas carregadas para popular os seletores de filtros
  const filterOptions = useMemo(() => {
    const leaguesSet = new Set<string>();
    const marketsSet = new Set<string>();

    bets.forEach((b) => {
      if (b.analyses?.league) leaguesSet.add(b.analyses.league);
      if (b.market) {
        // Normalizar um pouco para não ter 50 opções idênticas
        if (b.market.toLowerCase().includes('over 1.5')) marketsSet.add('Over 1.5');
        else if (b.market.toLowerCase().includes('over 2.5')) marketsSet.add('Over 2.5');
        else if (b.market.toLowerCase().includes('casa') || b.market.toLowerCase().includes('1x')) marketsSet.add('Casa');
        else if (b.market.toLowerCase().includes('visitante') || b.market.toLowerCase().includes('x2')) marketsSet.add('Visitante');
        else marketsSet.add(b.market);
      }
    });

    return {
      leagues: Array.from(leaguesSet),
      markets: Array.from(marketsSet)
    };
  }, [bets]);

  // Calcular métricas agregadas da amostra atual de apostas (filtrada ou total)
  const metrics = useMemo(() => {
    const baseMetrics = calculatePerformanceMetrics(bets);
    
    // Custom CLV calculation using closing_odd_pinnacle
    const clvBets = bets.filter(b => b.status !== 'pending' && (b as any).closing_odd_pinnacle && (b as any).closing_odd_pinnacle > 0);
    let clvSum = 0;
    clvBets.forEach(b => {
      const closingPinnacle = (b as any).closing_odd_pinnacle;
      const clv = (b.odd_taken / closingPinnacle - 1) * 100;
      clvSum += clv;
    });
    
    const avgCLV = clvBets.length > 0 ? clvSum / clvBets.length : 0;
    
    return {
      ...baseMetrics,
      avgCLV
    };
  }, [bets]);

  // Handler de Resolução
  const handleResolveBet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingBet) return;

    setSavingResolution(true);
    setErrorMessage(null);

    const closingOddVal = resClosingOdd ? parseFloat(resClosingOdd) : undefined;
    const cashoutAmountVal = resStatus === 'cashout' ? parseFloat(resCashoutAmount) : undefined;

    if (resStatus === 'cashout' && (cashoutAmountVal === undefined || isNaN(cashoutAmountVal))) {
      setErrorMessage('Por favor, informe o valor recuperado no cashout.');
      setSavingResolution(false);
      return;
    }

    try {
      const resolved = await resolveBet(resolvingBet.id, {
        status: resStatus,
        result_amount: cashoutAmountVal,
        match_score: resScore || undefined,
        closing_odd: closingOddVal || undefined,
        notes: resNotes || undefined
      });

      if (resolved) {
        if (closingOddVal && supabase) {
          await supabase
            .from('bets')
            .update({ closing_odd_pinnacle: closingOddVal })
            .eq('id', resolvingBet.id);
        }

        // Sincronizar resultado no tracker CLV local (localStorage)
        const clvStatus = resStatus === 'green' ? 'GREEN' : resStatus === 'red' ? 'RED' : 'VOID';
        if (resolvingBet.analysis_id) {
          atualizarResultadoCLV(resolvingBet.analysis_id, clvStatus);
        }

        setResolvingBet(null);
        // Reset form
        setResCashoutAmount('');
        setResScore('');
        setResClosingOdd('');
        setResNotes('');
        loadBetsData(true);
      } else {
        setErrorMessage('Falha ao gravar resolução da aposta. Tente novamente.');
      }
    } catch (err) {
      console.warn('[BetsView] Erro ao resolver aposta:', err);
      setErrorMessage('Erro inesperado de conexão.');
    } finally {
      setSavingResolution(false);
    }
  };

  const handleExportCSV = () => {
    if (!canExportCSV()) {
      window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal', { detail: { targetPlan: 'sharp' } }));
      return;
    }
    
    // Export resolved bets
    const resolvedBets = bets.filter(b => b.status !== 'pending');
    if (resolvedBets.length === 0) {
      showToast.info('Nenhuma aposta resolvida para exportar.');
      return;
    }
    
    const headers = ['Data', 'Confronto', 'Mercado', 'Odd', 'Stake', 'Resultado', 'PnL', 'CLV (%)'];
    const rows = resolvedBets.map(b => {
      const pnl = b.status === 'green' ? (b.stake_amount * (b.odd_taken - 1)) : b.status === 'red' ? -b.stake_amount : 0;
      
      let clv = '0.00';
      if ((b as any).closing_odd_pinnacle) {
        clv = ((b.odd_taken / (b as any).closing_odd_pinnacle - 1) * 100).toFixed(2);
      }
      
      const home = b.analyses?.home_team || '';
      const away = b.analyses?.away_team || '';
      const dateStr = new Date(b.created_at).toLocaleDateString('pt-BR');
      
      return [
        dateStr,
        `"${home} vs ${away}"`,
        `"${b.market}"`,
        b.odd_taken.toFixed(2),
        b.stake_amount.toFixed(2),
        b.status.toUpperCase(),
        pnl.toFixed(2),
        clv
      ].join(',');
    });
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `evengine_apostas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleResetBets = async () => {
    const confirmed = window.confirm("Tem certeza que deseja resetar TODAS as apostas registradas? Esta ação é irreversível!");
    if (!confirmed) return;

    try {
      const success = await resetBets();
      if (success) {
        showToast.success("Todos os registros de apostas foram excluídos com sucesso!");
        loadBetsData();
      } else {
        showToast.error("Houve uma falha ao resetar os dados de apostas.");
      }
    } catch (e) {
      showToast.error("Erro de conexão ao tentar resetar apostas.");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 text-left">
      
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-white uppercase tracking-tight">Auditoria & Post-Mortem</h1>
          <p className="text-xs text-white/40 uppercase font-black tracking-widest mt-1">
            Rastreabilidade de Apostas Feitas e Desempenho Estatístico
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleExportCSV}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
              canExportCSV()
                ? 'bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 text-emerald-500'
                : 'bg-white/5 border border-white/10 text-white/40 hover:bg-white/10'
            }`}
          >
            {!canExportCSV() && <Lock size={12} />}
            <span>Exportar CSV</span>
          </button>

          <button 
            onClick={handleResetBets}
            className="flex items-center gap-2 px-4 py-3 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 hover:border-rose-500/30 text-rose-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
          >
            <Trash2 size={14} />
            <span>Resetar Dados</span>
          </button>

          <button 
            onClick={() => loadBetsData(true)}
            className={`p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all ${refreshing ? 'animate-spin text-blue-500' : 'text-white/60'}`}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* CARD DE PERFORMANCE (ÚLTIMAS N APOSTAS) */}
      <section className="bg-[#0f0f11] border border-white/5 rounded-[2.5rem] p-6 sm:p-8 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        
        <div className="relative space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-black text-white/50 uppercase tracking-widest">Painel de Performance Histórica</h3>
            <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded">
              {bets.filter(b => b.status !== 'pending').length} APOSTAS RESOLVIDAS
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            
            {/* Wins / Losses / Voids */}
            <div className="space-y-1">
              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block">Registro</span>
              <div className="text-lg font-mono font-black text-white block">
                {metrics.wins}W - {metrics.losses}L - {metrics.voids}V
              </div>
              <span className="text-[8px] font-bold text-white/20 uppercase tracking-tighter block">
                Hit Rate: {metrics.hitRate}%
              </span>
            </div>

            {/* ROI */}
            <div className="space-y-1">
              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block">ROI</span>
              <div className={`text-lg font-mono font-black block ${metrics.roi > 0 ? 'text-green-400' : metrics.roi < 0 ? 'text-rose-500' : 'text-white/40'}`}>
                {metrics.roi >= 0 ? '+' : ''}{metrics.roi}%
              </div>
              <span className="text-[8px] font-bold text-white/20 uppercase tracking-tighter block">
                Retorno s/ Investimento
              </span>
            </div>

            {/* Stake Total */}
            <div className="space-y-1">
              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block">Stake Total</span>
              <div className="text-lg font-mono font-black text-white block">
                R$ {metrics.totalStake.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[8px] font-bold text-white/20 uppercase tracking-tighter block">
                Banca Alocada
              </span>
            </div>

            {/* Net Resultado */}
            <div className="space-y-1">
              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block">Resultado PnL</span>
              <div className={`text-lg font-mono font-black block ${metrics.netResult > 0 ? 'text-green-400' : metrics.netResult < 0 ? 'text-rose-500' : 'text-white/40'}`}>
                {metrics.netResult >= 0 ? '+' : ''}R$ {metrics.netResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[8px] font-bold text-white/20 uppercase tracking-tighter block">
                Resultado Líquido
              </span>
            </div>

            {/* CLV Médio */}
            <div className="space-y-1 col-span-2 md:col-span-1 relative">
              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block">CLV Médio</span>
              {!canTrackCLV() ? (
                <div 
                  onClick={() => window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'))}
                  className="flex items-center gap-1.5 py-1 text-white/20 select-none cursor-pointer hover:text-white/40 transition-colors"
                >
                  <Lock size={12} className="text-blue-500" />
                  <span className="text-[10px] font-black uppercase tracking-wider">UPGRADE PRO</span>
                </div>
              ) : (
                <>
                  <div className={`text-lg font-mono font-black block ${metrics.avgCLV > 0 ? 'text-green-400' : metrics.avgCLV < 0 ? 'text-rose-500' : 'text-white/40'}`}>
                    {metrics.avgCLV >= 0 ? '+' : ''}{metrics.avgCLV.toFixed(1)}%
                  </div>
                  <span className="text-[8px] font-bold text-white/20 uppercase tracking-tighter block">
                    Desvio contra Linha Final
                  </span>
                </>
              )}
            </div>

          </div>
        </div>
      </section>

      {/* CLV DASHBOARD — plano Sharp */}
      {plan === 'sharp' && (
        <section className="bg-[#0f0f11] border border-white/5 rounded-[2.5rem] p-6 sm:p-8">
          <CLVDashboard plan={plan} />
        </section>
      )}

      {/* FILTROS AVANÇADOS */}
      <section className="bg-[#0f0f11] border border-white/5 rounded-3xl p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-blue-500" />
          <h3 className="text-xs font-black text-white uppercase tracking-wider">Filtros Operacionais</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          
          {/* Status Filter */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-white/30 uppercase tracking-wider block">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-[#141416] border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="resolved">Resolvidos</option>
              <option value="green">Green</option>
              <option value="red">Red</option>
              <option value="void">Void</option>
              <option value="cashout">Cashout</option>
            </select>
          </div>

          {/* League Filter */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-white/30 uppercase tracking-wider block">Liga</label>
            <select
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
              className="w-full bg-[#141416] border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">Todas as Ligas</option>
              {filterOptions.leagues.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          {/* Market Filter */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-white/30 uppercase tracking-wider block">Mercado</label>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="w-full bg-[#141416] border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">Todos os Mercados</option>
              {filterOptions.markets.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Bookmaker Filter */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-white/30 uppercase tracking-wider block">Bookmaker</label>
            <select
              value={bookmakerFilter}
              onChange={(e) => setBookmakerFilter(e.target.value)}
              className="w-full bg-[#141416] border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="all">Todos</option>
              <option value="bet365">Bet365</option>
              <option value="pinnacle">Pinnacle</option>
              <option value="betfair">Betfair</option>
            </select>
          </div>

          {/* Period Filter */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-white/30 uppercase tracking-wider block">Período</label>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as "todas" | "hoje" | "7d" | "30d")}
              className="w-full bg-[#141416] border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="todas">Sempre</option>
              <option value="hoje">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>

        </div>
      </section>

      {/* LISTA DE APOSTAS */}
      <section className="space-y-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <RefreshCw size={24} className="animate-spin text-blue-500" />
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Buscando Apostas...</span>
          </div>
        ) : bets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-[#0f0f11] border border-dashed border-white/10 rounded-[2rem] text-center space-y-4">
            <BookOpen size={32} className="text-white/20" />
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Nenhuma Aposta Encontrada</h3>
              <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mt-1">
                Nenhum palpite foi registrado com esses filtros operacionais.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {bets.map((bet) => {
              const profit = bet.result_amount !== null ? bet.result_amount - bet.stake_amount : null;
              
              // CLV Cálculo
              let clv: number | null = null;
              if (bet.closing_odd && bet.closing_odd > 0) {
                clv = ((bet.odd_taken / bet.closing_odd) - 1) * 100;
              }

              return (
                <div 
                  key={bet.id}
                  className={`bg-[#0f0f11] border border-white/5 hover:border-white/10 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all`}
                >
                  <div className="flex-1 space-y-2.5 min-w-0">
                    {/* Header meta */}
                    <div className="flex flex-wrap items-center gap-2 text-[9px] font-black uppercase tracking-widest text-white/30">
                      <span className="text-blue-400 bg-blue-500/10 px-2 py-0.5 border border-blue-500/20 rounded">
                        {bet.analyses?.league || 'LIGA GERAL'}
                      </span>
                      <span>•</span>
                      <span>{new Date(bet.created_at).toLocaleDateString('pt-BR')}</span>
                      <span>•</span>
                      <span className="font-mono text-white/40">{bet.bookmaker}</span>
                    </div>

                    {/* Matchup & Market */}
                    <div>
                      <h3 className="text-sm font-black text-white tracking-tight uppercase">
                        {bet.analyses?.home_team || 'Time Casa'} <span className="text-white/20 mx-1">vs</span> {bet.analyses?.away_team || 'Time Fora'}
                      </h3>
                      <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider mt-0.5">
                        Palpite: <span className="text-white font-black">{bet.market}</span> @ <span className="font-mono text-emerald-400 font-bold">{bet.odd_taken.toFixed(2)}</span>
                      </p>
                    </div>

                    {/* Resolved tags */}
                    {bet.status !== 'pending' && (
                      <div className="flex flex-wrap items-center gap-3">
                        {bet.match_score && (
                          <span className="text-[9px] font-mono font-bold bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/60">
                            Placar: {bet.match_score}
                          </span>
                        )}
                        {clv !== null && (
                          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1 ${clv > 0 ? 'bg-green-500/10 border border-green-500/20 text-green-400' : clv < 0 ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' : 'bg-white/5 border border-white/10 text-white/50'}`}>
                            CLV: {clv >= 0 ? '+' : ''}{clv.toFixed(1)}%
                          </span>
                        )}
                        {bet.notes && (
                          <p className="text-[9px] text-white/30 italic max-w-md truncate">"{bet.notes}"</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right hand side: Stake/Resolutions */}
                  <div className="flex md:flex-col justify-between items-center md:items-end w-full md:w-auto border-t md:border-t-0 border-white/5 pt-4 md:pt-0 gap-4">
                    {/* Amounts */}
                    <div className="text-left md:text-right">
                      <span className="text-[9px] text-white/20 uppercase font-black tracking-widest block">Aposta</span>
                      <span className="text-sm font-mono font-black text-white block">
                        R$ {bet.stake_amount.toFixed(0)}
                      </span>
                    </div>

                    {/* Status Badge & Resolution trigger */}
                    {bet.status === 'pending' ? (
                      <button
                        onClick={() => setResolvingBet(bet)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black text-[9px] uppercase tracking-widest rounded-xl transition-all shadow-md hover:shadow-blue-600/15"
                      >
                        Marcar Resultado
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        {/* profit value tag */}
                        <div className="text-right">
                          <span className="text-[8px] text-white/20 uppercase font-black tracking-widest block">Retorno</span>
                          <span className={`text-xs font-mono font-black ${profit != null && profit > 0 ? 'text-green-400' : profit != null && profit < 0 ? 'text-rose-500' : 'text-white/40'}`}>
                            {profit != null && profit >= 0 ? '+' : ''}R$ {profit != null ? profit.toFixed(2) : '—'}
                          </span>
                        </div>

                        {/* Visual Badge */}
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border ${
                          bet.status === 'green' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                          bet.status === 'red' ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' :
                          bet.status === 'void' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                          'bg-white/5 border-white/10 text-white/50'
                        }`}>
                          {bet.status === 'green' ? 'W' :
                           bet.status === 'red' ? 'L' :
                           bet.status === 'void' ? 'V' : 'C'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* MODAL DE RESOLUÇÃO */}
      {resolvingBet && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="relative w-full max-w-md bg-[#141416] border border-white/[0.08] rounded-3xl shadow-2xl overflow-hidden p-6 space-y-6">
            
            {/* Header */}
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="text-blue-500" size={18} />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Resolver Aposta</h3>
              </div>
              <button 
                onClick={() => setResolvingBet(null)}
                className="p-1 hover:bg-white/5 text-white/40 hover:text-white rounded-lg transition-colors"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleResolveBet} className="space-y-4">
              
              {/* Event detail */}
              <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl text-xs space-y-1">
                <p className="text-white/40 uppercase font-black tracking-widest text-[8px]">Confronto</p>
                <p className="text-white font-bold uppercase">{resolvingBet.analyses?.home_team} x {resolvingBet.analyses?.away_team}</p>
                <p className="text-white/60">Palpite: <strong>{resolvingBet.market}</strong> @ <strong>{resolvingBet.odd_taken.toFixed(2)}</strong> (R$ {resolvingBet.stake_amount.toFixed(0)})</p>
              </div>

              {/* Status Selector */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest block">Status da Aposta</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { key: 'green', name: 'Green', color: 'border-green-500/30 text-green-400 bg-green-500/5 hover:bg-green-500/10' },
                    { key: 'red', name: 'Red', color: 'border-rose-500/30 text-rose-500 bg-rose-500/5 hover:bg-rose-500/10' },
                    { key: 'void', name: 'Void', color: 'border-amber-500/30 text-amber-400 bg-amber-500/5 hover:bg-amber-500/10' },
                    { key: 'cashout', name: 'Cashout', color: 'border-white/10 text-white/70 bg-white/5 hover:bg-white/10' }
                  ].map(statusOpt => (
                    <button
                      key={statusOpt.key}
                      type="button"
                      onClick={() => setResStatus(statusOpt.key as any)}
                      className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${
                        resStatus === statusOpt.key 
                          ? 'border-blue-500 bg-blue-500/20 text-white scale-[1.03]' 
                          : statusOpt.color
                      }`}
                    >
                      {statusOpt.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cashout Amount (Conditional) */}
              {resStatus === 'cashout' && (
                <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-200">
                  <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest block">Valor Recuperado (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={resCashoutAmount}
                    onChange={(e) => setResCashoutAmount(e.target.value)}
                    placeholder="Ex: 14.50"
                    className="w-full bg-[#0d0d0f] border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              )}

              {/* Placar Final */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest block">Placar do Jogo (Opcional)</label>
                <input
                  type="text"
                  value={resScore}
                  onChange={(e) => setResScore(e.target.value)}
                  placeholder="Ex: 2-1"
                  className="w-full bg-[#0d0d0f] border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* Odd de Fechamento */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest block">Odd de Fechamento Sharp (Opcional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={resClosingOdd}
                  onChange={(e) => setResClosingOdd(e.target.value)}
                  placeholder="Ex: 1.75 (para cálculo CLV)"
                  className="w-full bg-[#0d0d0f] border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* Notas */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest block">Notas / Observações</label>
                <textarea
                  value={resNotes}
                  onChange={(e) => setResNotes(e.target.value)}
                  placeholder="Anotações pós-mortem..."
                  rows={2}
                  className="w-full bg-[#0d0d0f] border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                />
              </div>

              {/* Error messages */}
              {errorMessage && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-rose-500 text-[10px] uppercase font-bold tracking-wider">
                  <AlertTriangle size={14} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setResolvingBet(null)}
                  className="w-1/2 py-3 bg-white/5 hover:bg-white/10 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all border border-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingResolution}
                  className="w-1/2 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-600/15 flex items-center justify-center gap-2"
                >
                  {savingResolution ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>Salvar Resultado</span>
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
