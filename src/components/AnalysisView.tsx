/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Match, AnalysisResponse, GoalAnalysis } from '../types';
import {
  X, TrendingUp, Target, ShieldCheck, Activity, Flag, Search,
  AlertTriangle, CheckCircle2, ChevronRight, Info, History,
  Check, PieChart, Zap, UserMinus, BarChart3, InfoIcon, Ban,
  RefreshCw, Ticket
} from 'lucide-react';
import { getBanca, calculateKellyStake } from '../services/bancaService';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect, useMemo } from 'react';
import { calcularValueBets, validateReport } from '../services/valueBetService';
import TipsterAnalysisServiceBase from '../services/tipsterAnalysisService';
import { getLimiarRecomendado } from '../services/calibrationService';
import { logAnalysis } from '../services/telemetryService';
import { useRef } from 'react';
import { AnalysisDecisionCard } from './AnalysisDecisionCard';
import { recalculateTipsterMetrics } from '../services/tipsterEngine';
import { poissonDistribution } from '../services/goalsService';
import { getFormaRecente } from '../services/scoutingService';
import AHCard from './Analysis/AHCard';
import { createBet } from '../services/betService';

const tipsterService = new TipsterAnalysisServiceBase();

interface AnalysisViewProps {
  key?: string | number;
  match: Match;
  analysis: AnalysisResponse | null;
  loading: boolean;
  onClose: () => void;
}


