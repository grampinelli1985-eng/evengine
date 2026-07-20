/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Match, LEAGUES, AnalysisResponse } from './types';
import { fetchAllMatches, getOddsApiQuotaInfo } from './services/oddsService';
import { analyzeMatch } from './services/geminiService';
import MatchCardTipster from './components/MatchCardTipster';
import SkeletonMatch from './components/SkeletonMatch';
import AnalysisView from './components/AnalysisView';
import TicketModal from './components/TicketModal';
import LiveNotification from './components/LiveNotification';
import LeagueSidebar from './components/LeagueSidebar';
import { getBanca, calculateKellyStake, carregarStopLossState } from './services/bancaService';
import { Trophy, Filter, RefreshCw, Search, AlertCircle, TrendingUp, Ticket, Menu, X, Zap, Flame, Shield, Activity, Crown, Star, Sun, Compass, Award, Home, BookOpen, ShieldOff, AlertTriangle, LogOut, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from './contexts/AuthContext';
import { syncQuotaFromAPI } from './services/apiQuotaService';
import { seedEloFromOdds, sanitizeEloRatings, calcularEstadoJogo, EstadoJogo, atualizarEloPartida } from './services/eloService';
import { registerOpeningOdds, detectLineMovement } from './services/lineMovementService';
import { registrarEntradaCLV, capturarOddsFechamento } from './services/clvService';
import { analisarMatchAH } from './services/asianHandicapService';
import { calcularValueBets, validateReport } from './services/valueBetService';
import { runTipsterEngine } from './services/tipsterEngine';
import { buscarEstatisticasMedias, buscarH2H } from './services/scoutingService';
import BancaModal from './components/BancaModal';
import { getBancaAtual, setBancaAtual } from './services/bancaService';
import { registrarPrevisao, resolverPrevisoesPendentes } from './services/calibrationService';
import HistoricoModal from './components/HistoricoModal';
import { ResultadoModal } from './components/ResultadoModal';
import TelemetryView from './components/TelemetryView';
import DashboardView from './components/DashboardView';
import BetsView from './components/BetsView';
import PendenciasView from './components/PendenciasView';
import { updateMatchResultInSupabase } from './services/telemetryService';
import { isLigaOperavel } from './config/leagues';
import DocumentationView from './components/Documentation/DocumentationView';
import WorldCupView from './components/WorldCup/WorldCupView';
import { useUserPlan } from './hooks/useUserPlan';
import { 
  canAnalyzeToday, 
  canAccessLeague, 
  canAccessWorldCup, 
  canViewHistory, 
  canTrackCLV, 
  canExportCSV, 
  canUseOwnApiKey, 
  canAddBanca, 
  getRemainingAnalysesToday,
  incrementAnalysesToday,
  updateUserPlan,
  updateApiKeyOwn,
  setCachedProfile
} from './services/planService';
import { buildFixtureKey, getCachedAnalysis, setCachedAnalysis, cleanExpiredCache } from './services/analysisCacheService';
import { registerMatchForTracking, pollLiveResults, hasPendingLiveMatches, buildLiveKey, LiveScore, onApiError } from './services/liveTrackerService';
import ApiErrorBanner, { ApiErrorType } from './components/ApiErrorBanner';
import { PlanBadge, UpgradeModal, PlanLock } from './components/PlanControl';
import { showToast, ToastContainer } from './components/Toast';
import { 
  getBancasFromSupabase, 
  addBancaToSupabase, 
  switchActiveBanca, 
  updateBancaBalance, 
  BancaDB 
} from './services/bancaService';

const APP_VERSION = "BG_V9_TIPSTER_GATE_V3";

const leagueIcons: Record<string, any> = {
  zap: Zap,
  flame: Flame,
  shield: Shield,
  activity: Activity,
  crown: Crown,
  star: Star,
  sun: Sun,
  compass: Compass,
  award: Award,
};

interface EngineAppProps {
  isPreviewMode?: boolean;
  onSignOut?: () => void;
}

export default function EngineApp({ isPreviewMode = false, onSignOut }: EngineAppProps) {
  const { user, signOut } = useAuth();
  const { profile, plan, apiKeyOwn } = useUserPlan();

  const [bancas, setBancas] = useState<BancaDB[]>([]);
  const [activeBancaId, setActiveBancaId] = useState<string | null>(() => localStorage.getItem('evengine_active_banca_id'));
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  // Stripe Checkout Init & Url query parser
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isPaymentSuccess = params.get('payment') === 'success';
    const mockPlan = params.get('mock_plan') as 'pro' | 'sharp';
    const mockUser = params.get('mock_user');
    
    if (isPaymentSuccess) {
      if (mockPlan && mockUser) {
        updateUserPlan(mockUser, mockPlan).then(() => {
          showToast.success(`Assinatura ativada! Plano ${mockPlan.toUpperCase()} ativo.`);
          window.history.replaceState({}, document.title, window.location.pathname);
        });
      } else {
        showToast.success('Pagamento confirmado! O seu plano será atualizado em instantes.');
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    const handleCheckoutInit = async (e: Event) => {
      const { plan: targetPlan } = (e as CustomEvent).detail;
      const userId = profile?.id || user?.id;
      
      if (!userId) {
        showToast.warning('Faça login para prosseguir.');
        return;
      }

      try {
        const apiHost = window.location.hostname;
        const apiBaseUrl = import.meta.env.VITE_API_URL || (apiHost === 'localhost' || apiHost === '127.0.0.1' ? 'http://localhost:3001' : `https://${apiHost}`);
        const response = await fetch(`${apiBaseUrl}/api/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ plan: targetPlan, userId, email: user?.email })
        });
        
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          showToast.error('Erro ao iniciar checkout: ' + (data.error || 'Erro desconhecido'));
        }
      } catch (err) {
        console.error(err);
        showToast.error('Erro de conexão ao iniciar checkout.');
      }
    };

    window.addEventListener('evengine_checkout_init', handleCheckoutInit);
    return () => window.removeEventListener('evengine_checkout_init', handleCheckoutInit);
  }, [profile, user]);

  // Sync bancas from Supabase for Sharp plan
  const loadBancas = async () => {
    if (profile?.id) {
      const list = await getBancasFromSupabase(profile.id);
      setBancas(list);
      
      if (list.length > 0) {
        const storedActiveId = localStorage.getItem('evengine_active_banca_id');
        const activeBanca = list.find(b => b.id === storedActiveId) || list[0];
        setActiveBancaId(activeBanca.id);
        switchActiveBanca(activeBanca);
      }
    }
  };

  useEffect(() => {
    if (plan === 'sharp') {
      loadBancas();
    } else {
      setBancas([]);
      localStorage.removeItem('evengine_active_banca_id');
      setActiveBancaId(null);
    }
  }, [profile, plan]);

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [filterLeagues, setFilterLeagues] = useState<string[]>(['all']);
  const [filterDate, setFilterDate] = useState<number>(1); // Default to 1 (Hoje)
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [analyzedMatches, setAnalyzedMatches] = useState<Record<string, AnalysisResponse>>({});
  const [isTicketOpen, setIsTicketOpen] = useState(false);
  const [isBulkAnalyzing, setIsBulkAnalyzing] = useState(false);
  const [ticketSelectionIds, setTicketSelectionIds] = useState<Set<string>>(new Set());
  const [loadingBilhete, setLoadingBilhete] = useState(false);
  const [liveNotifications, setLiveNotifications] = useState<Match[]>([]);
  const [banca, setBanca] = useState(getBanca());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Preview mode = sem autenticação, apenas visualização (sem análises)
  // Demo mode = usuário registrado com plan='demo' (5 análises totais)
  const isDemoMode = isPreviewMode && !user;
  const isDemoUser = !!user && plan === 'demo';
  const [apiFootballError, setApiFootballError] = useState<ApiErrorType>(null);

  useEffect(() => {
    const unsubscribe = onApiError((type) => {
      setApiFootballError(type);
    });
    return () => unsubscribe();
  }, []);
  const [showApprovedOnly, setShowApprovedOnly] = useState(false);
  const [bancaModalOpen, setBancaModalOpen] = useState(false);
  const [historicoModalOpen, setHistoricoModalOpen] = useState(false);
  const [bancaAtual, setBancaAtualState] = useState(getBancaAtual());
  const [resultadoModalOpen, setResultadoModalOpen] = useState(false);
  const [isExtraMenuOpen, setIsExtraMenuOpen] = useState(false);
  const extraMenuRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'dashboard' | 'main' | 'bets' | 'telemetry' | 'pendencias' | 'documentacao' | 'worldcup'>(() => {
    const saved = localStorage.getItem('evengine_active_view');
    return (saved as any) || 'dashboard';
  });
  const [prevView, setPrevView] = useState<string>(view);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  const [stopLossState, setStopLossState] = useState(() => carregarStopLossState());
  const [alertDismissed, setAlertDismissed] = useState(() => {
    return localStorage.getItem('evengine_stop_loss_alert_dismissed') === 'true';
  });
  const [liveResults, setLiveResults] = useState<Record<string, string>>({}); // matchId → placar final
  const [liveScores, setLiveScores] = useState<Record<string, LiveScore>>({}); // matchId → placar parcial
  const triggerPollRef = useRef<((force?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!isExtraMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (extraMenuRef.current && !extraMenuRef.current.contains(e.target as Node)) {
        setIsExtraMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isExtraMenuOpen]);

  useEffect(() => {
    const handleStopLossChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.suspensaoAtiva && !stopLossState.suspensaoAtiva) {
        localStorage.setItem('evengine_stop_loss_alert_dismissed', 'false');
        setAlertDismissed(false);
      }
      setStopLossState(carregarStopLossState());
    };
    window.addEventListener('evengine_stop_loss_changed', handleStopLossChange);
    return () => {
      window.removeEventListener('evengine_stop_loss_changed', handleStopLossChange);
    };
  }, [stopLossState.suspensaoAtiva]);

  // ─── Live Result Polling ────────────────────────────────────
  useEffect(() => {
    const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos

    const runPoll = async (force = false) => {
      const isWorldCup = localStorage.getItem('evengine_active_view') === 'worldcup';
      const shouldForce = force || isWorldCup;
      if (!shouldForce && !hasPendingLiveMatches()) return;

      // Capturar odds de fechamento para entradas CLV pendentes
      try {
        capturarOddsFechamento(matches);
      } catch { /* silencioso */ }

      const updates = await pollLiveResults(shouldForce);
      if (updates.length === 0) return;

      const newResults: Record<string, string> = {};
      const newScores: Record<string, LiveScore> = {};

      for (const u of updates) {
        const liveKey = buildLiveKey(u.homeTeam, u.awayTeam);
        if (u.finished) {
          newResults[liveKey] = u.placar;
          await updateMatchResultInSupabase(u.matchId, u.placar, false).catch(console.warn);
          setMatches(prev => prev.map(m =>
            m.id === u.matchId
              ? { ...m, resultado_registrado: true, resultado_placar: u.placar, resultado_data: new Date().toISOString() }
              : m
          ));
          showToast.success(`Resultado final: ${u.homeTeam} ${u.placar} ${u.awayTeam}`);
        } else {
          newScores[liveKey] = u as LiveScore;
        }
      }

      if (Object.keys(newResults).length > 0) {
        setLiveResults(prev => ({ ...prev, ...newResults }));
      }
      if (Object.keys(newScores).length > 0) {
        setLiveScores(prev => ({ ...prev, ...newScores }));
      }
    };

    // Expor runPoll para chamada imediata após análise
    triggerPollRef.current = runPoll;

    // Listener para WorldCupView (e outros componentes) registrarem e ativarem poll
    const handleTrackMatch = (e: Event) => {
      const { matchId, homeTeam, awayTeam, commenceTime } = (e as CustomEvent).detail;
      registerMatchForTracking(matchId, homeTeam, awayTeam, commenceTime);
      runPoll(true);
    };
    window.addEventListener('evengine_track_match', handleTrackMatch);

    // Primeira verificação ao montar (sem esperar 10min)
    runPoll();
    const interval = setInterval(runPoll, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      window.removeEventListener('evengine_track_match', handleTrackMatch);
    };
  }, []);

  useEffect(() => {
    const viewOrder: Record<string, number> = {
      dashboard: 0,
      main: 1,
      bets: 2,
      pendencias: 3,
      documentacao: 4,
      telemetry: 5
    };
    const prevIndex = viewOrder[prevView] ?? 0;
    const currIndex = viewOrder[view] ?? 0;
    
    if (currIndex > prevIndex) {
      setDirection('forward');
    } else if (currIndex < prevIndex) {
      setDirection('backward');
    }
    setPrevView(view);
  }, [view]);

  const slideVariants = {
    initial: (dir: 'forward' | 'backward') => ({
      opacity: 0,
      x: dir === 'forward' ? 30 : -30,
      scale: 0.99
    }),
    animate: {
      opacity: 1,
      x: 0,
      scale: 1
    },
    exit: (dir: 'forward' | 'backward') => ({
      opacity: 0,
      x: dir === 'forward' ? -30 : 30,
      scale: 0.99
    })
  };

  const slideTransition = {
    duration: 0.28,
    ease: [0.16, 1, 0.3, 1]
  };
  const [resultadoPreenchido, setResultadoPreenchido] = useState<any>(undefined);
  const [modoOperacao, setModoOperacao] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  const handleBancaSalva = (novaBANCA: number) => {
    setBancaAtual(novaBANCA);
    setBancaAtualState(novaBANCA);
    setBancaModalOpen(false);
  };

  // Selection state
  const [hasStarted, setHasStarted] = useState(() => localStorage.getItem('evengine_has_started') === 'true');
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('evengine_selected_leagues');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const ODDS_API_KEY = import.meta.env.VITE_ODDS_API_KEY || '';

  useEffect(() => {
    resolverPrevisoesPendentes().catch(console.error);

    const intervalo = setInterval(() => {
      resolverPrevisoesPendentes().catch(console.error);
    }, 30 * 60 * 1000);
    
    return () => clearInterval(intervalo);
  }, []);

  // Ouvinte global para chavear a visualização para a documentação e fechar modals de análise ativos
  useEffect(() => {
    const handleNavigateTab = () => {
      setSelectedMatch(null);
      setView('documentacao');
    };
    window.addEventListener('evengine_navigate_docs_tab', handleNavigateTab);
    return () => {
      window.removeEventListener('evengine_navigate_docs_tab', handleNavigateTab);
    };
  }, []);

  // Load analyzed matches from local storage on mount
  useEffect(() => {
    // Version Check & Clean
    const storedVersion = localStorage.getItem('evengine_version');
    if (storedVersion !== APP_VERSION) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('evengine_version', APP_VERSION);
      window.location.reload();
      return;
    }

    sanitizeEloRatings();
    cleanExpiredCache().catch(console.warn);
    const init = async () => {
      try {
        await syncQuotaFromAPI();
      } catch {
        // ignorar falha de sync
      }
    };
    init();

  }, []);

  const loadMatches = async (silent = false) => {
    let currentView = view as string;
    if (currentView === 'worldcup') {
      setView('main');
      currentView = 'main';
    }

    // Copa/torneio view usa API-Football exclusivamente — não consome Odds API
    if (currentView === 'worldcup') return;

    if (!silent) setLoading(true);
    else setIsRefreshing(true);

    setError(null);
    try {
      const activeApiKey = (plan === 'sharp' && apiKeyOwn) ? apiKeyOwn : ODDS_API_KEY;
      const data = await fetchAllMatches(activeApiKey, selectedLeagues);

      // Register initial data for advanced services
      registerOpeningOdds(data);
      data.forEach(m => {
        seedEloFromOdds(m);
        detectLineMovement(m);
      });

      setMatches(data);
    } catch (err) {
      console.error(err);
      setError('Houve um erro ao buscar as partidas reais. Verifique sua chave de API e conexão.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setHasStarted(true);
    }
  };

  // Sync view state to localStorage + dispara poll imediato ao entrar na Copa
  useEffect(() => {
    localStorage.setItem('evengine_active_view', view);
    if (view === 'worldcup') {
      triggerPollRef.current?.(true);
    }
  }, [view]);

  // Sync hasStarted state to localStorage
  useEffect(() => {
    localStorage.setItem('evengine_has_started', String(hasStarted));
  }, [hasStarted]);

  // Sync selectedLeagues state to localStorage
  useEffect(() => {
    localStorage.setItem('evengine_selected_leagues', JSON.stringify(selectedLeagues));
  }, [selectedLeagues]);

  // Load matches automatically on mount if already started
  useEffect(() => {
    const started = localStorage.getItem('evengine_has_started') === 'true';
    if (started) {
      loadMatches(true);
    }
  }, []);

  // Recarrega partidas ao voltar para a view principal (evita fetch desnecessário na Copa)
  const prevViewRef = useRef<string>(view);
  useEffect(() => {
    if (prevViewRef.current === 'worldcup' && view === 'main' && hasStarted) {
      loadMatches(true);
    }
    prevViewRef.current = view;
  }, [view]);

  const toggleFilterLeague = (key: string) => {
    setFilterLeagues(prev => {
      if (key === 'all') return ['all'];
      const filtered = prev.filter(k => k !== 'all');
      if (filtered.includes(key)) {
        const next = filtered.filter(k => k !== key);
        return next.length === 0 ? ['all'] : next;
      }
      return [...filtered, key];
    });
  };

  const toggleLeague = (key: string) => {
    setSelectedLeagues(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => setSelectedLeagues(LEAGUES.map(l => l.key));
  const deselectAll = () => setSelectedLeagues([]);

  const filteredMatches = useMemo(() => {
    let filtered = [...matches];

    if (!filterLeagues.includes('all')) {
      filtered = filtered.filter(m => filterLeagues.includes(m.sport_key));
    }

    if (searchQuery.trim()) {
      const normalize = (s: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const query = normalize(searchQuery);
      filtered = filtered.filter(m =>
        normalize(m.home_team).includes(query) ||
        normalize(m.away_team).includes(query) ||
        normalize(m.sport_title).includes(query)
      );
    }

    const now = new Date();
    const limit = new Date();
    
    if (filterDate === 1) {
      // Show only today's games (until 23:59:59)
      limit.setHours(23, 59, 59, 999);
    } else {
      limit.setDate(now.getDate() + filterDate);
    }

    // Precise filtering for the selected range using ELO states
    filtered = filtered.filter(m => {
      const matchDate = new Date(m.commence_time);
      const estado = calcularEstadoJogo(m);
      
      const isVisibleState = estado === 'pre_jogo' || estado === 'ao_vivo' || estado === 'aguardando_resultado';
      if (!isVisibleState) return false;
      
      if (estado === 'pre_jogo') {
        return matchDate <= limit;
      }
      return true;
    });

    if (modoOperacao) {
      filtered = filtered.filter(m => isLigaOperavel(m.sport_key));
    }

    // Sort by date
    return filtered.sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());
  }, [matches, filterLeagues, filterDate, modoOperacao, searchQuery]);

  const approvedCount = useMemo(() =>
    filteredMatches.filter(m => analyzedMatches[m.id]?.tipsterEngine?.status === 'APROVADO').length,
    [filteredMatches, analyzedMatches]
  );

  const handleAnalyze = async (match: Match) => {
    // Preview mode: sem cadastro, redireciona para registro
    if (isDemoMode) {
      window.dispatchEvent(new CustomEvent('evengine_open_auth_modal'));
      return;
    }

    if (analyzedMatches[match.id]) {
      setSelectedMatch(match);
      setAnalysis(analyzedMatches[match.id]);
      setAnalysisLoading(false);
      return;
    }
    if (!canAnalyzeToday()) {
      window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'));
      return;
    }
    if (match.sport_key && !canAccessLeague(match.sport_key)) {
      window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'));
      return;
    }
    setSelectedMatch(match);
    setAnalysis(null);
    setAnalysisLoading(true);

    const fixtureKey = buildFixtureKey(match.home_team, match.away_team, match.commence_time);
    const cached = await getCachedAnalysis(fixtureKey).catch(() => null);
    if (cached && cached.tipsterEngine) {
      setAnalysis(cached);
      setAnalyzedMatches(prev => ({ ...prev, [match.id]: cached }));
      setAnalysisLoading(false);
      return;
    }

    try {
      const result = cached ? { ...cached } : await analyzeMatch(match);
      let statsMedias = null;
      if (!result.escanteios?.probabilidade || !result.finalizacoes?.probabilidade) {
        statsMedias = await buscarEstatisticasMedias(
          match.home_team,
          match.away_team,
          match.sport_title
        ).catch(() => null);
      }

      result.escanteios = statsMedias?.escanteios ?? result.escanteios;
      result.finalizacoes = statsMedias?.finalizacoes ?? result.finalizacoes;

      const h2hData = await buscarH2H(
        match.home_team,
        match.away_team,
        match.sport_title
      ).catch(() => null);
      result.h2h = h2hData;

      // Calculate Value Bets
      const valueReport = calcularValueBets(match, result);
      const finalReport = validateReport(valueReport);

      // Line Movement + CLV signal (unified — clvSinal from this match's line movement, not global portfolio ROI)
      let lmTipo: 'STEAM_MOVE' | 'GRADUAL' | 'ESTAVEL' | 'ADVERSO' | 'REVERSE' = 'ESTAVEL';
      let lmDirecao: 'FAVOR' | 'CONTRA' | 'NEUTRO' = 'NEUTRO';
      let clvSinal: 'POSITIVO' | 'NEUTRO' | 'NEGATIVO' = 'NEUTRO';
      try {
        const lmData = detectLineMovement(match);
        if (lmData !== null) {
          const varHome = lmData.variation?.home ?? 0;
          lmTipo = lmData.tem_steam ? 'STEAM_MOVE' : varHome > 3 ? 'GRADUAL' : varHome < -3 ? 'ADVERSO' : 'ESTAVEL';
          lmDirecao = varHome > 0 ? 'FAVOR' : varHome < 0 ? 'CONTRA' : 'NEUTRO';
          if (lmData.tem_steam || varHome > 3) clvSinal = 'POSITIVO';
          else if (varHome < -3) clvSinal = 'NEGATIVO';
        }
      } catch (e) {
        lmTipo = 'ESTAVEL';
        lmDirecao = 'NEUTRO';
        clvSinal = 'NEUTRO';
      }

      const forma = result.scouting?.forma ?? 50;
      const motivacao = result.scouting?.motivacao ?? 50;
      const desfalques = result.scouting?.desfalques ?? 50;

      // 🚀 INTEGRATION: Tipster Engine Gate v2.0
      const engineInput = {
        ...result,
        valueBet: {
          ev: finalReport.melhor_value?.edge || 0,
          report: finalReport
        },
        banca: {
          kelly: result.tipster?.kellyStake || result.kellyStake || 0,
          bancaAtual: bancaAtual,
          redsConsecutivos: banca.stops.loss ? 3 : 0,
          apostasHoje: 0,
          drawdownPercentual: 0
        },
        matchData: match,
        elo: {
          jogosComputados: result.elo?.jogos_minimos_atingidos ? 15 : 5, // Mocking calibration count
          probabilidades: result.elo?.probabilidades ?? result.probabilidades_ml
        },
        gemini: {
          confianca: result.qualidade_score || result.qualidade || 70,
          probabilidades: result.probabilidades_ml
        },
        fixture: { tier: result.tipster?.tier?.name || 'C' },
        ticket: { tipo: 'simples' },
        odds: { atual: finalReport.melhor_value?.odd_api || 0 },
        clv: {
          sinal: clvSinal,
          fechamentoEstimado: (finalReport.melhor_value?.odd_api || 0) * 0.95,
          delta: clvSinal === 'POSITIVO' ? 5 : clvSinal === 'NEGATIVO' ? -5 : 0
        },
        lineMovement: {
          tipo: lmTipo,
          direcao: lmDirecao,
          magnitude: 0
        },
        probElo: result.elo?.probabilidades ?? result.probabilidades_ml,
        probGemini: result.probabilidades_ml,
        scouting: {
          ...result.scouting,
          forma,
          motivacao,
          desfalques
        }
      };

      // TIER — é um objeto com campo 'name', não string direta
      const tierName = result.tipster?.tier?.name ?? 'C';
      // Mapear: "S" = Super = Tier A, outros conforme necessário  
      const tierMapeado = tierName === 'S' ? 'A'
        : tierName === 'A' ? 'A'
          : tierName === 'B' ? 'B'
            : tierName === 'C' ? 'C' : 'D';

      // EV — usar o melhor edge dos mercados (está em decimal, converter para %)
      const mercadosValue = finalReport.mercados ?? [];
      const melhorMarket = mercadosValue.length > 0 
        ? [...mercadosValue].sort((a: any, b: any) => b.edge - a.edge)[0] 
        : null;

      const evFinal = melhorMarket && melhorMarket.edge > 0
        ? parseFloat((melhorMarket.edge * 100).toFixed(1))
        : 0;

      // KELLY — calcular com base no melhor mercado (sincronizado com EV)
      const bancaAtualTotal = banca.total || 1000;
      let kellyReaisValue = 0;
      if (melhorMarket && melhorMarket.edge > 0) {
        kellyReaisValue = calculateKellyStake(melhorMarket.prob_ia, melhorMarket.odd_api, bancaAtualTotal, 0.25);
      }
      const kellyPercentualValue = parseFloat(
        Math.min((kellyReaisValue / bancaAtualTotal) * 100, 3).toFixed(2)
      );

      // CONFIANÇA — tipster usa decimal 0-1, converter para %
      const confiancaDecimalValue = result.tipster?.confidence
        ?? (result.qualidade_score || result.qualidade || 70) / 100
        ?? 0;
      const confiancaPercentualValue = confiancaDecimalValue <= 1
        ? parseFloat((confiancaDecimalValue * 100).toFixed(1))
        : confiancaDecimalValue;

      // CONVERGÊNCIA GEMINI×POISSON
      const probGeminiApp = result?.probabilidades_ml ?? { casa: 0, empate: 0, fora: 0 };

      const probPoissonApp = result?.poisson?.probs_1x2 ?? null;
      const poissonDisponivelApp = !!(probPoissonApp && (
        (probPoissonApp.casa ?? 0) > 0 ||
        (probPoissonApp.empate ?? 0) > 0 ||
        (probPoissonApp.fora ?? 0) > 0
      ));
      const dCasa = poissonDisponivelApp && probPoissonApp
        ? Math.abs((probGeminiApp.casa ?? 0) - (probPoissonApp.casa ?? 0)) : 0;
      const dEmpate = poissonDisponivelApp && probPoissonApp
        ? Math.abs((probGeminiApp.empate ?? 0) - (probPoissonApp.empate ?? 0)) : 0;
      const dFora = poissonDisponivelApp && probPoissonApp
        ? Math.abs((probGeminiApp.fora ?? 0) - (probPoissonApp.fora ?? 0)) : 0;
      const deltaMax = poissonDisponivelApp ? Math.max(dCasa, dEmpate, dFora) : 0;

      const dadosCompletosApp = 
        poissonDisponivelApp && 
        probGeminiApp.casa > 0 && 
        probPoissonApp !== null;

      const convergenciaOk = dadosCompletosApp && deltaMax <= 15;


      const engineVerdict = await runTipsterEngine({
        analysis: engineInput,
        matchCardValues: {
          ev: evFinal,
          kelly: kellyPercentualValue,
          tier: tierMapeado,
          confianca: confiancaPercentualValue,
          convergenciaOk: convergenciaOk
        },
        bancaTotal: banca.total
      });      // Attach engine result to analysis
      result.tipsterEngine = engineVerdict;

      // Persistir no cache compartilhado Supabase
      setCachedAnalysis(fixtureKey, result, undefined, match.commence_time).catch(console.warn);

      // Registrar para rastreamento automático + poll imediato se jogo já começou
      registerMatchForTracking(match.id, match.home_team, match.away_team, match.commence_time);
      if (new Date(match.commence_time).getTime() <= Date.now()) {
        triggerPollRef.current?.(true);
      }

      // 🚀 CALIBRATION: Registrar se aprovado
      if (engineVerdict.status === 'APROVADO') {
        const oddAnalise = melhorMarket?.odd_api || result.tipster?.odds || 1.85;
        const mercadoAnalise = melhorMarket
          ? ((melhorMarket as any).mercado || melhorMarket.market || 'Mercado Principal')
          : (result.tipster?.market?.name || 'Mercado Principal');

        registrarPrevisao({
          matchId: match.id,
          homeTeam: match.home_team,
          awayTeam: match.away_team,
          commenceTime: match.commence_time,
          mercadoPrevisto: mercadoAnalise,
          resultadoPrevisto: result.tipster?.market?.outcome || 'Home',
          confiancaEstimada: confiancaPercentualValue,
          evEstimado: evFinal,
          oddUtilizada: oddAnalise,
          scoreGate: engineVerdict.score || 0,
          sportKey: match.sport_key
        });

        // CLV: registrar entrada para rastrear vs odd de fechamento
        if (canTrackCLV()) {
          registrarEntradaCLV({
            matchId: match.id,
            homeTeam: match.home_team,
            awayTeam: match.away_team,
            sportKey: match.sport_key,
            commenceTime: match.commence_time,
            mercado: mercadoAnalise,
            oddUtilizada: oddAnalise
          });
        }

        // AH: calcular equivalentes e anexar ao resultado (plano Pro+)
        if (plan === 'pro' || plan === 'sharp') {
          try {
            const ahAnalysis = analisarMatchAH(match.home_team, match.away_team, match.bookmakers || []);
            if (ahAnalysis) result.asianHandicap = ahAnalysis;
          } catch { /* silencioso */ }
        }
      }

      setAnalysis(result);
      setAnalyzedMatches(prev => ({ ...prev, [match.id]: result }));
      await incrementAnalysesToday();
    } catch (err) {
      console.error(err);
      // AnalysisView will handle showing error if analysis is null
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleGerarBilhete = async () => {
    if (loadingBilhete) return;
    setLoadingBilhete(true);
    
    try {
      // Analisar apenas os jogos selecionados que ainda não foram analisados
      const toAnalyze = filteredMatches.filter(m => ticketSelectionIds.has(m.id) && !analyzedMatches[m.id]);

      for (const match of toAnalyze) {
        try {
          if (isDemoMode) {
            window.dispatchEvent(new CustomEvent('evengine_open_auth_modal'));
            break;
          }
          if (!canAnalyzeToday()) {
            window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'));
            break;
          }
          if (match.sport_key && !canAccessLeague(match.sport_key)) {
            continue;
          }

          const fKey = buildFixtureKey(match.home_team, match.away_team, match.commence_time);
          const cachedBilhete = await getCachedAnalysis(fKey).catch(() => null);
          if (cachedBilhete && cachedBilhete.tipsterEngine) {
            setAnalyzedMatches(prev => ({ ...prev, [match.id]: cachedBilhete }));
            await new Promise(r => setTimeout(r, 100));
            continue;
          }

          const result = cachedBilhete ? { ...cachedBilhete } : await analyzeMatch(match);
          if (!cachedBilhete) {
            // EV-RATE-LIMIT: 3-second delay to avoid hitting Gemini API rate limits (15 RPM)
            await new Promise(r => setTimeout(r, 3000));
          }

          let statsMedias = null;
          if (!result.escanteios?.probabilidade || !result.finalizacoes?.probabilidade) {
            statsMedias = await buscarEstatisticasMedias(
              match.home_team,
              match.away_team,
              match.sport_title
            ).catch(() => null);
          }

          result.escanteios = statsMedias?.escanteios ?? result.escanteios;
          result.finalizacoes = statsMedias?.finalizacoes ?? result.finalizacoes;

          const h2hData = await buscarH2H(
            match.home_team,
            match.away_team,
            match.sport_title
          ).catch(() => null);
          result.h2h = h2hData;

          const valueReport = calcularValueBets(match, result);
          const finalReport = validateReport(valueReport);

          // Line Movement + CLV signal (unified — clvSinal from this match's line movement, not global portfolio ROI)
          let lmTipo: 'STEAM_MOVE' | 'GRADUAL' | 'ESTAVEL' | 'ADVERSO' | 'REVERSE' = 'ESTAVEL';
          let lmDirecao: 'FAVOR' | 'CONTRA' | 'NEUTRO' = 'NEUTRO';
          let clvSinal: 'POSITIVO' | 'NEUTRO' | 'NEGATIVO' = 'NEUTRO';
          try {
            const lmData = detectLineMovement(match);
            if (lmData !== null) {
              const varHome = lmData.variation?.home ?? 0;
              lmTipo = lmData.tem_steam ? 'STEAM_MOVE' : varHome > 3 ? 'GRADUAL' : varHome < -3 ? 'ADVERSO' : 'ESTAVEL';
              lmDirecao = varHome > 0 ? 'FAVOR' : varHome < 0 ? 'CONTRA' : 'NEUTRO';
              if (lmData.tem_steam || varHome > 3) clvSinal = 'POSITIVO';
              else if (varHome < -3) clvSinal = 'NEGATIVO';
            }
          } catch (e) {
            lmTipo = 'ESTAVEL';
            lmDirecao = 'NEUTRO';
            clvSinal = 'NEUTRO';
          }

          const forma = result.scouting?.forma ?? 50;
          const motivacao = result.scouting?.motivacao ?? 50;
          const desfalques = result.scouting?.desfalques ?? 50;

          const engineInput = {
            ...result,
            valueBet: {
              ev: finalReport.melhor_value?.edge || 0,
              report: finalReport
            },
            banca: {
              kelly: result.tipster?.kellyStake || result.kellyStake || 0,
              bancaAtual: bancaAtual,
              redsConsecutivos: banca.stops.loss ? 3 : 0,
              apostasHoje: 0,
              drawdownPercentual: 0
            },
            matchData: match,
            elo: {
              jogosComputados: result.elo?.jogos_minimos_atingidos ? 15 : 5,
              probabilidades: result.elo?.probabilidades ?? result.probabilidades_ml
            },
            gemini: {
              confianca: result.qualidade_score || result.qualidade || 70,
              probabilidades: result.probabilidades_ml
            },
            fixture: { tier: result.tipster?.tier?.name || 'C' },
            ticket: { tipo: 'simples' },
            odds: { atual: finalReport.melhor_value?.odd_api || 0 },
            clv: {
              sinal: clvSinal,
              fechamentoEstimado: (finalReport.melhor_value?.odd_api || 0) * 0.95,
              delta: clvSinal === 'POSITIVO' ? 5 : clvSinal === 'NEGATIVO' ? -5 : 0
            },
            lineMovement: {
              tipo: lmTipo,
              direcao: lmDirecao,
              magnitude: 0
            },
            probElo: result.elo?.probabilidades ?? result.probabilidades_ml,
            probGemini: result.probabilidades_ml,
            scouting: {
              ...result.scouting,
              forma,
              motivacao,
              desfalques
            }
          };

          const tierName = result.tipster?.tier?.name ?? 'C';
          const tierMapeado = tierName === 'S' ? 'A' : tierName === 'A' ? 'A' : tierName === 'B' ? 'B' : tierName === 'C' ? 'C' : 'D';

          const mercadosValue = finalReport.mercados ?? [];
          const melhorMarket = mercadosValue.length > 0 
            ? [...mercadosValue].sort((a: any, b: any) => b.edge - a.edge)[0] 
            : null;
          const evFinal = melhorMarket && melhorMarket.edge > 0 
            ? parseFloat((melhorMarket.edge * 100).toFixed(1)) 
            : 0;

          const bancaAtualTotal = banca.total || 1000;
          let kellyReaisValue = 0;
          if (melhorMarket && melhorMarket.edge > 0) {
            kellyReaisValue = calculateKellyStake(melhorMarket.prob_ia, melhorMarket.odd_api, bancaAtualTotal, 0.25);
          }
          const kellyPercentualValue = parseFloat(Math.min((kellyReaisValue / bancaAtualTotal) * 100, 3).toFixed(2));

          const confiancaDecimalValue = result.tipster?.confidence ?? (result.qualidade_score || result.qualidade || 70) / 100 ?? 0;
          const confiancaPercentualValue = confiancaDecimalValue <= 1 ? parseFloat((confiancaDecimalValue * 100).toFixed(1)) : confiancaDecimalValue;

          const probGeminiApp = result?.probabilidades_ml ?? { casa: 0, empate: 0, fora: 0 };

          const probPoissonApp = result?.poisson?.probs_1x2 ?? null;
          const poissonDisponivelApp = !!(probPoissonApp && ((probPoissonApp.casa ?? 0) > 0 || (probPoissonApp.empate ?? 0) > 0 || (probPoissonApp.fora ?? 0) > 0));
          const dCasa = poissonDisponivelApp && probPoissonApp ? Math.abs((probGeminiApp.casa ?? 0) - (probPoissonApp.casa ?? 0)) : 0;
          const dEmpate = poissonDisponivelApp && probPoissonApp ? Math.abs((probGeminiApp.empate ?? 0) - (probPoissonApp.empate ?? 0)) : 0;
          const dFora = poissonDisponivelApp && probPoissonApp ? Math.abs((probGeminiApp.fora ?? 0) - (probPoissonApp.fora ?? 0)) : 0;
          const deltaMax = poissonDisponivelApp ? Math.max(dCasa, dEmpate, dFora) : 0;
          
          const dadosCompletosApp = 
            poissonDisponivelApp && 
            probGeminiApp.casa > 0 && 
            probPoissonApp !== null;

          const convergenciaOk = dadosCompletosApp && deltaMax <= 15;


          const engineVerdict = await runTipsterEngine({
            analysis: engineInput,
            matchCardValues: {
              ev: evFinal,
              kelly: kellyPercentualValue,
              tier: tierMapeado,
              confianca: confiancaPercentualValue,
              convergenciaOk: convergenciaOk
            },
            bancaTotal: banca.total
          });
          result.tipsterEngine = engineVerdict;
          setCachedAnalysis(fKey, result, undefined, match.commence_time).catch(console.warn);
          registerMatchForTracking(match.id, match.home_team, match.away_team, match.commence_time);

          setAnalyzedMatches(prev => ({ ...prev, [match.id]: result }));
          await incrementAnalysesToday();
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          console.error(`Failed to analyze ${match.id}:`, err);
        }
      }

      // Abrir modal com resultado (o modal filtra as aprovadas internamente)
      setIsTicketOpen(true);
    } finally {
      setLoadingBilhete(false);
    }
  };

  const toggleTicketSelection = (id: string) => {
    setTicketSelectionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setTicketSelectionIds(new Set());
  const selectAllFiltered = () => setTicketSelectionIds(new Set(filteredMatches.map(m => m.id)));

  const handleAutoTicket = () => {
    const bestMatchIds = Object.entries(analyzedMatches)
      .filter(([id, analysisObj]) => {
        const analysis = (analysisObj as any);

        // 🚀 GATE CHECK: Only approved tips pass
        if (analysis.tipsterEngine && analysis.tipsterEngine.status !== 'APROVADO') {
          return false;
        }

        // Enforce 75% confidence rule for any primary market
        const hasHighConf = (
          analysis.probabilidades_ml.casa >= 75 ||
          analysis.probabilidades_ml.fora >= 75 ||
          analysis.gols.over15.probabilidade >= 75 ||
          analysis.gols.over25.probabilidade >= 75 ||
          analysis.dupla_chance?.['1X']?.probabilidade >= 75 ||
          analysis.dupla_chance?.['X2']?.probabilidade >= 75
        );
        return hasHighConf;
      })
      .map(([id]) => id);

    if (bestMatchIds.length === 0) {
      showToast.info('Nenhum jogo com confiança > 75% analisado ainda hoje. Analise mais jogos primeiro!');
      return;
    }

    setTicketSelectionIds(new Set(bestMatchIds));
    setIsTicketOpen(true);
  };

  // Live Tracking Logic
  useEffect(() => {
    const checkLive = () => {
      const now = new Date();
      const newLive = matches.filter(m => {
        // "In analysis" = part of current tickets/selections
        if (!ticketSelectionIds.has(m.id)) return false;

        const startTime = new Date(m.commence_time);
        // If match started in the last 15 minutes and hasn't been notified yet
        const isRecentlyStarted = startTime <= now && now.getTime() - startTime.getTime() < 1000 * 60 * 15;
        return isRecentlyStarted;
      });

      newLive.forEach(match => {
        if (!notifiedIdsRef.current.has(match.id)) {
          notifiedIdsRef.current.add(match.id);
          setLiveNotifications(prev => [...prev, match]);

          // Auto dismiss after 5s
          setTimeout(() => {
            setLiveNotifications(prev => prev.filter(n => n.id !== match.id));
          }, 5000);
        }
      });
    };

    const interval = setInterval(checkLive, 10000); // Check every 10s
    checkLive(); // Initial check
    return () => clearInterval(interval);
  }, [matches, ticketSelectionIds]);

  const removeNotification = (id: string) => {
    setLiveNotifications(prev => prev.filter(n => n.id !== id));
  };

  const groupedMatches = useMemo(() => {
    const groups: Record<string, Match[]> = {};
    let list = filteredMatches;
    if (showApprovedOnly) {
      list = list.filter(m => analyzedMatches[m.id]?.tipsterEngine?.status === 'APROVADO');
    }
    list.forEach(match => {
      if (!groups[match.sport_title]) {
        groups[match.sport_title] = [];
      }
      groups[match.sport_title].push(match);
    });
    return groups;
  }, [filteredMatches, analyzedMatches, showApprovedOnly]);

  // Initial League Selection Screen
  if (!hasStarted && !loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] text-[#e1e1e3] p-6 flex flex-col items-center justify-center font-sans">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-6xl w-full"
        >
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center font-bold text-2xl text-white shadow-2xl shadow-blue-600/30 rotate-3">E</div>
              <h1 className="text-5xl font-bold tracking-tight uppercase text-white leading-none">EVEngine <span className="text-blue-500">AI</span></h1>
            </div>
            <p className="text-white/40 text-lg font-medium leading-relaxed max-w-lg mx-auto">
              Selecione as competições que deseja monitorar. O modelo neural irá analisar apenas os dados ativos destas ligas.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-10">
            {LEAGUES.map((league) => (
              <button
                key={league.key}
                onClick={() => toggleLeague(league.key)}
                className={`p-6 rounded-2xl border transition-all text-left group relative overflow-hidden ${selectedLeagues.includes(league.key)
                  ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.1)]'
                  : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                  }`}
              >
                <div className="relative z-10">
                  <h3 className={`text-sm font-bold uppercase tracking-widest mb-1 ${selectedLeagues.includes(league.key) ? 'text-blue-400' : 'text-white/40 group-hover:text-white/60'}`}>
                    {league.name}
                  </h3>
                  <div className="text-[10px] font-mono text-white/20 uppercase tracking-tighter">{league.key.replace('soccer_', '').replace(/_/g, ' ')}</div>
                </div>
                {selectedLeagues.includes(league.key) && (
                  <motion.div
                    layoutId={`check-${league.key}`}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-500"
                  >
                    <Trophy size={20} />
                  </motion.div>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 bg-[#0f0f11] p-6 rounded-[2rem] border border-white/10">
            <div className="flex items-center gap-4">
              <button onClick={selectAll} className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors">Marcar Todas</button>
              <div className="w-1 h-1 rounded-full bg-white/10" />
              <button onClick={deselectAll} className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors">Desmarcar Todas</button>
            </div>

            <button
              disabled={selectedLeagues.length === 0}
              onClick={() => loadMatches()}
              className="w-full sm:w-auto px-12 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-2xl text-xs font-bold uppercase tracking-[0.3em] transition-all shadow-[0_0_30px_rgba(37,99,235,0.2)] hover:scale-[1.03] active:scale-95"
            >
              Iniciar Análise (<span>{selectedLeagues.length}</span>)
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div translate="no" className="min-h-screen bg-[#0a0a0b] text-[#e1e1e3] font-sans selection:bg-blue-500/30">

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f11]/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">

          <div className="flex items-center gap-3 sm:gap-4 shrink min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-blue-600 rounded-xl flex items-center justify-center font-black text-white shadow-lg shadow-blue-600/20 rotate-3 cursor-pointer shrink-0" onClick={() => { setHasStarted(false); setView('dashboard'); }}>
              E
            </div>
            <div className="shrink min-w-0">
              <h1 className="font-bold text-lg sm:text-xl tracking-tight uppercase leading-none text-white whitespace-nowrap truncate">
                EVEngine <span className="text-blue-500">AI</span>
              </h1>
              <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 whitespace-nowrap overflow-hidden">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                <p className="text-[8px] sm:text-[9px] text-white/40 font-bold uppercase tracking-widest leading-none truncate">V2.4 Intelligence Engine</p>
              </div>
            </div>
          </div>

          {/* Desktop Navigation & Controls (Hidden on Mobile/Tablet) */}
          <div className="hidden xl:flex items-center gap-1.5 2xl:gap-4 shrink-0">
            
            {/* System Status Badges Group */}
            <div className="flex items-center gap-1 2xl:gap-2 shrink-0 animate-in fade-in">
              <PlanBadge />
              <div className="h-6 w-px bg-white/10 mx-1 shrink-0" />
              
              <div className="h-9 flex items-center gap-1.5 px-2 2xl:px-3.5 bg-white/[0.02] border border-white/5 rounded-xl font-mono text-[10px] font-black uppercase tracking-widest select-none shrink-0 whitespace-nowrap">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isDemoMode ? 'bg-amber-500 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
                <span className={`shrink-0 ${isDemoMode ? 'text-amber-500' : 'text-green-400'}`}>
                  {isDemoMode ? 'DEMO' : (() => {
                    const info = getOddsApiQuotaInfo();
                    return info.remaining ? `REAL: ${info.remaining} REQS` : 'REAL ACTIVE';
                  })()}
                </span>
              </div>

              {plan === 'sharp' && bancas.length > 0 ? (
                <select
                  value={activeBancaId || ''}
                  onChange={(e) => {
                    const selected = bancas.find(b => b.id === e.target.value);
                    if (selected) {
                      setActiveBancaId(selected.id);
                      switchActiveBanca(selected);
                    }
                  }}
                  className="h-9 px-3 bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-500/30 text-emerald-400 rounded-xl font-mono text-[11px] font-black focus:outline-none shrink-0 cursor-pointer"
                >
                  {bancas.map(b => (
                    <option key={b.id} value={b.id} className="bg-[#0f0f11] text-emerald-400">
                      🏦 {b.nome} (R$ {Number(b.valor_atual).toFixed(0)})
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  onClick={() => setBancaModalOpen(true)}
                  className="h-9 flex items-center gap-1 px-2 2xl:gap-1.5 2xl:px-3.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/30 text-emerald-400 rounded-xl font-mono text-[11px] font-black tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.02)] active:scale-95 shrink-0 whitespace-nowrap"
                >
                  💰 R$ {bancaAtual.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2
                  })}
                </button>
              )}

            </div>

            <div className="h-6 w-px bg-white/10 mx-0.5 2xl:mx-2 shrink-0" />

            {/* Unified Sleek Navigation Dock */}
            <div className="flex items-center gap-0.5 2xl:gap-1 bg-white/[0.02] border border-white/5 p-1 rounded-2xl shadow-inner shrink-0">
              <button
                onClick={() => setView('dashboard')}
                className={`flex items-center gap-1 px-2.5 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2 border rounded-xl transition-all group shrink-0 whitespace-nowrap ${
                  view === 'dashboard'
                    ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/15'
                    : 'bg-transparent border-transparent text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <Home size={14} className="shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Dashboard</span>
              </button>

              <button
                onClick={() => {
                  setView('main');
                  if (!hasStarted) {
                    setHasStarted(true);
                    loadMatches(true);
                  }
                }}
                className={`flex items-center gap-1 px-2.5 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2 border rounded-xl transition-all group shrink-0 whitespace-nowrap ${
                  view === 'main'
                    ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/15'
                    : 'bg-transparent border-transparent text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <Trophy size={14} className="shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Partidas</span>
              </button>

              <button
                onClick={() => setView('worldcup')}
                className={`flex items-center gap-1 px-2.5 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2 border rounded-xl transition-all group shrink-0 whitespace-nowrap ${
                  view === 'worldcup'
                    ? 'bg-yellow-500 border-yellow-400 text-black shadow-lg shadow-yellow-500/15'
                    : 'bg-transparent border-transparent text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <Trophy size={14} className={`shrink-0 ${view === 'worldcup' ? 'text-black' : 'text-yellow-500/60'}`} />
                <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Copa 2026</span>
              </button>

              {/* Additional Menus Dropdown */}
              <div className="relative shrink-0" ref={extraMenuRef}>
                <button
                  onClick={() => setIsExtraMenuOpen(!isExtraMenuOpen)}
                  className={`flex items-center justify-center px-2.5 py-1.5 2xl:px-3 border rounded-xl transition-all active:scale-95 cursor-pointer shrink-0 ${
                    isExtraMenuOpen || view === 'telemetry' || view === 'documentacao' || view === 'bets' || view === 'pendencias'
                      ? 'border-blue-500/50 text-blue-400 bg-blue-600/10'
                      : 'border-transparent text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                  title="Menus Adicionais"
                >
                  <Menu size={14} className="shrink-0" />
                </button>

                <AnimatePresence>
                  {isExtraMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2 w-48 bg-[#0f0f11] border border-white/10 rounded-xl p-1.5 shadow-2xl z-50 flex flex-col gap-1"
                  >
                    <button
                      onClick={() => {
                        setView('bets');
                        setIsExtraMenuOpen(false);
                      }}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${
                        view === 'bets'
                          ? 'bg-blue-500 border-blue-400 text-white'
                          : 'bg-transparent border-transparent text-white/60 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Ticket size={14} className="shrink-0" />
                      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Apostas</span>
                    </button>

                    <button
                      onClick={() => {
                        setView('pendencias');
                        setIsExtraMenuOpen(false);
                      }}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${
                        view === 'pendencias'
                          ? 'bg-blue-500 border-blue-400 text-white'
                          : 'bg-transparent border-transparent text-white/60 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <AlertCircle size={14} className={`shrink-0 ${view === 'pendencias' ? 'text-white' : 'text-amber-500'}`} />
                      <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap">
                        Pendências
                        {(() => {
                          const count = matches.filter(m => calcularEstadoJogo(m) === 'pendencia').length;
                          return count > 0 ? (
                            <span className="px-1.5 py-0.5 bg-amber-500 text-black text-[9px] font-black rounded-full animate-pulse shrink-0">
                              {count}
                            </span>
                          ) : null;
                        })()}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setResultadoModalOpen(true);
                        setIsExtraMenuOpen(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 border border-transparent rounded-lg transition-all text-left cursor-pointer text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                    >
                      <FileText size={14} className="shrink-0 text-amber-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Registrar Resultado</span>
                    </button>

                    <div className="h-px bg-white/5 my-1" />

                    <button
                      onClick={() => {
                        setView('telemetry');
                        setIsExtraMenuOpen(false);
                      }}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${
                        view === 'telemetry'
                          ? 'bg-blue-500 border-blue-400 text-white'
                          : 'bg-transparent border-transparent text-white/60 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Activity size={14} className="shrink-0" />
                      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Telemetria</span>
                    </button>

                    <button
                      onClick={() => {
                        setView('documentacao');
                        setIsExtraMenuOpen(false);
                      }}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${
                        view === 'documentacao'
                          ? 'bg-blue-500 border-blue-400 text-white'
                          : 'bg-transparent border-transparent text-white/60 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <BookOpen size={14} className="shrink-0" />
                      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Documentação</span>
                    </button>

                    <div className="h-px bg-white/5 my-1" />

                    <button
                      onClick={() => {
                        setHasStarted(false);
                        localStorage.setItem('evengine_has_started', 'false');
                        setIsExtraMenuOpen(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 border border-transparent rounded-lg transition-all text-left cursor-pointer text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    >
                      <Trophy size={14} className="shrink-0 text-yellow-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Gerenciar Ligas</span>
                    </button>

                    <div className="h-px bg-white/5 my-1" />

                    <button
                      onClick={async () => {
                        await signOut();
                        setIsExtraMenuOpen(false);
                        if (onSignOut) onSignOut();
                      }}
                      className="flex items-center gap-2 px-3 py-2 border border-transparent rounded-lg transition-all text-left cursor-pointer text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      <LogOut size={14} className="shrink-0" />
                      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Sair da Conta</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="w-[1px] h-6 bg-white/10 mx-0.5 2xl:mx-1 shrink-0" />

            <button
              onClick={handleAutoTicket}
              className="flex items-center gap-1 px-2.5 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 rounded-xl transition-all group active:scale-95 shrink-0 whitespace-nowrap"
            >
              <Ticket size={14} className="text-blue-500 shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 whitespace-nowrap">AUTO</span>
            </button>
          </div>

          {/* Mobile Navigation Controls (Visible only under xl screens) */}
          <div className="xl:hidden flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => {
                setBancaModalOpen(true);
                setMobileMenuOpen(false);
              }}
              className="hidden sm:flex px-3.5 py-1.5 rounded-full bg-[#00e676]/10 border border-[#00e676]/30 text-[#00e676] font-bold text-xs font-mono transition-all hover:bg-[#00e676]/20 active:scale-95 items-center gap-1 shadow-[0_0_15px_rgba(0,230,118,0.05)] shrink-0"
            >
              <span>💰</span>
              <span>R$ {bancaAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </button>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 sm:p-2.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 rounded-xl text-blue-400 transition-all active:scale-95 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(37,99,235,0.15)] animate-pulse"
              aria-label="Toggle Menu"
            >
              {mobileMenuOpen ? <X size={20} className="text-rose-400" /> : <Menu size={22} />}
            </button>
          </div>

        </div>

        {/* Mobile Dropdown Drawer Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="xl:hidden border-t border-white/10 bg-[#0f0f11] overflow-hidden"
            >
              <div className="px-4 py-6 space-y-6 max-h-[80vh] overflow-y-auto no-scrollbar">
                
                {/* Section 1: Navigation */}
                <div className="space-y-2.5">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 px-2">
                    Navegação Principal
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      onClick={() => {
                        setView('dashboard');
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${
                        view === 'dashboard'
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <Home size={16} />
                      <span className="text-[11px] font-black uppercase tracking-wider">Dashboard</span>
                    </button>

                    <button
                      onClick={() => {
                        setView('main');
                        setMobileMenuOpen(false);
                        if (!hasStarted) {
                          setHasStarted(true);
                          loadMatches(true);
                        }
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${
                        view === 'main'
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <Trophy size={16} />
                      <span className="text-[11px] font-black uppercase tracking-wider">Partidas</span>
                    </button>

                    <button
                      onClick={() => {
                        setView('bets');
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${
                        view === 'bets'
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <Ticket size={16} />
                      <span className="text-[11px] font-black uppercase tracking-wider">Apostas</span>
                    </button>

                    <button
                      onClick={() => {
                        setView('pendencias');
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center justify-between px-4 py-3.5 border rounded-xl transition-all text-left ${
                        view === 'pendencias'
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <AlertCircle size={16} className={view === 'pendencias' ? 'text-white' : 'text-amber-500'} />
                        <span className="text-[11px] font-black uppercase tracking-wider">Pendências</span>
                      </div>
                      {(() => {
                        const count = matches.filter(m => calcularEstadoJogo(m) === 'pendencia').length;
                        return count > 0 ? (
                          <span className="px-2 py-0.5 bg-amber-500 text-black text-[9px] font-black rounded-full">
                            {count}
                          </span>
                        ) : null;
                      })()}
                    </button>

                    <button
                      onClick={() => {
                        setView('documentacao');
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${
                        view === 'documentacao'
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <BookOpen size={16} className={view === 'documentacao' ? 'text-white' : 'text-blue-500/60'} />
                      <span className="text-[11px] font-black uppercase tracking-wider">Documentação</span>
                    </button>

                    <button
                      onClick={() => {
                        setView('worldcup');
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${
                        view === 'worldcup'
                          ? 'bg-yellow-500 border-yellow-400 text-black shadow-lg shadow-yellow-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <Trophy size={16} className={view === 'worldcup' ? 'text-black' : 'text-yellow-500/60'} />
                      <span className="text-[11px] font-black uppercase tracking-wider">Copa 2026</span>
                    </button>

                    <button
                      onClick={() => {
                        setIsSidebarOpen(true);
                        setMobileMenuOpen(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3.5 border border-white/5 rounded-xl transition-all text-left bg-white/[0.02] text-white/60 hover:text-white hover:bg-white/[0.05]"
                    >
                      <Filter size={16} className="text-blue-500/60" />
                      <span className="text-[11px] font-black uppercase tracking-wider">Filtro de Ligas</span>
                    </button>
                  </div>
                </div>

                {/* Section 2: Automation & Actions */}
                <div className="space-y-2.5">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 px-2">
                    Ações & Automação
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        setResultadoModalOpen(true);
                        setMobileMenuOpen(false);
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-3.5 bg-[#ffeb3b]/10 border border-[#ffeb3b]/20 hover:bg-[#ffeb3b]/20 text-[#ffeb3b] rounded-xl transition-all font-black text-[10px] uppercase tracking-wider active:scale-95"
                    >
                      📝 RESULTADO
                    </button>

                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        handleAutoTicket();
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 text-blue-400 rounded-xl transition-all font-black text-[10px] uppercase tracking-wider active:scale-95"
                    >
                      <Ticket size={14} className="text-blue-500" />
                      AUTO
                    </button>
                  </div>
                </div>

                {/* Section 3: Technical Details & Systems */}
                <div className="space-y-2.5">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 px-2">
                    Sistema & Telemetria
                  </div>
                  <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-4 space-y-4">
                    
                    {/* API quota indicator - Apenas Admin */}
                    {user?.email === 'grampinelli1985@gmail.com' && (
                      <div className="flex items-center justify-between bg-[#141416] border border-white/5 px-3 py-2.5 rounded-xl">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${isDemoMode ? 'bg-amber-500 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
                          <span className="text-[9px] text-white/40 font-bold uppercase tracking-wider">Cota Odds API</span>
                        </div>
                        <span className={`text-[9px] font-mono uppercase font-black tracking-widest ${isDemoMode ? 'text-amber-500' : 'text-green-400'}`}>
                          {isDemoMode ? 'DEMO MODE' : (() => {
                            const info = getOddsApiQuotaInfo();
                            return info.remaining ? `REAL: ${info.remaining} REQS` : 'REAL ACTIVE';
                          })()}
                        </span>
                      </div>
                    )}

                    {/* Telemetry view link */}
                    <button
                      onClick={() => {
                        setView('telemetry');
                        setMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-blue-600/5 hover:bg-blue-600/10 border border-blue-500/10 rounded-xl text-[10px] text-blue-400 font-black uppercase tracking-wider transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <Activity size={12} className="text-blue-500" />
                        Telemetria Avançada
                      </span>
                      <span className="text-[9px] bg-blue-600/10 px-2 py-0.5 rounded text-blue-400 font-mono">ATIVO</span>
                    </button>

                    <button
                      onClick={() => {
                        setHasStarted(false);
                        localStorage.setItem('evengine_has_started', 'false');
                        setMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-yellow-500/5 hover:bg-yellow-500/10 border border-yellow-500/10 rounded-xl text-[10px] text-yellow-500 font-black uppercase tracking-wider transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <Trophy size={12} className="text-yellow-500" />
                        Gerenciar Ligas
                      </span>
                    </button>

                    {/* Refresh page */}
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        if (view === 'main') loadMatches(true);
                        else window.location.reload();
                      }}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/60 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest active:scale-95"
                    >
                      <RefreshCw size={12} className={isRefreshing ? 'animate-spin text-blue-500' : ''} />
                      {isRefreshing ? 'Atualizando...' : 'Recarregar Painel'}
                    </button>

                    {/* Sair da Conta */}
                    <button
                      onClick={async () => {
                        setMobileMenuOpen(false);
                        await signOut();
                        if (onSignOut) onSignOut();
                      }}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl text-rose-400 hover:text-rose-300 transition-all text-[10px] font-black uppercase tracking-widest active:scale-95"
                    >
                      <LogOut size={12} className="shrink-0" />
                      Sair da Conta
                    </button>

                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </header>

      {stopLossState.suspensaoAtiva && (
        <div className="bg-[#A32D2D]/10 border-b border-[#A32D2D]/20 py-3 transition-all">
          <div className="max-w-[1600px] mx-auto px-6 flex items-center justify-between flex-wrap gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[#A32D2D] shrink-0" />
              <div className="text-left">
                <p className="text-[10px] text-white font-black uppercase tracking-widest leading-none">
                  STOP LOSS ATIVADO
                </p>
                <p className="text-[10px] text-white/60 mt-0.5 font-medium">
                  {stopLossState.redStreakAtual} apostas consecutivas perdidas. Novas entradas estão bloqueadas. O bloqueio é removido automaticamente ao primeiro green.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-[#A32D2D]/20 text-[#A32D2D] text-[9px] font-black uppercase tracking-widest rounded border border-[#A32D2D]/30">
                Bloqueado
              </span>
            </div>
          </div>
        </div>
      )}

      {isDemoMode && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 py-2.5 transition-all">
            <div className="max-w-[1600px] mx-auto px-6 flex items-center justify-center flex-wrap gap-x-4 gap-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-500 shrink-0" />
                <p className="text-[10px] text-amber-500/80 font-bold uppercase tracking-widest leading-none">
                  MODO VISUALIZAÇÃO
                </p>
              </div>
              <p className="text-[10px] text-amber-400/90 font-medium">
                Cadastre-se gratuitamente para desbloquear 5 análises de demonstração.
              </p>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('evengine_open_auth_modal'))}
                className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[9px] font-black uppercase tracking-widest rounded transition-all border border-amber-500/30"
              >
                Criar Conta Grátis
              </button>
            </div>
          </div>
        )}
      {!isDemoMode && (() => {
        const quotaInfo = getOddsApiQuotaInfo();
        if (!quotaInfo.errorStatus && import.meta.env.VITE_ODDS_API_KEY && import.meta.env.VITE_ODDS_API_KEY !== 'YOUR_ODDS_API_KEY') return null;
        let motivo = "Chave de Odds ou IA (Gemini) expirada/ausente.";
        if (quotaInfo.errorStatus === '401') {
          motivo = "A chave da Odds API retornou erro 401 (Não Autorizada/Inválida). Verifique sua chave no arquivo .env.";
        } else if (quotaInfo.errorStatus === '429') {
          motivo = "A chave da Odds API retornou erro 429 (Limite de requisições excedido). Aguarde a renovação da cota.";
        } else if (!import.meta.env.VITE_ODDS_API_KEY || import.meta.env.VITE_ODDS_API_KEY === 'YOUR_ODDS_API_KEY') {
          motivo = "A chave VITE_ODDS_API_KEY não está configurada no seu arquivo .env.";
        }
        return (
          <div className="bg-amber-500/10 border-b border-amber-500/20 py-2.5 transition-all">
            <div className="max-w-[1600px] mx-auto px-6 flex items-center justify-center flex-wrap gap-x-4 gap-y-1">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-500 shrink-0" />
                <p className="text-[10px] text-amber-500/80 font-bold uppercase tracking-widest leading-none">
                  MODO DE DEMONSTRAÇÃO ATIVO
                </p>
              </div>
              <p className="text-[10px] text-amber-400/90 font-medium">
                {motivo}
              </p>
              <button
                onClick={() => { sessionStorage.clear(); window.location.reload(); }}
                className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[9px] font-black uppercase tracking-widest rounded transition-all border border-amber-500/30"
              >
                Limpar Cache e Recarregar
              </button>
            </div>
          </div>
        );
      })()}

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 sm:py-10 overflow-x-hidden relative">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            custom={direction}
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={slideTransition as any}
            className="w-full"
          >

        {view === 'dashboard' ? (
          <DashboardView
            matches={matches}
            analyzedMatches={analyzedMatches}
            onAnalyze={(match) => {
              handleAnalyze(match);
            }}
            onNavigateToMatches={() => {
              setView('main');
              if (!hasStarted) {
                setHasStarted(true);
                loadMatches(true);
              }
            }}
            onNavigateToDocs={() => setView('documentacao')}
            modoOperacao={modoOperacao}
            setModoOperacao={setModoOperacao}
          />
        ) : view === 'bets' ? (
          <BetsView onBack={() => setView('dashboard')} />
        ) : view === 'pendencias' ? (
          <PendenciasView
            matches={matches}
            analyzedMatches={analyzedMatches}
            onRegisterResult={(match) => {
              const analysisObj = analyzedMatches[match.id];
              setResultadoPreenchido({
                homeTeam: match.home_team,
                awayTeam: match.away_team,
                liga: match.sport_title || match.sport_key,
                mercado: (analysisObj as any)?.dica_principal || 'Vitória Casa',
                confianca: (analysisObj as any)?.qualidade || 80,
                ev: (analysisObj as any)?.elo?.raw_delta || 0,
                odd: 1.8,
                stake: 50,
                gateScore: (analysisObj as any)?.qualidade || 80,
                matchId: match.id
              });
              setResultadoModalOpen(true);
            }}
            onIgnoreMatch={async (match) => {
              // Marcar como ignorado localmente
              match.resultado_ignorado = true;
              
              // Atualizar cache local
              const cacheKey = `analysis_${match.id}`;
              const cached = localStorage.getItem(cacheKey);
              if (cached) {
                try {
                  const parsed = JSON.parse(cached);
                  parsed.data.resultado_ignorado = true;
                  localStorage.setItem(cacheKey, JSON.stringify(parsed));
                } catch(e) {}
              }
              
              setMatches([...matches]);
              await updateMatchResultInSupabase(match.id, 'IGNORADO', true);
            }}
          />
        ) : view === 'documentacao' ? (
          <DocumentationView onBack={() => setView('dashboard')} />
        ) : view === 'worldcup' ? (
          <div className="relative min-h-[500px]">
            {!canAccessWorldCup() && (
              <PlanLock plan="pro" feature="Módulo Copa do Mundo" />
            )}

            <WorldCupView
              onBack={() => setView('dashboard')}
              bancaAtual={bancaAtual}
              showApprovedOnly={showApprovedOnly}
              analyzedMatches={analyzedMatches}
              onAnalyze={handleAnalyze}
              liveResults={liveResults}
              liveScores={liveScores}
            />
          </div>
        ) : (
          <>
            {/* Intro & Summary */}
            {!loading && matches.length > 0 && (
              <div className="mb-12 space-y-8">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="px-3 py-1 bg-blue-500/10 text-blue-400 text-[10px] font-black rounded-full uppercase tracking-[0.2em] border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.05)] flex items-center gap-2"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse" />
                        <span>Neural Intelligence Feed</span>
                      </motion.div>
                    </div>
                    <h2 className="text-4xl sm:text-5xl font-black text-white mb-3 tracking-tight leading-none uppercase">
                      Próximas <span className="text-white/20 italic">Partidas</span>
                    </h2>
                    <div className="flex items-center gap-4 text-white/40 text-xs sm:text-sm font-medium">
                      <p className="max-w-lg leading-relaxed">
                        Detectamos <span className="text-white font-bold"><span>{filteredMatches.length}</span> confrontos</span> com liquidez estatística para análise.
                      </p>
                      <div className="h-4 w-px bg-white/10 hidden sm:block" />
                      <p className="hidden sm:block">Foco em padrões de gols e chances combinadas.</p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    {/* SearchBar (Unified Height: h-11) */}
                    <div className="relative w-full sm:w-80 group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-blue-500 transition-colors pointer-events-none z-10">
                        <Search size={16} />
                      </div>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar time ou liga..."
                        className="w-full h-11 bg-[#0d0d0f] border border-white/5 rounded-xl pl-11 pr-10 text-xs font-semibold text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 focus:bg-white/[0.03] transition-all focus:shadow-[0_0_20px_rgba(59,130,246,0.03)]"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-white/5 rounded-xl text-white/20 hover:text-white transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      {/* Interactive Date Filter (Unified Height: h-11) */}
                      <div className="h-11 flex items-center gap-1 bg-[#0d0d0f] border border-white/5 rounded-xl p-1">
                        {[
                          { value: 1, label: 'Hoje' },
                          { value: 2, label: '48h' },
                          { value: 3, label: '72h' },
                          { value: 7, label: '7 Dias' },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setFilterDate(opt.value)}
                            className={`h-full flex items-center px-4 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all select-none hover:scale-[1.02] active:scale-98 cursor-pointer ${
                              filterDate === opt.value
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                                : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Live 24H Badge (Unified Height: h-11 & style) */}
                      <div className="h-11 flex items-center justify-center gap-2.5 bg-blue-600/5 border border-blue-500/20 text-blue-400 px-4 rounded-xl font-mono text-[9px] uppercase font-black tracking-[0.2em] shadow-[0_0_15px_rgba(37,99,235,0.02)] select-none whitespace-nowrap">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse" />
                        <span>Live 24H</span>
                      </div>

                      {/* Gate Approved Filter */}
                      <button
                        onClick={() => setShowApprovedOnly(prev => !prev)}
                        className={`h-11 flex items-center justify-center gap-2 px-4 rounded-xl font-mono text-[9px] uppercase font-black tracking-[0.2em] border transition-all ${
                          showApprovedOnly
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                            : 'bg-[#0d0d0f] border-white/5 text-white/40 hover:text-white/60 hover:bg-white/5'
                        }`}
                        title={approvedCount > 0 ? `${approvedCount} partida(s) aprovada(s) pelo Gate` : 'Nenhuma aprovada ainda — analise os jogos primeiro'}
                      >
                        <Shield size={12} className={showApprovedOnly ? 'text-emerald-400' : 'text-white/20'} />
                        <span>Gate</span>
                        {approvedCount > 0 && (
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                            showApprovedOnly
                              ? 'bg-emerald-500 text-black'
                              : 'bg-white/10 text-white/60'
                          }`}>
                            {approvedCount}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* League Quick Filters */}
                <div className="relative group">
                  <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-4 -mx-1 px-1">
                    <button
                      onClick={() => toggleFilterLeague('all')}
                      className={`flex items-center gap-3 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] border transition-all whitespace-nowrap shadow-sm ${filterLeagues.includes('all')
                        ? 'bg-white text-black border-white shadow-lg shadow-white/10 scale-[1.02]'
                        : 'bg-[#0d0d0f] text-white/40 border-white/5 hover:border-white/10 hover:text-white'
                        }`}
                    >
                      <Filter size={14} className={filterLeagues.includes('all') ? 'text-black' : 'text-blue-500/60'} />
                      <span>Todas as Ligas</span>
                    </button>

                    <button
                      onClick={() => setIsSidebarOpen(true)}
                      className="flex items-center gap-3 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] border border-blue-500/20 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 transition-all whitespace-nowrap"
                    >
                      <Filter size={14} className="text-blue-400" />
                      <span>Filtro de Ligas</span>
                    </button>

                    <div className="w-px h-8 bg-white/5 mx-1 flex-shrink-0" />

                    {LEAGUES.filter(l => selectedLeagues.includes(l.key)).map(league => {
                      const Icon = leagueIcons[league.symbol as string] || Trophy;
                      const isActive = filterLeagues.includes(league.key);
                      return (
                        <button
                          key={league.key}
                          onClick={() => toggleFilterLeague(league.key)}
                          className={`flex items-center gap-3 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] border transition-all whitespace-nowrap group/btn ${isActive
                            ? 'bg-blue-600 text-white border-blue-500 shadow-xl shadow-blue-600/20 scale-[1.02]'
                            : 'bg-[#0d0d0f] text-white/40 border-white/5 hover:border-white/10 hover:text-white'
                            }`}
                        >
                          <Icon size={14} className={isActive ? 'text-white' : 'text-blue-500/40 group-hover/btn:text-blue-400 transition-colors'} />
                          <span>{league.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Fade edges for scroll */}
                  <div className="absolute right-0 top-0 bottom-4 w-20 bg-gradient-to-l from-[#0a0a0b] to-transparent pointer-events-none hidden sm:block" />
                </div>
              </div>
            )}

            {/* Content */}
            {loading ? (
              <div className="space-y-16">
                {[1, 2].map(i => (
                  <div key={i} className="space-y-8">
                    <div className="flex items-center gap-4">
                      <div className="h-6 w-48 bg-white/5 animate-pulse rounded-lg" />
                      <div className="h-[1px] bg-white/5 grow" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                      {[1, 2, 3].map(j => <span key={j}><SkeletonMatch /></span>)}
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-24 bg-[#0d0d0f] rounded-[2rem] border border-white/10 mt-10 shadow-2xl">
                <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center mb-6 border border-rose-500/20">
                  <AlertCircle size={32} className="text-rose-500" />
                </div>
                <h3 className="text-2xl font-black text-white mb-3 uppercase tracking-tighter italic">Erro de Conexão</h3>
                <p className="text-white/40 text-center max-w-sm px-6 font-medium leading-relaxed"><span>{error}</span></p>
                <button
                  onClick={() => loadMatches()}
                  className="mt-8 px-8 py-3 bg-white hover:bg-white/90 text-black rounded-xl font-black uppercase tracking-widest transition-all hover:scale-[1.02]"
                >
                  Recarregar Feed
                </button>
              </div>
            ) : (filteredMatches.length === 0 || (showApprovedOnly && Object.keys(groupedMatches).length === 0)) ? (
              <div className="flex flex-col items-center justify-center py-24 bg-[#0d0d0f] rounded-[2rem] border border-white/10 mt-10 shadow-2xl">
                <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-6 border border-white/10">
                  <Search size={32} className="text-white/10" />
                </div>
                <h3 className="text-2xl font-black text-white mb-3 uppercase tracking-tighter italic">
                  {searchQuery ? <span>Sem Resultados</span> : showApprovedOnly ? <span>Sem Aprovadas</span> : <span>Vazio</span>}
                </h3>
                <p className="text-white/40 text-center max-w-sm px-6 font-medium leading-relaxed">
                  {searchQuery
                    ? <span>Nenhum confronto encontrado para "{searchQuery}". Verifique a ortografia ou tente outro termo.</span>
                    : showApprovedOnly
                    ? <span>Nenhuma partida aprovada pelo Gate com os filtros atuais. Analise mais partidas para ver as aprovadas.</span>
                    : <span>Nenhuma partida encontrada para o período selecionado.</span>}
                </p>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-6 px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-bold text-white uppercase tracking-widest transition-all"
                  >
                    Limpar Busca
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-20">
                {/* Engine Legend */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/[0.02] border border-white/5 rounded-[2.5rem] p-10 mb-16 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                  <div className="relative flex flex-col md:flex-row justify-between items-center gap-8">
                    <div>
                      <h4 className="text-white font-black text-xl uppercase tracking-tighter mb-1">Guia de Análise Tipster</h4>
                      <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Critérios de Validação da EVEngine AI</p>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-12 w-full md:w-auto">
                      {[
                        { tier: 'S/A', color: 'text-emerald-400', dot: 'bg-emerald-500', label: 'APOSTE', desc: 'Alta Confiança' },
                        { tier: 'B', color: 'text-blue-400', dot: 'bg-blue-500', label: 'APOSTE', desc: 'Boa Oportunidade' },
                        { tier: 'C', color: 'text-amber-400', dot: 'bg-amber-500', label: 'MONITORAR', desc: 'Risco Médio' },
                        { tier: 'D', color: 'text-rose-400', dot: 'bg-rose-500', label: 'EVITAR', desc: 'Baixa Confiança' }
                      ].map(item => (
                        <div key={item.tier} className="flex items-center gap-4">
                          <div className="relative">
                            <div className={`w-8 h-8 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center font-black text-[9px] ${item.color}`}>
                              {item.tier}
                            </div>
                            <div className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[#141416] shadow-[0_0_8px_currentcolor] ${item.dot} ${item.color}`} />
                          </div>
                          <div>
                            <p className={`text-[9px] font-black uppercase tracking-[0.1em] ${item.color}`}>{item.label}</p>
                            <p className="text-[8px] text-white/30 font-bold uppercase tracking-tighter">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
                {Object.entries(groupedMatches).map(([leagueName, leagueMatches]) => (
                  <section key={leagueName} className="space-y-8">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-7 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb]" />
                        <h3 className="text-white font-bold text-2xl uppercase tracking-tight">
                          {leagueName}
                        </h3>
                      </div>
                      <div className="h-[1px] bg-white/5 grow mt-1 mr-4" />
                      <span className="text-white/20 text-[10px] font-black uppercase tracking-[0.3em] font-mono whitespace-nowrap">
                        <span>{(leagueMatches as Match[]).length}</span> <span>AVAILABLE SESSIONS</span>
                      </span>

                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">

                      {(leagueMatches as Match[]).map((match: Match) => (
                        <MatchCardTipster
                          key={match.id}
                          deepAnalysis={analyzedMatches[match.id]}
                          match={{
                            id: match.id,
                            homeTeam: match.home_team,
                            awayTeam: match.away_team,
                            date: match.commence_time,
                            homeOdds: match.bookmakers?.[0]?.markets.find(m => m.key === 'h2h')?.outcomes.find(o => o.name === match.home_team)?.price || 1.8,
                            drawOdds: match.bookmakers?.[0]?.markets.find(m => m.key === 'h2h')?.outcomes.find(o => o.name === 'Draw')?.price || 3.2,
                            awayOdds: match.bookmakers?.[0]?.markets.find(m => m.key === 'h2h')?.outcomes.find(o => o.name === match.away_team)?.price || 3.5,
                            resultado_registrado: match.resultado_registrado || !!liveResults[buildLiveKey(match.home_team, match.away_team)],
                            resultado_placar: (() => {
                              const lk = buildLiveKey(match.home_team, match.away_team);
                              const final = liveResults[lk];
                              const parcial = liveScores[lk];
                              return final
                                ?? (parcial ? `${parcial.placar} · ${parcial.minuto}'` : undefined)
                                ?? match.resultado_placar;
                            })(),
                            resultado_data: match.resultado_data,
                            resultado_ignorado: match.resultado_ignorado,
                            sportKey: match.sport_key,
                          }}
                          isSelected={ticketSelectionIds.has(match.id)}
                          onToggleSelection={(id, selected) => {
                            if (selected) {
                              setTicketSelectionIds(prev => new Set(prev).add(id));
                            } else {
                              setTicketSelectionIds(prev => {
                                const next = new Set(prev);
                                next.delete(id);
                                return next;
                              });
                            }
                          }}
                          onAction={() => handleAnalyze(match)}
                          onRegisterResult={(m) => {
                            const analysisObj = analyzedMatches[match.id];
                            setResultadoPreenchido({
                              homeTeam: match.home_team,
                              awayTeam: match.away_team,
                              liga: match.sport_title || match.sport_key,
                              mercado: (analysisObj as any)?.dica_principal || 'Vitória Casa',
                              confianca: (analysisObj as any)?.qualidade || 80,
                              ev: (analysisObj as any)?.elo?.raw_delta || 0,
                              odd: 1.8,
                              stake: 50,
                              gateScore: (analysisObj as any)?.qualidade || 80,
                              matchId: match.id
                            });
                            setResultadoModalOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-[1600px] mx-auto px-6 py-20 border-t border-white/10 mt-20 text-center border-dashed">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-3 mb-8 bg-blue-600/10 px-4 py-2 rounded-full border border-blue-500/20">
            <TrendingUp size={16} className="text-blue-500" />
            <span className="text-blue-500 text-[10px] font-black tracking-[0.2em] uppercase italic">Neural Network Verified Stats</span>
          </div>
          <p className="text-white/20 text-[9px] max-w-2xl leading-relaxed uppercase font-black tracking-[0.3em] font-mono italic opacity-60">
            EVEngine AI uses high-integrity data streams and generative intelligence to synthesize market probability. Betting involves significant risk. Our models suggest conservative positions. 18+ Only.
          </p>
          <div className="flex items-center gap-10 mt-12 opacity-20 hover:opacity-40 transition-opacity">
            <div className="text-[10px] font-mono text-white">V2.4.0</div>
            <div className="text-[10px] font-mono text-white">GEMINI-2.5-FLASH</div>
            <div className="text-[10px] font-mono text-white">ODDS-PARITY</div>
          </div>
        </div>
      </footer>

      {/* Sidebar Navigation */}
      <LeagueSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        selectedLeagues={filterLeagues}
        onToggleLeague={toggleFilterLeague}
        matches={matches}
      />

      {/* Analysis Modal */}
      <AnimatePresence mode="wait">
        {selectedMatch && (

          <AnalysisView
            key={selectedMatch.id}
            match={selectedMatch}
            analysis={analysis}
            loading={analysisLoading}
            onClose={() => setSelectedMatch(null)}
          />
        )}

      </AnimatePresence>


      {/* API-Football error banner (Apenas admin se for erro de cota) */}
      <ApiErrorBanner
        errorType={apiFootballError?.kind === 'quota' && user?.email !== 'grampinelli1985@gmail.com' ? null : apiFootballError}
        onDismiss={() => setApiFootballError(null)}
      />

      {/* Live Notifications Container */}
      <div className="fixed top-20 right-6 z-[60] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {liveNotifications.map(match => (
            <LiveNotification
              key={match.id}
              match={match}
              onClose={removeNotification}
            />
          ))}
        </AnimatePresence>
      </div>



      {/* Floating Selection Bar */}
      <AnimatePresence>
        {ticketSelectionIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-4xl"
          >
            <div className="bg-[#141416]/90 backdrop-blur-xl border border-white/[0.08] p-4 rounded-[2rem] shadow-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 pl-4">
                <div className="flex flex-col min-w-0">
                  <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest leading-none mb-1 truncate">Candidatos ao Bilhete</span>
                  <span className="text-white font-bold text-sm truncate">
                    <span>{ticketSelectionIds.size}</span> <span>{ticketSelectionIds.size === 1 ? 'Jogo' : 'Jogos'}</span>
                  </span>
                </div>

                <button
                  onClick={clearSelection}
                  className="text-[10px] font-bold text-white/20 hover:text-white transition-colors uppercase tracking-[0.2em]"
                >
                  Limpar
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={selectAllFiltered}
                  className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-[9px] font-bold uppercase tracking-[0.2em] transition-all hidden sm:block"
                >
                  Selecionar Todos
                </button>
                {(() => {
                  const qtdSelecionadas = ticketSelectionIds.size;
                  const canGenerate = qtdSelecionadas > 0;
                  
                  return (
                    <button
                      onClick={handleGerarBilhete}
                      disabled={!canGenerate || loadingBilhete}
                      style={{
                        opacity: loadingBilhete ? 0.7 : (canGenerate ? 1 : 0.4),
                        cursor: loadingBilhete ? 'wait' : (canGenerate ? 'pointer' : 'not-allowed')
                      }}
                      className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[9px] font-bold uppercase tracking-[0.2em] transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
                    >
                      <div className="flex items-center gap-2">
                        {loadingBilhete ? (
                          <>
                            <RefreshCw key="icon-analyzing" size={14} className="animate-spin" />
                            <span key="txt-analyzing">Analisando...</span>
                          </>
                        ) : (
                          <>
                            <Ticket key="icon-ready" size={14} />
                            <span key="txt-ready">Gerar Bilhete</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ticket Modal - Posicionado no final para estabilidade do DOM */}
      <TicketModal
        isOpen={isTicketOpen}
        onClose={() => setIsTicketOpen(false)}
        matches={filteredMatches.filter(m => ticketSelectionIds.has(m.id))}
        analyses={analyzedMatches}
        bancaAtual={bancaAtual}
      />
      <BancaModal
        isOpen={bancaModalOpen}
        onClose={() => setBancaModalOpen(false)}
        onSave={handleBancaSalva}
      />
      
      <HistoricoModal
        isOpen={historicoModalOpen}
        onClose={() => setHistoricoModalOpen(false)}
      />

      <ResultadoModal
        key={resultadoPreenchido?.matchId || 'new'}
        isOpen={resultadoModalOpen}
        onClose={() => setResultadoModalOpen(false)}
        preenchido={resultadoPreenchido}
        onSaved={async (matchId, placar, resultado) => {
          // Atualizar localmente a partida
          setMatches(prev => prev.map(m => {
            if (m.id === matchId) {
              return {
                ...m,
                resultado_registrado: true,
                resultado_placar: placar,
                resultado_data: new Date().toISOString()
              };
            }
            return m;
          }));
          
          // Atualizar ELO local
          const jogo = matches.find(m => m.id === matchId);
          if (jogo) {
            atualizarEloPartida(jogo.home_team, jogo.away_team, resultado);
          }
          
          // Gravar no cache local
          const cacheKey = `analysis_${matchId}`;
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              parsed.data.resultado_registrado = true;
              parsed.data.resultado_placar = placar;
              parsed.data.resultado_data = new Date().toISOString();
              localStorage.setItem(cacheKey, JSON.stringify(parsed));
            } catch(e) {}
          }
          
          // Gravar no Supabase
          await updateMatchResultInSupabase(matchId, placar, false);
        }}
      />
      <AnimatePresence>
        {view === 'telemetry' && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 250 }}
            className="fixed inset-0 z-[60] bg-[#0a0a0b] overflow-y-auto"
          >
            <TelemetryView onBack={() => setView('main')} />
          </motion.div>
        )}
      </AnimatePresence>

      {stopLossState.suspensaoAtiva && !alertDismissed && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="relative w-full max-w-md bg-[#141416] border border-[#A32D2D]/30 rounded-3xl shadow-2xl overflow-hidden p-6 space-y-6 text-left">
            <div className="flex items-center gap-3 pb-3 border-b border-white/5">
              <div className="p-2 bg-[#A32D2D]/10 rounded-xl text-[#A32D2D]">
                <ShieldOff size={24} />
              </div>
              <div>
                <h3 className="text-base font-black text-white uppercase tracking-tight">Stop Loss Ativado</h3>
                <p className="text-[9px] text-white/30 uppercase font-black tracking-widest mt-0.5">Segurança de Capital Ativada</p>
              </div>
            </div>
            
            <div className="space-y-3 text-xs text-white/70">
              <p className="font-bold text-white">
                {stopLossState.redStreakAtual} apostas consecutivas perdidas.
              </p>
              <p>
                Novas entradas estão temporariamente bloqueadas para proteger sua banca contra volatilidade extrema.
              </p>
              <p className="text-white/40 text-[10px] uppercase font-bold tracking-wider bg-white/5 p-2 rounded-xl">
                ℹ️ O bloqueio será removido automaticamente ao registrar o primeiro GREEN.
              </p>
            </div>

            <div className="pt-2">
              <button
                onClick={() => {
                  localStorage.setItem('evengine_stop_loss_alert_dismissed', 'true');
                  setAlertDismissed(true);
                }}
                className="w-full py-3 bg-[#A32D2D] hover:bg-[#A32D2D]/90 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-[#A32D2D]/20"
              >
                Entendi, prosseguir em modo leitura
              </button>
            </div>
          </div>
        </div>
      )}
      <UpgradeModal />
      <ToastContainer />
    </div>
  );
}
