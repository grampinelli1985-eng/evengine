/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Match, LEAGUES, AnalysisResponse } from './types';
import { fetchAllMatches, getOddsApiQuotaInfo, fetchActiveMatches, syncApiEplFixtureToMatch, syncApiFootballFixtureToMatch, carregarLigasUsuario } from './services/oddsService';
import { analyzeMatch } from './services/geminiService';
import { updateMatchResultInSupabase, resetGeminiCallCounter, getGeminiCallCount } from './services/telemetryService';
import MatchCardTipster from './components/MatchCardTipster';
import SkeletonMatch from './components/SkeletonMatch';
import AnalysisView from './components/AnalysisView';
import TicketModal from './components/TicketModal';
import LiveNotification from './components/LiveNotification';
import LeagueSidebar from './components/LeagueSidebar';
import { getBanca, calculateKellyStake, carregarStopLossState, salvarStopLossState, podeAumentarStake, aplicarModoConservador, registrarEntradaAprovada, getBancaAtual, setBancaAtual, getBancasFromSupabase, addBancaToSupabase, switchActiveBanca, updateBancaBalance, BancaDB } from './services/bancaService';
import { fetchBets, fetchAnalysisByMatchId, saveAnalysis, createBet, autoResolveBetFromLiveResult } from './services/betService';
import { Trophy, Filter, RefreshCw, Search, AlertCircle, TrendingUp, Ticket, Menu, X, Zap, Flame, Shield, Activity, Crown, Star, Sun, Compass, Award, Home, BookOpen, ShieldOff, AlertTriangle, LogOut, FileText, CheckCircle, Eye, EyeOff, Users, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from './contexts/AuthContext';
import { syncQuotaFromAPI } from './services/apiQuotaService';
import { seedEloFromOdds, sanitizeEloRatings, calcularEstadoJogo, EstadoJogo, atualizarEloPartida } from './services/eloService';
import { registerOpeningOdds, detectLineMovement } from './services/lineMovementService';
import { registrarEntradaCLV, capturarOddsFechamento, corrigirEntradaCLV, sincronizarResultadoCLV } from './services/clvService';
import { analisarMatchAH } from './services/asianHandicapService';
import { calcularValueBets, validateReport } from './services/valueBetService';
import { runTipsterEngine } from './services/tipsterEngine';
import { buscarEstatisticasMedias, buscarH2H } from './services/scoutingService';
import BancaModal from './components/BancaModal';
import { registrarPrevisao, resolverPrevisoesPendentes } from './services/calibrationService';
import HistoricoModal from './components/HistoricoModal';
import { ResultadoModal } from './components/ResultadoModal';
import TelemetryView from './components/TelemetryView';
import DashboardView from './components/DashboardView';
import BetsView from './components/BetsView';
import PendenciasView from './components/PendenciasView';
import { isLigaOperavel } from './config/leagues';
import DocumentationView from './components/Documentation/DocumentationView';
import WorldCupView from './components/WorldCup/WorldCupView';
import LineMovementsView, { LineMovementRecord } from './components/LineMovementsView';
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
import { buildFixtureKey, getCachedAnalysis, setCachedAnalysis, cleanExpiredCache, markMatchAsAnalyzed, getAnalyzedLog, wasAnalyzedWithin24h, fetchAnalyzedMatchIdsLast24h } from './services/analysisCacheService';
import { registerMatchForTracking, pollLiveResults, hasPendingLiveMatches, buildLiveKey, LiveScore, onApiError } from './services/liveTrackerService';
import ApiErrorBanner, { ApiErrorType } from './components/ApiErrorBanner';
import { PlanBadge, UpgradeModal, PlanLock } from './components/PlanControl';
import { showToast, ToastContainer } from './components/Toast';

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

// Official league emblems as inline SVG, keyed by Odds API sport_key
const LeagueEmblem = ({ sportKey, size = 16, active = false }: { sportKey: string; size?: number; active?: boolean }) => {
  const cls = `flex-shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-50 group-hover/btn:opacity-80'}`;

  if (sportKey === 'soccer_epl') {
    // Premier League — purple lion crest simplified
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#38003c' : '#2a002e'} />
        <path d="M16 4 C16 4 10 7 10 13 C10 19 13 22 16 28 C19 22 22 19 22 13 C22 7 16 4 16 4Z" fill="#00ff85" />
        <circle cx="16" cy="13" r="3.5" fill="#38003c" />
        <path d="M10 10 L8 8 M22 10 L24 8" stroke="#00ff85" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (sportKey === 'soccer_spain_la_liga') {
    // La Liga — orange/red shield
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#ff4b00' : '#cc3b00'} />
        <path d="M16 5 L26 9 L26 18 C26 23 21 27 16 29 C11 27 6 23 6 18 L6 9 Z" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.5" />
        <text x="16" y="21" textAnchor="middle" fontSize="10" fontWeight="900" fontFamily="serif" fill="white" letterSpacing="-0.5">LFP</text>
      </svg>
    );
  }

  if (sportKey === 'soccer_italy_serie_a') {
    // Serie A — dark blue with star
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#1a1f6e' : '#13185a'} />
        <path d="M16 7 L17.8 12.8 L24 12.8 L19 16.2 L20.8 22 L16 18.6 L11.2 22 L13 16.2 L8 12.8 L14.2 12.8 Z" fill="#008fd7" />
        <path d="M16 10 L17.2 13.8 L21 13.8 L18 16 L19.2 19.8 L16 17.6 L12.8 19.8 L14 16 L11 13.8 L14.8 13.8 Z" fill="white" />
      </svg>
    );
  }

  if (sportKey === 'soccer_germany_bundesliga') {
    // Bundesliga — red with swoosh
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#d20515' : '#a80410'} />
        <path d="M7 11 C7 11 12 9 16 11 C20 13 22 17 16 19 C10 21 7 19 7 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <circle cx="22" cy="21" r="3" fill="white" />
        <circle cx="22" cy="21" r="1.5" fill={active ? '#d20515' : '#a80410'} />
      </svg>
    );
  }

  if (sportKey === 'soccer_france_ligue_one') {
    // Ligue 1 — orange/gold with L1
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#daa520' : '#b8891a'} />
        <path d="M16 5 L26 9 L26 19 C26 24 21 28 16 29 C11 28 6 24 6 19 L6 9 Z" fill="white" fillOpacity="0.12" stroke="white" strokeWidth="1.5" />
        <text x="16" y="21" textAnchor="middle" fontSize="11" fontWeight="900" fontFamily="sans-serif" fill="white">L1</text>
      </svg>
    );
  }

  if (sportKey === 'soccer_uefa_champs_league_qualification') {
    // UCL Qualifying — same as UCL but with "Q" badge
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#001489' : '#000e6e'} />
        <polygon points="16,5 18.5,12.5 26.5,12.5 20,17.5 22.5,25 16,20 9.5,25 12,17.5 5.5,12.5 13.5,12.5" fill="#FFD700" />
        <rect x="19" y="19" width="12" height="10" rx="3" fill="#C8102E" />
        <text x="25" y="27" textAnchor="middle" fontSize="7" fontWeight="bold" fill="white" fontFamily="Arial">Q</text>
      </svg>
    );
  }

  if (sportKey === 'soccer_uefa_champs_league') {
    // UCL — dark blue with star ball
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#001489' : '#000e6e'} />
        <circle cx="16" cy="16" r="8" fill="none" stroke="#ffffff" strokeWidth="1.5" />
        <path d="M16 8 L17 12 L21 12 L18 14.5 L19 18.5 L16 16 L13 18.5 L14 14.5 L11 12 L15 12 Z" fill="white" />
        <path d="M10 10 L8 7 M22 10 L24 7 M16 8 L16 5" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </svg>
    );
  }

  if (sportKey === 'soccer_uefa_europa_league') {
    // Europa League — orange
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#f04e23' : '#c03d1a'} />
        <circle cx="16" cy="16" r="8" fill="none" stroke="white" strokeWidth="1.5" />
        <path d="M16 9 L17 12.8 L21 12.8 L18 15.2 L19 19 L16 16.6 L13 19 L14 15.2 L11 12.8 L15 12.8 Z" fill="white" />
      </svg>
    );
  }

  if (sportKey === 'soccer_netherlands_eredivisie') {
    // Eredivisie — red/white
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#c8102e' : '#a00d24'} />
        <rect x="6" y="13" width="20" height="6" fill="white" />
        <text x="16" y="20" textAnchor="middle" fontSize="5.5" fontWeight="900" fontFamily="sans-serif" fill="#c8102e">EREDIVISIE</text>
      </svg>
    );
  }

  if (sportKey === 'soccer_portugal_primeira_liga') {
    // Primeira Liga — green/red
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#006600' : '#004d00'} />
        <rect x="6" y="6" width="8" height="20" fill="#cc0000" />
        <path d="M16 5 L26 9 L26 19 C26 24 21 27 16 29 C11 27 6 24 6 19 L6 9 Z" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5" />
        <text x="20" y="20" textAnchor="middle" fontSize="5" fontWeight="900" fontFamily="sans-serif" fill="white">LIGA</text>
      </svg>
    );
  }

  if (sportKey === 'soccer_brazil_campeonato') {
    // Brasileirão — green/yellow
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#009c3b' : '#007a2e'} />
        <path d="M16 6 L28 16 L16 26 L4 16 Z" fill="#ffdf00" />
        <circle cx="16" cy="16" r="5.5" fill={active ? '#009c3b' : '#007a2e'} />
        <path d="M11 16 C11 14 13 12 16 12 C17 12 18 12.5 19 13" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      </svg>
    );
  }

  if (sportKey === 'soccer_argentina_primera_division') {
    // Argentina Primera — light blue/white
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#74acdf' : '#5a8fbf'} />
        <rect x="6" y="6" width="20" height="20" rx="2" fill="none" stroke="white" strokeWidth="1.5" />
        <rect x="6" y="13" width="20" height="6" fill="white" />
        <circle cx="16" cy="16" r="2.5" fill="#f6b40e" />
      </svg>
    );
  }

  if (sportKey === 'soccer_usa_mls') {
    // MLS — dark blue/red
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#002f6c' : '#00245a'} />
        <path d="M16 6 L20 12 L27 12 L21.5 16.5 L23.5 23 L16 19 L8.5 23 L10.5 16.5 L5 12 L12 12 Z" fill="#c8102e" />
        <path d="M16 8 L19 13 L25 13 L20.5 16.5 L22 22 L16 18.5 L10 22 L11.5 16.5 L7 13 L13 13 Z" fill="white" fillOpacity="0.2" />
      </svg>
    );
  }

  if (sportKey === 'soccer_turkey_super_league') {
    // Süper Lig — red/white
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#e30a17' : '#b80812'} />
        <circle cx="14" cy="16" r="6" fill="white" />
        <circle cx="16" cy="16" r="6" fill={active ? '#e30a17' : '#b80812'} />
        <path d="M22 13 L23.7 16 L22 19 L23 19 L25 16 L23 13 Z" fill="white" />
      </svg>
    );
  }

  if (sportKey === 'soccer_mexico_ligamx') {
    // Liga MX — dark green
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#00693e' : '#00502f'} />
        <path d="M16 5 L26 9 L26 19 C26 24 21 27 16 29 C11 27 6 24 6 19 L6 9 Z" fill="none" stroke="#ffffff" strokeWidth="1.5" />
        <text x="16" y="21" textAnchor="middle" fontSize="7.5" fontWeight="900" fontFamily="sans-serif" fill="white">MX</text>
      </svg>
    );
  }

  if (sportKey === 'soccer_conmebol_copa_libertadores') {
    // Copa Libertadores — dark blue/yellow
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={cls} fill="none">
        <rect width="32" height="32" rx="4" fill={active ? '#002060' : '#001540'} />
        <path d="M16 5 C20 5 25 8 25 14 C25 20 20 26 16 28 C12 26 7 20 7 14 C7 8 12 5 16 5Z" fill="none" stroke="#f5c518" strokeWidth="2" />
        <path d="M16 9 L17.2 13 L21 13 L18 15.2 L19.2 19 L16 16.8 L12.8 19 L14 15.2 L11 13 L14.8 13 Z" fill="#f5c518" />
      </svg>
    );
  }

  // Generic fallback
  const FallbackIcon = leagueIcons['trophy'] || Trophy;
  return <Trophy size={size} className={`flex-shrink-0 transition-opacity ${active ? 'opacity-100 text-blue-400' : 'opacity-40 text-blue-400/50 group-hover/btn:opacity-70'}`} />;
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
  const [hasMockData, setHasMockData] = useState(false);

  useEffect(() => {
    const unsubscribe = onApiError((type) => {
      setApiFootballError(type);
    });
    return () => unsubscribe();
  }, []);
  const [showApprovedOnly, setShowApprovedOnly] = useState(false);
  const [filterAnalyzed, setFilterAnalyzed] = useState<'all' | 'analyzed' | 'pending'>('all');
  const [placedBets, setPlacedBets] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('evengine_placed_bets') || '[]'));
    } catch { return new Set(); }
  });
  const [bancaModalOpen, setBancaModalOpen] = useState(false);
  const [confirmBet, setConfirmBet] = useState<{ match: Match; analysis: AnalysisResponse; suggestedOdd: number } | null>(null);
  const [confirmBetOdd, setConfirmBetOdd] = useState('');
  const [remoteAnalyzedIds, setRemoteAnalyzedIds] = useState<Set<string>>(new Set());
  const [historicoModalOpen, setHistoricoModalOpen] = useState(false);
  const [bancaAtual, setBancaAtualState] = useState(getBancaAtual());
  const [resultadoModalOpen, setResultadoModalOpen] = useState(false);
  const [isExtraMenuOpen, setIsExtraMenuOpen] = useState(false);
  const extraMenuRef = useRef<HTMLDivElement>(null);
  const [lineMovements, setLineMovements] = useState<LineMovementRecord[]>([]);
  const [view, setView] = useState<'dashboard' | 'main' | 'bets' | 'telemetry' | 'pendencias' | 'documentacao' | 'worldcup' | 'linemovement'>(() => {
    const saved = localStorage.getItem('evengine_active_view');
    return (saved as any) || 'dashboard';
  });
  const [prevView, setPrevView] = useState<string>(view);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  const [stopLossState, setStopLossState] = useState(() => {
    const state = carregarStopLossState();
    // Auto-correção na inicialização: suspensão inválida com streak < 3 → limpa
    if (state.suspensaoAtiva && state.redStreakAtual < 3) {
      const corrected = { ...state, suspensaoAtiva: false, redStreakAtual: 0 };
      salvarStopLossState(corrected);
      return corrected;
    }
    return state;
  });
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

          // Auto-resolve apostas pendentes deste jogo e sincroniza CLV
          autoResolveBetFromLiveResult({
            matchId: u.matchId,
            homeGoals: (u as any).homeGoals ?? 0,
            awayGoals: (u as any).awayGoals ?? 0,
            placar: u.placar,
          }).then(count => {
            if (count > 0) {
              showToast.success(`✓ ${count} aposta${count > 1 ? 's' : ''} resolvida${count > 1 ? 's' : ''} automaticamente: ${u.homeTeam} ${u.placar} ${u.awayTeam}`);
            } else {
              showToast.success(`Resultado final: ${u.homeTeam} ${u.placar} ${u.awayTeam}`);
            }
          }).catch(() => {
            showToast.success(`Resultado final: ${u.homeTeam} ${u.placar} ${u.awayTeam}`);
          });
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

  // Traduz um texto técnico isolado em mensagem amigável
  function traduzirTextoTecnico(texto: string): string {
    if (texto.includes('Lambda instável') || texto.includes('CV=')) {
      return 'Dados insuficientes: liga em início de temporada ou times sem histórico de gols. Aguarde mais rodadas disputadas.';
    }
    return texto;
  }

  // Traduz códigos técnicos de veto em mensagens legíveis para o usuário
  function traduzirVetos(vetos: string[]): string[] {
    return vetos.map(v => {
      if (v.includes('B-DADOS') && (v.includes('Lambda instável') || v.includes('CV='))) {
        return '[B-DADOS] Dados insuficientes: liga em início de temporada ou times sem histórico de gols. Aguarde mais rodadas disputadas.';
      }
      if (v.includes('B-STOP-LOSS-PNL')) {
        return '[B-STOP-LOSS] Stop Loss diário ativado. Perda do dia atingiu o limite de 5% da banca. Retorne amanhã.';
      }
      if (v.includes('B-STOP-WIN')) {
        return '[B-STOP-WIN] Meta diária de lucro atingida (+15% da banca). Proteja o resultado — sem novas entradas hoje.';
      }
      if (v.includes('B-STOP-LOSS') || v.includes('Stop Loss Ativado')) {
        // Extrai número de derrotas do próprio motivo gerado pelo engine
        const matchDerrota = v.match(/após (\d+) derrota/);
        const n = matchDerrota ? matchDerrota[1] : v.match(/(\d+) reds/)?.[1] ?? '3';
        return `[B-STOP-LOSS] Proteção ativada após ${n} derrotas consecutivas. Novas entradas bloqueadas até o próximo green.`;
      }
      if (v.includes('B-LIMITE') || v.includes('limite de entradas') || v.includes('jogos simultâneos')) {
        // Mantém a mensagem detalhada gerada pelo engine se ela já contiver a causa
        if (v.includes('simultâneos') || v.includes('simultâneo')) {
          return '[B-LIMITE] Limite de jogos simultâneos atingido. Aguarde a resolução de uma aposta aberta.';
        }
        return '[B-LIMITE] Limite diário de entradas atingido. Retorne amanhã ou aguarde resolução das apostas abertas.';
      }
      if (v.includes('B-EV') || v.includes('EV insuficiente')) {
        return '[B-EV] Valor esperado abaixo do mínimo aceitável. A odd não oferece edge suficiente sobre o mercado.';
      }
      if (v.includes('B-CONF') || v.includes('confiança')) {
        return '[B-CONF] Confiança da análise abaixo do limiar. Incerteza muito alta para recomendar entrada.';
      }
      return v;
    });
  }
  const [resultadoPreenchido, setResultadoPreenchido] = useState<any>(undefined);
  const [modoOperacao, setModoOperacao] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  // Persistido em sessionStorage para sobreviver a recargas dentro da mesma sessão do browser
  const notifiedLineMovementRef = useRef<Set<string>>(
    new Set(JSON.parse(sessionStorage.getItem('evengine_notified_lm') || '[]'))
  );
  const addNotifiedLM = (id: string) => {
    notifiedLineMovementRef.current.add(id);
    sessionStorage.setItem('evengine_notified_lm', JSON.stringify([...notifiedLineMovementRef.current]));
  };

  // ── Helpers para criar/salvar aposta de um match ────────────────────────────
  const buildBetPayloadFromMatch = (match: Match, analysis: AnalysisResponse) => {
    const engine = (analysis as any)?.tipsterEngine;

    // Fonte 1: mercado_selecionado — é o que o Gate efetivamente aprovou
    const selecionado = engine?.mercado_selecionado;
    // Fonte 2: mercado (campo de decisão do Gate)
    const mercadoGate = engine?.mercado;
    // Fonte 3: fallback — melhor EV de todos_mercados (menos preciso)
    const mercadosValue: any[] = engine?.todos_mercados ?? [];
    const melhorFallback = mercadosValue.length > 0
      ? [...mercadosValue].sort((a: any, b: any) => (b.ev || 0) - (a.ev || 0))[0]
      : null;

    const mercado: string =
      selecionado?.nome ??
      mercadoGate?.nome ??
      melhorFallback?.nome ??
      (analysis as any)?.dica_principal ??
      'Principal';

    const odd: number =
      selecionado?.odd_referencia ??
      selecionado?.odd_bet365_publica ??
      mercadoGate?.odd ??
      melhorFallback?.odd_referencia ??
      melhorFallback?.odd ??
      1.85;

    const probIA: number =
      selecionado?.probabilidade_final ??
      mercadoGate?.probabilidade_ia ??
      melhorFallback?.probabilidade_final ??
      melhorFallback?.probabilidade_ia ??
      0.5;

    const stakeRecomendada = calculateKellyStake(probIA, odd, bancaAtual || 1000, 0.25);
    return {
      analysis_id: null as null,
      market: mercado as string,
      odd_taken: parseFloat(odd.toFixed(3)),
      stake_amount: parseFloat((stakeRecomendada || 0).toFixed(2)),
      bookmaker: 'bet365' as const,
      status: 'pending' as const,
      notes: `${match.home_team} × ${match.away_team} | ${match.sport_title} | ${new Date(match.commence_time).toLocaleDateString('pt-BR')} | matchId:${match.id}`
    };
  };

  // Salva detalhes pendentes no localStorage para retry se Supabase falhar
  const savePendingBetToStorage = (matchId: string, payload: ReturnType<typeof buildBetPayloadFromMatch>) => {
    try {
      const raw = localStorage.getItem('evengine_pending_bets');
      const pending: Record<string, any> = raw ? JSON.parse(raw) : {};
      pending[matchId] = payload;
      localStorage.setItem('evengine_pending_bets', JSON.stringify(pending));
    } catch { /* ignorar */ }
  };

  const removePendingBetFromStorage = (matchId: string) => {
    try {
      const raw = localStorage.getItem('evengine_pending_bets');
      if (!raw) return;
      const pending = JSON.parse(raw);
      delete pending[matchId];
      localStorage.setItem('evengine_pending_bets', JSON.stringify(pending));
    } catch { /* ignorar */ }
  };

  // Ao carregar jogos, tenta sincronizar apostas que falharam anteriormente
  const syncPendingBets = async (currentMatches: Match[], currentAnalyzed: Record<string, AnalysisResponse>) => {
    try {
      const raw = localStorage.getItem('evengine_pending_bets');
      if (!raw) return;
      const pending: Record<string, any> = JSON.parse(raw);
      const matchIds = Object.keys(pending);
      if (matchIds.length === 0) return;

      for (const matchId of matchIds) {
        let payload = pending[matchId];

        // Se não tiver payload salvo (apostas antigas marcadas sem dados),
        // tenta reconstruir a partir do match/analysis atual
        if (!payload || !payload.market) {
          const match = currentMatches.find(m => m.id === matchId);
          const analysis = currentAnalyzed[matchId];
          if (!match || !analysis) continue;
          payload = buildBetPayloadFromMatch(match, analysis);
        }

        try {
          await createBet(payload);
          removePendingBetFromStorage(matchId);
          console.info(`[SyncBets] Aposta recuperada para matchId ${matchId}`);
        } catch (e) {
          console.warn(`[SyncBets] Falha ao recuperar aposta ${matchId}:`, e);
        }
      }
    } catch (e) {
      console.warn('[SyncBets] Erro ao ler pending bets:', e);
    }

    // Corrige entradas CLV com mercado errado (registradas antes de correção de bug).
    // Para cada análise disponível, verifica se o mercado armazenado no CLV diverge
    // do mercado que o Gate efetivamente aprovou e corrige silenciosamente.
    try {
      for (const [matchId, analysis] of Object.entries(currentAnalyzed)) {
        const engine = (analysis as any)?.tipsterEngine;
        if (!engine) continue;
        const selecionado = engine.mercado_selecionado;
        const mercadoGate = engine.mercado;
        const novoMercado: string | undefined =
          selecionado?.nome ?? mercadoGate?.nome;
        const novaOdd: number | undefined =
          selecionado?.odd_referencia ??
          selecionado?.odd_bet365_publica ??
          mercadoGate?.odd;
        if (novoMercado && novaOdd) {
          corrigirEntradaCLV(matchId, novoMercado, novaOdd);
        }
      }
    } catch (e) {
      console.warn('[SyncBets] Erro ao corrigir entradas CLV:', e);
    }
  };

  const handleMarcarFeito = async (match: Match, overrideAnalysis?: AnalysisResponse, realOdd?: number) => {
    const analysis = overrideAnalysis ?? analyzedMatches[match.id];
    if (!analysis) return;

    // Evita registro duplicado
    if (placedBets.has(match.id)) return;

    const newPlaced = new Set(placedBets);
    newPlaced.add(match.id);
    setPlacedBets(newPlaced);
    localStorage.setItem('evengine_placed_bets', JSON.stringify([...newPlaced]));

    const payload = buildBetPayloadFromMatch(match, analysis);
    if (realOdd && realOdd > 1) {
      payload.odd_taken = parseFloat(realOdd.toFixed(3));
    }

    // Salva no localStorage ANTES do Supabase — garante que retry é possível se falhar
    savePendingBetToStorage(match.id, payload);

    const isAutoSharp = plan === 'sharp' && !!overrideAnalysis;

    try {
      await createBet(payload);
      removePendingBetFromStorage(match.id);
      if (isAutoSharp) {
        showToast.success(`⚡ Sharp Auto-Registro: ${match.home_team} × ${match.away_team} adicionado em Apostas`);
      } else {
        showToast.success(`✓ ${match.home_team} × ${match.away_team} registrado em Apostas`);
      }
    } catch (e) {
      console.warn('[Marcar Feito] Falha ao gravar no Supabase — será tentado novamente:', e);
      showToast.warning(`Salvo localmente. Será sincronizado ao recarregar.`);
    }
  };

  const handleOpenConfirmBet = (match: Match, analysis?: AnalysisResponse) => {
    const a = analysis ?? analyzedMatches[match.id];
    if (!a) return;
    const payload = buildBetPayloadFromMatch(match, a);
    setConfirmBetOdd(payload.odd_taken.toFixed(2));
    setConfirmBet({ match, analysis: a, suggestedOdd: payload.odd_taken });
  };

  // Auto-registro removido: Gate aprovar ≠ aposta realizada.
  // Usuário deve marcar manualmente via "Marcar como Feito".

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

  // Migração única: apostas marcadas antes da correção não tinham payload salvo.
  // Registra os matchIds no pending_bets com payload vazio para que syncPendingBets
  // os reconstrua a partir do match/analysis quando os dados carregarem.
  useEffect(() => {
    try {
      const placed = new Set<string>(JSON.parse(localStorage.getItem('evengine_placed_bets') || '[]'));
      if (placed.size === 0) return;
      const raw = localStorage.getItem('evengine_pending_bets');
      const pending: Record<string, any> = raw ? JSON.parse(raw) : {};
      let changed = false;
      for (const matchId of placed) {
        if (!(matchId in pending)) {
          pending[matchId] = null; // null = sem payload, será reconstruído
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem('evengine_pending_bets', JSON.stringify(pending));
      }
    } catch { /* ignorar */ }
  }, []);

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

  // Restaurar análises do log de 24h (localStorage + Supabase) após carregar partidas e perfil
  useEffect(() => {
    if (!matches.length) return;
    const userId = profile?.id || user?.id;
    if (!userId) return;

    const restore = async () => {
      // 1. Buscar IDs analisados nas últimas 24h do Supabase (cross-device)
      const remoteIds = await fetchAnalyzedMatchIdsLast24h(userId);
      setRemoteAnalyzedIds(remoteIds);

      // 2. Merge com log local (para partidas analisadas sem conexão)
      const localLog = getAnalyzedLog(userId);
      const allAnalyzedIds = new Set([...remoteIds, ...Object.keys(localLog)]);

      // 3. Sincronizar: adicionar ao log local IDs que vieram do remoto
      remoteIds.forEach(id => {
        if (!localLog[id]) {
          const match = matches.find(m => m.id === id);
          if (match) {
            const fk = buildFixtureKey(match.home_team, match.away_team, match.commence_time);
            markMatchAsAnalyzed(id, fk, userId);
          }
        }
      });

      // 4. Tentar restaurar dados de análise do cache do Supabase
      const updates: Record<string, any> = {};
      for (const matchId of allAnalyzedIds) {
        if (analyzedMatches[matchId]) continue;
        const entry = localLog[matchId];
        if (!entry) continue;
        const cached = await getCachedAnalysis(entry.fixtureKey, (plan as any) || 'free').catch(() => null);
        if (cached && cached.tipsterEngine) {
          updates[matchId] = cached;
        }
      }
      if (Object.keys(updates).length) {
        setAnalyzedMatches(prev => ({ ...prev, ...updates }));
      }
    };

    restore();
  }, [matches, profile, user]);

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
      
      const isMock = data.some(m => m._isMockData);
      setHasMockData(isMock);

      // Register initial data for advanced services
      registerOpeningOdds(data);
      const newMovements: LineMovementRecord[] = [];
      data.forEach(m => {
        seedEloFromOdds(m);
        const lm = detectLineMovement(m);
        // Acumula movimentos detectados para o LineMovementsView
        if (lm && Math.abs(lm.variation?.home ?? 0) >= 3) {
          newMovements.push({
            id: `${m.id}-${Date.now()}`,
            matchId: m.id,
            homeTeam: m.home_team,
            awayTeam: m.away_team,
            league: m.sport_key ?? '',
            variationHome: lm.variation?.home ?? 0,
            temSteam: !!(lm.tem_steam),
            timestamp: new Date().toISOString(),
          });
        }
        // Alerta de movimento de odds para planos Pro e Sharp — dispara apenas uma vez por partida
        if (lm && (plan === 'pro' || plan === 'sharp') && !notifiedLineMovementRef.current.has(m.id)) {
          if (lm.tem_steam) {
            addNotifiedLM(m.id);
            showToast.warning(`⚡ Steam Move detectado: ${m.home_team} vs ${m.away_team}`);
          } else if (Math.abs(lm.variation?.home ?? 0) >= 5) {
            addNotifiedLM(m.id);
            showToast.info(`📈 Movimento de odds: ${m.home_team} vs ${m.away_team} (${lm.variation?.home > 0 ? '+' : ''}${lm.variation?.home?.toFixed(1)}%)`);
          }
        }
      });
      if (newMovements.length > 0) {
        setLineMovements(prev => {
          const map = new Map(prev.map(r => [r.matchId, r]));
          newMovements.forEach(r => map.set(r.matchId, r));
          return [...map.values()];
        });
      }

      setMatches(data);

      // Recupera apostas que falharam em sessões anteriores
      syncPendingBets(data, analyzedMatches).catch(console.warn);
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

    // Filter by analysis status — localStorage (24h) + Supabase remoto (cross-device)
    const userId = profile?.id || user?.id;
    const isAnalyzed = (m: Match) =>
      !!analyzedMatches[m.id] ||
      remoteAnalyzedIds.has(m.id) ||
      wasAnalyzedWithin24h(m.id, userId);

    if (filterAnalyzed === 'analyzed') {
      filtered = filtered.filter(isAnalyzed);
    } else if (filterAnalyzed === 'pending') {
      filtered = filtered.filter(m => !isAnalyzed(m));
    }

    // Sort by date
    return filtered.sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());
  }, [matches, filterLeagues, filterDate, modoOperacao, searchQuery, filterAnalyzed, analyzedMatches, remoteAnalyzedIds, profile, user]);

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

    // Verifica cota e acesso à liga ANTES de qualquer early return,
    // para que todo clique em análise (nova ou cacheada) consuma a cota diária.
    if (!canAnalyzeToday()) {
      window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'));
      return;
    }
    if (match.sport_key && !canAccessLeague(match.sport_key)) {
      window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal'));
      return;
    }

    if (analyzedMatches[match.id]) {
      setSelectedMatch(match);
      setAnalysis(analyzedMatches[match.id]);
      setAnalysisLoading(false);
      await incrementAnalysesToday();
      return;
    }
    setSelectedMatch(match);
    setAnalysis(null);
    setAnalysisLoading(true);

    const fixtureKey = buildFixtureKey(match.home_team, match.away_team, match.commence_time);
    const cached = await getCachedAnalysis(fixtureKey).catch(() => null);
    if (cached && cached.tipsterEngine) {
      // Não servir do cache se o engine estava bloqueado — bloqueios são estado
      // transitório (stop-loss, limite de entradas, jogos simultâneos) que podem
      // ter mudado. Re-roda o engine sobre a análise cacheada.
      const cachedEngine = cached.tipsterEngine as any;
      const isBlockedInCache = cachedEngine?.status === 'BLOQUEADO' || cachedEngine?.bloqueado === true;
      if (!isBlockedInCache) {
        // Traduzir vetos e resultado_check_factual mesmo quando vem do cache
        if (cached.tipsterEngine?.vetos?.length) {
          cached.tipsterEngine.vetos = traduzirVetos(cached.tipsterEngine.vetos);
        }
        if ((cached.tipsterEngine as any)?.resultado_check_factual) {
          (cached.tipsterEngine as any).resultado_check_factual = traduzirTextoTecnico(
            (cached.tipsterEngine as any).resultado_check_factual
          );
        }
        setAnalysis(cached);
        setAnalyzedMatches(prev => ({ ...prev, [match.id]: cached }));
        markMatchAsAnalyzed(match.id, fixtureKey, profile?.id || user?.id);
        await incrementAnalysesToday();
        setAnalysisLoading(false);
        return;
      }
      // Stop Loss no cache: cai no fluxo normal para re-executar o Gate com o estado atual
    }

    try {
      resetGeminiCallCounter();
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

      // Buscar histórico para aplicar proteções
      let pendentesCount = 0;
      let stakeAnterior: number | null = null;
      if (user) {
        try {
          const pendentes = await fetchBets({ status: 'pending' });
          pendentesCount = pendentes.length;
          
          const resolvidas = await fetchBets({ status: 'resolved' });
          if (resolvidas.length > 0) {
            stakeAnterior = resolvidas[0].stake_amount || null;
          }
        } catch (e) {
          console.warn('Falha ao buscar histórico de apostas para limites', e);
        }
      }

      // Aplicar limite de stake pós-RED e multiplicar pelo modo conservador
      if (stakeAnterior !== null && !podeAumentarStake(stakeAnterior, kellyReaisValue)) {
        kellyReaisValue = Math.min(kellyReaisValue, stakeAnterior);
        console.warn(`[Proteção de Capital] Stake cap aplicada: R$ ${kellyReaisValue} (aguardando 2 wins)`);
      }
      kellyReaisValue = aplicarModoConservador(kellyReaisValue);

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
        bancaTotal: banca.total,
        pendentesCount
      });      // Attach engine result to analysis
      if (engineVerdict?.vetos?.length) {
        engineVerdict.vetos = traduzirVetos(engineVerdict.vetos);
      }
      result.tipsterEngine = engineVerdict;

      // Persistir no cache compartilhado Supabase — só cacheia APROVADAS
      if (engineVerdict.status === 'APROVADO') {
        setCachedAnalysis(fixtureKey, result, undefined, match.commence_time).catch(console.warn);
      }

      // Registrar para rastreamento automático + poll imediato se jogo já começou
      registerMatchForTracking(match.id, match.home_team, match.away_team, match.commence_time);
      if (new Date(match.commence_time).getTime() <= Date.now()) {
        triggerPollRef.current?.(true);
      }

      // 🚀 CALIBRATION: Registrar se aprovado
      if (engineVerdict.status === 'APROVADO') {
        registrarEntradaAprovada();

        // Usar o mercado que o Gate efetivamente aprovou (mercado_selecionado),
        // não o de maior EV bruto de todos_mercados (pode ser outro)
        const gateMercado = engineVerdict.mercado_selecionado ?? engineVerdict.mercado;
        const oddAnalise: number =
          (gateMercado as any)?.odd_referencia ??
          (gateMercado as any)?.odd_bet365_publica ??
          (gateMercado as any)?.odd ??
          melhorMarket?.odd_api ??
          result.tipster?.odds ??
          1.85;
        const mercadoAnalise: string =
          (gateMercado as any)?.nome ??
          melhorMarket?.market ??
          result.tipster?.market?.name ??
          'Mercado Principal';

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
      markMatchAsAnalyzed(match.id, buildFixtureKey(match.home_team, match.away_team, match.commence_time), profile?.id || user?.id);
      await incrementAnalysesToday();

      // Auto-registro Sharp: delegado ao useEffect que lê placedBets atualizado
    } catch (err) {
      console.error(err);
      // AnalysisView will handle showing error if analysis is null
    } finally {
      const calls = getGeminiCallCount();
      console.info(`[EngineApp] Análise da partida ${match.home_team} x ${match.away_team} consumiu ${calls} chamadas Gemini.`);
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

          resetGeminiCallCounter();
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
          if (engineVerdict?.vetos?.length) {
        engineVerdict.vetos = traduzirVetos(engineVerdict.vetos);
      }
      result.tipsterEngine = engineVerdict;
          // Só cacheia análises APROVADAS — bloqueados podem mudar com dados adicionais
          if (engineVerdict.status === 'APROVADO') {
            setCachedAnalysis(fKey, result, undefined, match.commence_time).catch(console.warn);
          }
          registerMatchForTracking(match.id, match.home_team, match.away_team, match.commence_time);

          setAnalyzedMatches(prev => ({ ...prev, [match.id]: result }));
          await incrementAnalysesToday();
          const calls = getGeminiCallCount();
          console.info(`[EngineApp] Lote (bilhete) para a partida ${match.home_team} x ${match.away_team} consumiu ${calls} chamadas Gemini.`);

          // Delay adicional caso tenha consultado APIs externas
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

          // Auto dismiss after 12s
          setTimeout(() => {
            setLiveNotifications(prev => prev.filter(n => n.id !== match.id));
          }, 12000);
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
                <div className="relative z-10 flex items-center gap-3">
                  <LeagueEmblem sportKey={league.key} size={28} active={selectedLeagues.includes(league.key)} />
                  <div>
                    <h3 className={`text-sm font-bold uppercase tracking-widest mb-0.5 ${selectedLeagues.includes(league.key) ? 'text-blue-400' : 'text-white/40 group-hover:text-white/60'}`}>
                      {league.name}
                    </h3>
                    <div className="text-[10px] font-mono text-white/20 uppercase tracking-tighter">{league.key.replace('soccer_', '').replace(/_/g, ' ')}</div>
                  </div>
                </div>
                {selectedLeagues.includes(league.key) && (
                  <motion.div
                    layoutId={`check-${league.key}`}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-500"
                  >
                    <CheckCircle size={18} />
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
      <style>{`
        @keyframes lmHighlight {
          0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0); outline: 2px solid rgba(16,185,129,0); }
          20%  { box-shadow: 0 0 0 8px rgba(16,185,129,0.35); outline: 2px solid rgba(16,185,129,0.8); }
          100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); outline: 2px solid rgba(16,185,129,0); }
        }
        .lm-highlight { animation: lmHighlight 2s ease-out forwards; border-radius: 1.5rem; }
      `}</style>

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
                className={`flex items-center gap-1 px-2.5 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2 border rounded-xl transition-all group shrink-0 whitespace-nowrap ${view === 'dashboard'
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
                className={`flex items-center gap-1 px-2.5 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2 border rounded-xl transition-all group shrink-0 whitespace-nowrap ${view === 'main'
                    ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/15'
                    : 'bg-transparent border-transparent text-white/50 hover:text-white hover:bg-white/5'
                  }`}
              >
                <Trophy size={14} className="shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Partidas</span>
              </button>

              <button
                onClick={() => setView('telemetry')}
                className={`flex items-center gap-1 px-2.5 py-1.5 2xl:gap-2 2xl:px-4 2xl:py-2 border rounded-xl transition-all group shrink-0 whitespace-nowrap ${view === 'telemetry'
                    ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/15'
                    : 'bg-transparent border-transparent text-white/50 hover:text-white hover:bg-white/5'
                  }`}
              >
                <Activity size={14} className={`shrink-0 ${view === 'telemetry' ? 'text-white' : 'text-blue-400/70'}`} />
                <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Telemetria</span>
              </button>

              {/* Additional Menus Dropdown */}
              <div className="relative shrink-0" ref={extraMenuRef}>
                <button
                  onClick={() => setIsExtraMenuOpen(!isExtraMenuOpen)}
                  className={`flex items-center justify-center px-2.5 py-1.5 2xl:px-3 border rounded-xl transition-all active:scale-95 cursor-pointer shrink-0 ${isExtraMenuOpen || view === 'telemetry' || view === 'documentacao' || view === 'bets' || view === 'pendencias' || view === 'linemovement'
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
                        className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${view === 'bets'
                            ? 'bg-blue-500 border-blue-400 text-white'
                            : 'bg-transparent border-transparent text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                      >
                        <Ticket size={14} className="shrink-0" />
                        <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Apostas</span>
                      </button>

                      {plan === 'sharp' ? (
                        <button
                          onClick={() => {
                            setView('linemovement');
                            setIsExtraMenuOpen(false);
                          }}
                          className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${view === 'linemovement'
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-transparent border-transparent text-white/60 hover:text-white hover:bg-white/5'
                            }`}
                        >
                          <Activity size={14} className={`shrink-0 ${view === 'linemovement' ? 'text-white' : 'text-emerald-400/70'}`} />
                          <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap flex items-center gap-1.5">
                            Line Movements
                            {lineMovements.length > 0 && (
                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${view === 'linemovement' ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                {lineMovements.length}
                              </span>
                            )}
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal', { detail: { targetPlan: 'sharp' } }));
                            setIsExtraMenuOpen(false);
                          }}
                          className="flex items-center gap-2 px-3 py-2 border border-transparent rounded-lg transition-all text-left cursor-pointer text-white/30 hover:text-white/60 hover:bg-white/5"
                          title="Exclusivo Plano Sharp"
                        >
                          <Lock size={14} className="shrink-0 text-emerald-500/40" />
                          <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap flex items-center gap-1.5">
                            Line Movements
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/20">Sharp</span>
                          </span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setView('pendencias');
                          setIsExtraMenuOpen(false);
                        }}
                        className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${view === 'pendencias'
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
                          setView('worldcup');
                          setIsExtraMenuOpen(false);
                        }}
                        className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${view === 'worldcup'
                            ? 'bg-yellow-500 border-yellow-400 text-black'
                            : 'bg-transparent border-transparent text-white/60 hover:text-white hover:bg-white/5'
                          }`}
                      >
                        <Trophy size={14} className={`shrink-0 ${view === 'worldcup' ? 'text-black' : 'text-yellow-500/60'}`} />
                        <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Copa 2026</span>
                      </button>

                      <button
                        onClick={() => {
                          setView('documentacao');
                          setIsExtraMenuOpen(false);
                        }}
                        className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-left cursor-pointer ${view === 'documentacao'
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
          </div>

          {/* Mobile Navigation Controls (Visible only under xl screens) */}
          <div className="xl:hidden flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => {
                setBancaModalOpen(true);
                setMobileMenuOpen(false);
              }}
              className="flex px-3 py-1.5 rounded-full bg-[#00e676]/10 border border-[#00e676]/30 text-[#00e676] font-bold text-xs font-mono transition-all hover:bg-[#00e676]/20 active:scale-95 items-center gap-1 shadow-[0_0_15px_rgba(0,230,118,0.05)] shrink-0 max-w-[140px] overflow-hidden"
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
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${view === 'dashboard'
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
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${view === 'main'
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
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${view === 'bets'
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
                      className={`flex items-center justify-between px-4 py-3.5 border rounded-xl transition-all text-left ${view === 'pendencias'
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

                    {plan === 'sharp' ? (
                      <button
                        onClick={() => {
                          setView('linemovement');
                          setMobileMenuOpen(false);
                        }}
                        className={`flex items-center justify-between px-4 py-3.5 border rounded-xl transition-all text-left ${view === 'linemovement'
                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                            : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                          }`}
                      >
                        <div className="flex items-center gap-3">
                          <Activity size={16} className={view === 'linemovement' ? 'text-white' : 'text-emerald-400/70'} />
                          <span className="text-[11px] font-black uppercase tracking-wider">Line Movements</span>
                        </div>
                        {lineMovements.length > 0 && (
                          <span className={`px-2 py-0.5 text-[9px] font-black rounded-full ${view === 'linemovement' ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-400'}`}>
                            {lineMovements.length}
                          </span>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal', { detail: { targetPlan: 'sharp' } }));
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center justify-between px-4 py-3.5 border border-white/5 rounded-xl transition-all text-left bg-white/[0.02] text-white/30 hover:bg-emerald-500/5 hover:text-white/50"
                      >
                        <div className="flex items-center gap-3">
                          <Lock size={16} className="text-emerald-500/40" />
                          <span className="text-[11px] font-black uppercase tracking-wider">Line Movements</span>
                        </div>
                        <span className="px-2 py-0.5 text-[9px] font-black rounded border border-emerald-500/25 bg-emerald-500/10 text-emerald-400/70">Sharp</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setView('documentacao');
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${view === 'documentacao'
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                        }`}
                    >
                      <BookOpen size={16} className={view === 'documentacao' ? 'text-white' : 'text-blue-500/60'} />
                      <span className="text-[11px] font-black uppercase tracking-wider">Documentação</span>
                    </button>

                    <button
                      onClick={() => {
                        setView('telemetry');
                        setMobileMenuOpen(false);
                      }}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-xl transition-all text-left ${view === 'telemetry'
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/5 text-white/60 hover:text-white hover:bg-white/[0.05]'
                        }`}
                    >
                      <Activity size={16} className={view === 'telemetry' ? 'text-white' : 'text-blue-400/70'} />
                      <span className="text-[11px] font-black uppercase tracking-wider">Telemetria</span>
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
      </header>

      {stopLossState.suspensaoAtiva && (
        <div className="bg-[#A32D2D]/10 border-b border-[#A32D2D]/20 py-3 transition-all">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex items-center justify-between flex-wrap gap-x-4 gap-y-2">
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
                onClick={() => {
                  localStorage.removeItem('odds_api_error_status');
                  sessionStorage.clear();
                  window.location.reload();
                }}
                className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[9px] font-black uppercase tracking-widest rounded transition-all border border-amber-500/30"
              >
                Limpar Cache e Recarregar
              </button>
            </div>
          </div>
        );
      })()}

      {hasMockData && (
        <div className="bg-red-500/10 border-b border-red-500/20 py-2.5 transition-all">
          <div className="max-w-[1600px] mx-auto px-6 flex items-center justify-center flex-wrap gap-x-4 gap-y-1">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <p className="text-[10px] text-red-500/80 font-bold uppercase tracking-widest leading-none">
                DADOS DE DEMONSTRAÇÃO
              </p>
            </div>
            <p className="text-[10px] text-red-400/90 font-medium">
              API indisponível. NÃO usar para decisões reais.
            </p>
          </div>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-10 overflow-x-hidden relative">
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
                    } catch (e) { }
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
                {/* ── Hero Header ── */}
                {!loading && matches.length > 0 && (
                  <div className="mb-6 sm:mb-10 space-y-4">
                    {(() => {
                      const userId2 = profile?.id || user?.id;
                      const isAnalyzed2 = (m: Match) => !!analyzedMatches[m.id] || remoteAnalyzedIds.has(m.id) || wasAnalyzedWithin24h(m.id, userId2);
                      const analyzedCount = filteredMatches.filter(isAnalyzed2).length;
                      const pendingCount = filteredMatches.filter(m => !isAnalyzed2(m)).length;
                      return (
                        <div className="flex flex-col lg:flex-row lg:items-start gap-6 lg:gap-8">

                          {/* ── Esquerda: hero (sem card/box) ── */}
                          <div className="flex-1 flex flex-col gap-4">

                            {/* Badge */}
                            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full w-fit">
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shadow-[0_0_6px_rgba(96,165,250,0.8)]" />
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">Neural Intelligence Feed</span>
                            </motion.div>

                            {/* Radar + título + stats na mesma linha */}
                            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
                              className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6">

                              {/* Radar SVG animado */}
                              <div className="relative flex-shrink-0 w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28">
                                <svg viewBox="0 0 80 80" className="w-full h-full" style={{ overflow: 'visible' }}>
                                  <defs>
                                    <radialGradient id="radarSweep2" cx="50%" cy="50%" r="50%">
                                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
                                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                                    </radialGradient>
                                    <clipPath id="radarCircle2"><circle cx="40" cy="40" r="36" /></clipPath>
                                  </defs>
                                  <circle cx="40" cy="40" r="36" fill="none" stroke="#3b82f6" strokeOpacity="0.15" strokeWidth="0.8" />
                                  <circle cx="40" cy="40" r="24" fill="none" stroke="#3b82f6" strokeOpacity="0.15" strokeWidth="0.8" />
                                  <circle cx="40" cy="40" r="12" fill="none" stroke="#3b82f6" strokeOpacity="0.2" strokeWidth="0.8" />
                                  <line x1="40" y1="4" x2="40" y2="76" stroke="#3b82f6" strokeOpacity="0.1" strokeWidth="0.6" />
                                  <line x1="4" y1="40" x2="76" y2="40" stroke="#3b82f6" strokeOpacity="0.1" strokeWidth="0.6" />
                                  <g clipPath="url(#radarCircle2)" style={{ transformOrigin: '40px 40px', animation: 'radarRotate 2.8s linear infinite' }}>
                                    <path d="M40,40 L40,4 A36,36 0 0,1 76,40 Z" fill="url(#radarSweep2)" opacity="0.85" />
                                    <line x1="40" y1="40" x2="40" y2="4" stroke="#60a5fa" strokeWidth="1.2" strokeOpacity="0.9" />
                                  </g>
                                  <circle cx="40" cy="40" r="2.5" fill="#3b82f6" />
                                  <circle cx="40" cy="40" r="2.5" fill="#3b82f6" style={{ animation: 'radarPulse 2.8s ease-out infinite' }} />
                                  <circle cx="52" cy="28" r="1.8" fill="#34d399" style={{ animation: 'blipFade 2.8s ease-out infinite 0.6s' }} />
                                  <circle cx="30" cy="50" r="1.4" fill="#34d399" style={{ animation: 'blipFade 2.8s ease-out infinite 1.4s' }} />
                                  <circle cx="58" cy="48" r="1.2" fill="#34d399" style={{ animation: 'blipFade 2.8s ease-out infinite 0.2s' }} />
                                </svg>
                                <style>{`
                                  @keyframes radarRotate { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
                                  @keyframes radarPulse { 0%{r:2.5;opacity:1} 100%{r:10;opacity:0} }
                                  @keyframes blipFade { 0%,40%{opacity:0} 60%{opacity:1} 100%{opacity:0} }
                                `}</style>
                              </div>

                              {/* Título + live */}
                              <div className="flex-shrink-0">
                                <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.88] uppercase">
                                  <span className="text-white">Radar de</span><br />
                                  <span className="text-blue-500 italic">Partidas</span>
                                </h2>
                                <div className="mt-2.5 flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Live 24H</span>
                                  <span className="text-white/20">|</span>
                                  <span className="text-xs text-white/40">Monitoramento ativo</span>
                                </div>
                              </div>

                              {/* Stat cards + busca agrupados (desktop) — alinhados à direita do título */}
                              <div className="hidden sm:flex flex-col gap-2 ml-auto">
                                {/* 3 stat cards */}
                                <div className="flex items-stretch gap-3">
                                  {[
                                    { icon: Users, color: 'text-blue-400', num: filteredMatches.length, label: filteredMatches.length === 1 ? 'Confronto' : 'Confrontos', sub: 'encontrado' },
                                    { icon: Eye, color: 'text-emerald-400', num: analyzedCount, label: 'Analisadas', sub: 'concluídas' },
                                    { icon: Zap, color: 'text-amber-400', num: pendingCount, label: 'Pendentes', sub: 'aguardando' },
                                  ].map(({ icon: Icon, color, num, label, sub }) => (
                                    <div key={label} className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3 flex flex-col items-center text-center min-w-[90px]">
                                      <Icon size={18} className={`${color} mb-2`} />
                                      <span className={`text-3xl font-black tabular-nums leading-none ${color}`}>{String(num).padStart(2, '0')}</span>
                                      <span className="text-[10px] font-black uppercase tracking-wider text-white mt-1.5">{label}</span>
                                      <span className="text-[10px] text-white/30">{sub}</span>
                                    </div>
                                  ))}
                                </div>
                                {/* Busca — exatamente abaixo dos cards */}
                                <div className="relative group">
                                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 text-white/25 group-focus-within:text-blue-400 transition-colors">
                                    <Search size={14} />
                                  </div>
                                  <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar time ou liga..."
                                    className="w-full h-10 bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-9 text-sm font-medium text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/40 focus:bg-white/[0.06] transition-all"
                                  />
                                  {searchQuery && (
                                    <button onClick={() => setSearchQuery('')}
                                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-white/25 hover:text-white transition-colors">
                                      <X size={12} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </motion.div>

                            {/* 3 stat cards + busca — mobile (abaixo do título) */}
                            <div className="flex sm:hidden flex-col gap-2">
                              <div className="flex items-stretch gap-3">
                                {[
                                  { icon: Users, color: 'text-blue-400', num: filteredMatches.length, label: filteredMatches.length === 1 ? 'Confronto' : 'Confrontos', sub: 'encontrado' },
                                  { icon: Eye, color: 'text-emerald-400', num: analyzedCount, label: 'Analisadas', sub: 'concluídas' },
                                  { icon: Zap, color: 'text-amber-400', num: pendingCount, label: 'Pendentes', sub: 'aguardando' },
                                ].map(({ icon: Icon, color, num, label, sub }) => (
                                  <div key={label} className="flex-1 bg-white/[0.03] border border-white/[0.07] rounded-xl py-3 flex flex-col items-center text-center">
                                    <Icon size={16} className={`${color} mb-1.5`} />
                                    <span className={`text-2xl font-black tabular-nums leading-none ${color}`}>{String(num).padStart(2, '0')}</span>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-white mt-1">{label}</span>
                                    <span className="text-[10px] text-white/30">{sub}</span>
                                  </div>
                                ))}
                              </div>
                              {/* Busca mobile */}
                              <div className="relative group">
                                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 text-white/25 group-focus-within:text-blue-400 transition-colors">
                                  <Search size={14} />
                                </div>
                                <input
                                  type="text"
                                  value={searchQuery}
                                  onChange={(e) => setSearchQuery(e.target.value)}
                                  placeholder="Buscar time ou liga..."
                                  className="w-full h-10 bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-9 text-sm font-medium text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/40 focus:bg-white/[0.06] transition-all"
                                />
                                {searchQuery && (
                                  <button onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-white/25 hover:text-white transition-colors">
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Chip de modelos */}
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05] w-fit">
                              <Activity size={13} className="text-blue-400/70 flex-shrink-0" />
                              <span className="text-[11px] text-white/50 font-medium">
                                Monitorando <span className="text-white/75">ELO</span> • <span className="text-white/75">Poisson</span> • <span className="text-white/75">Odds</span> • <span className="text-white/75">Sharp Money</span> • <span className="text-white/75">IA</span>
                              </span>
                            </div>

                          </div>

                          {/* ── Direita: Gate card + filtros ── */}
                          <div className="flex flex-col gap-3 w-full lg:w-[320px] xl:w-[360px]">

                            {/* GATE card */}
                            <style>{`
                              @keyframes gateShieldPulse {
                                0%   { box-shadow: 0 0 0 0 rgba(59,130,246,0.5), 0 0 0 0 rgba(59,130,246,0.25); }
                                50%  { box-shadow: 0 0 0 7px rgba(59,130,246,0.12), 0 0 0 14px rgba(59,130,246,0.04); }
                                100% { box-shadow: 0 0 0 0 rgba(59,130,246,0), 0 0 0 0 rgba(59,130,246,0); }
                              }
                              @keyframes gateShieldScan {
                                0%   { transform: translateY(110%) scaleX(0.6); opacity: 0; }
                                30%  { opacity: 0.7; }
                                70%  { opacity: 0.7; }
                                100% { transform: translateY(-110%) scaleX(0.6); opacity: 0; }
                              }
                              @keyframes gateShieldGlow {
                                0%, 100% { opacity: 0.7; }
                                50%       { opacity: 1; }
                              }
                              .gate-shield-active {
                                animation: gateShieldPulse 2.4s ease-out infinite;
                              }
                              .gate-scan-line {
                                animation: gateShieldScan 2.4s ease-in-out infinite;
                              }
                              .gate-shield-icon {
                                animation: gateShieldGlow 2.4s ease-in-out infinite;
                              }
                            `}</style>
                            <button
                              onClick={() => setShowApprovedOnly(prev => !prev)}
                              title={approvedCount > 0 ? `${approvedCount} aprovada(s) pelo Gate` : 'Nenhuma aprovada ainda'}
                              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border transition-all text-left ${
                                showApprovedOnly
                                  ? 'bg-blue-600/12 border-blue-500/35'
                                  : 'bg-white/[0.03] border-white/[0.07] hover:border-blue-500/25 hover:bg-blue-500/[0.04]'
                              }`}
                            >
                              {/* Shield icon com animação de proteção quando ativo */}
                              <div className={`relative flex-shrink-0 w-14 h-14 rounded-xl bg-blue-600/15 border border-blue-500/25 flex items-center justify-center overflow-hidden ${showApprovedOnly ? 'gate-shield-active' : ''}`}>
                                {/* Linha de scan (só quando ativo) */}
                                {showApprovedOnly && (
                                  <div className="gate-scan-line absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400/70 to-transparent pointer-events-none" />
                                )}
                                <Shield size={26} className={`text-blue-400 relative z-10 ${showApprovedOnly ? 'gate-shield-icon' : ''}`} />
                                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#0a0a0b] flex items-center justify-center z-20">
                                  <CheckCircle size={11} className="text-white" />
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-base font-black text-blue-400 uppercase tracking-wider">Gate</span>
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                                    <CheckCircle size={9} />
                                    Ativo
                                  </span>
                                </div>
                                <div className="text-[12px] text-white/50">Filtro inteligente</div>
                                <div className="text-[12px] text-blue-400/70">Proteção de entradas</div>
                              </div>
                              {approvedCount > 0 && (
                                <span className={`text-sm font-black px-2.5 py-1 rounded-lg tabular-nums flex-shrink-0 ${showApprovedOnly ? 'bg-blue-600 text-white' : 'bg-white/[0.08] text-white/50'}`}>
                                  {approvedCount}
                                </span>
                              )}
                            </button>

                            {/* Período */}
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/25 px-0.5">Período</span>
                              <div className="flex items-center h-10 bg-white/[0.04] border border-white/[0.08] rounded-lg p-0.5 gap-0.5">
                                {[
                                  { value: 1, label: 'Hoje' },
                                  { value: 2, label: '48H' },
                                  { value: 3, label: '72H' },
                                  { value: 7, label: '7 Dias' },
                                ].map((opt) => (
                                  <button
                                    key={opt.value}
                                    onClick={() => setFilterDate(opt.value)}
                                    className={`h-full flex-1 rounded-md text-xs font-black uppercase tracking-wide transition-all select-none ${
                                      filterDate === opt.value
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-white/35 hover:text-white/70 hover:bg-white/[0.06]'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Analisadas / Pendentes */}
                            <div className="flex gap-2">
                              <button
                                onClick={() => setFilterAnalyzed(prev => prev === 'analyzed' ? 'all' : 'analyzed')}
                                className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                                  filterAnalyzed === 'analyzed'
                                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                                    : 'bg-white/[0.04] border-white/[0.08] text-white/35 hover:text-white/70'
                                }`}
                              >
                                <Eye size={13} />
                                <span>Analisadas</span>
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${filterAnalyzed === 'analyzed' ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/40'}`}>
                                  {analyzedCount}
                                </span>
                              </button>
                              <button
                                onClick={() => setFilterAnalyzed(prev => prev === 'pending' ? 'all' : 'pending')}
                                className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                                  filterAnalyzed === 'pending'
                                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                                    : 'bg-white/[0.04] border-white/[0.08] text-white/35 hover:text-white/70'
                                }`}
                              >
                                <Zap size={13} />
                                <span>Pendentes</span>
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${filterAnalyzed === 'pending' ? 'bg-amber-500 text-black' : 'bg-white/10 text-white/40'}`}>
                                  {pendingCount}
                                </span>
                              </button>
                            </div>

                          </div>
                        </div>
                      );
                    })()}

                    {/* Divider */}
                    <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

                                        {/* League Quick Filters */}
                    <div className="relative">
                      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">

                        <button
                          onClick={() => toggleFilterLeague('all')}
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs sm:text-[13px] font-black uppercase tracking-[0.12em] border transition-all whitespace-nowrap flex-shrink-0 ${
                            filterLeagues.includes('all')
                              ? 'bg-white text-black border-transparent shadow-md shadow-white/10'
                              : 'bg-white/[0.04] text-white/40 border-white/[0.08] hover:border-white/15 hover:text-white/70'
                          }`}
                        >
                          <Filter size={13} className={filterLeagues.includes('all') ? 'text-black' : 'text-blue-400/60'} />
                          <span>Todas as Ligas</span>
                        </button>

                        <button
                          onClick={() => setIsSidebarOpen(true)}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs sm:text-[13px] font-black uppercase tracking-[0.12em] border border-blue-500/25 bg-blue-600/10 text-blue-400 hover:bg-blue-600/18 transition-all whitespace-nowrap flex-shrink-0"
                        >
                          <Filter size={13} />
                          <span>Filtro de Ligas</span>
                        </button>

                        <div className="w-px h-5 bg-white/[0.08] flex-shrink-0" />

                        {LEAGUES.filter(l => selectedLeagues.includes(l.key)).map(league => {
                          const isActive = filterLeagues.includes(league.key);
                          return (
                            <button
                              key={league.key}
                              onClick={() => toggleFilterLeague(league.key)}
                              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs sm:text-[13px] font-black uppercase tracking-[0.12em] border transition-all whitespace-nowrap flex-shrink-0 group/btn ${
                                isActive
                                  ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/30'
                                  : 'bg-white/[0.04] text-white/40 border-white/[0.08] hover:border-white/15 hover:text-white/70'
                              }`}
                            >
                              <LeagueEmblem sportKey={league.key} size={16} active={isActive} />
                              <span>{league.name}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="absolute right-0 top-0 bottom-1 w-16 bg-gradient-to-l from-[#0a0a0b] to-transparent pointer-events-none hidden sm:block" />
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
                      {searchQuery ? <span>Sem Resultados</span> : showApprovedOnly ? <span>Sem Aprovadas</span> : filterAnalyzed === 'analyzed' ? <span>Nenhuma Analisada</span> : filterAnalyzed === 'pending' ? <span>Todas Analisadas</span> : <span>Vazio</span>}
                    </h3>
                    <p className="text-white/40 text-center max-w-sm px-6 font-medium leading-relaxed">
                      {searchQuery
                        ? <span>Nenhum confronto encontrado para "{searchQuery}". Verifique a ortografia ou tente outro termo.</span>
                        : showApprovedOnly
                          ? <span>Nenhuma partida aprovada pelo Gate com os filtros atuais. Analise mais partidas para ver as aprovadas.</span>
                          : filterAnalyzed === 'analyzed'
                            ? <span>Nenhuma partida foi analisada ainda no período selecionado. Clique em "Analisar" em qualquer card para começar.</span>
                            : filterAnalyzed === 'pending'
                              ? <span>Todas as partidas do período selecionado já foram analisadas. Parabéns!</span>
                              : <span>Nenhuma partida encontrada para o período selecionado.</span>}
                    </p>
                    {(searchQuery || filterAnalyzed !== 'all') && (
                      <button
                        onClick={() => { setSearchQuery(''); setFilterAnalyzed('all'); }}
                        className="mt-6 px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-bold text-white uppercase tracking-widest transition-all"
                      >
                        Limpar Filtros
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-10 sm:space-y-20">
                    {/* Engine Legend */}
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/[0.07] bg-white/[0.02] mb-8 sm:mb-14"
                    >
                      {/* subtle gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/[0.04] via-transparent to-purple-600/[0.04] pointer-events-none" />

                      <div className="relative p-5 sm:p-8">
                        {/* Header row */}
                        <div className="flex items-center gap-3 mb-6 sm:mb-8">
                          <div className="w-1 h-8 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
                          <div>
                            <h4 className="text-white font-black text-base sm:text-lg uppercase tracking-tight leading-none">
                              Guia de Análise Tipster
                            </h4>
                            <p className="text-[10px] text-white/30 uppercase font-semibold tracking-[0.18em] mt-0.5">
                              Critérios de Validação · EVEngine AI
                            </p>
                          </div>
                        </div>

                        {/* Cards grid */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                          {[
                            {
                              tier: 'S/A',
                              color: 'text-emerald-400',
                              border: 'border-emerald-500/25',
                              bg: 'bg-emerald-500/[0.07]',
                              dot: 'bg-emerald-400',
                              glow: 'shadow-[0_0_16px_rgba(52,211,153,0.25)]',
                              label: 'APOSTE',
                              desc: 'Alta Confiança',
                              hint: 'Melhor edge detectado'
                            },
                            {
                              tier: 'B',
                              color: 'text-blue-400',
                              border: 'border-blue-500/25',
                              bg: 'bg-blue-500/[0.07]',
                              dot: 'bg-blue-400',
                              glow: 'shadow-[0_0_16px_rgba(96,165,250,0.25)]',
                              label: 'APOSTE',
                              desc: 'Boa Oportunidade',
                              hint: 'Value positivo confirmado'
                            },
                            {
                              tier: 'C',
                              color: 'text-amber-400',
                              border: 'border-amber-500/25',
                              bg: 'bg-amber-500/[0.07]',
                              dot: 'bg-amber-400',
                              glow: 'shadow-[0_0_16px_rgba(251,191,36,0.2)]',
                              label: 'MONITORAR',
                              desc: 'Risco Médio',
                              hint: 'Aguarde mais dados'
                            },
                            {
                              tier: 'D',
                              color: 'text-rose-400',
                              border: 'border-rose-500/25',
                              bg: 'bg-rose-500/[0.07]',
                              dot: 'bg-rose-400',
                              glow: 'shadow-[0_0_16px_rgba(251,113,133,0.2)]',
                              label: 'EVITAR',
                              desc: 'Baixa Confiança',
                              hint: 'Sem edge estatístico'
                            },
                          ].map(item => (
                            <div
                              key={item.tier}
                              className={`flex flex-col gap-3 p-4 sm:p-5 rounded-xl border ${item.border} ${item.bg}`}
                            >
                              {/* Tier badge + dot */}
                              <div className="flex items-center justify-between">
                                <div className={`relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-black/20 border ${item.border} flex items-center justify-center font-black text-sm sm:text-base ${item.color} ${item.glow}`}>
                                  {item.tier}
                                  <div className={`absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full border-2 border-[#0d0d0f] ${item.dot}`} />
                                </div>
                              </div>

                              {/* Label + desc */}
                              <div>
                                <p className={`text-sm sm:text-base font-black uppercase tracking-wide leading-none ${item.color}`}>
                                  {item.label}
                                </p>
                                <p className="text-xs sm:text-sm font-semibold text-white/60 mt-1 leading-none">
                                  {item.desc}
                                </p>
                              </div>

                              {/* Hint */}
                              <p className="text-[10px] sm:text-xs text-white/25 font-medium leading-snug">
                                {item.hint}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                    {Object.entries(groupedMatches).map(([leagueName, leagueMatches]) => (
                      <section key={leagueName} className="space-y-5 sm:space-y-8">
                        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
                          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            <div className="w-1.5 sm:w-2 h-6 sm:h-7 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb]" />
                            <h3 className="text-white font-bold text-lg sm:text-2xl uppercase tracking-tight truncate max-w-[160px] sm:max-w-none">
                              {leagueName}
                            </h3>
                          </div>
                          <div className="h-[1px] bg-white/5 grow mt-1" />
                          <span className="text-white/20 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] font-mono whitespace-nowrap shrink-0">
                            {(leagueMatches as Match[]).length} <span className="hidden sm:inline">AVAILABLE SESSIONS</span><span className="sm:hidden">jogos</span>
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">

                          {(leagueMatches as Match[]).map((match: Match) => {
                            const isApproved = analyzedMatches[match.id]?.tipsterEngine?.status === 'APROVADO';
                            const isPlaced = placedBets.has(match.id);
                            return (
                            <div key={match.id} id={`match-card-${match.id}`} className="flex flex-col gap-2">
                            <MatchCardTipster
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
                            {/* FEITO button — visible only on Gate APROVADO entries */}
                            {isApproved && (
                              isPlaced ? (
                                <div className="flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                                  <CheckCircle size={13} className="shrink-0" />
                                  <span>Apostado</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleOpenConfirmBet(match)}
                                  className="flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/60 rounded-xl text-white text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-md shadow-emerald-600/20"
                                >
                                  <CheckCircle size={13} className="shrink-0" />
                                  <span>Marcar como Feito</span>
                                </button>
                              )
                            )}
                            </div>
                            );
                          })}
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
      <footer className="max-w-[1600px] mx-auto px-4 sm:px-6 py-10 sm:py-20 border-t border-white/10 mt-10 sm:mt-20 text-center border-dashed">
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
        errorType={apiFootballError?.kind === 'quota' && (plan === 'pro' || plan === 'sharp') ? null : apiFootballError}
        onDismiss={() => setApiFootballError(null)}
      />

      {/* Live Notifications Container — restrito a planos pro/sharp */}
      {(plan === 'pro' || plan === 'sharp') && (
        <div className="fixed top-[4.5rem] right-3 sm:right-6 z-[60] flex flex-col gap-3 pointer-events-none max-w-[calc(100vw-1.5rem)] sm:max-w-sm">
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
      )}



      {/* Floating Selection Bar */}
      <AnimatePresence>
        {ticketSelectionIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-4xl"
          >
            <div className="bg-[#141416]/90 backdrop-blur-xl border border-white/[0.08] p-3 sm:p-4 rounded-2xl sm:rounded-[2rem] shadow-2xl flex flex-wrap items-center justify-between gap-3">
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
        plan={plan}
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

          // Gravar no cache local — normalizar estrutura flat vs { data: {...} }
          const cacheKey = `analysis_${matchId}`;
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              const payload = parsed.data ?? parsed; // suporta ambas as estruturas
              payload.resultado_registrado = true;
              payload.resultado_placar = placar;
              payload.resultado_data = new Date().toISOString();
              localStorage.setItem(cacheKey, JSON.stringify(parsed));
            } catch (e) { console.error('[Cache] Falha ao atualizar resultado no localStorage:', e); }
          }

          // Atualizar analyzedMatches em memória para evitar estado stale
          setAnalyzedMatches(prev => {
            const existing = prev[matchId];
            if (!existing) return prev;
            return { ...prev, [matchId]: { ...existing, resultado_registrado: true, resultado_placar: placar, resultado_data: new Date().toISOString() } as any };
          });

          // Gravar no Supabase — terceiro argumento é resultado_registrado (deve ser true)
          await updateMatchResultInSupabase(matchId, placar, true);
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

      <AnimatePresence>
        {view === 'linemovement' && plan === 'sharp' && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 250 }}
            className="fixed inset-0 z-[60] bg-[#0a0a0b] overflow-y-auto"
          >
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
              {/* Back button */}
              <button
                onClick={() => setView('main')}
                className="flex items-center gap-2 text-white/40 hover:text-white text-xs font-black uppercase tracking-widest mb-8 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Voltar
              </button>
              <LineMovementsView
                records={lineMovements}
                plan={plan}
                onRefresh={() => loadMatches(true)}
                onGoToMatch={(matchId) => {
                  // Limpa todos os filtros para garantir que a partida seja visível
                  setFilterDate(7);
                  setFilterLeagues(['all']);
                  setFilterAnalyzed('all');
                  setSearchQuery('');
                  setShowApprovedOnly(false);
                  setView('main');
                  // Aguarda a view renderizar com os filtros limpos antes de scrollar
                  setTimeout(() => {
                    const el = document.getElementById(`match-card-${matchId}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('lm-highlight');
                      setTimeout(() => el.classList.remove('lm-highlight'), 2000);
                    } else {
                      // Partida não encontrada na lista atual — pode ter saído da janela da API
                      const rec = lineMovements.find(r => r.matchId === matchId);
                      const matchName = rec ? `${rec.homeTeam} vs ${rec.awayTeam}` : 'a partida';
                      showToast.warning(`${matchName} não está mais disponível na janela de busca atual. Tente recarregar o painel.`);
                    }
                  }, 500);
                }}
              />
            </div>
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

      {/* Modal de confirmação de odd real */}
      {confirmBet && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#141416] border border-white/[0.08] rounded-3xl shadow-2xl p-6 space-y-5">
            <div>
              <p className="text-[9px] font-black text-white/30 uppercase tracking-widest">Confirmar Entrada</p>
              <h3 className="text-sm font-black text-white uppercase mt-1">
                {confirmBet.match.home_team} <span className="text-white/30">×</span> {confirmBet.match.away_team}
              </h3>
              <p className="text-[10px] text-white/40 mt-0.5">
                {(confirmBet.analysis as any)?.resultado?.mercado_selecionado?.nome ||
                 (confirmBet.analysis as any)?.tipster_engine?.mercado_selecionado?.nome || 'Mercado'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest block">
                Odd que você entrou
              </label>
              <p className="text-[8px] text-white/25 mb-1.5">
                Referência Pinnacle: <span className="text-blue-400 font-mono">{confirmBet.suggestedOdd.toFixed(2)}</span>
              </p>
              <input
                type="number"
                step="0.01"
                min="1.01"
                value={confirmBetOdd}
                onChange={(e) => setConfirmBetOdd(e.target.value)}
                className="w-full bg-[#0d0d0f] border border-white/10 rounded-xl px-4 py-3 text-sm font-mono font-black text-white focus:outline-none focus:border-emerald-500 transition-colors"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmBet(null)}
                className="w-1/2 py-3 bg-white/5 hover:bg-white/10 text-white/60 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all border border-white/5"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const odd = parseFloat(confirmBetOdd);
                  await handleMarcarFeito(confirmBet.match, confirmBet.analysis, isNaN(odd) ? undefined : odd);
                  setConfirmBet(null);
                }}
                className="w-1/2 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-600/15"
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