const Tooltip = ({ text }: { text: string }) => (
  <div className="group relative inline-block ml-2">
    <InfoIcon size={14} className="text-white/20 cursor-help hover:text-white/60 transition-colors" />
    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-[#1a1a1c] border border-white/10 rounded-xl text-[10px] text-white/70 font-medium leading-relaxed opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-[100] shadow-2xl backdrop-blur-md">
      {text}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-8 border-transparent border-b-[#1a1a1c]" />
    </div>
  </div>
);



interface PoissonChartProps {
  lambda: number;
}

function PoissonChart({ lambda }: PoissonChartProps) {
  const dist = poissonDistribution(lambda);
  const data = [
    { label: '0 Gols', val: dist.prob0 * 100, color: 'from-blue-600 to-cyan-500' },
    { label: '1 Gol', val: dist.prob1 * 100, color: 'from-cyan-500 to-teal-400' },
    { label: '2 Gols', val: dist.prob2 * 100, color: 'from-teal-400 to-emerald-400' },
    { label: '3 Gols', val: dist.prob3 * 100, color: 'from-emerald-400 to-amber-500' },
    { label: '4+ Gols', val: dist.prob4plus * 100, color: 'from-amber-500 to-rose-500' },
  ];

  return (
    <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8 h-full flex flex-col justify-between">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={18} className="text-emerald-400" />
        <div>
          <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white flex items-center gap-1.5">
            Distribuição de Gols (Poisson)
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('evengine_navigate_docs_tab'));
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('evengine_navigate_docs', {
                    detail: { sectionId: 'como-funciona', subsectionId: 'fluxo-completo' }
                  }));
                }, 150);
              }}
              title="Aprender sobre o Modelo Poisson na Documentação"
              className="text-emerald-400/60 hover:text-emerald-400 transition-colors cursor-pointer flex items-center"
            >
              <Info size={12} className="ml-1 shrink-0" />
            </button>
          </h4>
          <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest mt-0.5 block">λ (Expectativa de Gols) = {lambda.toFixed(2)}</span>
        </div>
      </div>
      <div className="space-y-4 pt-2 flex-1 flex flex-col justify-center">
        {data.map((item, idx) => (
          <div key={idx} className="group relative">
            <div className="flex justify-between items-center text-[10px] font-mono mb-1.5 font-bold">
              <span className="text-white/60 uppercase tracking-wider group-hover:text-white transition-colors">{item.label}</span>
              <span className="text-emerald-400 group-hover:scale-105 transition-all">{item.val.toFixed(1)}%</span>
            </div>
            <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden border border-white/[0.03]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${item.val}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className={`h-full bg-gradient-to-r ${item.color} rounded-full relative group-hover:brightness-110 transition-all`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalysisView({ match, analysis, loading, onClose }: AnalysisViewProps) {


  const banca = getBanca();
  const [formaHome, setFormaHome] = useState<any>({ data: [], source: 'unavailable' });
  const [formaAway, setFormaAway] = useState<any>({ data: [], source: 'unavailable' });

  
  const [oddManualText, setOddManualText] = useState('');
  const [oddManual, setOddManual] = useState<number | null>(null);
  const [engineResult, setEngineResult] = useState<any>(analysis?.tipsterEngine);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showAuditWarning, setShowAuditWarning] = useState(false);
  const [userConfirmedAudit, setUserConfirmedAudit] = useState(false);
  const lastLoggedRef = useRef<string>('');
  const mercadoLocked = useRef<any>(null);
  const [loggedAnalysisId, setLoggedAnalysisId] = useState<string | null>(null);
  const [ticketGerado, setTicketGerado] = useState(false);
  const [betRegistrada, setBetRegistrada] = useState(false);
  const [registrandoBet, setRegistrandoBet] = useState(false);
  
  // Initial sync when analysis loads
  useEffect(() => {
    if (analysis?.tipsterEngine) {
      setEngineResult(analysis.tipsterEngine);
      setUserConfirmedAudit(false);
      if (analysis.tipsterEngine.mercado) {
        mercadoLocked.current = analysis.tipsterEngine.mercado;
      }
    }
  }, [analysis]);
  
  useEffect(() => {
    if (match) {
      const stored = localStorage.getItem(`bet365_odd_${match.id}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            setOddManualText(String(parsed.odd));
            setOddManual(parsed.odd);
          } else {
            localStorage.removeItem(`bet365_odd_${match.id}`);
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }, [match]);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      if (!oddManualText) {
        setOddManual(null);
        setUserConfirmedAudit(false);
        if (match) localStorage.removeItem(`bet365_odd_${match.id}`);
        return;
      }
      
      const val = parseFloat(oddManualText);
      
      // Evita disparar validação chata de erro se o usuário estiver no meio da digitação (ex: "1" ou termina com ".")
      if (oddManualText === '1' || oddManualText.endsWith('.')) {
        return;
      }

      if (isNaN(val) || val < 1.01 || val > 50.00) {
        setToastMessage("Odd inválida. Deve estar entre 1.01 e 50.00.");
        setOddManual(null);
        setTimeout(() => setToastMessage(null), 3000);
      } else {
        setOddManual(val);
        if (match) {
          localStorage.setItem(`bet365_odd_${match.id}`, JSON.stringify({ odd: val, timestamp: Date.now() }));
        }
      }
    }, 1000); // Aumentado para 1000ms para permitir digitação suave sem interrupções
    return () => clearTimeout(handler);
  }, [oddManualText, match]);

  useEffect(() => {
    if (analysis && analysis.tipsterEngine) {
      if (analysis.tipsterEngine.mercado && !mercadoLocked.current) {
        mercadoLocked.current = analysis.tipsterEngine.mercado;
      }
      
      const lockedMercado = mercadoLocked.current || analysis.tipsterEngine.mercado;
      const probIA = lockedMercado?.probabilidade_ia || 0;
      
      const evRecalculado = oddManual ? ((probIA / 100) * oddManual - 1) : null;
      if (oddManual && evRecalculado !== null && evRecalculado < 0.03 && !userConfirmedAudit) {
        setShowAuditWarning(true);
      }
      
      const newResult = recalculateTipsterMetrics(
        analysis.tipsterEngine,
        oddManual,
        analysis.marketReference,
        probIA,
        banca.total,
        analysis,
        userConfirmedAudit
      );
      
      // Preserve the locked mercado on stateful new result
      if (newResult && lockedMercado) {
        newResult.mercado = lockedMercado;
      }
      
      setEngineResult(newResult);

      // 🚀 Telemetry: Gravar no Supabase (com deduplicação)
      const logKey = `${match.id}_${oddManual || 'auto'}`;
      if (lastLoggedRef.current !== logKey) {
        lastLoggedRef.current = logKey;
        logAnalysis(match, newResult, oddManual, analysis?.poisson?.fonteXg)
          .then(id => {
            if (id) setLoggedAnalysisId(id);
          })
          .catch(err => 
            console.warn('[Telemetry] Silently failed to log:', err)
          );
      }
    }
  }, [oddManual, analysis, match, userConfirmedAudit]);

  useEffect(() => {
    if (match) {
      getFormaRecente(match.home_team, match.sport_key, match.sport_title).then(setFormaHome);
      getFormaRecente(match.away_team, match.sport_key, match.sport_title).then(setFormaAway);
    }
  }, [match]);

  // ── VALORES SINCRONIZADOS COM MATCHCARD (Protegidos) ────────────────
  const matchOdds = match.bookmakers?.[0]?.markets.find(m => m.key === 'h2h')?.outcomes.find(o => o.name === match.home_team)?.price || 1.8;
  
  const syncResult = useMemo(() => {
    try {
      return tipsterService.analyzePick({
        match: {
          homeTeam: match.home_team,
          awayTeam: match.away_team,
          date: match.commence_time,
        },
        market: { type: '1x2', outcome: 'Home' },
        odds: matchOdds,
        bankroll: 1000,
      }, {
        winRate: 0.60,
        avgOdds: 2.0,
        roi: 0.1,
        dailyLimit: 100
      }, false); // NÃO incrementar limite diário aqui (apenas sincronia visual)
    } catch (e) {
      console.warn('[TipsterService] Fallback ativado:', e);
      // Retorno dummy para evitar crash
      return {
        expectedValue: 0,
        kellyStake: 0,
        confidence: 0.5,
        tier: { name: 'C' }
      };
    }
  }, [match, matchOdds]);

  // ── COBERTURA DE DADOS ──────────────────────────
  const cobertura = useMemo(() => {
    const criterios = [
      { nome: 'Forma Casa', status: formaHome.source !== 'unavailable', fonte: formaHome.source },
      { nome: 'Forma Visitante', status: formaAway.source !== 'unavailable', fonte: formaAway.source },
      { nome: 'H2H Histórico', status: analysis?.h2h?.fonte !== 'unavailable' && analysis?.h2h?.fonte !== 'estimado', fonte: analysis?.h2h?.fonte },
      { nome: 'Médias xG/Stats', status: analysis?.scouting?.data_source !== 'gemini_inferido' && analysis?.scouting?.data_source !== 'unavailable', fonte: analysis?.scouting?.data_source },
      { nome: 'Desfalques', status: !!analysis?.desfalques && analysis.desfalques.length > 0, fonte: 'api_football' }
    ];
    const total = criterios.length;
    const resolvidos = criterios.filter(c => c.status).length;
    return { resolvidos, total, criterios };
  }, [formaHome, formaAway, analysis]);



  const evSyncBruto = parseFloat((syncResult.expectedValue * 100).toFixed(1));
  const kellySyncBruto = parseFloat(((syncResult.kellyStake / 1000) * 100).toFixed(1));
  const confSyncBruto = Math.round(syncResult.confidence * 100);
  const tierSyncBruto = syncResult.tier.name === 'S' ? 'A' : syncResult.tier.name;

  // Quando analysis.tipsterEngine existe, usar os valores reais da análise
  const teEngine = engineResult;

  const hasReference = analysis?.marketReference?.hasReference ?? false;
  let uiState = 'D';
  if (hasReference && oddManual) uiState = 'A';
  else if (hasReference && !oddManual) uiState = 'B';
  else if (!hasReference && oddManual) uiState = 'C';
  else if (!hasReference && !oddManual) uiState = 'D';
  const evExibido   = teEngine?.evExecution !== undefined ? teEngine.evExecution : (teEngine?.ev !== undefined ? teEngine.ev : evSyncBruto);
  const kellyExibido = teEngine?.stake?.stake_final !== undefined
    ? parseFloat(teEngine.stake.stake_final.toFixed(1))
    : kellySyncBruto;
  const confExibido  = teEngine?.confianca !== undefined
    ? Math.round(teEngine.confianca)
    : confSyncBruto;
  const tierExibido  = teEngine?.tier !== undefined
    ? (teEngine.tier === 'S' ? 'A' : teEngine.tier)
    : tierSyncBruto;

  // ── CONVERGÊNCIA GEMINI×POISSON ──────────────────────
  const probGemini = analysis?.probabilidades_ml ?? { casa: 0, empate: 0, fora: 0 };

  const rawPoisson = analysis?.poisson ?? null;
  const probPoisson = rawPoisson?.probs_1x2 ?? null;


  const poissonDisponivel = !!(probPoisson && (
    (probPoisson.casa ?? 0) > 0 || 
    (probPoisson.empate ?? 0) > 0 || 
    (probPoisson.fora ?? 0) > 0
  ));

  const deltaCasa = poissonDisponivel && probPoisson
    ? Math.abs((probGemini.casa ?? 0) - (probPoisson.casa ?? 0))
    : 0;
  const deltaEmpate = poissonDisponivel && probPoisson
    ? Math.abs((probGemini.empate ?? 0) - (probPoisson.empate ?? 0))
    : 0;
  const deltaFora = poissonDisponivel && probPoisson
    ? Math.abs((probGemini.fora ?? 0) - (probPoisson.fora ?? 0))
    : 0;

  const deltaMaximo = poissonDisponivel
    ? Math.max(deltaCasa, deltaEmpate, deltaFora)
    : 0;

  const dadosCompletos = 
    poissonDisponivel && 
    probGemini.casa > 0 && 
    probPoisson !== null;

  const convergenciaOk = dadosCompletos && deltaMaximo <= 15;




  const convergenciaLabel = !poissonDisponivel ? 'N/D'
    : deltaMaximo <= 5 ? 'FORTE'
      : deltaMaximo <= 10 ? 'BOA'
        : deltaMaximo <= 15 ? 'ACEITÁVEL'
          : 'DIVERGENTE';


  const limiarConfianca = getLimiarRecomendado();

  // ── CRITÉRIOS DO GATE ─────────────────────────────────
  const criteriosRender = {
    ev: { 
      valor: evExibido === null || evExibido === undefined ? 'Aguardando dados' : `${evExibido}%`, 
      passa: evExibido === null || evExibido === undefined ? true : (evExibido >= 3 || userConfirmedAudit), 
      label: 'EV DO MERCADO', 
      exige: '≥ 3%', 
      bloqueante: true 
    },
    kelly: { 
      valor: kellyExibido === null || kellyExibido === undefined ? 'Aguardando dados' : `${kellyExibido}%`, 
      passa: kellyExibido === null || kellyExibido === undefined ? true : (kellyExibido >= 0.5 || userConfirmedAudit), 
      label: 'KELLY STAKE', 
      exige: '≥ 0.5%', 
      bloqueante: true 
    },
    convergenciaModelos: {
      valor: `${convergenciaLabel} (Δ${deltaMaximo.toFixed(1)}pp)`,
      passa: convergenciaOk,
      label: 'CONVERGÊNCIA G×P',
      exige: 'Δ ≤ 15pp',
      bloqueante: false
    },
    confianca: { valor: `${confExibido}%`, passa: confExibido >= 65, label: 'CONFIANÇA IA', exige: '≥ 65%', bloqueante: false },
    tier: { valor: tierExibido, passa: ['A', 'B'].includes(tierExibido), label: 'TIER LIGA', exige: 'A ou B', bloqueante: true },
    tipoAposta: { valor: 'Simples', passa: true, label: 'TIPO APOSTA', exige: 'Simples/Dupla', bloqueante: false },
    clv: { valor: teEngine?.clv?.sinal || 'N/D', passa: teEngine?.clv?.sinal !== 'NEGATIVO', label: 'SINAL CLV', exige: 'POS/NEUTRO', bloqueante: false },
    lineMovement: { valor: teEngine?.lineMovement?.tipo || 'N/D', passa: teEngine?.lineMovement?.tipo !== 'ADVERSO', label: 'LINE MOVEMENT', exige: 'EST/GRAD/STM', bloqueante: false },
  };

  const criteriosBlockeantes = Object.values(criteriosRender).filter(c => c.bloqueante);

  const algumBlocanteReprovado = criteriosBlockeantes.some(c => !c.passa);
  const statusGate = algumBlocanteReprovado ? 'BLOQUEADO' : 'APROVADO';

  const motivosBloqueio = criteriosBlockeantes
    .filter(c => !c.passa)
    .map(c => c.label);

  const textoBloqueio = motivosBloqueio.length > 0
    ? `Veto nos critérios: ${motivosBloqueio.join(', ')}`
    : (teEngine?.bloqueio?.motivo || 'Critérios bloqueantes não foram atendidos.');

  const scoreBruto = [
    criteriosRender.ev.passa ? 25 : 0,
    criteriosRender.kelly.passa ? 15 : 0,
    criteriosRender.convergenciaModelos.passa ? 20 : 0,
    criteriosRender.confianca.passa ? 15 : 0,
    criteriosRender.tier.passa ? 10 : 0,
    criteriosRender.tipoAposta.passa ? 5 : 0,
    criteriosRender.clv.passa ? 5 : 0,
    criteriosRender.lineMovement.passa ? 5 : 0,
  ].reduce((a, b) => a + b, 0);

  // Score real independente de bloqueio
  const scoreComposto = scoreBruto;

  let gateIcon = <ShieldCheck size={40} className="text-[#0d0d1a]" />;
  let gateIconBg = 'bg-[#00e676] shadow-[#00e676]/20';
  let gateTextColor = 'text-[#00e676]';

  if (statusGate === 'APROVADO') {
    if (scoreComposto >= 80) {
      gateIcon = <ShieldCheck size={40} className="text-[#0d0d1a]" />;
      gateIconBg = 'bg-[#00e676] shadow-[#00e676]/20';
      gateTextColor = 'text-[#00e676]';
    } else {
      gateIcon = <AlertTriangle size={40} className="text-[#0d0d1a]" />;
      gateIconBg = 'bg-yellow-500 shadow-yellow-500/20';
      gateTextColor = 'text-yellow-500';
    }
  } else {
    gateIcon = <span className="text-4xl" style={{ fontFamily: 'Segoe UI Emoji' }}>⛔</span>;
    gateIconBg = 'bg-[#f44336] shadow-[#f44336]/20 flex items-center justify-center';
    gateTextColor = 'text-[#f44336]';
  }

  const scoreCorHex = algumBlocanteReprovado
    ? '#ff9800'
    : scoreComposto >= 80 ? '#00e676'
      : scoreComposto >= 65 ? '#00bcd4'
        : '#f44336';

  const getFormBadge = (res: string) => {
    const r = res?.toUpperCase();
    const colors: Record<string, string> = {
      'V': 'bg-green-500 text-white border-green-500/20',
      'E': 'bg-yellow-500 text-black border-yellow-500/20',
      'D': 'bg-red-500 text-white border-red-500/20',
      '?': 'bg-white/5 text-white/20 border-white/10'
    };
    return colors[r] || colors['?'];
  };

  const valueReport = analysis ? validateReport(calcularValueBets(match, analysis)) : null;

  return (
    <div translate="no" className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-6 bg-black/95 backdrop-blur-xl">
      <motion.div
        key={`analysis-modal-${match.id}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#0a0a0b] border border-white/10 w-full sm:max-w-[1400px] h-full sm:h-[95vh] rounded-none sm:rounded-[2.5rem] shadow-2xl relative overflow-hidden overflow-x-hidden flex flex-col"
      >
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest shadow-2xl z-50 border border-red-400"
            >
              {toastMessage}
            </motion.div>
          )}

          {showAuditWarning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-[#0f0f12] border border-yellow-500/30 w-full max-w-md rounded-3xl p-6 shadow-2xl relative overflow-hidden font-mono text-left"
              >
                {/* Glow Effect */}
                <div className="absolute -top-10 -left-10 w-40 h-40 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none" />
                
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/5">
                  <span className="text-2xl">⚠️</span>
                  <h3 className="text-lg font-black text-yellow-500 uppercase tracking-widest leading-none">
                    ODD COM EV INSUFICIENTE
                  </h3>
                </div>
                
                <div className="space-y-4">
                  <div className="bg-red-950/20 p-4 rounded-2xl border border-red-900/30 space-y-2">
                    <p className="font-bold text-red-300 text-xs uppercase tracking-wider">
                      Odd manual inserida: <span className="font-mono text-sm text-white">{oddManual?.toFixed(2)}</span>
                    </p>
                    {teEngine?.mercado_selecionado?.odd_referencia && (
                      <p className="text-red-400 text-[11px] uppercase tracking-wider">
                        Pinnacle referência: <span className="font-mono text-white">{teEngine.mercado_selecionado.odd_referencia.toFixed(2)}</span>
                      </p>
                    )}
                    {teEngine?.mercado_selecionado?.odd_referencia && oddManual && (
                      <p className="text-red-400 text-[11px] uppercase tracking-wider">
                        Desvio: <span className="font-mono text-white">{(((oddManual - teEngine.mercado_selecionado.odd_referencia) / teEngine.mercado_selecionado.odd_referencia) * 100).toFixed(1)}%</span>
                      </p>
                    )}
                  </div>
                  
                  <div className="bg-red-950/20 p-4 rounded-2xl border border-red-900/30 space-y-2">
                    {teEngine?.evExecution !== undefined && (
                      <p className="font-bold text-red-300 text-xs uppercase tracking-wider">
                        EV Recalculado: <span className="font-mono text-sm text-white">{teEngine.evExecution.toFixed(1)}%</span>
                      </p>
                    )}
                    <p className="text-red-400 text-[11px] uppercase tracking-wider">
                      Mínimo Requerido: <span className="font-mono text-white">3%</span>
                    </p>
                    <p className="text-red-400 text-[11px] uppercase tracking-wider font-bold mt-2 flex items-center gap-1.5">
                      ❌ Esta odd NÃO atende critérios operacionais
                    </p>
                  </div>
                  
                  <p className="text-white/70 text-[11px] leading-relaxed">
                    Esta odd NÃO será aprovada para operação real, mas você pode usar para AUDITORIA/TESTE.
                    <br />
                    <span className="text-yellow-400 font-bold">
                      Deseja continuar?
                    </span>
                  </p>
                </div>
                
                <div className="mt-8 flex gap-3 justify-end">
                  <button
                    onClick={() => {
                      setOddManualText('');
                      setOddManual(null);
                      setShowAuditWarning(false);
                      setUserConfirmedAudit(false);
                      if (match) localStorage.removeItem(`bet365_odd_${match.id}`);
                    }}
                    className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black text-white/60 hover:text-white uppercase tracking-widest transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      setUserConfirmedAudit(true);
                      setShowAuditWarning(false);
                    }}
                    className="px-4 py-2.5 bg-yellow-600 hover:bg-yellow-500 rounded-xl text-[10px] font-black text-black uppercase tracking-widest shadow-lg shadow-yellow-600/20 active:scale-95 transition-all"
                  >
                    Continuar Auditoria
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="border-b border-white/5 px-4 sm:px-8 py-4 sm:py-5 flex justify-between items-center bg-white/[0.01]">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Activity size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-black text-xl tracking-tight uppercase leading-none italic">Análise Técnica</h2>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest leading-none">Status: Deep Intelligence Active</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Badge de Cobertura */}
            <div 
              className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
                cobertura.resolvidos >= 4 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                cobertura.resolvidos >= 2 ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                'bg-red-500/10 border-red-500/20 text-red-400'
              } cursor-help transition-all hover:scale-105`}
              title={cobertura.criterios.map(c => `${c.status ? '✅' : '❌'} ${c.nome} (${c.fonte || 'indisponível'})`).join('\n')}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${
                cobertura.resolvidos >= 4 ? 'bg-emerald-400' :
                cobertura.resolvidos >= 2 ? 'bg-amber-400' :
                'bg-red-400'
              } animate-pulse`} />
              <span className="text-[10px] font-black uppercase tracking-wider">
                Cobertura: {cobertura.resolvidos}/{cobertura.total}
              </span>
            </div>

            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full transition-all text-white/40 hover:text-white border border-white/10"
            >
              <X size={18} />
            </button>
          </div>

        </div>

        <div className="p-4 sm:p-10 overflow-y-auto overflow-x-hidden custom-scrollbar flex-1 space-y-10">

          {loading ? (
            <div key="analysis-loading" className="flex flex-col items-center justify-center py-32 space-y-6">
              <div className="w-16 h-16 border-t-2 border-blue-500 rounded-full animate-spin" />
              <p className="text-white/20 font-mono text-xs uppercase tracking-widest">Sincronizando modelos preditivos...</p>
            </div>
          ) : analysis ? (
            <motion.div key="analysis-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-6 relative overflow-hidden flex flex-col justify-center">
                  <div className="flex items-center gap-3 mb-4">
                    <Target size={16} className="text-white/40" />
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Odd Bet365 (Manual)</h4>
                  </div>
                  
                  {statusGate === 'BLOQUEADO' ? (
                    <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                      <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest leading-relaxed">
                        Este jogo não atende critérios mínimos. Insira odd apenas para auditoria — não vai gerar bilhete.
                      </p>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Somente auditoria..."
                        value={oddManualText}
                        onChange={(e) => {
                          let val = e.target.value;
                          val = val.replace(',', '.');
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            setOddManualText(val);
                          }
                        }}
                        className="w-full mt-3 bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-white/30 font-mono text-sm focus:outline-none"
                      />
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={`Ex: insira a odd Bet365 para ${analysis.tipsterEngine.mercado?.nome}`}
                        value={oddManualText}
                        onChange={(e) => {
                          let val = e.target.value;
                          val = val.replace(',', '.');
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            setOddManualText(val);
                          }
                        }}
                        className="w-full bg-[#0a0a0b] border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-white/20 shadow-inner"
                      />
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-[9px] text-white/40 uppercase font-bold tracking-widest">
                          Para: {analysis.tipsterEngine.mercado?.nome}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-white/20 uppercase font-black">Odd mínima para EV+:</span>
                          <span className="text-[10px] font-mono font-black text-emerald-400/80 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                            {analysis.tipsterEngine.mercado?.probabilidade_ia > 0 
                              ? (1 / (analysis.tipsterEngine.mercado.probabilidade_ia / 100)).toFixed(2)
                              : '—'}
                          </span>

                        </div>
                      </div>
                    </>
                  )}
                </div>


                {(() => {
                  const sanidade = teEngine?.sharp_context?.sanidade_odds;
                  const desvioValido = sanidade ? sanidade.desvio_valido : true;

                  const oddRef = teEngine?.mercado_selecionado?.odd_referencia;
                  const oddB365Public = teEngine?.mercado_selecionado?.odd_bet365_publica;
                  const oddB365Manual = teEngine?.mercado_selecionado?.odd_bet365_manual;
                  const oddB365 = oddB365Manual || oddB365Public;

                  // Use the backend calculated deviation if sanidade object is present and valid
                  const desvio = (sanidade && !sanidade.desvio_valido)
                    ? null
                    : (sanidade?.desvio_final !== undefined && sanidade?.desvio_final !== null)
                      ? sanidade.desvio_final
                      : (oddRef && oddB365)
                        ? ((oddB365 / oddRef) - 1) * 100
                        : null;

                  if (sanidade && !sanidade.desvio_valido) {
                    return (
                      <div className="border rounded-[2rem] p-6 relative overflow-hidden flex flex-col justify-center transition-all duration-300 bg-[#f4433610] border-[#f4433630]">
                        <div className="flex items-center gap-3 mb-3">
                          <AlertTriangle size={16} className="text-red-400" />
                          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Bet365 vs Pinnacle</h4>
                        </div>
                        <div className="flex flex-col gap-1 mb-2">
                          <div className="text-[11px] font-mono text-white/60">
                            Pinnacle (Abertura): <span className="text-white font-bold">{teEngine?.linha?.odd_abertura ? teEngine.linha.odd_abertura.toFixed(2) : (oddRef?.toFixed(2) || '—')}</span>
                          </div>
                          {teEngine?.linha?.odd_atual && (
                            <div className="text-[11px] font-mono text-white/60">
                              Pinnacle (Atual): <span className="text-[#00e676] font-bold">{teEngine.linha.odd_atual.toFixed(2)}</span>
                              <span className="text-[9px] text-white/40 ml-1">({teEngine.linha.fonte} @ {teEngine.linha.timestamp})</span>
                            </div>
                          )}
                          {teEngine?.linha?.movimento_pts > 0.001 && (
                            <div className="text-[9px] font-black tracking-widest mt-1 uppercase text-rose-400">
                              {teEngine.linha.movimento_direcao === 'caiu' ? '📉 Odd caiu' : '📈 Odd subiu'}: {teEngine.linha.movimento_pts.toFixed(2)} pts
                            </div>
                          )}
                          <div className="text-[11px] font-mono text-white/60">
                            Bet365 (tentada): <span className="text-white font-bold text-rose-400">{oddB365?.toFixed(2) || '—'}</span>
                          </div>
                        </div>
                        <div className="border-t border-red-500/10 pt-2 mt-2">
                          <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest block mb-1">ERRO: {sanidade.erro_tipo || 'ODD_IMPLAUSIVEL'}</span>
                          <p className="text-[10px] text-white/80 leading-normal italic font-mono">
                            {sanidade.observacao}
                          </p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className={`border rounded-[2rem] p-6 relative overflow-hidden flex flex-col justify-center transition-all duration-300 ${
                      desvio !== null
                        ? desvio > 1
                          ? 'bg-[#00e67610] border-[#00e67630]'
                          : desvio < -1
                            ? 'bg-[#f4433610] border-[#f4433630]'
                            : 'bg-white/[0.05] border-white/10'
                        : 'bg-white/[0.02] border-white/5'
                    }`}>
                      <div className="flex items-center gap-3 mb-4">
                        <Activity size={16} className={desvio !== null ? (desvio > 1 ? 'text-[#00e676]' : desvio < -1 ? 'text-[#f44336]' : 'text-white/40') : 'text-white/20'} />
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Bet365 vs {analysis.marketReference?.sharpBookmaker === 'pinnacle' ? 'Pinnacle' : 'Referência'}</h4>
                      </div>
                      
                      {desvio !== null ? (
                        <div>
                          <div className="flex flex-col gap-1 mb-3">
                             <div className="text-[11px] font-mono text-white/60">
                               Pinnacle (Abertura): <span className="text-white font-bold">{teEngine?.linha?.odd_abertura ? teEngine.linha.odd_abertura.toFixed(2) : (oddRef != null ? oddRef.toFixed(2) : '—')}</span>
                             </div>
                             {teEngine?.linha?.odd_atual && (
                               <div className="text-[11px] font-mono text-white/60">
                                 Pinnacle (Atual): <span className="text-[#00e676] font-bold">{teEngine.linha.odd_atual.toFixed(2)}</span>
                                 <span className="text-[9px] text-white/40 ml-1">({teEngine.linha.fonte} @ {teEngine.linha.timestamp})</span>
                               </div>
                             )}
                             {teEngine?.linha?.movimento_pts > 0.001 && (
                               <div className="text-[9px] font-black tracking-widest mt-1 uppercase text-rose-400">
                                 {teEngine.linha.movimento_direcao === 'caiu' ? '📉 Odd caiu' : '📈 Odd subiu'}: {teEngine.linha.movimento_pts.toFixed(2)} pts
                               </div>
                             )}
                             <div className="text-[11px] font-mono text-white/60">
                               Bet365 ({oddB365Manual ? 'manual' : 'pública'}): <span className="text-white font-bold">{oddB365 != null ? oddB365.toFixed(2) : '—'}</span>
                             </div>
                          </div>
                          <div className="flex items-baseline gap-2 pt-2 border-t border-white/10 mt-2">
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Desvio:</span>
                            <span className={`text-xl font-mono font-black ${desvio > 1 ? 'text-[#00e676]' : desvio < -1 ? 'text-[#f44336]' : 'text-white'}`}>
                              {desvio > 0 ? '+' : ''}{desvio.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm font-bold text-white/20 uppercase tracking-widest italic">Aguardando odd da Bet365...</div>
                      )}
                    </div>
                  );
                })()}
                
                <div className="col-span-1 md:col-span-2 text-center text-[10px] font-mono text-white/30 uppercase tracking-widest mb-4">
                  {hasReference ? (
                    <>
                      Ref Sharp: {analysis.marketReference?.sharpBookmaker} | Vig: {analysis.marketReference?.overround.toFixed(1)}% | 
                      Fair: C {(analysis.marketReference?.fairProbs[0]*100).toFixed(1)}% E {(analysis.marketReference?.fairProbs[1]*100).toFixed(1)}% F {(analysis.marketReference?.fairProbs[2]*100).toFixed(1)}%
                    </>
                  ) : (
                    <span className="text-amber-500/80">⚠️ Sem referência sharp disponível para este jogo. Análise menos confiável.</span>
                  )}
                </div>
              </div>

              {/* 0. Tipster Engine Gate v2.0 - Analysis Decision Card */}
              {analysis.tipsterEngine && teEngine && teEngine.decisao && (
                <>
                  <AnalysisDecisionCard decisao={teEngine}>
                    <div className="mt-8 border-t border-white/10 pt-6">
                      <div className="flex flex-col items-center sm:items-end w-full">
                        {teEngine.decisao.status === 'APROVADO' ? (
                          <div className="flex flex-col gap-2 items-center sm:items-end w-full">
                            <div className="flex gap-2">
                              {teEngine.stake?.modificador < 1 && (
                                <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[9px] font-black text-amber-500 uppercase tracking-widest">
                                  Stake Reduzida ({teEngine.stake.modificador * 100}%)
                                </span>
                              )}
                              <span className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg text-[9px] font-black text-blue-400 uppercase tracking-widest">Proteção Ativa</span>
                            </div>
                            {uiState === 'B' ? (
                              <div className="text-[9px] text-amber-500/80 uppercase font-black tracking-widest mt-2 border border-amber-500/20 px-4 py-2 rounded-lg bg-amber-500/10">Insira odd Bet365 para gerar bilhete</div>
                            ) : uiState === 'C' ? (
                              <div className="text-[9px] text-rose-500/80 uppercase font-black tracking-widest mt-2 border border-rose-500/20 px-4 py-2 rounded-lg bg-rose-500/10">Sem referência sharp. EV calculado contra probIA.</div>
                            ) : uiState === 'D' ? (
                              <div className="text-[9px] text-rose-500/80 uppercase font-black tracking-widest mt-2 border border-rose-500/20 px-4 py-2 rounded-lg bg-rose-500/10">Sem referência sharp e sem odd. Indisponível.</div>
                            ) : null}
                            <button 
                              onClick={() => setTicketGerado(true)}
                              disabled={uiState !== 'A' || !dadosCompletos}
                              className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl mt-2 ${uiState === 'A' && dadosCompletos ? 'bg-[#00e676] hover:bg-[#00c853] text-[#0d0d1a] shadow-[#00e676]/20' : 'bg-white/10 text-white/20 cursor-not-allowed border border-white/5'}`}>
                              {ticketGerado ? '✓ BILHETE GERADO' : (dadosCompletos ? 'GERAR BILHETE' : 'AGUARDANDO ANÁLISE...')}
                            </button>

                            {ticketGerado && (
                              <div className="mt-4 p-4 bg-blue-600/10 border border-blue-500/20 rounded-2xl w-full max-w-md animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <div className="flex items-center gap-2 mb-3 text-blue-400 font-bold text-xs uppercase tracking-wider">
                                  <Ticket size={16} />
                                  <span>Bilhete Consolidado!</span>
                                </div>
                                <div className="text-[10px] text-white/70 space-y-1 mb-4 leading-relaxed text-left">
                                  <p><strong>Evento:</strong> {match.home_team} vs {match.away_team}</p>
                                  <p><strong>Palpite:</strong> {teEngine.mercado_selecionado?.nome || 'Mercado Principal'}</p>
                                  <p><strong>Odd Bet365:</strong> <span className="font-mono text-emerald-400 font-bold">{oddManual?.toFixed(2)}</span></p>
                                  <p className="flex items-center gap-1.5">
                                    <strong>Stake Kelly:</strong>
                                    <span className="font-mono text-emerald-400">R$ {teEngine.stake.valor_reais.toFixed(2)} ({teEngine.stake.percentual.toFixed(2)}%)</span>
                                    <button
                                      onClick={() => {
                                        window.dispatchEvent(new CustomEvent('evengine_navigate_docs_tab'));
                                        setTimeout(() => {
                                          window.dispatchEvent(new CustomEvent('evengine_navigate_docs', {
                                            detail: { sectionId: 'os-9-gates', subsectionId: 'gate-b2' }
                                          }));
                                        }, 150);
                                      }}
                                      title="Entender alocação de Stake Kelly"
                                      className="text-emerald-400/60 hover:text-emerald-400 transition-colors cursor-pointer flex items-center"
                                    >
                                      <Info size={10} className="shrink-0" />
                                    </button>
                                  </p>
                                </div>
                                
                                {betRegistrada ? (
                                  <div className="flex items-center justify-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 font-black text-[10px] uppercase tracking-widest w-full">
                                    <Check size={14} />
                                    <span>Aposta Registrada!</span>
                                  </div>
                                ) : (
                                  <button
                                    disabled={registrandoBet}
                                    onClick={async () => {
                                      setRegistrandoBet(true);
                                      try {
                                        // const { createBet } = await import('../services/betService'); // removido para usar o import estático
                                        const recommendedMarket = teEngine.mercado_selecionado?.nome || 'Mercado Principal';
                                        
                                        const success = await createBet({
                                          analysis_id: loggedAnalysisId,
                                          market: recommendedMarket,
                                          odd_taken: oddManual || 1.80,
                                          stake_amount: teEngine.stake.valor_reais > 0 ? Number(teEngine.stake.valor_reais.toFixed(2)) : 10.00,
                                          bookmaker: 'bet365',
                                          status: 'pending'
                                        });
                                        
                                        if (success) {
                                          setBetRegistrada(true);
                                          setToastMessage("Aposta registrada!");
                                          setTimeout(() => setToastMessage(null), 3000);
                                        } else {
                                          setToastMessage("Erro ao registrar aposta.");
                                          setTimeout(() => setToastMessage(null), 3000);
                                        }
                                      } catch (err) {
                                        console.warn('[Bet Registration] Failed:', err);
                                        setToastMessage("Erro de conexão.");
                                        setTimeout(() => setToastMessage(null), 3000);
                                      } finally {
                                        setRegistrandoBet(false);
                                      }
                                    }}
                                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-95 flex items-center justify-center gap-2"
                                  >
                                    {registrandoBet ? (
                                      <>
                                        <RefreshCw size={12} className="animate-spin" />
                                        <span>Registrando...</span>
                                      </>
                                    ) : (
                                      <>
                                        <ShieldCheck size={14} />
                                        <span>Registrar aposta feita</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}

                          </div>
                        ) : (
                          <div className="flex flex-col items-center sm:items-end gap-2 w-full">
                            {analysis.tipsterEngine?.sharp_context?.mercado_alternativo ? (
                              <>
                                <span className="text-[10px] font-mono font-bold text-blue-400/80 uppercase tracking-widest">— Avaliar Oportunidade Alternativa</span>
                                <div className="px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[9px] font-black text-blue-400/80 uppercase tracking-widest italic text-center w-full max-w-sm">
                                  Mercado principal reprovado. Consulte alternativa acima.
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="text-[10px] font-mono font-bold text-rose-400/80 uppercase tracking-widest">— Entrada não recomendada</span>
                                <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black text-white/60 uppercase tracking-widest italic text-center w-full max-w-sm">
                                  Riscos acima do limiar estatístico
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </AnalysisDecisionCard>

                  {/* Grid de Critérios isolado */}
                  <div className="bg-[#0d0d1a] border border-[#1e1e3e] rounded-[2rem] p-6 sm:p-10 relative overflow-hidden shadow-2xl mb-10">
                    <div className="flex items-center gap-3 mb-6">
                      <ShieldCheck size={16} className="text-white/40" />
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Critérios Analisados</h4>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
                      {(() => {
                        const docMapping: Record<string, { sectionId: string; subsectionId?: string }> = {
                          'EV DO MERCADO': { sectionId: 'value-betting', subsectionId: 'o-que-e-ev' },
                          'KELLY STAKE': { sectionId: 'os-9-gates', subsectionId: 'gate-b2' },
                          'CONVERGÊNCIA G×P': { sectionId: 'os-9-gates', subsectionId: 'gate-b3' },
                          'CONVERGÊNCIA Δ': { sectionId: 'os-9-gates', subsectionId: 'gate-b3' },
                          'CONFIANÇA IA': { sectionId: 'como-funciona' },
                          'TIER LIGA': { sectionId: 'os-9-gates', subsectionId: 'resumo-gates' },
                          'SINAL CLV': { sectionId: 'paper-trading', subsectionId: 'calcular-clv' },
                          'LINE MOVEMENT': { sectionId: 'sharp-money', subsectionId: 'gate-b7' },
                        };
                        return [
                          criteriosRender.ev,
                          criteriosRender.kelly,
                          criteriosRender.convergenciaModelos,
                          criteriosRender.confianca,
                          criteriosRender.tier,
                          criteriosRender.tipoAposta,
                          criteriosRender.clv,
                          criteriosRender.lineMovement,
                          {
                            label: 'CONVERGÊNCIA Δ',
                            valor: `${teEngine?.convergencia?.delta || 0}pp`,
                            exige: '≤ 15pp',
                            passa: (teEngine?.convergencia?.delta || 0) <= 15,
                            bloqueante: false // Informativo
                          },
                        ].map((c: any, i) => (
                          <div key={i} className={`p-4 rounded-xl border flex items-center justify-between transition-all ${c.passa
                              ? 'bg-[#00e67608] border-[#00e67622]'
                              : (c.bloqueante ? 'bg-[#f4433615] border-[#f4433644]' : 'bg-[#f4433608] border-[#f4433622]')
                            }`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-5 h-5 rounded-md flex items-center justify-center ${c.passa ? 'text-[#00e676]' : 'text-[#f44336]'}`}>
                                {c.passa ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
                              </div>
                              <div className="flex flex-col text-left">
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">{c.label}</span>
                                  {docMapping[c.label] && (
                                    <button
                                      onClick={() => {
                                        const target = docMapping[c.label];
                                        window.dispatchEvent(new CustomEvent('evengine_navigate_docs_tab'));
                                        setTimeout(() => {
                                          window.dispatchEvent(new CustomEvent('evengine_navigate_docs', {
                                            detail: target
                                          }));
                                        }, 150);
                                      }}
                                      title="Ver ajuda contextual na documentação"
                                      className="text-white/20 hover:text-blue-400 transition-colors cursor-pointer flex items-center"
                                    >
                                      <Info size={10} className="shrink-0 ml-0.5" />
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[11px] font-black ${c.passa ? 'text-white/80' : 'text-[#f44336]'}`}>{c.valor}</span>
                                  <span className="text-[8px] text-white/10 italic">({c.exige})</span>
                                </div>
                              </div>
                            </div>
                            {!c.passa && c.bloqueante && (
                              <span className="px-2 py-0.5 bg-[#f4433622] rounded-md text-[7px] font-black text-[#f44336] uppercase tracking-tighter">Bloqueante</span>
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </>
              )}

              {/* 1. Valor Esperado por Mercado */}
              <section>
                <div className="flex items-center gap-3 mb-6">
                  <BarChart3 size={16} className="text-white/40" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">Valor Esperado por Mercado</h3>
                  <Tooltip text="Calcula a vantagem (Edge) comparando a probabilidade da IA com as odds das casas. Edge > 0 indica valor a longo prazo." />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {(teEngine?.todos_mercados || []).map((m: any, idx: number) => {
                    const evMarket = ((m.probabilidade_final / 100) * m.odd_referencia) - 1;
                    const isApproved = teEngine?.decisao?.status === 'APROVADO';
                    const isSelectedAndApproved = m.selecionado && isApproved;
                    
                    return (
                    <div key={idx} className={`bg-[#141416] border ${
                      isSelectedAndApproved
                        ? 'border-emerald-500 bg-emerald-500/10 animate-pulse-approved'
                        : m.selecionado
                          ? 'border-blue-500/40 bg-blue-500/5'
                          : 'border-white/5'
                    } p-4 rounded-xl flex items-center justify-between group transition-all`}>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-black tracking-widest uppercase ${
                            isSelectedAndApproved
                              ? 'text-emerald-400 font-extrabold'
                              : m.selecionado
                                ? 'text-blue-400'
                                : 'text-white/20'
                          }`}>
                            {m.nome}
                          </span>
                          {m.selecionado && (
                            <span className={`px-2 py-0.5 border rounded text-[8px] font-black tracking-widest uppercase ${
                              isApproved
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20 animate-pulse'
                                : 'bg-blue-500/20 text-blue-400 border-blue-500/20'
                            }`}>
                              {isApproved ? '🚀 Liberado pelo Gate' : '✅ Selecionado pelo Gate'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-6 mt-1">
                          <div className="flex flex-col">
                            <span className="text-[8px] text-white/20 uppercase font-bold tracking-widest">IA</span>
                            <span className="text-xs font-mono font-bold text-white/50">{m.probabilidade_final.toFixed(1)}%</span>
                          </div>
                          <div className="flex flex-col">
                             <span className="text-[8px] text-white/20 uppercase font-bold tracking-widest">Odd Pinnacle</span>
                             <span className="text-xs font-mono font-bold text-white/50">
                               {teEngine?.linha?.odd_abertura && m.selecionado ? (
                                 <>
                                   <span className="line-through text-white/20 mr-1.5">{teEngine.linha.odd_abertura.toFixed(2)}</span>
                                   <span className="text-[#00e676]">{m.odd_referencia.toFixed(2)}</span>
                                 </>
                               ) : (
                                 m.odd_referencia.toFixed(2)
                               )}
                             </span>
                           </div>
                          <div className="flex flex-col">
                            <span className="text-[8px] text-white/20 uppercase font-bold tracking-widest">Min Odd</span>
                            <span className="text-xs font-mono font-bold text-emerald-500/50">{m.break_even_odd.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-lg font-mono font-bold tracking-tighter ${
                          isSelectedAndApproved
                            ? 'text-emerald-400'
                            : m.selecionado
                              ? 'text-blue-400'
                              : 'text-white/20'
                        }`}>
                          {evMarket > 0 && <span>+</span>}
                          <span>{(evMarket * 100).toFixed(1)} %</span>
                        </span>
                        {m.selecionado && (
                          <div className={`text-[8px] uppercase font-bold mt-1 ${isApproved ? 'text-emerald-400/60' : 'text-blue-400/50'}`}>
                            {isApproved ? 'Aposta Liberada' : 'EV Calculado'}
                          </div>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </section>

              {/* 1b. Asian Handicap Equivalentes — plano Pro/Sharp */}
              {(analysis as any).asianHandicap && (
                <AHCard analysis={(analysis as any).asianHandicap} />
              )}

              {/* 2. Ranking Elo Card (Based on Imagem 02) */}
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 lg:col-span-8 bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <ShieldCheck size={18} className="text-orange-500" />
                    <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white flex items-center gap-1.5">
                      Ranking Elo
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('evengine_navigate_docs_tab'));
                          setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('evengine_navigate_docs', {
                              detail: { sectionId: 'como-funciona', subsectionId: 'fluxo-completo' }
                            }));
                          }, 150);
                        }}
                        title="Ver Documentação Matemática do ELO"
                        className="text-orange-400/60 hover:text-orange-400 transition-colors cursor-pointer"
                      >
                        <Info size={12} />
                      </button>
                    </h4>
                    <Tooltip text="Sistema matemático que mede a força relativa. Baseado em vitórias/derrotas históricas e nível dos adversários enfrentados." />
                  </div>

                  <div className="grid grid-cols-2 gap-6 mb-10">
                    <div className="bg-white/[0.02] border border-white/5 p-6 rounded-2xl">
                      <span className="text-[8px] text-white/40 uppercase font-bold tracking-widest mb-2 block">Mandante</span>
                      <span className="text-[10px] text-white/60 font-medium mb-1 block truncate">{match.home_team}</span>
                      <div className="text-4xl font-mono font-bold text-white tracking-tighter mb-4">{analysis.elo?.home_rating || 1500}</div>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 w-[60%]" />
                      </div>
                    </div>
                    <div className="bg-white/[0.02] border border-white/5 p-6 rounded-2xl">
                      <span className="text-[8px] text-white/40 uppercase font-bold tracking-widest mb-2 block">Visitante</span>
                      <span className="text-[10px] text-white/60 font-medium mb-1 block truncate">{match.away_team}</span>
                      <div className="text-4xl font-mono font-bold text-white tracking-tighter mb-4">{analysis.elo?.away_rating || 1500}</div>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 w-[70%]" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6 mb-8">
                    <h5 className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">Probabilidades Elo vs Gemini</h5>
                    {[
                      { label: 'Casa', elo: analysis.elo?.probabilidades?.casa ?? Math.round(50 + (analysis.elo?.delta || 0) / 20), ia: analysis.probabilidades_ml.casa },
                      { label: 'Empate', elo: analysis.elo?.probabilidades?.empate ?? 25, ia: analysis.probabilidades_ml.empate },
                      { label: 'Fora', elo: analysis.elo?.probabilidades?.fora ?? Math.max(0, Math.round(50 - (analysis.elo?.delta || 0) / 20) - 25), ia: analysis.probabilidades_ml.fora }
                    ].map(p => (
                      <div key={p.label} className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold">
                          <div className="flex items-center gap-2">
                            <span className="text-white/40 uppercase w-12">{p.label}</span>
                            <span className="text-orange-500 font-mono">{p.elo}%</span>
                          </div>
                          <span className="text-purple-400 font-mono">{p.ia}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full relative overflow-hidden">
                          <div className="h-full bg-orange-500/30 rounded-full" style={{ width: `${p.elo}%` }} />
                          <div className="absolute top-0 bottom-0 w-1 bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]" style={{ left: `${p.ia}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {analysis.elo?.calibrando && (
                    <div className="p-4 bg-orange-500/5 border border-orange-500/10 rounded-2xl flex items-start gap-3">
                      <AlertTriangle size={14} className="text-orange-500 shrink-0 mt-0.5" />
                      <p className="text-[9px] text-orange-500 font-bold uppercase tracking-widest leading-relaxed">
                        Rating em calibração — menos de 10 jogos computados por time. Predições Elo têm confiança baixa.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-4 mt-6">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-500" />
                      <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest">Elo Model</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-0.5 h-3 bg-purple-500" />
                      <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest">IA Gemini</span>
                    </div>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-4 space-y-6">
                  <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8">
                    <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30 mb-8">Neural Match Delta</h4>
                    <div className="flex items-baseline gap-2 mb-4">
                      <div className="text-6xl font-mono font-bold text-white tracking-tighter">{analysis.elo?.raw_delta}</div>
                      <span className="text-white/20 font-bold text-xs uppercase">Pts Delta</span>
                    </div>
                    <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">
                      Favorito Elo: {analysis.elo?.delta && Math.abs(analysis.elo.delta) < 20 ? 'Equilibrado' : analysis.elo?.favorito}
                      {analysis.elo?.calibrando && <span className="block text-white/20 mt-1">(Calibrando)</span>}
                    </p>
                  </div>

                  <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8 flex flex-col gap-3">
                    <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-2">Registrar Resultado (Atualiza Elo)</span>
                    <button className="w-full py-4 bg-white/5 border border-white/5 rounded-xl text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-white/10 transition-all">Vitória Casa</button>
                    <button className="w-full py-4 bg-white/5 border border-white/5 rounded-xl text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-white/10 transition-all">Empate</button>
                    <button className="w-full py-4 bg-white/5 border border-white/5 rounded-xl text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-white/10 transition-all">Vitória Fora</button>
                  </div>
                </div>
              </div>

              {/* 3. Score de Qualidade (Bottom Banner from Imagem 02) */}
              <section className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8">
                <div className="flex items-center gap-3 mb-10">
                  <BarChart3 size={16} className="text-white/40" />
                  <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Score de Qualidade</h4>
                  <Tooltip text="Mede a integridade da análise. Avalia se há dados suficientes de forma, H2H e desfalques para uma predição confiável." />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  {[
                    { label: 'Forma Recente', val: teEngine?.qualidade?.forma ?? 78, color: 'bg-green-500' },
                    { label: 'H2H', val: teEngine?.qualidade?.h2h ?? 71, color: 'bg-green-500/60' },
                    { label: 'Motivação', val: teEngine?.qualidade?.motivacao ?? 85, color: 'bg-green-500' },
                    { label: 'Desfalques', val: teEngine?.qualidade?.desfalques ?? 92, color: 'bg-green-500' }
                  ].map(item => (
                    <div key={item.label} className="space-y-3">
                      <div className="flex justify-between items-baseline">
                        <span className="text-[9px] font-black text-white uppercase tracking-widest">{item.label}</span>
                        <span className="text-[10px] font-mono font-bold text-white/60">{item.val}/100</span>
                      </div>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full ${item.color}`} style={{ width: `${item.val}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 4. Dica Principal / Sumário Executivo */}
              {(() => {
                const isBloqueado = !teEngine?.decisao || teEngine.decisao.status === 'BLOQUEADO';
                
                if (teEngine && !teEngine.mercado_selecionado) {
                  if (import.meta.env.VITE_DEBUG_ENGINE === 'true') {
                    console.error('[REGRESSÃO] decisao.mercado_selecionado faltando no teEngine!', analysis);
                  }
                }

                if (isBloqueado) {
                  return (
                    <section className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 text-center">
                      <span className="text-xl mb-2 block" style={{ fontFamily: 'Segoe UI Emoji' }}>⛔</span>
                      <h4 className="text-[11px] font-black text-rose-500 uppercase tracking-widest">Análise bloqueada</h4>
                      <p className="text-[10px] text-white/40 uppercase font-bold mt-1">Score: {teEngine?.score?.valor ?? 0}/100</p>
                    </section>
                  );
                }

                return (
                  <section className="bg-[#00e676]/5 border border-[#00e676]/20 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div>
                      <span className="text-[10px] text-[#00e676]/60 font-black uppercase tracking-[0.2em] block mb-2">Dica Principal</span>
                      <div className="text-lg font-bold text-white">{teEngine.mercado_selecionado.nome}</div>
                      <div className="text-[10px] font-mono text-white/60 mt-1">
                        Probabilidade: {teEngine.mercado_selecionado.probabilidade_final}%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-[#00e676]/60 font-black uppercase tracking-[0.2em] mb-1">Gate Score</div>
                      <div className="text-2xl font-mono font-black text-[#00e676]">{teEngine.score.valor}</div>
                    </div>
                  </section>
                );
              })()}

              <div className={`relative ${(!teEngine?.decisao || teEngine.decisao.status === 'BLOQUEADO') ? 'opacity-30' : ''}`}>
                {(!teEngine?.decisao || teEngine.decisao.status === 'BLOQUEADO') && (
                  <div className="absolute inset-0 z-50 flex items-start justify-center pt-20 pointer-events-none">
                    <div className="bg-[#0a0a0b]/90 border border-rose-500/20 px-8 py-4 rounded-full flex items-center gap-3 backdrop-blur-xl shadow-2xl sticky top-20">
                      <span className="text-2xl" style={{ fontFamily: 'Segoe UI Emoji' }}>📋</span>
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Dados informativos — análise bloqueada</span>
                    </div>
                  </div>
                )}

                {/* ⚽ MERCADOS DE GOLS */}
                {teEngine?.goalsAnalysis && (
                  <div className="mb-10 space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Activity size={18} className="text-[#00e676]" />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white">⚽ MERCADOS DE GOLS</h3>
                        <Tooltip text="Análise estatística e probabilística de mercados de gols (Over/Under e Ambos Marcam) usando calibração de modelos híbridos." />
                      </div>

                      {/* Crossed Sources Status Banner */}
                      <div className="bg-[#141416]/40 border border-white/[0.04] rounded-2xl px-4 py-2 flex items-center justify-between gap-4 backdrop-blur-md self-start sm:self-auto">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="text-[#00e676]" size={14} />
                          <span className="text-[9px] font-bold text-white/60">Validação Poisson × Gemini IA:</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-black ${(teEngine.goalsAnalysis.convergence ?? 0) <= 15 ? 'text-[#00e676]' : 'text-rose-500'}`}>
                            {teEngine.goalsAnalysis.convergence ?? 'N/D'}% div.
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider uppercase ${(teEngine.goalsAnalysis.convergence ?? 0) <= 15 ? 'bg-[#00e676]/10 text-[#00e676]' : 'bg-rose-500/10 text-rose-400'}`}>
                            {(teEngine.goalsAnalysis.convergence ?? 0) <= 15 ? 'CONVERGENTE' : 'DIVERGENTE'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Poisson Chart */}
                      <div className="lg:col-span-1">
                        <PoissonChart lambda={teEngine.goalsAnalysis.totalGoalsExpected || 2.5} />
                      </div>

                      {/* Cards de Valor de Gols */}
                      <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {['over_1.5', 'over_2.5', 'btb'].map((marketKey) => {
                          const gm = teEngine.goalsAnalysis.markets?.find((m: any) => m.marketKey === marketKey);
                          if (!gm) return null;
                          
                          const isSelected = teEngine.mercado_selecionado?.nome === gm.market;
                          const edgePct = (gm.edge * 100).toFixed(1);

                          // Encontrar o melhor mercado de gols para destaque secundário inteligente
                          const goalsMarkets = teEngine.goalsAnalysis.markets || [];
                          const bestGoalMarket = [...goalsMarkets]
                            .sort((a: any, b: any) => b.edge - a.edge)[0];
                          
                          const isBestGoal = bestGoalMarket && bestGoalMarket.marketKey === marketKey;
                          
                          // Um mercado de gols é indicado se for o melhor de gols, tiver EV positivo >= 3%
                          // e a convergência Gemini-Poisson for aceitável (divergência <= 15pp)
                          const isConvergente = (teEngine.goalsAnalysis.convergence ?? 0) <= 15;
                          const isIndicado = isBestGoal && gm.edge >= 0.03 && isConvergente;
                          
                          // Gemini and Poisson crossed probabilities
                          const geminiProb = teEngine.goalsAnalysis.geminiProbs?.[marketKey] ?? null;
                          const poissonProb = gm.prob_ia; // mathematical probability is stored as gm.prob_ia

                          return (
                            <div 
                              key={marketKey} 
                              className={`relative rounded-[2rem] p-6 border flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] cursor-pointer ${
                                isSelected 
                                  ? 'border-blue-500/50 bg-gradient-to-b from-blue-500/[0.04] to-transparent shadow-[0_0_25px_rgba(59,130,246,0.08)] hover:border-blue-500/70' 
                                  : isIndicado
                                    ? 'border-[#00e676]/50 bg-gradient-to-b from-[#00e676]/[0.04] to-transparent shadow-[0_0_25px_rgba(0,230,118,0.08)] hover:border-[#00e676]/70' 
                                    : 'border-white/[0.05] hover:border-white/15 bg-white/[0.01]'
                              }`}
                            >
                              <div>
                                <div className="flex justify-between items-start mb-6">
                                  <span className={`text-[10px] font-black tracking-wider uppercase ${
                                    isSelected 
                                      ? 'text-blue-400' 
                                      : isIndicado 
                                        ? 'text-[#00e676]' 
                                        : 'text-white/60'
                                  }`}>
                                    {gm.market === 'Ambos Times Marcam' ? 'Ambos Marcam' : gm.market}
                                  </span>
                                  {isSelected ? (
                                    <span className="px-2 py-0.5 bg-blue-500/25 text-blue-400 border border-blue-500/20 rounded text-[7px] font-black tracking-widest uppercase">
                                      PALPITE PRINCIPAL
                                    </span>
                                  ) : isIndicado ? (
                                    <span className="px-2 py-0.5 bg-[#00e676]/25 text-[#00e676] border border-[#00e676]/20 rounded text-[7px] font-black tracking-widest uppercase animate-pulse">
                                      ⚡ INDICADO PELO GATE
                                    </span>
                                  ) : gm.edge >= 0.03 ? (
                                    <span className="px-2 py-0.5 bg-[#00e676]/10 text-[#00e676] border border-[#00e676]/20 rounded text-[7px] font-black tracking-widest uppercase">
                                      ✓ EV POSITIVO
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 bg-white/5 text-white/30 border border-white/10 rounded text-[7px] font-black tracking-widest uppercase">
                                      ⚠️ EV NEGATIVO
                                    </span>
                                  )}
                                </div>

                                <div className="space-y-2 mb-6">
                                  {/* Poisson quantitative probability */}
                                  <div className="flex justify-between items-center text-[10px] font-mono">
                                    <span className="text-white/30 uppercase flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_5px_rgba(96,165,250,0.5)]" />
                                      Poisson Prob
                                    </span>
                                    <span className="text-white font-bold">{poissonProb.toFixed(1)}%</span>
                                  </div>
                                  
                                  {/* Gemini qualitative probability */}
                                  {geminiProb !== null && (
                                    <div className="flex justify-between items-center text-[10px] font-mono">
                                      <span className="text-white/30 uppercase flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shadow-[0_0_5px_rgba(192,132,252,0.5)]" />
                                        Gemini IA
                                      </span>
                                      <span className="text-white font-bold">{geminiProb.toFixed(1)}%</span>
                                    </div>
                                  )}
                                  
                                  <div className="h-px bg-white/5 my-1" />

                                  <div className="flex justify-between text-[10px] font-mono">
                                    <span className="text-white/30 uppercase">Odd Fair</span>
                                    <span className="text-white font-bold">{gm.odd_fair.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between text-[10px] font-mono">
                                    <span className="text-white/30 uppercase">Odd Ref</span>
                                    <span className="text-white font-bold">{gm.odd_api.toFixed(2)}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="pt-4 border-t border-white/5 flex justify-between items-baseline">
                                <span className="text-[8px] font-black text-white/30 uppercase tracking-widest">Edge / EV</span>
                                <span className={`text-lg font-mono font-black ${
                                  isSelected 
                                    ? 'text-blue-400' 
                                    : gm.edge >= 0.03
                                      ? 'text-[#00e676]' 
                                      : gm.edge > 0
                                        ? 'text-[#00e676]/60'
                                        : 'text-rose-500/60'
                                }`}>
                                  {gm.edge > 0 ? `+${edgePct}%` : `${edgePct}%`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Bottom Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8 flex flex-col">
                  <div className="flex items-center gap-3 mb-8">
                    <TrendingUp size={16} className="text-white/20" />
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Probabilidades</h4>
                    <Tooltip text="Cálculo probabilístico de gols usando Distribuição de Poisson. Considera força de ataque/defesa e médias da liga." />
                  </div>
                  <div className="space-y-8 flex-1 flex flex-col justify-center">
                    {[
                      { label: 'Over 1.5', val: analysis.gols.over15.probabilidade, color: 'bg-green-500' },
                      { label: 'Over 2.5', val: analysis.gols.over25.probabilidade, color: 'bg-yellow-500' },
                      { label: 'Over 3.5', val: analysis.gols.over35.probabilidade, color: 'bg-rose-500' }
                    ].map(item => (
                      <div key={item.label} className="space-y-3">
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{item.label}</span>
                          <span className="text-xs font-mono font-bold text-white">{item.val}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full ${item.color}`} style={{ width: `${item.val}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <Flag size={16} className="text-white/20" />
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Escanteios</h4>
                    <Tooltip text="Estimativa baseada no volume de finalizações, cruzamentos e estilo tático de jogo das duas equipes." />
                  </div>
                  {(() => {
                    const escMin = analysis?.escanteios?.total_min ?? 9;
                    const escMax = analysis?.escanteios?.total_max ?? 11;
                    const escProb = analysis?.escanteios?.probabilidade ?? 80;
                    const escMediaHome = analysis?.escanteios?.media_home ?? 0;
                    const escMediaAway = analysis?.escanteios?.media_away ?? 0;
                    return (
                      <>
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-5xl font-mono font-bold text-white tracking-tighter">{escMin}-{escMax}</span>
                          <span className="text-xs font-bold text-blue-400">{escProb}%</span>
                        </div>
                        <p className="text-[9px] text-white/20 uppercase font-black tracking-widest mb-10">Média de Probabilidade</p>
                        <div className="pt-6 border-t border-white/5 flex items-center justify-between gap-3">
                          <div className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl p-3 flex flex-col gap-1.5 items-center justify-center transition-colors hover:bg-white/[0.04]">
                            <span className="text-[9px] font-black uppercase text-white/40 text-center leading-tight break-words">{match.home_team}</span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-sm font-mono font-bold text-white">{escMediaHome}</span>
                              <span className="text-[8px] text-white/20 uppercase">/j</span>
                            </div>
                          </div>
                          <div className="text-[9px] font-black text-white/10 uppercase tracking-widest px-2">VS</div>
                          <div className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl p-3 flex flex-col gap-1.5 items-center justify-center transition-colors hover:bg-white/[0.04]">
                            <span className="text-[9px] font-black uppercase text-white/40 text-center leading-tight break-words">{match.away_team}</span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-sm font-mono font-bold text-white">{escMediaAway}</span>
                              <span className="text-[8px] text-white/20 uppercase">/j</span>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <Activity size={16} className="text-white/20" />
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Finalizações</h4>
                    <Tooltip text="Projeção de chutes a gol baseada no aproveitamento ofensivo e histórico de chances criadas nas últimas 5 partidas." />
                  </div>
                  {(() => {
                    const finMin = analysis?.finalizacoes?.total_min ?? 24;
                    const finMax = analysis?.finalizacoes?.total_max ?? 28;
                    const finProb = analysis?.finalizacoes?.probabilidade ?? 75;
                    const finMediaHome = analysis?.finalizacoes?.media_home ?? 0;
                    const finMediaAway = analysis?.finalizacoes?.media_away ?? 0;
                    return (
                      <>
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-5xl font-mono font-bold text-white tracking-tighter">{finMin}-{finMax}</span>
                          <span className="text-xs font-bold text-blue-400">{finProb}%</span>
                        </div>
                        <p className="text-[9px] text-white/20 uppercase font-black tracking-widest mb-10">Expectativa Técnica</p>
                        <div className="pt-6 border-t border-white/5 flex items-center justify-between gap-3">
                          <div className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl p-3 flex flex-col gap-1.5 items-center justify-center transition-colors hover:bg-white/[0.04]">
                            <span className="text-[9px] font-black uppercase text-white/40 text-center leading-tight break-words">{match.home_team}</span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-sm font-mono font-bold text-blue-400">{finMediaHome}</span>
                              <span className="text-[8px] text-blue-400/40 uppercase">/j</span>
                            </div>
                          </div>
                          <div className="text-[9px] font-black text-white/10 uppercase tracking-widest px-2">VS</div>
                          <div className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl p-3 flex flex-col gap-1.5 items-center justify-center transition-colors hover:bg-white/[0.04]">
                            <span className="text-[9px] font-black uppercase text-white/40 text-center leading-tight break-words">{match.away_team}</span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-sm font-mono font-bold text-blue-400">{finMediaAway}</span>
                              <span className="text-[8px] text-blue-400/40 uppercase">/j</span>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="bg-[#141416] border border-white/[0.08] rounded-[2rem] p-8">
                  <div className="flex items-center gap-3 mb-8">
                    <ShieldCheck size={16} className="text-white/20" />
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Dupla Chance</h4>
                    <Tooltip text="Combinação matemática das probabilidades de Resultado Final para cobrir 2 dos 3 cenários possíveis (1X, 12, X2)." />
                  </div>
                  <div className="flex h-3 w-full rounded-full overflow-hidden mb-10 bg-white/5">
                    <div className="h-full bg-blue-500" style={{ width: `${analysis.dupla_chance['1X'].probabilidade}%` }} />
                    <div className="h-full bg-white/10" style={{ width: `${analysis.dupla_chance['12'].probabilidade}%` }} />
                    <div className="h-full bg-rose-500" style={{ width: `${analysis.dupla_chance['X2'].probabilidade}%` }} />
                  </div>
                  <div className="space-y-2">
                    {['1X', 'X2', '12'].map(key => (
                      <div key={key} className="bg-white/[0.02] border border-white/5 p-3 rounded-xl flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/40"><span>{key}</span></span>
                        <span className="text-xs font-mono font-bold text-white"><span>{analysis.dupla_chance[key as keyof typeof analysis.dupla_chance].probabilidade}</span>%</span>
                      </div>
                    ))}

                  </div>
                </div>
              </div>

              {/* Confrontos Diretos (H2H) */}
              {analysis.h2h && (
                <div className="pt-10 border-t border-white/5">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 italic">Confrontos Diretos (H2H)</h4>
                      {analysis?.h2h?.confiavel === false && (
                        <span className="text-[9px] font-bold text-orange-400/80 animate-pulse flex items-center gap-1 ml-4">
                          <AlertTriangle size={10} /> ⚠️ DADOS NÃO VERIFICADOS
                        </span>
                      )}
                      {analysis.h2h.fonte === 'estimado' && !analysis?.h2h?.confiavel && (
                        <span style={{
                          fontSize: 9, padding: '2px 8px',
                          borderRadius: 8, marginLeft: 12,
                          background: '#ff980022',
                          color: '#ff9800',
                          border: '1px solid #ff980044',
                          fontWeight: 900
                        }}>
                          ⚠️ DADOS ESTIMADOS
                        </span>
                      )}
                    </div>
                    <Tooltip text="Histórico de confrontos diretos recentes entre as duas equipes." />
                  </div>

                  <div className="bg-[#0d0d1a] border border-[#1e1e3e] rounded-[16px] p-6">
                    {/* 1. MINI PLACAR DE DOMÍNIO */}
                    <div className="flex flex-col items-center mb-8">
                      <div className="text-[10px] text-white/40 font-black uppercase tracking-widest mb-3">Domínio Histórico</div>
                      <div className="w-full flex items-center justify-between text-[11px] sm:text-xs font-black uppercase">
                        <span className="text-blue-400 flex-1 text-right leading-tight pr-2 break-words">{match.home_team}</span>
                        <div className="w-1/3 px-2 sm:px-4 flex items-center gap-1 sm:gap-2 shrink-0">
                          <div className="h-2 rounded-l-full bg-blue-500" style={{ flex: analysis.h2h.resumo.vitorias_home || 0.1 }} />
                          <div className="h-2 bg-white/20" style={{ flex: analysis.h2h.resumo.empates || 0.1 }} />
                          <div className="h-2 rounded-r-full bg-rose-500" style={{ flex: analysis.h2h.resumo.vitorias_away || 0.1 }} />
                        </div>
                        <span className="text-rose-400 flex-1 text-left leading-tight pl-2 break-words">{match.away_team}</span>
                      </div>
                      <div className="w-full flex items-center justify-center gap-6 mt-2 text-[10px] font-mono text-white/40">
                        <span>{analysis.h2h.resumo.vitorias_home}V</span>
                        <span>{analysis.h2h.resumo.empates}E</span>
                        <span>{analysis.h2h.resumo.vitorias_away}V</span>
                      </div>
                    </div>

                    {/* 3. STATS DO H2H */}
                    <div className="grid grid-cols-2 gap-4 mb-8">
                      <div className="bg-white/[0.02] border border-white/5 p-4 rounded-xl text-center">
                        <div className="text-sm font-mono font-bold text-white mb-1">
                          {analysis.h2h.resumo.media_gols_home.toFixed(1)} <span className="text-white/20 mx-1">x</span> {analysis.h2h.resumo.media_gols_away.toFixed(1)}
                        </div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-white/40">Média Gols (C x F)</div>
                      </div>
                      <div className="bg-white/[0.02] border border-white/5 p-4 rounded-xl text-center">
                        <div className="text-sm font-mono font-bold text-white mb-1">{analysis.h2h.resumo.over25_percentual}%</div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-white/40">Over 2.5 Gols</div>
                      </div>
                    </div>

                    {/* 2. LISTA DOS 5 CONFRONTOS */}
                    <div className="space-y-2">
                      <div className="text-[10px] text-white/40 font-black uppercase tracking-widest mb-3 pl-2">Últimos Confrontos</div>
                      {analysis.h2h.confrontos.map((c: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-colors">
                          <span className="text-[10px] text-white/30 font-mono w-16">{c.data}</span>
                          <div className="flex-1 flex justify-center items-center text-[11px] sm:text-xs font-bold text-white">
                            <span className="text-right flex-1 leading-tight break-words">{c.homeTeam}</span>
                            <span className="px-2 sm:px-3 text-white/40 font-mono shrink-0">{c.placar}</span>
                            <span className="text-left flex-1 leading-tight break-words">{c.awayTeam}</span>
                          </div>
                          <div className="w-16 flex justify-end">
                            <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded-md border ${c.vencedor === 'home' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                c.vencedor === 'away' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                                  'bg-white/10 text-white/40 border-white/10'
                              }`}>
                              {c.vencedor === 'draw' ? 'EMP' : (c.vencedor ? c.vencedor.substring(0, 3) : '—')}
                            </span>
                          </div>
                        </div>
                      ))}
                      {analysis.h2h.confrontos.length === 0 && (
                        <div className="text-center p-4 text-[10px] text-white/20 uppercase font-black">Nenhum confronto recente</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Scouting Intelligence (Final Section) */}
              <div className="pt-10 border-t border-white/5">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex flex-col gap-1">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 italic">Scouting Intelligence</h4>
                    {(analysis?.scouting?.confiavel === false || analysis?.scouting?.data_source === 'gemini_inferido') && (
                      <span className="text-[9px] font-bold text-orange-400/80 animate-pulse flex items-center gap-1">
                        <AlertTriangle size={10} /> ⚠️ DADOS NÃO VERIFICADOS (INFERÊNCIA IA)
                      </span>
                    )}
                  </div>
                  <Tooltip text="Monitoramento em tempo real da forma física e técnica. V = Vitória, E = Empate, D = Derrota, ? = Dados Indisponíveis." />

                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {[
                    { name: match.home_team, form: formaHome.data },
                    { name: match.away_team, form: formaAway.data }
                  ].map(team => (
                    <div key={team.name} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">

                      <span className="text-[11px] font-black uppercase text-white/60 leading-tight max-w-[200px] break-words">
                        <span>{team.name}</span>
                      </span>
                      <div className="flex gap-1.5">
                        {team.form && team.form.length > 0 ? team.form.map((r: any, i: number) => (
                          <div key={i} style={{
                            width: 32, height: 32, borderRadius: 8,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: r.resultado === 'W' ? '#00e67622'
                              : r.resultado === 'D' ? '#ffeb3b22' : '#f4433622',
                            border: `1px solid ${r.resultado === 'W' ? '#00e67644'
                                : r.resultado === 'D' ? '#ffeb3b44' : '#f4433644'
                              }`,
                            cursor: 'pointer'
                          }} title={`${r.resultado} ${r.placar} vs ${r.adversario}`}>
                            <span style={{
                              color: r.resultado === 'W' ? '#00e676'
                                : r.resultado === 'D' ? '#ffeb3b' : '#f44336',
                              fontWeight: 900, fontSize: 11, fontFamily: 'monospace'
                            }}>
                              {r.resultado}
                            </span>
                            <span style={{ color: '#555', fontSize: 8 }}>
                              {r.placar}
                            </span>
                          </div>
                        )) : (
                          ['?', '?', '?', '?', '?'].map((r, i) => (
                            <div key={i} className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black border ${getFormBadge(r)}`}>
                              <span>{r}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}

                </div>
                </div>
              </div>
            </motion.div>
          ) : null}

        </div>

        <footer className="h-12 bg-white/[0.02] border-t border-white/5 px-10 flex items-center justify-between text-[9px] font-mono text-white/10 uppercase tracking-[0.3em]">
          <div className="flex gap-10">
            <span><span>Verified Analysis Status</span></span>
            <span><span>Model: GEMINI-2.0-FLASH</span></span>
          </div>

          <div className="flex items-center gap-2 text-blue-500/40">
            <ShieldCheck size={12} />
            <span>EVEngine AI Integrity v8.1</span>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

