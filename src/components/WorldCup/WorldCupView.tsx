import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, RefreshCw, Trophy, Globe, BarChart3, Activity, Calendar } from 'lucide-react';
import { WCMatch, WCAnalysisResult, WC_TOURNAMENTS, WCTournament } from '../../services/worldCup/wcTypes';
import { fetchWCMatches } from '../../services/worldCup/wcOddsService';
import { runWCTipsterEngine } from '../../services/worldCup/wcTipsterEngine';
import { fetchWCApiFootballData, WCApiFootballData } from '../../services/worldCup/wcApiFootballService';
import { getAllWCRatings } from '../../services/worldCup/wcEloService';
import { canAnalyzeToday, incrementAnalysesToday } from '../../services/planService';
import WorldCupMatchCard from './WorldCupMatchCard';
import { buildLiveKey } from '../../services/liveTrackerService';

interface WorldCupViewProps {
  onBack: () => void;
  bancaAtual?: number;
  liveResults?: Record<string, string>;
  liveScores?: Record<string, { matchId: string; placar: string; minuto: number; statusShort: string; finished: false }>;
  showApprovedOnly?: boolean;
  analyzedMatches?: Record<string, any>;
  onAnalyze?: (match: any) => Promise<any> | void;
}

type DateFilter = 1 | 2 | 3 | 7;

const DATE_FILTERS: { label: string; value: DateFilter }[] = [
  { label: 'Hoje', value: 1 },
  { label: '48H', value: 2 },
  { label: '72H', value: 3 },
  { label: '7 Dias', value: 7 },
];

function matchWithinDays(match: WCMatch, days: DateFilter): boolean {
  const now = Date.now();
  const cutoff = now + days * 24 * 60 * 60 * 1000;
  const t = new Date(match.commence_time).getTime();
  return t >= now - 2 * 60 * 60 * 1000 && t <= cutoff;
}

