import { useState, useEffect } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import {
  Brain, BarChart3, Shield, Target, Activity, Zap,
  ArrowRight, Check, Star, TrendingUp, ChevronRight,
  Eye, Lock, Cpu, Database, Award, Scale,
  FileText, ShieldAlert, Crown
} from 'lucide-react';
import './landing.css';

interface LandingPageProps {
  onNavigateToAuth: () => void;
  onNavigateToDemo?: () => void;
}

const stats = [
  { value: '+2.18%', label: 'CLV Médio (30d)', description: 'Closing Line Value vig-free', icon: TrendingUp },
  { value: '14.821', label: 'Apostas Bloqueadas', description: 'Protegido pelos Gates', icon: Shield },
  { value: '6', label: 'Gates de Proteção', description: 'Filtros quantitativos ativos por análise', icon: Shield },
];

const steps = [
  { phase: 'Fase 01', title: 'Entrada do Jogo', desc: 'Identificação automatizada de novas partidas na grade.', icon: PlayIcon },
  { phase: 'Fase 02', title: 'Coleta de Dados', desc: 'Raspagem instantânea de odds e limites (Pinnacle/Betfair).', icon: Database },
  { phase: 'Fase 03', title: 'IA Gemini', desc: 'Análise semântica e qualitativa de notícias e desfalques.', icon: Brain },
  { phase: 'Fase 04', title: 'Poisson + ELO', desc: 'Simulação matemática de probabilidades puras.', icon: BarChart3 },
  { phase: 'Fase 05', title: 'Cálculo EV', desc: 'Comparação probabilística contra a linha justa sem margem (vig-free).', icon: Scale },
  { phase: 'Fase 06', title: '6 Gates de Proteção', desc: 'Filtros quantitativos de segurança contra variância e anomalias.', icon: ShieldAlert },
  { phase: 'Fase 07', title: 'Recomendação Final', desc: 'Disparo no painel apenas se aprovada em todos os crivos.', icon: Target },
];

function PlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

const gates = [
  { code: 'B-EV', title: 'Margem de Valor Esperado', desc: 'Exige EV mínimo de +5% para cobrir a variância e máximo de +20%. Se passar de +20%, indica anomalia ou desvio grave do modelo em relação ao mercado.' },
  { code: 'B-CONF', title: 'Confiança Mínima', desc: 'Calibração específica por módulo esportivo. O índice de confiança intrínseco do modelo deve ultrapassar o limiar crítico definido.' },
  { code: 'B-SCORE', title: 'Score Ponderado', desc: 'Pontuação composta gerada pela convergência de múltiplos sub-modelos. Se a convergência falhar, a análise é descartada.' },
  { code: 'B-MEFF', title: 'Market Efficiency Edge', desc: 'Diferença entre a probabilidade do modelo e a odd implícita de mercado deve estar estritamente entre 2pp e 20pp.' },
  { code: 'B-ODD', title: 'Filtro de Odd Limite', desc: 'A odd deve estar estritamente na faixa de 1.40 a 5.00. Fora desse intervalo, o risco geométrico e a baixa liquidez invalidam a entrada.' },
  { code: 'GATE-03', title: 'Queda de Odds Pós-Análise', desc: 'Monitora a variação do mercado em tempo real. Se as odds caírem mais de 7% em relação ao momento da análise, a entrada é bloqueada.' },
];

const plans = [
  {
    name: 'Free',
    price: 'Grátis',
    period: '',
    description: 'Experimentação e validação inicial',
    features: [
      '3 análises/dia',
      'Apenas Tier A (Top 5 ligas europeias)',
      'Sem Módulo Copa do Mundo',
      'Histórico 7 dias',
    ],
    cta: 'Começar Grátis',
    featured: false,
    badge: ''
  },
  {
    name: 'Pro',
    price: 'R$ 147',
    period: '/mês',
    description: 'Para o apostador quantitativo focado',
    features: [
      'Até 30 análises/dia (fair use)',
      '10 Ligas (EPL, La Liga, Serie A, Bundesliga, Ligue 1, Champions, Brasileirão, Eredivisie, Libertadores, Sul-Americana)',
      'Módulo Copa do Mundo 2026',
      'Histórico 30 dias',
      'Alertas de movimento de odds',
    ],
    cta: 'Assinar Pro',
    featured: true,
    badge: 'Mais Popular'
  },
  {
    name: 'Sharp',
    price: 'R$ 247',
    period: '/mês',
    description: 'Para investidores sérios e sindicatos',
    features: [
      'Análises sem limites',
      'Todas as ligas disponíveis',
      'Módulo Copa do Mundo 2026',
      'Histórico 90 dias',
      'Alertas de movimento de odds',
      'CLV Tracking',
      'Exportar CSV/JSON',
      'Suporte prioritário',
    ],
    cta: 'Assinar Sharp',
    featured: false,
    badge: 'Para investidores sérios'
  }
];

