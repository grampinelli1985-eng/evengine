import React from 'react';
import { DecisaoEngine } from '../types/decisao';
import { 
  ShieldCheck, 
  AlertTriangle, 
  HelpCircle, 
  Activity, 
  TrendingUp, 
  Sparkles, 
  AlertCircle, 
  ArrowUpRight, 
  Percent, 
  Layers, 
  Sliders, 
  Target 
} from 'lucide-react';

export function AnalysisDecisionCard({ decisao, children }: { decisao: DecisaoEngine, children?: React.ReactNode }) {
  if (!decisao) return null;

  const isAprovado = decisao.decisao.status === 'APROVADO';
  const score = decisao.score.valor;

  // Extração de variáveis do motor para cálculo do Score Composto V2.0
  const evVal = decisao.mercado_selecionado?.ev ?? (decisao as any).evExecution ?? (decisao as any).ev ?? (decisao as any).sharp_context?.ev_ajustado ?? 0;

  // ELO-08 (clubes): zona de alerta quando EV supera 10% — cap de clubes é 12%,
  // atingiuTeto dispara em 10.2%. Acima de 10% o modelo começa a divergir do mercado.
  const EV_AVISO_CLUBES = 10;
  const isAvisoEV = isAprovado && evVal > EV_AVISO_CLUBES;
  const scoreEV = evVal >= 15 ? 100 : (evVal >= 3 ? 50 + ((evVal - 3) / 12) * 50 : (evVal >= 0 ? (evVal / 3) * 50 : 0));
  
  const probFinal = decisao.mercado_selecionado?.probabilidade_final ?? 50;
  const probElo = decisao.mercado_selecionado?.probabilidade_elo ?? probFinal;
  const chosenDelta = Math.abs(probFinal - probElo);
  const scoreGP = Math.max(0, 100 - (chosenDelta * 5));

  const tier = (decisao as any).tier ?? 'C';
  const scoreTier = tier === 'A' ? 100 : (tier === 'B' ? 80 : (tier === 'C' ? 40 : 0));

  const scoreConfianca = decisao.sharp_context?.confianca_ajustada ?? (decisao as any).confianca ?? 70;

  const clvDelta = (decisao as any).clv?.delta ?? 0;
  const scoreCLV = clvDelta > 0 ? 100 : (clvDelta < 0 ? 0 : 50);
  
  const oddBet365Manual = decisao.mercado_selecionado?.odd_bet365_manual || decisao.mercado_selecionado?.odd_bet365_publica;
  const oddPinnacle = decisao.mercado_selecionado?.odd_referencia;
  const sanidade = decisao.sharp_context?.sanidade_odds;
  const desvioValido = sanidade ? sanidade.desvio_valido : true;
  let scoreLine = 100;
  if (desvioValido && oddPinnacle && oddBet365Manual && oddBet365Manual > oddPinnacle) {
    const desvioPercentual = (oddBet365Manual - oddPinnacle) / oddPinnacle;
    scoreLine = Math.max(0, 100 - (desvioPercentual / 0.05) * 100);
  } else if (!desvioValido) {
    scoreLine = 0;
  }

  // Cores HSL baseadas no status — âmbar quando EV está em zona de alerta
  const themeColor = isAvisoEV ? '#f59e0b' : isAprovado ? '#00e676' : '#f44336';
  const themeGlow = isAvisoEV ? 'shadow-amber-500/20' : isAprovado ? 'shadow-[#00e676]/20' : 'shadow-[#f44336]/20';
  const themeBg = isAvisoEV ? 'bg-amber-500/10 border-amber-500/20' : isAprovado ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20';

  return (
    <section className="bg-[#0c0c1e]/90 border border-white/[0.08] backdrop-blur-xl rounded-[2.5rem] p-6 sm:p-10 relative overflow-hidden shadow-2xl mb-10">
      {/* Decorative Glow Spots */}
      <div className="absolute -left-20 -top-20 w-72 h-72 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 w-72 h-72 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row items-stretch justify-between gap-8 mb-10 pb-8 border-b border-white/5 relative z-10">
        <div className="flex items-center gap-6">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center shadow-2xl transition-all duration-500 shrink-0 ${
            isAvisoEV ? 'bg-amber-500' : isAprovado ? 'bg-[#00e676]' : 'bg-[#f44336]'
          } ${themeGlow}`}>
            {isAvisoEV ? (
              <AlertTriangle size={40} className="text-[#0c0c1e]" />
            ) : isAprovado ? (
              <ShieldCheck size={40} className="text-[#0c0c1e]" />
            ) : (
              <span className="text-4xl" style={{ fontFamily: 'Segoe UI Emoji' }}>⛔</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-white/5 rounded-full text-[9px] font-black text-white/50 uppercase tracking-[0.25em] border border-white/10">
                Gate v2.0 • Sharp Decision Engine
              </span>
            </div>
            <h3 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter italic leading-none" style={{ color: themeColor }}>
              {decisao.decisao.status}
            </h3>
          </div>
        </div>
        
        {/* JOGO vs APOSTA Quality Indicators */}
        <div className="grid grid-cols-2 gap-4 sm:gap-6 min-w-[280px]">
          {/* JOGO QUALITY (Score Composto) */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 flex flex-col justify-between items-center text-center">
            <span className="text-[9px] text-white/40 uppercase font-black tracking-wider flex items-center gap-1.5 mb-2">
              <Activity size={10} className="text-purple-400" /> Qualidade do Jogo
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-mono font-black" style={{ color: score >= 60 ? '#00e676' : '#f44336' }}>
                {score}
              </span>
              <span className="text-xs font-bold text-white/20">/100</span>
            </div>
            <span className={`text-[8px] font-mono mt-2 px-2 py-0.5 rounded uppercase tracking-wider ${
              score >= 60 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>
              {score >= 60 ? 'Filtro OK' : 'Abaixo 60'}
            </span>
          </div>

          {/* APOSTA QUALITY (Expected Value) */}
          <div className={`rounded-2xl p-4 flex flex-col justify-between items-center text-center border ${
            isAvisoEV ? 'bg-amber-500/[0.04] border-amber-500/20' : 'bg-white/[0.02] border-white/5'
          }`}>
            <span className="text-[9px] text-white/40 uppercase font-black tracking-wider flex items-center gap-1.5 mb-2">
              <TrendingUp size={10} className={isAvisoEV ? 'text-amber-400' : 'text-blue-400'} /> Vantagem (EV)
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-mono font-black" style={{
                color: isAvisoEV ? '#f59e0b' : evVal >= 3 ? '#00e676' : '#f44336'
              }}>
                {evVal > 0 ? '+' : ''}{evVal.toFixed(1)}%
              </span>
            </div>
            <span className={`text-[8px] font-mono mt-2 px-2 py-0.5 rounded uppercase tracking-wider ${
              isAvisoEV
                ? 'bg-amber-500/10 text-amber-400'
                : evVal >= 3 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>
              {isAvisoEV ? 'Valor Elevado' : evVal >= 3 ? 'Valor OK' : 'Sem Valor'}
            </span>
          </div>
        </div>
      </div>

      {/* WEIGHTED SUB-SCORES BREAKDOWN */}
      <div className="mb-8 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden backdrop-blur-md">
        <div className="flex items-center gap-2 mb-6">
          <Sliders size={14} className="text-purple-400" />
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">
            Detalhamento do Score Composto (Pesos GATE V2.0)
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-mono text-[10px]">
          {/* 1. EV (30%) */}
          <div className="bg-white/[0.01] border border-white/[0.03] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-all">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white/60 font-bold uppercase tracking-wider">1. Vantagem EV</span>
              <span className="text-[9px] text-purple-400 font-bold">Peso 30%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${scoreEV}%` }} />
              </div>
              <span className="font-bold text-white shrink-0">{scoreEV.toFixed(0)}/100</span>
            </div>
          </div>

          {/* 2. G->P Convergence (20%) */}
          <div className="bg-white/[0.01] border border-white/[0.03] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-all">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white/60 font-bold uppercase tracking-wider">2. Consenso G→P</span>
              <span className="text-[9px] text-purple-400 font-bold">Peso 20%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${scoreGP}%` }} />
              </div>
              <span className="font-bold text-white shrink-0">{scoreGP.toFixed(0)}/100</span>
            </div>
          </div>

          {/* 3. Liga Tier (15%) */}
          <div className="bg-white/[0.01] border border-white/[0.03] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-all">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white/60 font-bold uppercase tracking-wider">3. Tier de Liga ({tier})</span>
              <span className="text-[9px] text-purple-400 font-bold">Peso 15%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${scoreTier}%` }} />
              </div>
              <span className="font-bold text-white shrink-0">{scoreTier.toFixed(0)}/100</span>
            </div>
          </div>

          {/* 4. Confiança IA (15%) */}
          <div className="bg-white/[0.01] border border-white/[0.03] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-all">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white/60 font-bold uppercase tracking-wider">4. Confiança IA</span>
              <span className="text-[9px] text-purple-400 font-bold">Peso 15%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${scoreConfianca}%` }} />
              </div>
              <span className="font-bold text-white shrink-0">{scoreConfianca.toFixed(0)}/100</span>
            </div>
          </div>

          {/* 5. Sinal CLV (10%) */}
          <div className="bg-white/[0.01] border border-white/[0.03] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-all">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white/60 font-bold uppercase tracking-wider">5. Sinal CLV</span>
              <span className="text-[9px] text-purple-400 font-bold">Peso 10%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-pink-500 rounded-full" style={{ width: `${scoreCLV}%` }} />
              </div>
              <span className="font-bold text-white shrink-0">{scoreCLV.toFixed(0)}/100</span>
            </div>
          </div>

          {/* 6. Line Movement (10%) */}
          <div className="bg-white/[0.01] border border-white/[0.03] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-all">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white/60 font-bold uppercase tracking-wider">6. Line Movement</span>
              <span className="text-[9px] text-purple-400 font-bold">Peso 10%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${scoreLine}%` }} />
              </div>
              <span className="font-bold text-white shrink-0">{scoreLine.toFixed(0)}/100</span>
            </div>
          </div>
        </div>
      </div>

      {/* SHARP CONTEXT ENRICHMENT LAYER v2.0 */}
      {decisao.sharp_context && (
        <div className="mb-8 bg-[#121226]/60 border border-[#2d2d5a] rounded-3xl p-6 relative overflow-hidden backdrop-blur-md">
          {/* Subtle Glow */}
          <div className="absolute -right-20 -top-20 w-44 h-44 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">
                SHARP CONTEXT ENRICHMENT LAYER v2.0 • Checklist Factual
              </h4>
            </div>
            <span className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-[8px] font-mono text-blue-400 uppercase tracking-widest leading-none">
              Validações de Campo Ativas
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 font-mono">
            {/* Bloco 1: Desfalques */}
            <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
              <div>
                <span className="text-[8px] text-white/30 uppercase font-black tracking-widest block mb-1">Bloco 1: Desfalques</span>
                <span className="text-[10px] text-white/80 font-bold leading-tight block">
                  {decisao.sharp_context.desfalques_verificados ? "✓ Verificados" : "⚠️ Não Verificados"}
                </span>
              </div>
              <span className={`text-[8px] font-black uppercase tracking-wider mt-3 px-2 py-0.5 rounded self-start ${
                decisao.sharp_context.desfalques_verificados 
                  ? (decisao.sharp_context.ajuste_probabilidade_aplicado.includes('-4.0pp') ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400')
                  : 'bg-rose-500/10 text-rose-400'
              }`}>
                {decisao.sharp_context.desfalques_verificados 
                  ? (decisao.sharp_context.ajuste_probabilidade_aplicado.includes('-4.0pp') ? 'Baixa Estabilidade' : 'Integridade Alta')
                  : 'Incerteza -3pp'}
              </span>
            </div>

            {/* Bloco 2: Forma Recente */}
            <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
              <div>
                <span className="text-[8px] text-white/30 uppercase font-black tracking-widest block mb-1">Bloco 2: Forma (5j)</span>
                <div className="flex flex-col gap-1 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-white/40 uppercase w-7 font-bold">Casa:</span>
                    <span className="text-[10px] text-white font-bold">{decisao.sharp_context.forma_casa_5j}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-white/40 uppercase w-7 font-bold">Fora:</span>
                    <span className="text-[10px] text-white font-bold">{decisao.sharp_context.forma_visitante_5j}</span>
                  </div>
                </div>
              </div>
              {decisao.sharp_context.motivo_especifico.toLowerCase().includes('mandante sem vitória') || 
               decisao.sharp_context.ajuste_probabilidade_aplicado.toLowerCase().includes('mandante sem vitória') ? (
                <span className="text-[8px] font-black uppercase tracking-wider mt-3 px-2 py-0.5 bg-rose-500/10 text-rose-400 rounded self-start">
                  Mandante &lt; 2V (-3pp)
                </span>
              ) : (
                <span className="text-[8px] font-black uppercase tracking-wider mt-3 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded self-start">
                  Forma Coberta
                </span>
              )}
            </div>

            {/* Bloco 3: Competição */}
            <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
              <div>
                <span className="text-[8px] text-white/30 uppercase font-black tracking-widest block mb-1">Bloco 3: Competição</span>
                <span className="text-[10px] text-white/80 font-bold leading-tight block truncate" title={decisao.sharp_context.contexto_competicao}>
                  {decisao.sharp_context.contexto_competicao}
                </span>
              </div>
              <span className="text-[8px] text-white/30 uppercase font-black tracking-widest block mt-2">
                Ajuste EV: <span className="text-blue-400">{decisao.sharp_context.ajuste_probabilidade_aplicado}</span>
              </span>
            </div>

            {/* Bloco 4: Validação de Confiança & Dados */}
            <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
              <div>
                <span className="text-[8px] text-white/30 uppercase font-black tracking-widest block mb-1">Incerteza do Modelo</span>
                <span className="text-[10px] text-white/80 font-bold leading-tight block">
                  Confiança: {scoreConfianca.toFixed(0)}%
                </span>
              </div>
              <span className={`text-[8px] font-black uppercase tracking-wider mt-3 px-2 py-0.5 rounded self-start ${
                scoreConfianca >= 70 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
              }`}>
                {scoreConfianca >= 70 ? 'Confiança Alta' : 'Inseguro (-pp)'}
              </span>
            </div>

            {/* Bloco 5: Sanidade de Odds e Mapeamento */}
            <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex flex-col justify-between">
              <div>
                <span className="text-[8px] text-white/30 uppercase font-black tracking-widest block mb-1">Bloco 5: Sanidade Odds</span>
                <span className="text-[10px] text-white/80 font-bold leading-tight block">
                  {decisao.sharp_context?.sanidade_odds?.desvio_valido 
                    ? "✓ Válido" 
                    : (decisao.sharp_context?.sanidade_odds?.odd_bet365_final > 0 ? "❌ Falhou" : "ℹ️ Automático")}
                </span>
              </div>
              <span className={`text-[8px] font-black uppercase tracking-wider mt-3 px-2 py-0.5 rounded self-start ${
                decisao.sharp_context?.sanidade_odds?.desvio_valido
                  ? (decisao.sharp_context.sanidade_odds.passo3_desvio === 'DESVIO_CONFIRMADO' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400')
                  : (decisao.sharp_context?.sanidade_odds?.odd_bet365_final > 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-blue-500/10 text-blue-400')
              }`}>
                {decisao.sharp_context?.sanidade_odds?.desvio_valido
                  ? (decisao.sharp_context.sanidade_odds.passo3_desvio === 'DESVIO_CONFIRMADO' ? 'Confirmado' : 'Íntegro')
                  : (decisao.sharp_context?.sanidade_odds?.odd_bet365_final > 0
                      ? (decisao.sharp_context?.sanidade_odds?.passo1_limite === 'ODD_IMPLAUSIVEL' ? 'Implausível' : 'Inversão')
                      : 'Público / Auto')}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="text-[9px] font-mono text-white/50 leading-normal text-left">
              <span className="text-white/80 font-bold uppercase">Resultado do Check Factual:</span> {decisao.sharp_context.motivo_especifico}
            </div>
            {decisao.sharp_context.probabilidade_final_casa !== undefined && (
              <div className="flex items-center gap-2 font-mono shrink-0">
                <span className="text-[9px] text-white/30 uppercase font-bold">Prob. Mandante Pós-Ajuste:</span>
                <span className="text-sm font-black text-blue-400">{decisao.sharp_context.probabilidade_final_casa.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DECISION ACTION / RESOLUTION BOX */}
      {isAprovado ? (
        <div className={`border rounded-2xl p-6 relative overflow-hidden ${
          isAvisoEV
            ? 'bg-amber-500/[0.03] border-amber-500/20'
            : 'bg-emerald-500/[0.03] border-emerald-500/20'
        }`}>
          {/* Corner Glow Accent */}
          <div className={`absolute right-0 bottom-0 w-24 h-24 rounded-full blur-2xl pointer-events-none ${
            isAvisoEV ? 'bg-amber-500/5' : 'bg-emerald-500/5'
          }`} />

          {/* ELO-08: Aviso de EV elevado próximo ao cap de clubes */}
          {isAvisoEV && (
            <div className="mb-5 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5">
              <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest block mb-0.5">
                  Aviso — EV Elevado ({evVal.toFixed(1)}%)
                </span>
                <p className="text-[10px] text-amber-300/70 font-mono leading-relaxed">
                  EV acima de {EV_AVISO_CLUBES}% se aproxima do teto realista de clubes (12%).
                  Verifique se as odds Pinnacle não moveram desde a análise antes de registrar.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <div className="w-full lg:w-auto">
              <span className={`text-[10px] uppercase font-black tracking-[0.3em] block mb-2 text-center lg:text-left ${
                isAvisoEV ? 'text-amber-400/60' : 'text-emerald-400/50'
              }`}>
                ENTRADA RECOMENDADA
              </span>
              <div className="text-2xl font-black text-white mb-2 flex items-center gap-2">
                <Target className="text-emerald-400 shrink-0" size={24} />
                {decisao.mercado_selecionado.nome}
              </div>
              
              {decisao.modo_auditoria && (
                <div className="border border-yellow-600/30 bg-yellow-950/20 p-4 rounded-xl my-3 max-w-md">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    <span className="text-yellow-500 font-bold text-xs uppercase tracking-wider">
                      ⚠️ MODO AUDITORIA - ODD COM EV NEGATIVO ({decisao.aviso_ev_negativo !== undefined && decisao.aviso_ev_negativo !== null ? (decisao.aviso_ev_negativo * 100).toFixed(1) : '—'}%)
                    </span>
                  </div>
                  <p className="text-yellow-300/80 text-[10px] mt-2 font-mono">
                    Modo: AUDITORIA APENAS - Operando fora dos limites de segurança quantitativos por comando explícito do usuário.
                  </p>
                </div>
              )}
              
              <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-[11px] font-mono">
                <div className="font-bold text-white/60">
                  Probabilidade Alinhada: <span className="text-blue-400">{decisao.mercado_selecionado.probabilidade_final.toFixed(1)}%</span>
                </div>
                <div className="font-bold text-white/60">
                  Odd Referência (Pinnacle): <span className="text-blue-400">{decisao.mercado_selecionado.odd_referencia != null ? decisao.mercado_selecionado.odd_referencia.toFixed(2) : '—'}</span>
                </div>
                <div className="font-bold text-white/60">
                  Odd Mínima Sugerida: <span className="text-emerald-400">{decisao.mercado_selecionado.break_even_odd.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center lg:items-end shrink-0 border-t lg:border-t-0 lg:border-l border-white/5 pt-4 lg:pt-0 lg:pl-8">
              <span className="text-[10px] text-white/30 uppercase font-black tracking-[0.25em] block mb-2">Stake Recomendada</span>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-mono font-black text-white">
                  {decisao.stake.percentual.toFixed(2)}%
                </span>
                <span className="text-lg font-bold text-emerald-400 italic">
                  R$ {decisao.stake.valor_reais.toFixed(2)}
                </span>
              </div>
              <span className="text-[8px] text-white/30 font-mono mt-1">Calculado pelo Critério de Kelly</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Main Block Box */}
          <div className="p-6 bg-rose-500/[0.03] border border-rose-500/20 rounded-2xl relative overflow-hidden">
            <div className="absolute right-0 bottom-0 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />
            
            <p className="text-[11px] font-bold text-rose-500 uppercase tracking-widest leading-relaxed mb-4 flex items-center gap-2">
              <AlertCircle size={14} className="text-rose-500" />
              SISTEMA DE DECISÃO VETOU ESTA OPERAÇÃO (Sinal Vermelho)
            </p>
            
            <ul className="text-[11px] font-mono text-rose-300/80 list-none pl-0 space-y-3">
              {(() => {
                const getGateTarget = (motivoStr: string) => {
                  const m = motivoStr.toUpperCase();
                  if (m.includes('EV') || m.includes('VALOR') || m.includes('B1') || m.includes('B-EV')) return { sectionId: 'os-9-gates', subsectionId: 'gate-b1' };
                  if (m.includes('KELLY') || m.includes('STAKE') || m.includes('B2')) return { sectionId: 'os-9-gates', subsectionId: 'gate-b2' };
                  if (m.includes('CONVERGÊNCIA') || m.includes('DIVERGENTE') || m.includes('POISSON') || m.includes('B3')) return { sectionId: 'os-9-gates', subsectionId: 'gate-b3' };
                  if (m.includes('LIGA') || m.includes('TIER') || m.includes('B5')) return { sectionId: 'os-9-gates', subsectionId: 'resumo-gates' };
                  if (m.includes('LINE') || m.includes('SHARP') || m.includes('VARIAC') || m.includes('B7')) return { sectionId: 'os-9-gates', subsectionId: 'gate-b7' };
                  if (m.includes('UNDERDOG') || m.includes('ZEBRA') || m.includes('IA VIÉS') || m.includes('UNDER') || m.includes('B-UNDERDOG-CALIBRATION')) return { sectionId: 'os-9-gates', subsectionId: 'gate-b-underdog' };
                  if (m.includes('DADOS') || m.includes('FACTUAL') || m.includes('B-DADOS')) return { sectionId: 'os-9-gates', subsectionId: 'resumo-gates' };
                  return { sectionId: 'os-9-gates' };
                };
                
                const motivos = decisao.score.motivos_bloqueio.length > 0 
                  ? decisao.score.motivos_bloqueio 
                  : [decisao.sharp_context?.motivo_especifico ?? "Critérios factuais insuficientes ou EV ruim."];

                return motivos.map((motivo, i) => {
                  const target = getGateTarget(motivo);
                  return (
                    <li key={i} className="flex items-center justify-between gap-4 flex-wrap bg-white/[0.01] border border-white/5 p-3 rounded-xl hover:bg-white/[0.03] transition-all">
                      <span className="text-rose-200/90 leading-normal flex-1">{motivo}</span>
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('evengine_navigate_docs_tab'));
                          setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('evengine_navigate_docs', {
                              detail: target
                            }));
                          }, 150);
                        }}
                        title="Aprender sobre esta trava de segurança na documentação"
                        className="text-[9px] font-black text-blue-400 hover:text-blue-300 uppercase tracking-wider flex items-center gap-1 cursor-pointer bg-white/[0.03] hover:bg-white/[0.08] px-2.5 py-1 rounded border border-white/5 transition-all shrink-0"
                      >
                        <span>📚 Ver Regra</span>
                      </button>
                    </li>
                  );
                });
              })()}
            </ul>
          </div>

          {/* Alternative Market Suggestion Box */}
          {decisao.sharp_context?.mercado_alternativo && (
            <div className="p-6 bg-blue-500/[0.03] border border-blue-500/20 rounded-2xl relative overflow-hidden">
              <div className="absolute -right-10 -bottom-10 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
              
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest block mb-1">
                    💡 Oportunidade Alternativa Encontrada
                  </span>
                  <p className="text-[11px] text-white/50 font-mono mb-3">
                    O mercado principal ({decisao.mercado_selecionado?.nome || 'calculado'}) falhou no portão matemático, mas identificamos uma alternativa com EV positivo:
                  </p>
                  <div className="text-lg font-black text-white flex items-center gap-2">
                    <Sparkles className="text-blue-400" size={16} />
                    {decisao.sharp_context.mercado_alternativo.nome}
                  </div>
                </div>

                <div className="flex gap-4 shrink-0 font-mono text-[11px] bg-white/[0.02] border border-white/5 p-3 rounded-xl">
                  <div>
                    <span className="text-white/40 block text-[8px] uppercase font-bold tracking-wider">Odd Pin</span>
                    <span className="text-white font-black text-sm">{decisao.sharp_context.mercado_alternativo.odd != null ? decisao.sharp_context.mercado_alternativo.odd.toFixed(2) : '—'}</span>
                  </div>
                  <div className="border-l border-white/5 pl-4">
                    <span className="text-white/40 block text-[8px] uppercase font-bold tracking-wider">Edge EV</span>
                    <span className="text-emerald-400 font-black text-sm">{decisao.sharp_context.mercado_alternativo.ev != null ? `+${decisao.sharp_context.mercado_alternativo.ev.toFixed(1)}%` : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {children}
    </section>
  );
}