export default function WorldCupView({
  onBack,
  bancaAtual = 1000,
  liveResults,
  liveScores
}: WorldCupViewProps) {
  const [matches, setMatches] = useState<WCMatch[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, WCAnalysisResult>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'partidas' | 'rankings'>('partidas');
  const [activeTournament, setActiveTournament] = useState<WCTournament | 'all'>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>(7);
  const [showApprovedOnly, setShowApprovedOnly] = useState(false);

  const wcRankings = useMemo(() => getAllWCRatings(), []);

  useEffect(() => {
    loadMatches();
  }, []);

  async function loadMatches() {
    setLoading(true);
    const apiKey = import.meta.env.VITE_ODDS_API_KEY ?? '';
    const data = await fetchWCMatches(apiKey);
    setMatches(data);
    setLoading(false);
  }

  async function handleAnalyze(match: WCMatch) {
    const isReAnalysis = !!analyses[match.id];

    if (!isReAnalysis && !canAnalyzeToday()) {
      window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'));
      return;
    }

    setAnalyzingId(match.id);
    await new Promise(r => setTimeout(r, 300));

    // Fetch API-Football data concurrently (non-blocking — falls back gracefully)
    let apiData: WCApiFootballData | null = null;
    try {
      apiData = await fetchWCApiFootballData(
        match.home_team,
        match.away_team,
        match.sport_key,
        match.commence_time
      );
    } catch {
      // API-Football unavailable — engine runs without enrichment
    }

    const result = runWCTipsterEngine(match, bancaAtual, apiData);
    setAnalyses(prev => ({ ...prev, [match.id]: result }));

    window.dispatchEvent(new CustomEvent('evengine_track_match', {
      detail: {
        matchId: match.id,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        commenceTime: match.commence_time
      }
    }));

    if (!isReAnalysis) {
      await incrementAnalysesToday();
    }

    setAnalyzingId(null);
  }

  async function handleAnalyzeAll() {
    for (const match of filteredMatches) {
      if (!analyses[match.id]) {
        if (!canAnalyzeToday()) {
          window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'));
          break;
        }
        await handleAnalyze(match);
        // Sleep for 800ms to avoid API rate limit (max 10 req/min on free plan)
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
  }

  const filteredMatches = useMemo(() => {
    let list = matches;
    if (activeTournament !== 'all') {
      list = list.filter(m => m.sport_key === activeTournament);
    }
    list = list.filter(m => matchWithinDays(m, dateFilter));
    return list.sort((a, b) =>
      new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime()
    );
  }, [matches, activeTournament, dateFilter]);

  const stats = useMemo(() => {
    const analyzed = Object.values(analyses).filter(a =>
      filteredMatches.some(m => m.id === a.matchId)
    );
    const approved = analyzed.filter(a => a.gate.status === 'APROVADO');
    return {
      total: filteredMatches.length,
      analyzed: analyzed.length,
      approved: approved.length,
      avgEV: approved.length > 0
        ? (approved.reduce((s, a) => s + a.gate.mercado.ev, 0) / approved.length).toFixed(1)
        : '0.0',
    };
  }, [analyses, filteredMatches]);

  const displayedMatches = useMemo(() => {
    if (!showApprovedOnly) return filteredMatches;
    return filteredMatches.filter(m => analyses[m.id]?.gate?.status === 'APROVADO');
  }, [filteredMatches, analyses, showApprovedOnly]);

  return (
    <div translate="no" className="min-h-screen bg-[#080809] text-white font-sans">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <Trophy size={20} className="text-yellow-500" />
                <h1 className="text-2xl font-black uppercase tracking-tight">
                  Copa do Mundo <span className="text-yellow-500">2026</span>
                </h1>
              </div>
              <p className="text-[9px] font-mono text-white/20 uppercase tracking-widest mt-0.5">
                Motor ELO + Poisson WC · Gate v2.2 · API-Football
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAnalyzeAll}
              disabled={loading || filteredMatches.length === 0}
              className="px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 text-yellow-400 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-30 flex items-center gap-2"
            >
              <Activity size={12} />
              Analisar Todos
            </button>
            <button
              onClick={loadMatches}
              disabled={loading}
              className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all disabled:opacity-30"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Partidas', value: stats.total, color: 'text-white' },
            { label: 'Analisadas', value: stats.analyzed, color: 'text-blue-400' },
            { label: 'Aprovadas Gate', value: stats.approved, color: 'text-emerald-400', filterable: true },
            { label: 'EV Médio', value: `${stats.avgEV}%`, color: 'text-yellow-400' },
          ].map(s => (
            <div
              key={s.label}
              onClick={s.filterable ? () => setShowApprovedOnly(prev => !prev) : undefined}
              className={`bg-[#0d0d10] border rounded-2xl p-4 text-center transition-all ${
                s.filterable
                  ? 'cursor-pointer hover:bg-white/[0.04] active:scale-95 ' + (showApprovedOnly ? 'border-emerald-500/30 bg-emerald-500/[0.02]' : 'border-white/[0.06]')
                  : 'border-white/[0.06]'
              }`}
            >
              <div className="text-[8px] text-white/20 font-black uppercase tracking-widest mb-1">{s.label}</div>
              <div className={`text-2xl font-mono font-black ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2">
          {(['partidas', 'rankings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                activeTab === tab
                  ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                  : 'bg-white/[0.02] border-white/[0.06] text-white/30 hover:text-white/60'
              }`}
            >
              {tab === 'partidas'
                ? <><Globe size={10} className="inline mr-1.5" />Partidas</>
                : <><BarChart3 size={10} className="inline mr-1.5" />Rankings ELO</>
              }
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'partidas' ? (
            <motion.div key="partidas" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

              {/* Filters Row */}
              <div className="flex flex-wrap items-center gap-3 mb-6">

                {/* Date Filter */}
                <div className="flex items-center gap-1.5 bg-[#0d0d10] border border-white/[0.06] rounded-2xl p-1.5">
                  <Calendar size={12} className="text-white/20 ml-1.5" />
                  {DATE_FILTERS.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setDateFilter(f.value)}
                      className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                        dateFilter === f.value
                          ? 'bg-yellow-500 text-black shadow-sm'
                          : 'text-white/30 hover:text-white/70'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Tournament Filter */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setActiveTournament('all')}
                    className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all ${
                      activeTournament === 'all'
                        ? 'bg-white/10 border-white/20 text-white'
                        : 'border-white/[0.06] text-white/20 hover:text-white/50'
                    }`}
                  >
                    🌍 Todos
                  </button>
                  {WC_TOURNAMENTS.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setActiveTournament(t.key)}
                      className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all ${
                        activeTournament === t.key
                          ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                          : 'border-white/[0.06] text-white/20 hover:text-white/50'
                      }`}
                    >
                      {t.flag} {t.name}
                    </button>
                  ))}
                </div>

                {/* Gate Filter */}
                <button
                  onClick={() => setShowApprovedOnly(prev => !prev)}
                  className={`px-3.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all flex items-center gap-1.5 ${
                    showApprovedOnly
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 font-bold'
                      : 'border-white/[0.06] text-white/20 hover:text-white/50 bg-[#0d0d10]/40'
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full ${showApprovedOnly ? 'bg-emerald-400 animate-pulse' : 'bg-white/25'}`} />
                  Aprovadas Gate
                </button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-24 space-y-4">
                  <div className="w-10 h-10 border-t-2 border-yellow-500 rounded-full animate-spin" />
                  <p className="text-white/20 font-mono text-[10px] uppercase tracking-widest">
                    Buscando partidas internacionais...
                  </p>
                </div>
              ) : displayedMatches.length === 0 ? (
                <div className="text-center py-24 space-y-3">
                  <Trophy size={40} className="text-white/10 mx-auto" />
                  <p className="text-white/20 text-sm font-black uppercase tracking-wider">
                    {showApprovedOnly ? 'Sem partidas aprovadas pelo Gate' : `Sem partidas nos próximos ${dateFilter === 1 ? 'hoje' : `${dateFilter} dias`}`}
                  </p>
                  <p className="text-white/10 text-[10px] font-mono max-w-xs mx-auto leading-relaxed">
                    {showApprovedOnly
                      ? 'Tente analisar mais partidas ou amplie os outros filtros de data e torneio.'
                      : 'Tente ampliar o filtro de data ou aguarde a divulgação dos jogos pela The Odds API'}
                  </p>
                  {!showApprovedOnly && (
                    <button
                      onClick={() => setDateFilter(7)}
                      className="mt-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all hover:bg-yellow-500/20"
                    >
                      Ver 7 dias
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {displayedMatches.map(match => {
                    const lk = buildLiveKey(match.home_team, match.away_team);
                    const placarFinal = liveResults?.[lk];
                    const placarParcial = liveScores?.[lk];
                    const placarExibido = placarFinal
                      ?? (placarParcial ? `${placarParcial.placar} · ${placarParcial.minuto}'` : null);

                    return (
                      <WorldCupMatchCard
                        key={match.id}
                        match={match}
                        analysis={analyses[match.id]}
                        isAnalyzing={analyzingId === match.id}
                        onAnalyze={handleAnalyze}
                        placar={placarExibido}
                        placarAoVivo={!placarFinal && placarParcial != null}
                      />
                    );
                  })}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="rankings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="bg-[#0d0d10] border border-white/[0.06] rounded-[2rem] overflow-hidden">
                <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-3">
                  <BarChart3 size={16} className="text-yellow-500" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-white">
                    Ranking ELO — Seleções Nacionais
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-white/[0.02]">
                        <th className="px-6 py-3 text-[8px] font-black text-white/30 uppercase tracking-widest">#</th>
                        <th className="px-6 py-3 text-[8px] font-black text-white/30 uppercase tracking-widest">Seleção</th>
                        <th className="px-6 py-3 text-[8px] font-black text-white/30 uppercase tracking-widest">Confederação</th>
                        <th className="px-6 py-3 text-[8px] font-black text-white/30 uppercase tracking-widest">Rating ELO</th>
                        <th className="px-6 py-3 text-[8px] font-black text-white/30 uppercase tracking-widest">Tier</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {wcRankings.slice(0, 32).map((team, idx) => {
                        const tier = team.eloRating >= 1750 ? 'S' :
                                     team.eloRating >= 1650 ? 'A' :
                                     team.eloRating >= 1550 ? 'B' : 'C';
                        const tierColor = tier === 'S' ? 'text-yellow-400' :
                                          tier === 'A' ? 'text-emerald-400' :
                                          tier === 'B' ? 'text-blue-400' : 'text-white/30';
                        return (
                          <tr key={team.name} className="hover:bg-white/[0.01] transition-colors">
                            <td className="px-6 py-3 text-[10px] font-mono text-white/30">{idx + 1}</td>
                            <td className="px-6 py-3 text-[11px] font-bold text-white">{team.name}</td>
                            <td className="px-6 py-3 text-[9px] font-mono text-white/40 uppercase">{team.confederation}</td>
                            <td className="px-6 py-3 text-[11px] font-mono font-black text-white">{team.eloRating}</td>
                            <td className={`px-6 py-3 text-[11px] font-black ${tierColor}`}>{tier}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