export default function LandingPage({ onNavigateToAuth, onNavigateToDemo }: LandingPageProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activePlanIdx, setActivePlanIdx] = useState(1);
  const [isPricingPaused, setIsPricingPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.95]);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (isPricingPaused) return;

    const interval = setInterval(() => {
      setActivePlanIdx((prev) => (prev + 1) % plans.length);
    }, 6000);

    return () => clearInterval(interval);
  }, [isPricingPaused]);

  return (
    <div className="landing-page min-h-screen">
      {/* Background Effects */}
      <div className="landing-bg-grid" />
      <div className="landing-glow-orb landing-glow-orb--blue" />
      <div className="landing-glow-orb landing-glow-orb--green" />
      <div className="landing-glow-orb landing-glow-orb--purple" />

      {/* Navbar */}
      <nav className={`landing-nav ${isScrolled ? 'landing-nav--scrolled' : ''}`}>
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <span className="text-lg font-extrabold tracking-tight text-white uppercase font-sans">
              EV<span className="text-blue-400">Engine</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <a href="#stats" className="text-xs uppercase tracking-widest text-white/50 hover:text-white transition-colors font-bold">Métricas</a>
            <a href="#how-it-works" className="text-xs uppercase tracking-widest text-white/50 hover:text-white transition-colors font-bold">Pipeline</a>
            <a href="#gates" className="text-xs uppercase tracking-widest text-white/50 hover:text-white transition-colors font-bold">Gates</a>
            <a href="#trust" className="text-xs uppercase tracking-widest text-white/50 hover:text-white transition-colors font-bold">Premissas</a>
            <a href="#journey" className="text-xs uppercase tracking-widest text-white/50 hover:text-white transition-colors font-bold">Jornada</a>
            <a href="#pricing" className="text-xs uppercase tracking-widest text-white/50 hover:text-white transition-colors font-bold">Planos</a>
          </div>

          <div className="flex items-center gap-3">
            {onNavigateToDemo && (
              <button
                onClick={onNavigateToDemo}
                className="text-xs uppercase tracking-widest text-white/60 hover:text-white transition-colors font-bold px-4 py-2"
              >
                Experimentar Demo
              </button>
            )}
            <button
              onClick={onNavigateToAuth}
              className="cta-button text-xs !py-2.5 !px-5 flex items-center gap-1.5"
            >
              Acessar Plataforma <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <motion.section
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative z-10 pt-36 pb-16 px-6"
      >
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="badge-glow mb-8 inline-flex">
              <Cpu size={12} />
              Motor Analítico Quantitativo — Gemini IA
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl sm:text-5xl md:text-7xl font-black tracking-tight leading-[1.05] mb-6 text-white uppercase"
          >
            Você aposta.
            <br />
            <span className="gradient-text">A casa sempre ganha.</span>
            <br />
            Por quê?
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="text-base md:text-lg text-white/50 max-w-3xl mx-auto mb-10 font-medium leading-relaxed"
          >
            EVENGINE calcula onde a casa errou o preço — e só recomenda quando há{' '}
            <span className="text-blue-400 font-bold">edge matemático real</span> confirmado por{' '}
            <span className="text-emerald-400 font-bold">6 Gates de proteção</span> de risco de banca.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button onClick={onNavigateToAuth} className="cta-button">
              Começar Grátis — 3 análises por dia <ArrowRight size={16} />
            </button>
            {onNavigateToDemo && (
              <button
                onClick={onNavigateToDemo}
                className="px-6 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-2xl text-xs uppercase tracking-[0.2em] transition-all hover:scale-[1.03] active:scale-95 flex items-center gap-1.5"
              >
                Experimentar Demo
              </button>
            )}
          </motion.div>

          {/* Trust indicators */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="mt-12 flex items-center justify-center gap-6 text-[10px] uppercase tracking-widest text-white/30 font-bold"
          >
            <span className="flex items-center gap-1.5"><Lock size={11} className="text-blue-500" /> Sem Tipster</span>
            <span className="flex items-center gap-1.5"><Shield size={11} className="text-blue-500" /> Gates de Risco</span>
            <span className="flex items-center gap-1.5"><TrendingUp size={11} className="text-blue-500" /> CLV Auditado</span>
          </motion.div>
        </div>
      </motion.section>

      {/* Quantitative Social Proof (New Section) */}
      <section id="stats" className="relative z-10 py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="glass-card p-6 flex flex-col justify-between border-white/[0.04] relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <stat.icon size={64} className="text-blue-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <stat.icon size={16} className="text-blue-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">{stat.label}</span>
                  </div>
                  <div className="text-3xl md:text-4xl font-black text-white tracking-tight">
                    {stat.value}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-white/[0.03] text-xs text-white/35 font-medium">
                  {stat.description}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <div className="section-divider" />

      {/* How it works (Vertical Timeline) */}
      <section id="how-it-works" className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400/60 mb-4 block">
              Como Funciona
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight uppercase">
              Pipeline de Análise em <span className="gradient-text">7 Fases</span>
            </h2>
          </div>

          <div className="relative border-l border-blue-500/20 ml-4 md:ml-32 space-y-12 py-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.phase}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="relative pl-8 md:pl-12"
              >
                {/* Timeline Dot */}
                <div className="absolute left-0 top-1.5 -translate-x-1/2 w-8 h-8 rounded-full bg-[#070708] border border-blue-500 flex items-center justify-center text-blue-400 z-10 shadow-lg shadow-blue-500/10">
                  <step.icon />
                </div>

                {/* Desktop Phase Tag */}
                <div className="hidden md:block absolute right-full mr-8 top-1.5 text-right">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-400/50 bg-blue-500/5 px-2.5 py-1 rounded-full border border-blue-500/10">
                    {step.phase}
                  </span>
                </div>

                <div className="glass-card p-6 border-white/[0.04] hover:border-blue-500/20">
                  <div className="flex items-center gap-2 mb-2 md:hidden">
                    <span className="text-[8px] font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                      {step.phase}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">{step.title}</h3>
                  <p className="text-sm text-white/40 leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="mt-16 text-center">
            <div className="inline-block glass-card py-4 px-8 border-emerald-500/20 bg-emerald-500/[0.02]">
              <p className="text-xs sm:text-sm font-bold text-emerald-400 tracking-wide uppercase">
                🛡️ Se qualquer Gate fechar, a aposta é bloqueada — independente do EV calculado
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="section-divider" />

      {/* The 6 Protection Gates */}
      <section id="gates" className="relative z-10 py-24 px-6 bg-gradient-to-b from-transparent to-[#050508]/40">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400/60 mb-4 block">
              Gestão de Risco Quantitativa
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight uppercase">
              Os 6 Gates de <span className="gradient-text">Proteção de Banca</span>
            </h2>
            <p className="text-sm text-white/45 max-w-2xl mx-auto mt-4 leading-relaxed">
              O sistema age como um hedge fund quantitativo. Se um único portão rejeitar a operação, ela é bloqueada instantaneamente, protegendo seu capital contra a volatilidade.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {gates.map((gate, i) => (
              <motion.div
                key={gate.code}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="glass-card p-6 border-white/[0.04] hover:border-blue-500/20"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[10px] font-black font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded">
                    {gate.code}
                  </span>
                  <h3 className="text-sm font-bold text-white uppercase tracking-tight">{gate.title}</h3>
                </div>
                <p className="text-xs text-white/40 leading-relaxed">{gate.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <div className="section-divider" />

      {/* Por Que Confiar (Why Trust) Section */}
      <section id="trust" className="relative z-10 py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400/60 mb-4 block">
              Alinhamento de Interesse
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight uppercase">
              Por que confiar no <span className="gradient-text">EVENGINE</span>?
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="glass-card p-8 border-white/[0.04]">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6">
                <FileText size={20} />
              </div>
              <h3 className="text-base font-bold text-white mb-3 uppercase tracking-wider">Transparência total</h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Cada análise arquivada com resultado real. Você vê o histórico completo, sem filtragem ou seleção curada de greens.
              </p>
            </div>

            <div className="glass-card p-8 border-white/[0.04]">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6">
                <Scale size={20} />
              </div>
              <h3 className="text-base font-bold text-white mb-3 uppercase tracking-wider">Sem promessa de lucro</h3>
              <p className="text-xs text-white/40 leading-relaxed">
                O sistema garante edge matemático e valor esperado no preço, não resultado. Apostadores quantitativos sérios operam sob a lei dos grandes números.
              </p>
            </div>

            <div className="glass-card p-8 border-white/[0.04]">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6">
                <Activity size={20} />
              </div>
              <h3 className="text-base font-bold text-white mb-3 uppercase tracking-wider">Paper trading obrigatório</h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Recomendamos 30 dias de simulação antes de arriscar qualquer capital real. O próprio sistema guia o processo de validação da sua variância.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="section-divider" />

      {/* Onboarding / User Journey Timeline */}
      <section id="journey" className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400/60 mb-4 block">
              Jornada de Consistência
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight uppercase">
              Sua Trajetória no <span className="gradient-text">Sistema</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 relative">
            <div className="glass-card p-8 border-white/[0.04] relative">
              <div className="text-2xl font-black text-blue-400 mb-4">Dias 1-30</div>
              <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wide">Fase de Paper Trading</h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Acompanhe o painel de análises, registre as apostas de forma simulada sem expor dinheiro real, e monitore o CLV de fechamento.
              </p>
            </div>

            <div className="glass-card p-8 border-blue-500/20 bg-blue-500/[0.01] relative">
              <div className="text-2xl font-black text-blue-400 mb-4">Dia 31</div>
              <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wide">Ponto de Validação</h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Se o seu CLV médio ajustado for superior a +1.5%, você comprovou que está batendo a linha do mercado. É hora de iniciar a transição para capital real.
              </p>
            </div>

            <div className="glass-card p-8 border-white/[0.04] relative">
              <div className="text-2xl font-black text-blue-400 mb-4">Longo Prazo</div>
              <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wide">Execução e Volume</h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Adoção automática de Quarter-Kelly, proteção rigorosa de banca através dos Gates, e convergência do ROI estatístico através do volume de apostas.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="section-divider" />

      {/* Pricing Section */}
      <section id="pricing" className="relative z-10 py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400/60 mb-4 block">
              Tabela de Planos
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight uppercase">
              Estrutura de <span className="gradient-text">Planos e Preços</span>
            </h2>
          </div>

          {/* Pricing Tabs for Mobile/Desktop Toggle */}
          <div className="flex justify-center gap-2 mb-10 overflow-x-auto pb-2 scrollbar-none">
            {plans.map((p, idx) => (
              <button
                key={p.name}
                onClick={() => setActivePlanIdx(idx)}
                className={`px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${activePlanIdx === idx
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white border border-white/5'
                  }`}
              >
                {p.name}
                {p.name.toLowerCase() === 'pro' && <Crown size={10} className={`${activePlanIdx === idx ? 'text-white' : 'text-blue-400'} flex-shrink-0`} />}
                {p.name.toLowerCase() === 'sharp' && <Crown size={10} className={`${activePlanIdx === idx ? 'text-white' : 'text-amber-400'} flex-shrink-0`} />}
              </button>
            ))}
          </div>

          {/* Carousel Slider */}
          <div
            className="relative w-full max-w-5xl mx-auto flex flex-col items-center justify-center h-[560px] md:h-[520px] select-none"
            onMouseEnter={() => setIsPricingPaused(true)}
            onMouseLeave={() => setIsPricingPaused(false)}
          >
            {/* 3D Stack Cards Container */}
            <div className="relative w-full max-w-md h-full flex items-center justify-center overflow-visible">
              {plans.map((plan, idx) => {
                let diff = idx - activePlanIdx;
                if (diff < -1) diff += plans.length;
                if (diff > 1) diff -= plans.length;

                const isActive = diff === 0;
                const isLeft = diff === -1;
                const isRight = diff === 1;

                const xTranslate = isMobile
                  ? '0%'
                  : (isLeft ? '-280px' : isRight ? '280px' : '0px');
                const scaleValue = isActive ? (plan.featured ? 1.04 : 1.0) : 0.85;
                const opacityValue = isActive ? 1 : (isMobile ? 0 : 0.35);
                const zIndexValue = isActive ? 10 : 5;
                const blurValue = isActive ? 'blur(0px)' : 'blur(2px)';
                const pointerEvents = isActive ? 'auto' : (isMobile ? 'none' : 'auto');

                return (
                  <motion.div
                    key={plan.name}
                    style={{
                      position: 'absolute',
                      width: '100%',
                      pointerEvents,
                    }}
                    animate={{
                      x: xTranslate,
                      scale: scaleValue,
                      opacity: opacityValue,
                      zIndex: zIndexValue,
                      filter: blurValue,
                    }}
                    whileHover={isActive ? { y: -6 } : {}}
                    onClick={() => {
                      if (!isActive) setActivePlanIdx(idx);
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    className={`pricing-card relative cursor-pointer ${plan.featured ? 'pricing-card--featured' : ''}`}
                  >
                    {plan.badge && (
                      <div className="flex items-center gap-1.5 mb-4">
                        <Star size={12} className="text-blue-400 fill-blue-400" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-400">
                          {plan.badge}
                        </span>
                      </div>
                    )}
                    <h3 className="text-lg font-black text-white uppercase flex items-center gap-1.5">
                      {plan.name}
                      {plan.name.toLowerCase() === 'pro' && <Crown size={16} className="text-blue-500 fill-blue-500/20 flex-shrink-0 animate-pulse" />}
                      {plan.name.toLowerCase() === 'sharp' && <Crown size={16} className="text-amber-500 fill-amber-500/20 flex-shrink-0 animate-pulse" />}
                    </h3>
                    <p className="text-xs text-white/35 mt-1 mb-5">{plan.description}</p>
                    <div className="mb-6">
                      <span className="text-4xl font-black text-white">{plan.price}</span>
                      {plan.period && <span className="text-sm text-white/30 font-medium">{plan.period}</span>}
                    </div>
                    <ul className="space-y-3 mb-8">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5 text-sm text-white/50 font-medium">
                          <Check size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToAuth();
                      }}
                      className={`w-full py-3 rounded-xl font-black uppercase text-xs tracking-wider transition-all ${plan.featured
                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:shadow-lg hover:shadow-blue-500/20'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5'
                        }`}
                    >
                      {plan.cta} <ChevronRight size={14} className="inline ml-1" />
                    </button>
                  </motion.div>
                );
              })}
            </div>

            {/* Slider Controls */}
            <button
              onClick={() => setActivePlanIdx((prev) => (prev - 1 + plans.length) % plans.length)}
              className="absolute left-4 md:left-[-60px] top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/5 flex items-center justify-center text-white/60 hover:text-white transition-all z-20"
            >
              <ChevronRight size={18} className="rotate-180" />
            </button>
            <button
              onClick={() => setActivePlanIdx((prev) => (prev + 1) % plans.length)}
              className="absolute right-4 md:right-[-60px] top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/5 flex items-center justify-center text-white/60 hover:text-white transition-all z-20"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Carousel Dots */}
          <div className="flex justify-center gap-2 mt-8">
            {plans.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActivePlanIdx(idx)}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${activePlanIdx === idx ? 'bg-blue-500 w-5' : 'bg-white/10 hover:bg-white/20'
                  }`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-12 px-6 mt-12">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="text-sm font-bold text-white/40 uppercase tracking-wider">
              EV<span className="text-blue-400">Engine</span> — Quant SaaS
            </span>
          </div>
          <p className="text-xs text-white/25 font-semibold uppercase tracking-wider">
            © {new Date().getFullYear()} EVEngine. Todos os direitos reservados.
          </p>
        </div>
        <div className="max-w-6xl mx-auto pt-6 border-t border-white/[0.03]">
          <p className="text-[10px] text-white/20 font-medium leading-relaxed uppercase tracking-wider text-center md:text-left">
            ⚠️ EVENGINE é uma ferramenta de análise quantitativa. Apostas esportivas envolvem risco financeiro. Jogue com responsabilidade.
          </p>
        </div>
      </footer>
    </div>
  );
}
