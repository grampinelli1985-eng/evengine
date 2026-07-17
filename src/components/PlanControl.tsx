import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Check, Zap, Star, X, Shield, ArrowRight, Crown } from 'lucide-react';
import { useUserPlan } from '../hooks/useUserPlan';
import { updateUserPlan } from '../services/planService';
import { useAuth } from '../contexts/AuthContext';

interface PlanLockProps {
  plan: 'pro' | 'sharp';
  feature: string;
  className?: string;
}

export function PlanLock({ plan, feature, className = '' }: PlanLockProps) {
  const handleUpgradeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('evengine_open_upgrade_modal', { detail: { targetPlan: plan } }));
  };

  return (
    <div className={`absolute inset-0 z-40 backdrop-blur-[6px] bg-black/60 flex flex-col items-center justify-center text-center p-6 rounded-2xl border border-white/5 ${className}`}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-sm p-6 border-blue-500/25 shadow-xl shadow-blue-500/10 flex flex-col items-center"
      >
        <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-4 animate-pulse">
          <Lock size={20} />
        </div>
        <h4 className="text-sm font-black uppercase text-white tracking-wider mb-2">Recurso Bloqueado</h4>
        <p className="text-xs text-white/50 leading-relaxed mb-5">
          O recurso <strong>{feature}</strong> está disponível apenas para assinantes do plano{' '}
          <span className={`inline-flex items-center gap-1 font-bold uppercase ${plan === 'sharp' ? 'text-emerald-400' : 'text-blue-400'}`}>
            {plan === 'pro' && <Crown size={11} className="text-blue-400 fill-blue-400/20" />}
            {plan === 'sharp' && <Crown size={11} className="text-emerald-400 fill-emerald-400/20" />}
            {plan}
          </span>{' '}
          ou superior.
        </p>
        <button
          onClick={handleUpgradeClick}
          className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all flex items-center gap-1.5"
        >
          Desbloquear Agora <Zap size={10} className="fill-white" />
        </button>
      </motion.div>
    </div>
  );
}

