import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Zap, Shield, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { WCMatch, WCAnalysisResult } from '../../services/worldCup/wcTypes';
import { getWCTeamRating } from '../../services/worldCup/wcEloService';

interface WorldCupMatchCardProps {
  match: WCMatch;
  analysis?: WCAnalysisResult;
  isAnalyzing?: boolean;
  onAnalyze: (match: WCMatch) => void;
}

const TEAM_PT: Record<string, string> = {
  'Brazil': 'Brasil',
  'Argentina': 'Argentina',
  'France': 'França',
  'England': 'Inglaterra',
  'Spain': 'Espanha',
  'Germany': 'Alemanha',
  'Portugal': 'Portugal',
  'Netherlands': 'Holanda',
  'Belgium': 'Bélgica',
  'Italy': 'Itália',
  'Croatia': 'Croácia',
  'Uruguay': 'Uruguai',
  'Colombia': 'Colômbia',
  'Mexico': 'México',
  'United States': 'Estados Unidos',
  'USA': 'Estados Unidos',
  'Canada': 'Canadá',
  'Morocco': 'Marrocos',
  'Senegal': 'Senegal',
  'Japan': 'Japão',
  'South Korea': 'Coreia do Sul',
  'Australia': 'Austrália',
  'Serbia': 'Sérvia',
  'Switzerland': 'Suíça',
  'Denmark': 'Dinamarca',
  'Poland': 'Polônia',
  'Ecuador': 'Equador',
  'Ghana': 'Gana',
  'Cameroon': 'Camarões',
  'Tunisia': 'Tunísia',
  'Iran': 'Irã',
  'Saudi Arabia': 'Arábia Saudita',
  'Qatar': 'Catar',
  'Costa Rica': 'Costa Rica',
  'Wales': 'País de Gales',
  'Chile': 'Chile',
  'Peru': 'Peru',
  'Venezuela': 'Venezuela',
  'Bolivia': 'Bolívia',
  'Paraguay': 'Paraguai',
  'Egypt': 'Egito',
  'Nigeria': 'Nigéria',
  'Algeria': 'Argélia',
  'Czech Republic': 'República Tcheca',
  'Austria': 'Áustria',
  'Turkey': 'Turquia',
  'Ukraine': 'Ucrânia',
  'Hungary': 'Hungria',
  'Slovakia': 'Eslováquia',
  'Scotland': 'Escócia',
  'Romania': 'Romênia',
  'South Africa': 'África do Sul',
  'New Zealand': 'Nova Zelândia',
  'Jamaica': 'Jamaica',
  'Panama': 'Panamá',
  'Honduras': 'Honduras',
  'El Salvador': 'El Salvador',
  'Guatemala': 'Guatemala',
  'Trinidad and Tobago': 'Trinidad e Tobago',
  'Ivory Coast': 'Costa do Marfim',
  "Côte d'Ivoire": 'Costa do Marfim',
  'Mali': 'Mali',
  'Guinea': 'Guiné',
  'Burkina Faso': 'Burkina Faso',
  'Zambia': 'Zâmbia',
  'Angola': 'Angola',
  'Congo DR': 'Congo RD',
  'Kenya': 'Quênia',
  'Tanzania': 'Tanzânia',
  'Uganda': 'Uganda',
  'Iraq': 'Iraque',
  'Jordan': 'Jordânia',
  'United Arab Emirates': 'Emirados Árabes',
  'China': 'China',
  'India': 'Índia',
  'Thailand': 'Tailândia',
  'Vietnam': 'Vietnã',
  'Indonesia': 'Indonésia',
  'Philippines': 'Filipinas',
};

function ptBR(name: string): string {
  return TEAM_PT[name] ?? name;
}

const PHASE_LABEL: Record<string, string> = {
  grupos: 'Fase de Grupos',
  oitavas: 'Oitavas de Final',
  quartas: 'Quartas de Final',
  semi: 'Semifinal',
  final: 'Final',
  eliminatorias: 'Eliminatórias',
};

const PHASE_COLOR: Record<string, string> = {
  grupos: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  oitavas: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  quartas: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  semi: 'text-red-400 bg-red-500/10 border-red-500/20',
  final: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  eliminatorias: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
};

