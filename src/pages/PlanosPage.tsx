import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X, Shield, Star, HelpCircle, ArrowLeft, Info, Crown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FAQItem {
  question: string;
  answer: string;
}

export default function PlanosPage() {
  const [activeFAQ, setActiveFAQ] = useState<number | null>(null);

  const plans = [
    {
      name: 'FREE',
      price: 'R$0',
      period: '15 dias',
      cta: 'Teste Grátis',
      link: '/login',
      badge: null,
      borderColor: 'border-[#1e2330]',
      features: [
        { name: 'Análises/dia', val: '3', checked: true },
        { name: 'Ligas cobertas', val: 'Ligas Tier A + Brasileirão Série A', checked: true },
        { name: 'Módulo Copa do Mundo 2026', val: false, checked: false },
        { name: 'ELO Engine (clubes)', val: 'básico', checked: true },
        { name: 'Filtros B-EV / B-MEFF', val: true, checked: true },
        { name: 'Histórico de análises', val: '7 dias', checked: true },
        { name: 'CLV Tracking (Closing Line Value)', val: false, checked: false },
        { name: 'Alertas de movimento de odds', val: false, checked: false },
        { name: 'Paper Trading (30 dias obrigatórios)', val: true, checked: true },
        { name: 'Exportar CSV/JSON', val: false, checked: false },
        { name: 'Suporte', val: 'Community', checked: true }
      ]
    },
    {
      name: 'PRO',
      price: 'R$147',
      period: '/mês',
      cta: 'Assinar PRO',
      link: '/login?plan=pro',
      badge: 'MAIS POPULAR',
      borderColor: 'border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.1)]',
      features: [
        { name: 'Análises/dia', val: 'Até 30/dia (fair use)', checked: true },
        { name: 'Ligas cobertas', val: '10 Ligas (EPL, La Liga, Serie A, Bundesliga, Ligue 1, Champions, Brasileirão, Eredivisie, Libertadores, Sul-Americana)', checked: true },
        { name: 'Módulo Copa do Mundo 2026', val: true, checked: true },
        { name: 'ELO Engine (clubes)', val: 'completo', checked: true },
        { name: 'Filtros B-EV / B-MEFF', val: true, checked: true },
        { name: 'Histórico de análises', val: '30 dias', checked: true },
        { name: 'CLV Tracking (Closing Line Value)', val: false, checked: false },
        { name: 'Alertas de movimento de odds', val: true, checked: true },
        { name: 'Paper Trading (30 dias obrigatórios)', val: true, checked: true },
        { name: 'Exportar CSV/JSON', val: false, checked: false },
        { name: 'Suporte', val: 'Email', checked: true }
      ]
    },
    {
      name: 'SHARP',
      price: 'R$247',
      period: '/mês',
      cta: 'Assinar SHARP',
      link: '/login?plan=sharp',
      badge: 'PROFISSIONAL',
      borderColor: 'border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.1)]',
      features: [
        { name: 'Análises/dia', val: 'Sem limite (cache prioritário)', checked: true },
        { name: 'Ligas cobertas', val: 'Todas as ligas', checked: true },
        { name: 'Módulo Copa do Mundo 2026', val: true, checked: true },
        { name: 'ELO Engine (clubes)', val: 'completo', checked: true },
        { name: 'Filtros B-EV / B-MEFF', val: true, checked: true },
        { name: 'Histórico de análises', val: '90 dias', checked: true },
        { name: 'CLV Tracking (Closing Line Value)', val: true, checked: true },
        { name: 'Alertas de movimento de odds', val: true, checked: true },
        { name: 'Paper Trading (30 dias obrigatórios)', val: true, checked: true },
        { name: 'Exportar CSV/JSON', val: true, checked: true },
        { name: 'Suporte', val: 'Prioritário', checked: true }
      ]
    }
  ];

  const faqs: FAQItem[] = [
    {
      question: 'O EVENGINE garante lucro?',
      answer: 'Não. Nenhuma ferramenta séria de value betting garante lucro. Garantimos rigor matemático e transparência nos modelos.'
    },
    {
      question: 'O que é B-EV e B-MEFF?',
      answer: 'São filtros de qualidade. B-EV bloqueia apostas com EV fora da faixa 3%–12%. B-MEFF bloqueia quando a vantagem sobre o mercado está abaixo de 2pp ou acima de 20pp (sinal de erro de modelo).'
    },
    {
      question: 'Posso cancelar quando quiser?',
      answer: 'Sim. Sem fidelidade. Cancele pelo painel e o acesso continua até o fim do período pago.'
    },
    {
      question: 'O que é o Módulo Copa do Mundo?',
      answer: 'Motor ELO isolado com presets FIFA 2026, Poisson ajustado para campo neutro, e calibração independente dos modelos de clubes. Disponível apenas em PRO e SHARP.'
    },
    {
      question: 'O que é CLV Tracking?',
      answer: 'Closing Line Value (CLV) mede se as odds que você apostou eram melhores do que as odds de fechamento do mercado — o principal indicador de edge real a longo prazo. Disponível exclusivamente no plano SHARP (R$ 247/mês).'
    },
    {
      question: 'Por que o plano PRO custa R$ 147 e não menos?',
      answer: 'Cada análise consome dados em tempo real de casas sharp (Pinnacle), processamento de IA e infraestrutura de banco de dados. Ferramentas quantitativas sérias de value betting custam entre €50 e €200/mês no mercado europeu. R$ 147 é o ponto onde conseguimos manter a qualidade do serviço sem comprometer os modelos matemáticos.'
    }
  ];

  const handleBackToLanding = () => {
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-[#070708] text-white flex flex-col font-sans select-none overflow-x-hidden antialiased">
      {/* Header Banner */}
      <header className="w-full border-b border-[#1e2330] bg-[#070708]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={handleBackToLanding}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="font-black text-xs text-white">EV</span>
          </div>
          <span className="font-black tracking-widest text-sm uppercase">EVENGINE</span>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleBackToLanding}
            className="text-xs uppercase tracking-wider text-white/50 hover:text-white flex items-center gap-1.5 font-bold transition-colors py-1.5 px-3 rounded-lg hover:bg-white/5 border border-white/5"
          >
            <ArrowLeft size={12} /> Voltar
          </button>
          <a
            href="/login"
            className="text-xs font-black uppercase tracking-widest bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-500 transition-colors"
          >
            Criar Conta Grátis
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-20 px-6 border-b border-[#1e2330] bg-gradient-to-b from-[#0a0a0f] to-[#070708]">
        <div className="max-w-4xl mx-auto text-center">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-500 mb-4 block">
            EDGE MATEMÁTICO VALIDADO
          </span>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight uppercase mb-6 leading-tight">
            Análise de Value Betting com <span className="text-blue-500">Rigor Quantitativo</span>
          </h1>
          <p className="text-sm md:text-base text-white/50 max-w-2xl mx-auto leading-relaxed">
            Modelos ELO, Poisson-Dixon-Coles e Shin calibrados para futebol real. Sem achismo, sem tipster.
          </p>
        </div>
      </section>

      {/* Planos Section (Desktop Comparison Table & Mobile Stack Cards) */}
      <section className="py-24 px-6 max-w-6xl mx-auto w-full flex-grow">
        
        {/* Mobile View: Stacked Cards */}
        <div className="md:hidden space-y-8">
          {plans.map((p) => (
            <div key={p.name} className={`bg-[#0f1117] border-2 ${p.borderColor} rounded-2xl p-6 flex flex-col relative`}>
              {p.badge && (
                <span className={`absolute -top-3.5 left-6 text-[8px] font-black uppercase px-3 py-1 rounded-full text-white tracking-widest ${
                  p.badge === 'MAIS POPULAR' ? 'bg-blue-600' : 'bg-amber-600'
                }`}>
                  {p.badge}
                </span>
              )}
              <div className="mb-6">
                <h3 className="text-lg font-black tracking-wider text-white/90 uppercase flex items-center gap-1.5">
                  {p.name}
                  {p.name === 'PRO' && <Crown size={16} className="text-blue-500 fill-blue-500/20 flex-shrink-0 animate-pulse" />}
                  {p.name === 'SHARP' && <Crown size={16} className="text-amber-500 fill-amber-500/20 flex-shrink-0 animate-pulse" />}
                </h3>
                <div className="mt-2 flex items-baseline gap-1 flex-wrap">
                  <span className="text-3xl font-black">{p.price}</span>
                  <span className="text-xs text-white/40">{p.period}</span>
                </div>
                {p.name === 'PRO' && (
                  <div className="text-[10px] text-emerald-400/70 font-bold mt-1">
                    ou R$1.470/ano · 2 meses grátis
                  </div>
                )}
                {p.name === 'SHARP' && (
                  <div className="text-[10px] text-emerald-400/70 font-bold mt-1">
                    ou R$2.470/ano · 2 meses grátis
                  </div>
                )}
              </div>

              <div className="space-y-4 mb-8">
                {p.features.map((f) => (
                  <div key={f.name} className="flex justify-between items-center py-2 border-b border-[#1e2330]/50 text-xs">
                    <span className="text-white/40 font-medium">{f.name}</span>
                    <span className="font-bold flex items-center gap-1.5">
                      {typeof f.val === 'string' ? (
                        <span className="text-white">{f.val}</span>
                      ) : f.val === true ? (
                        <Check size={14} className="text-[#22c55e]" />
                      ) : (
                        <X size={14} className="text-[#ef4444]" />
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <a
                href={p.link}
                className={`w-full text-center py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all ${
                  p.name === 'PRO'
                    ? 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20'
                    : p.name === 'SHARP'
                    ? 'bg-amber-600 text-white hover:bg-amber-500 hover:shadow-lg hover:shadow-amber-500/20'
                    : 'bg-white/5 text-white hover:bg-white/10 border border-white/5'
                }`}
              >
                {p.cta}
              </a>
            </div>
          ))}
        </div>

        {/* Desktop View: Comparison Table */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-[#1e2330] bg-[#0f1117] shadow-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#1e2330] bg-[#0a0c10]">
                <th className="p-6 text-sm font-black uppercase text-white/40 w-1/4">Recursos</th>
                {plans.map((p) => (
                  <th key={p.name} className="p-6 w-1/4 relative border-l border-[#1e2330]">
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black tracking-wider text-white/90 uppercase flex items-center gap-1.5">
                          {p.name}
                          {p.name === 'PRO' && <Crown size={14} className="text-blue-500 fill-blue-500/20 flex-shrink-0" />}
                          {p.name === 'SHARP' && <Crown size={14} className="text-amber-500 fill-amber-500/20 flex-shrink-0" />}
                        </span>
                        {p.badge && (
                          <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded ${
                            p.badge === 'MAIS POPULAR' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}>
                            {p.badge}
                          </span>
                        )}
                      </div>
                      <div className="mt-4 flex items-baseline gap-1 flex-wrap">
                        <span className="text-3xl font-black text-white">{p.price}</span>
                        <span className="text-xs text-white/30">{p.period}</span>
                      </div>
                      {p.name === 'PRO' && (
                        <div className="text-[10px] text-emerald-400/70 font-bold mt-1">
                          ou R$1.470/ano · 2 meses grátis
                        </div>
                      )}
                      {p.name === 'SHARP' && (
                        <div className="text-[10px] text-emerald-400/70 font-bold mt-1">
                          ou R$2.470/ano · 2 meses grátis
                        </div>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans[0].features.map((feat, fIdx) => (
                <tr 
                  key={feat.name} 
                  className={`border-b border-[#1e2330]/50 transition-colors ${
                    fIdx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'
                  }`}
                >
                  <td className="p-4 text-xs font-semibold text-white/60">{feat.name}</td>
                  {plans.map((p) => {
                    const f = p.features[fIdx];
                    return (
                      <td key={p.name} className="p-4 text-xs font-bold text-center border-l border-[#1e2330]/50">
                        {typeof f.val === 'string' ? (
                          <span className="text-white/80">{f.val}</span>
                        ) : f.val === true ? (
                          <div className="flex justify-center"><Check size={16} className="text-[#22c55e]" /></div>
                        ) : (
                          <div className="flex justify-center"><X size={16} className="text-[#ef4444]" /></div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* CTA Row */}
              <tr className="bg-[#0a0c10]/50">
                <td className="p-6"></td>
                {plans.map((p) => (
                  <td key={p.name} className="p-6 border-l border-[#1e2330] text-center">
                    <a
                      href={p.link}
                      className={`inline-block w-full py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all ${
                        p.name === 'PRO'
                          ? 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20'
                          : p.name === 'SHARP'
                          ? 'bg-amber-600 text-white hover:bg-amber-500 hover:shadow-lg hover:shadow-amber-500/20'
                          : 'bg-white/5 text-white hover:bg-white/10 border border-white/5'
                      }`}
                    >
                      {p.cta} <ChevronRight size={10} className="inline ml-1" />
                    </a>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Explicativo de Limites no PRO */}
        <div className="mt-8 bg-[#0a0d14] rounded-xl p-5 border border-[#1e2330]/50 max-w-4xl mx-auto flex items-start gap-4 text-white/70 text-sm">
          <Info size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-white mb-1.5 uppercase tracking-wider text-xs">Por que existe um limite de 30 análises/dia no PRO?</h4>
            <p className="leading-relaxed mb-2 text-xs md:text-sm text-white/50">
              Cada análise consome chamadas em tempo real à The Odds API e ao modelo de IA. O limite de 30/dia cobre com folga o uso de qualquer apostador profissional (a média é 8-12 análises/dia) e garante que o serviço permaneça estável para todos os assinantes.
            </p>
            <p className="leading-relaxed text-xs md:text-sm text-white/50">
              Precisa de volume maior ou integrações via API? O plano <strong className="text-blue-400">SHARP</strong> remove esse limite.
            </p>
          </div>
        </div>

      </section>

      {/* Paper Trading Obligatory Block */}
      <section className="py-16 px-6 bg-[#0a0d14] border-y border-[#1e2330]">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center md:items-start gap-6">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0">
            <Shield size={24} />
          </div>
          <div className="flex-grow text-center md:text-left">
            <h3 className="text-base font-black uppercase tracking-wider text-white mb-3">
              Por que 30 dias de Paper Trading são obrigatórios?
            </h3>
            <p className="text-sm text-white/55 leading-relaxed">
              Antes de arriscar dinheiro real, o EVENGINE exige 30 dias de simulação. 
              Isso não é burocracia — é o protocolo que separa quem entende value betting 
              de quem vai perder a banca em 2 semanas. Nenhum plano remove esse requisito.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section className="py-24 px-6 max-w-3xl mx-auto w-full">
        <div className="text-center mb-12">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500 mb-2 block">
            SUPORTE E DÚVIDAS
          </span>
          <h2 className="text-2xl font-black uppercase tracking-tight text-white">
            Perguntas Frequentes
          </h2>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => {
            const isOpen = activeFAQ === idx;
            return (
              <div 
                key={idx} 
                className="bg-[#0f1117] border border-[#1e2330] rounded-xl overflow-hidden transition-all duration-200"
              >
                <button
                  onClick={() => setActiveFAQ(isOpen ? null : idx)}
                  className="w-full p-5 text-left flex justify-between items-center text-xs md:text-sm font-bold uppercase tracking-wider text-white/90 hover:text-white transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <HelpCircle size={14} className="text-blue-500" />
                    {faq.question}
                  </span>
                  <ChevronDown 
                    size={16} 
                    className={`text-white/40 transform transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-500' : ''}`} 
                  />
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="p-5 pt-0 border-t border-[#1e2330]/50 text-xs md:text-sm text-white/50 leading-relaxed bg-[#0a0c10]/40">
                        {faq.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-[#1e2330] bg-[#050508] py-12 px-6 mt-auto">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <span className="font-black tracking-widest text-xs uppercase text-white/70 block mb-2">EVENGINE</span>
            <p className="text-[10px] text-white/30 max-w-sm leading-relaxed">
              EVENGINE não é casa de apostas. Não aceita depósitos. Análise quantitativa independente para apostadores profissionais.
            </p>
          </div>
          <div className="flex gap-6 text-[10px] font-bold uppercase tracking-wider text-white/40">
            <a href="#terms" className="hover:text-white transition-colors">Termos de Uso</a>
            <a href="#privacy" className="hover:text-white transition-colors">Política de Privacidade</a>
            <a href="#contact" className="hover:text-white transition-colors">Contato</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