export function PlanBadge() {
  const { profile, plan, getRemainingAnalysesToday } = useUserPlan();

  const isDemo = plan === 'demo';

  const badgeColors = {
    demo: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    free: 'bg-white/5 text-white/50 border border-white/10',
    pro: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    sharp: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  };

  const remaining = getRemainingAnalysesToday;
  const showRemaining = plan === 'free' || plan === 'demo';

  return (
    <div className="flex items-center gap-3">
      <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${badgeColors[plan] ?? badgeColors.free}`}>
        {plan === 'pro' && <Crown size={10} className="text-blue-400 fill-blue-400/20 flex-shrink-0 animate-pulse" />}
        {plan === 'sharp' && <Crown size={10} className="text-emerald-400 fill-emerald-400/20 flex-shrink-0 animate-pulse" />}
        {plan === 'demo' ? 'Demo' : `Plano ${plan.charAt(0).toUpperCase() + plan.slice(1)}`}
      </span>
      {showRemaining && (
        <span className="text-[10px] text-white/30 font-semibold uppercase tracking-wider">
          {plan === 'demo'
            ? <>Análises demo: <strong className="text-amber-400">{remaining} restantes</strong></>
            : <>Análises de hoje: <strong className="text-blue-400">{remaining} restantes</strong></>
          }
        </span>
      )}
    </div>
  );
}

interface UpgradeModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function UpgradeModal({ isOpen: propIsOpen, onClose: propOnClose }: UpgradeModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { plan, profile } = useUserPlan();
  const { user } = useAuth();

  const isDemoExhausted = plan === 'demo' && profile && profile.analyses_today >= 5;
  const isDemoUpgrade = plan === 'demo';

  useEffect(() => {
    if (propIsOpen !== undefined) {
      setIsOpen(propIsOpen);
    }
  }, [propIsOpen]);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('evengine_open_upgrade_modal', handleOpen);
    return () => window.removeEventListener('evengine_open_upgrade_modal', handleOpen);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    if (propOnClose) propOnClose();
  };

  const handleSelectPlan = async (targetPlan: 'free' | 'pro' | 'sharp') => {
    if (targetPlan === 'free') {
      // FREE é gratuito — migra imediatamente sem checkout
      if (user) {
        await updateUserPlan(user.id, 'free');
        handleClose();
      }
      return;
    }
    // PRO e SHARP — redireciona para checkout (mock por enquanto)
    window.dispatchEvent(new CustomEvent('evengine_checkout_init', { detail: { plan: targetPlan } }));
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="relative w-full max-w-4xl bg-[#070708] border border-white/5 rounded-3xl p-6 md:p-8 overflow-hidden z-10 max-h-[90vh] overflow-y-auto"
        >
          <div className="flex justify-between items-start mb-6">
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400/80 mb-2 block">
                {isDemoUpgrade ? 'Demonstração Concluída' : 'Premium Hub'}
              </span>
              <h3 className="text-2xl font-black text-white uppercase tracking-tight">
                {isDemoExhausted
                  ? 'Suas 5 análises demo foram utilizadas'
                  : 'Evolua Seu Edge Matemático'}
              </h3>
              {isDemoUpgrade && (
                <p className="text-xs text-white/40 mt-2 max-w-lg leading-relaxed">
                  {isDemoExhausted
                    ? 'Você explorou o Evengine AI. Escolha um plano para continuar analisando partidas todos os dias.'
                    : 'Você está no período de demonstração. Faça upgrade para acesso contínuo.'}
                </p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-5 mb-6">
            {/* Free */}
            <div className={`glass-card p-6 border-white/5 flex flex-col justify-between relative ${plan === 'free' ? 'ring-1 ring-white/10' : ''}`}>
              {plan === 'free' && (
                <span className="absolute top-4 right-4 bg-white/10 text-[8px] font-black uppercase px-2 py-0.5 rounded text-white/70">
                  Plano Atual
                </span>
              )}
              <div>
                <h4 className="text-sm font-black text-white uppercase mb-2">Free</h4>
                <div className="text-2xl font-black text-white mb-1">Grátis</div>
                <p className="text-[9px] text-white/30 mb-4">Teste por 15 dias · sem cartão</p>
                <ul className="space-y-2.5 text-xs text-white/50 mb-6">
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> 3 análises/dia</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> Apenas Tier A (Top 5 ligas)</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> Histórico de 7 dias</li>
                  <li className="flex items-center gap-2 text-white/20"><X size={12} /> Sem Copa do Mundo</li>
                  <li className="flex items-center gap-2 text-white/20"><X size={12} /> Sem CLV tracking</li>
                  <li className="flex items-center gap-2 text-white/20"><X size={12} /> Sem API key própria</li>
                </ul>
              </div>
              <button
                onClick={() => handleSelectPlan('free')}
                disabled={plan === 'free'}
                className={`w-full py-2.5 font-black uppercase text-[10px] tracking-wider rounded-xl transition-all ${
                  plan === 'free'
                    ? 'bg-white/5 text-white/40 cursor-default'
                    : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                }`}
              >
                {plan === 'free' ? 'Plano Atual' : isDemoUpgrade ? 'Teste Grátis (15 d)' : 'Teste Grátis (15 d)'}
              </button>
            </div>

            {/* Pro */}
            <div className={`glass-card p-6 border-blue-500/20 bg-blue-500/[0.01] flex flex-col justify-between relative ${plan === 'pro' ? 'ring-1 ring-blue-500/40' : ''}`}>
              {plan === 'pro' && (
                <span className="absolute top-4 right-4 bg-blue-500/20 text-[8px] font-black uppercase px-2 py-0.5 rounded text-blue-400">
                  Plano Atual
                </span>
              )}
              <span className="absolute -top-3 left-6 bg-gradient-to-r from-blue-500 to-blue-700 text-[8px] font-black uppercase px-3 py-1 rounded-full text-white tracking-widest shadow-md">
                Mais Popular
              </span>
              <div className="pt-2">
                <h4 className="text-sm font-black text-white uppercase mb-2 flex items-center gap-1.5">
                  Pro <Crown size={14} className="text-blue-500 fill-blue-500/20 flex-shrink-0 animate-pulse" />
                </h4>
                <div className="text-2xl font-black text-white mb-4">R$ 147 <span className="text-xs text-white/40 font-medium">/mês</span></div>
                <ul className="space-y-2.5 text-xs text-white/60 mb-6">
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> Até 30 análises/dia</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> 10 Ligas cobertas</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> Módulo Copa do Mundo 2026</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> Histórico 30 dias</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-blue-400" /> Alertas de odds ativos</li>
                  <li className="flex items-center gap-2 text-white/20"><X size={12} /> Sem CLV tracking</li>
                </ul>
              </div>
              <button
                onClick={() => handleSelectPlan('pro')}
                disabled={plan === 'pro' || plan === 'sharp'}
                className={`w-full py-2.5 font-black uppercase text-[10px] tracking-wider rounded-xl transition-all ${
                  plan === 'pro' || plan === 'sharp'
                    ? 'bg-white/5 text-white/40 cursor-default'
                    : 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20'
                }`}
              >
                {plan === 'pro' ? 'Plano Atual' : plan === 'sharp' ? 'Incluso' : 'Escolher Pro'}
              </button>
            </div>

            {/* Sharp */}
            <div className={`glass-card p-6 border-emerald-500/20 bg-emerald-500/[0.01] flex flex-col justify-between relative ${plan === 'sharp' ? 'ring-1 ring-emerald-500/40' : ''}`}>
              {plan === 'sharp' && (
                <span className="absolute top-4 right-4 bg-emerald-500/20 text-[8px] font-black uppercase px-2 py-0.5 rounded text-emerald-400">
                  Plano Atual
                </span>
              )}
              <span className="absolute -top-3 left-6 bg-gradient-to-r from-emerald-500 to-emerald-700 text-[8px] font-black uppercase px-3 py-1 rounded-full text-white tracking-widest shadow-md">
                Para Investidores Sérios
              </span>
              <div className="pt-2">
                <h4 className="text-sm font-black text-white uppercase mb-2 flex items-center gap-1.5">
                  Sharp <Crown size={14} className="text-emerald-500 fill-emerald-500/20 flex-shrink-0 animate-pulse" />
                </h4>
                <div className="text-2xl font-black text-white mb-4">R$ 247 <span className="text-xs text-white/40 font-medium">/mês</span></div>
                <ul className="space-y-2.5 text-xs text-white/60 mb-6">
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> Análises sem limite</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> Todas as ligas disponíveis</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> Módulo Copa do Mundo 2026</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> Histórico 90 dias</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> CLV tracking ativo</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> Exportar CSV/JSON</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> API key própria</li>
                  <li className="flex items-center gap-2"><Check size={12} className="text-emerald-400" /> Até 5 bancas simultâneas</li>
                </ul>
              </div>
              <button
                onClick={() => handleSelectPlan('sharp')}
                disabled={plan === 'sharp'}
                className={`w-full py-2.5 font-black uppercase text-[10px] tracking-wider rounded-xl transition-all ${
                  plan === 'sharp'
                    ? 'bg-white/5 text-white/40 cursor-default'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20'
                }`}
              >
                {plan === 'sharp' ? 'Plano Atual' : 'Escolher Sharp'}
              </button>
            </div>
          </div>

          {isDemoUpgrade && (
            <p className="text-center text-[10px] text-white/20">
              O plano Free é gratuito para sempre · PRO e Sharp têm cobrança mensal · Cancele quando quiser
            </p>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