export default function WorldCupMatchCard({ match, analysis, isAnalyzing, onAnalyze }: WorldCupMatchCardProps) {
  const [expanded, setExpanded] = useState(false);

  const homeRating = getWCTeamRating(match.home_team);
  const awayRating = getWCTeamRating(match.away_team);

  const matchDate = new Date(match.commence_time);
  const dateStr = matchDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const timeStr = matchDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const gate = analysis?.gate;
  const elo = analysis?.elo;
  const poisson = analysis?.poisson;

  const phaseKey = match.phase ?? 'grupos';
  const phaseClass = PHASE_COLOR[phaseKey] ?? PHASE_COLOR.grupos;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#0d0d10] border border-white/[0.07] hover:border-white/[0.14] rounded-[2rem] overflow-hidden transition-all group"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <span className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${phaseClass}`}>
            {PHASE_LABEL[phaseKey] ?? phaseKey}
            {match.group ? ` · Grupo ${match.group}` : ''}
          </span>
          <span className="text-[9px] font-mono text-white/30 font-bold">
            {dateStr} · {timeStr}
          </span>
        </div>

        {/* Teams */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 text-center">
            <div className="text-sm font-black text-white uppercase tracking-tight truncate">{ptBR(match.home_team)}</div>
            <div className="text-[8px] text-white/20 font-mono mt-0.5">ELO {homeRating}</div>
          </div>
          <div className="shrink-0 px-3">
            <span className="text-[10px] font-black text-white/10 italic">vs</span>
          </div>
          <div className="flex-1 text-center">
            <div className="text-sm font-black text-white uppercase tracking-tight truncate">{ptBR(match.away_team)}</div>
            <div className="text-[8px] text-white/20 font-mono mt-0.5">ELO {awayRating}</div>
          </div>
        </div>
      </div>

      {/* Probability Bars (ELO) */}
      {elo && (
        <div className="px-5 py-3 border-t border-white/[0.04]">
          <div className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-2">Probabilidades ELO</div>
          <div className="flex gap-1 h-1.5 rounded-full overflow-hidden">
            <div className="bg-blue-500 transition-all" style={{ width: `${elo.probabilidades.casa}%` }} />
            <div className="bg-white/20 transition-all" style={{ width: `${elo.probabilidades.empate}%` }} />
            <div className="bg-orange-500 transition-all" style={{ width: `${elo.probabilidades.fora}%` }} />
          </div>
          <div className="flex justify-between mt-1.5 text-[8px] font-mono">
            <span className="text-blue-400">{elo.probabilidades.casa}%</span>
            <span className="text-white/30">{elo.probabilidades.empate}%</span>
            <span className="text-orange-400">{elo.probabilidades.fora}%</span>
          </div>
        </div>
      )}

      {/* Gate Badge + Expand */}
      {gate && (
        <div className="px-5 py-3 border-t border-white/[0.04]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {gate.status === 'APROVADO' ? (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                  <Zap size={10} className="text-emerald-400 fill-emerald-400" />
                  <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">Aprovado</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 border border-rose-500/20 rounded-full">
                  <Shield size={10} className="text-rose-400" />
                  <span className="text-[8px] font-black text-rose-400 uppercase tracking-widest">
                    {gate.bloqueio?.codigo ?? 'Bloqueado'}
                  </span>
                </div>
              )}

              {gate.status === 'APROVADO' && (
                <div className="flex items-center gap-1">
                  <TrendingUp size={10} className="text-emerald-500" />
                  <span className="text-[9px] font-mono font-black text-emerald-400">
                    EV {gate.mercado.ev > 0 ? '+' : ''}{gate.mercado.ev.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => setExpanded(e => !e)}
              className="text-white/20 hover:text-white/60 transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* Expanded Details */}
      {expanded && analysis && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="border-t border-white/[0.04] px-5 py-4 space-y-4"
        >
          {/* Mercado recomendado */}
          {gate?.status === 'APROVADO' && (
            <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
              <div className="text-[8px] text-white/30 uppercase font-black tracking-widest mb-1">Mercado Recomendado</div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-white uppercase">{gate.mercado.nome}</span>
                <div className="text-right">
                  <div className="text-[10px] font-mono font-black text-emerald-400">Odd {gate.mercado.odd.toFixed(2)}</div>
                  <div className="text-[8px] text-white/20 font-mono">{gate.mercado.probabilidade_ia}% conf.</div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-white/[0.04] flex justify-between text-[8px] font-mono">
                <span className="text-white/30">Stake sugerida</span>
                <span className="text-white/70 font-black">R$ {gate.stake.valor_reais} ({gate.stake.stake_final.toFixed(1)}% banca)</span>
              </div>
            </div>
          )}

          {/* Bloqueio */}
          {gate?.status === 'BLOQUEADO' && gate.bloqueio && (
            <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl">
              <div className="text-[8px] text-rose-400 uppercase font-black tracking-widest mb-1">{gate.bloqueio.codigo}</div>
              <p className="text-[10px] text-white/40 leading-relaxed">{gate.bloqueio.motivo}</p>
            </div>
          )}

          {/* Poisson */}
          {poisson && (
            <div>
              <div className="text-[8px] text-white/20 uppercase font-black tracking-widest mb-2">Poisson WC (λ calibrado)</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Over 1.5', value: poisson.over15.probabilidade },
                  { label: 'Over 2.5', value: poisson.over25.probabilidade },
                  { label: 'BTTS', value: poisson.btts.probabilidade },
                ].map(item => (
                  <div key={item.label} className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-2 text-center">
                    <div className="text-[8px] text-white/30 uppercase font-bold">{item.label}</div>
                    <div className="text-[13px] font-mono font-black text-white mt-0.5">{item.value}%</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[8px] font-mono text-white/20">
                λ {ptBR(match.home_team)}: {poisson.lambda_home} · λ {ptBR(match.away_team)}: {poisson.lambda_away}
                · Placar mais prov.: <span className="text-white/50 font-black">{poisson.resultado_mais_provavel}</span>
              </div>
            </div>
          )}

          {/* Alertas */}
          {gate?.alertas && gate.alertas.length > 0 && (
            <div className="space-y-1">
              {gate.alertas.map((alerta, i) => (
                <div key={i} className="text-[9px] text-amber-400/70 flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">⚠</span>
                  <span>{alerta}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Action Button */}
      <div className="px-5 pb-5 pt-2">
        <button
          onClick={() => onAnalyze(match)}
          disabled={isAnalyzing}
          className="w-full py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all
            bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/60 hover:text-white
            disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isAnalyzing ? (
            <>
              <div className="w-3 h-3 border border-t-white/60 rounded-full animate-spin" />
              Analisando...
            </>
          ) : analysis ? (
            'Re-analisar'
          ) : (
            'Analisar Partida'
          )}
        </button>
      </div>
    </motion.div>
  );
}
