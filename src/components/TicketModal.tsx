import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Ticket, Copy, Check, ChevronRight, TrendingUp, 
  Search, ShieldCheck, AlertTriangle 
} from 'lucide-react';
import { Match, AnalysisResponse } from '../types';
import { TicketPick, TicketGenerationService } from '../services/ticketGenerationService';

interface TicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  matches: Match[];
  analyses: Record<string, AnalysisResponse>;
  bancaAtual?: number;
}


const ticketService = new TicketGenerationService();

interface TicketItem {
  match: Match;
  type: string;
  probability: number;
  odd: number;
}

export default function TicketModal({ isOpen, onClose, matches, analyses, bancaAtual = 1000 }: TicketModalProps) {
  const [copied, setCopied] = useState(false);

  const ticketItems: TicketItem[] = [];

  const partidasAprovadas: Match[] = [];
  const partidasBloqueadas: any[] = [];

  matches.forEach(match => {
    const analysis = analyses[match.id];
    const foiAprovadoPeloGate = analysis?.tipsterEngine?.status === 'APROVADO';

    if (!foiAprovadoPeloGate) {
      if (analysis?.tipsterEngine) {
        partidasBloqueadas.push({
          partida: analysis,
          id: match.id,
          home_team: match.home_team,
          away_team: match.away_team,
          motivo: analysis?.tipsterEngine?.bloqueio?.motivo ?? 'Não aprovada pelo Gate v2.0'
        });
      }
      return;
    }

    partidasAprovadas.push(match);
  });

  partidasAprovadas.forEach(match => {
    const analysis = analyses[match.id];
    if (analysis) {
      const potentials = [
        { type: 'Over 1.5 Gols', prob: analysis.gols.over15.probabilidade, odd: 1.35 },
        { type: 'Over 2.5 Gols', prob: analysis.gols.over25.probabilidade, odd: 1.85 },
        { type: 'Casa ou Empate', prob: analysis.dupla_chance['1X'].probabilidade, odd: 1.40 },
        { type: 'Visitante ou Empate', prob: analysis.dupla_chance['X2'].probabilidade, odd: 1.45 },
      ];
      
      const best = potentials.sort((a, b) => b.prob - a.prob)[0];

      if (best) {
        const mercadoRecomendado = analysis.tipsterEngine?.mercado?.nome ?? best.type;
        const probRecomendada = analysis.tipsterEngine?.mercado?.probabilidade_ia ?? best.prob;
        const oddRecomendada = analysis.tipsterEngine?.mercado?.odd ?? best.odd;

        ticketItems.push({ match, type: mercadoRecomendado, probability: probRecomendada, odd: oddRecomendada });
      }

      // Removido checks manuais de escanteios/finalizações para confiar no Gate
    }
  });

  const copyTicket = () => {
    const text = ticketItems.map(item => {
      const isGoals = item.type.includes('Gols') || item.type.includes('Ambos') || item.type.includes('Over') || item.type.includes('btb');
      const emoji = isGoals ? '⚽' : '🎯';
      return `${item.match.home_team} vs ${item.match.away_team}\n${emoji} Palpite: ${item.type} (${Math.round(item.probability)}%)\n`;
    }).join('\n') + '\nGerado por EVEngine AI';
    
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard API indisponível (iframe, HTTP, iOS) — falha silenciosa
    });
  };

  const analyzedCount = Object.keys(analyses).filter(id => matches.some(m => m.id === id)).length;
  const totalCount = matches.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <div translate="no" className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4 bg-black/90 backdrop-blur-sm">
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="relative w-full max-w-2xl bg-[#141416] border border-white/[0.08] rounded-none sm:rounded-[2.5rem] shadow-2xl overflow-hidden h-full sm:max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="p-5 pb-2 sm:p-8 sm:pb-4 flex items-center justify-between flex-shrink-0">

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
                  <Ticket size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white tracking-tight uppercase">Bilhete Diário</h2>
                  <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mt-0.5">Filtro de Alta Confiança {'>='} 75%</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/40 transition-colors border border-white/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="px-8 mb-4">
               <div className="flex justify-between text-[8px] font-black text-white/20 uppercase tracking-[0.2em] mb-2">
                  <span>Partidas Analisadas</span>
                  <span>{analyzedCount}/{totalCount}</span>
               </div>
               <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div key="progress-bar" className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${(analyzedCount/totalCount)*100}%` }} />
               </div>
            </div>

            {/* List */}
            <div className="p-8 pt-4 overflow-y-auto flex-1 space-y-4 custom-scrollbar">
              {/* Aviso de Bloqueio do Gate */}
              {partidasBloqueadas.length > 0 && (
                <div style={{
                  background: '#1a0505',
                  border: '1px solid #f4433644',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 16
                }}>
                  <div style={{ color: '#f44336', fontWeight: 700, fontSize: 13 }}>
                    ⛔ {partidasBloqueadas.length} partida(s) removida(s) pelo Gate v2.0
                  </div>
                  {partidasBloqueadas.map((m) => (
                    <div key={m.id} style={{ color: '#888', fontSize: 11, marginTop: 4 }}>
                      · {m.home_team} vs {m.away_team}:
                      {' '}{m.motivo}
                    </div>
                  ))}
                </div>
              )}

              <AnimatePresence mode="wait">
                {partidasAprovadas.length === 0 ? (
                  <div style={{
                    textAlign: 'center', padding: 32,
                    color: '#f44336', fontFamily: 'monospace'
                  }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⛔</div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      BILHETE BLOQUEADO
                    </div>
                    <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
                      Nenhuma partida selecionada foi aprovada pelo Gate v2.0.
                      Aguarde partidas com critérios suficientes.
                    </div>
                  </div>
                ) : (
                  <motion.div 
                    key="ticket-list-content"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col gap-4"
                  >
                    <div className="grid gap-3">
                      <div className="relative pl-12 pr-4 space-y-4 py-8">
                        {/* Vertical Connecting Line */}
                        <div className="absolute left-[23px] top-12 bottom-12 w-[1px] bg-white/10" />
                        
                        {ticketItems.map((item, idx) => {
                          const isSameAsPrevious = idx > 0 && ticketItems[idx - 1].match.id === item.match.id;
                          const isGoals = item.type.includes('Gols') || item.type.includes('Ambos') || item.type.includes('Over') || item.type.includes('btb');
                          
                          return (
                            <motion.div 
                              key={`${item.match.id}-${idx}`}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: idx * 0.1 }}
                              className={`relative ${isSameAsPrevious ? 'pt-2' : 'pt-6'}`}
                            >
                              <div className={`absolute -left-[34px] top-[14px] w-[11px] h-[11px] rounded-full bg-[#141416] border-2 ${isGoals ? 'border-emerald-500/40' : 'border-blue-600/40'} flex items-center justify-center z-10`}>
                                 <div className={`w-1.5 h-1.5 rounded-full ${isGoals ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                              </div>

                              <div className="flex justify-between items-center group">
                                 <div className="flex-1 space-y-2">
                                    {!isSameAsPrevious && (
                                      <div className="mb-2">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.2em]">{item.match.sport_title}</span>
                                          <div className="w-1 h-1 rounded-full bg-white/5" />
                                          <span className="text-[8px] font-black text-blue-500/40 uppercase tracking-[0.2em]">Match ID: {item.match.id.substring(0, 4)}</span>
                                        </div>
                                        <h3 className="text-sm font-black text-white tracking-tight uppercase">
                                          {item.match.home_team} <span className="text-white/10 mx-1">X</span> {item.match.away_team}
                                        </h3>
                                      </div>
                                    )}
                                    
                                    <div className={`flex items-center gap-2.5 bg-white/[0.02] border border-white/5 rounded-xl px-4 py-2.5 w-fit transition-all ${isGoals ? 'group-hover:border-emerald-500/30' : 'group-hover:border-blue-500/30'}`}>
                                       {isGoals ? (
                                         <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-md text-[8px] font-black uppercase tracking-wider flex items-center gap-1">
                                           <span>⚽</span> GOLS
                                         </span>
                                       ) : (
                                         <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                                       )}
                                       <span className="text-[10px] text-white/70 font-black uppercase tracking-widest">
                                         {item.type}
                                       </span>
                                    </div>
                                 </div>

                                 <div className="text-right min-w-[80px]">
                                    <div className="flex items-baseline justify-end gap-1">
                                      <span className="text-xl font-mono font-black text-white">{Math.round(item.probability)}</span>
                                      <span className="text-[10px] font-black text-white/20">%</span>
                                    </div>
                                    {!isSameAsPrevious && <p className="text-[7px] text-white/10 font-black uppercase tracking-[0.2em] mt-1">IA Confidence</p>}
                                 </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4 p-6 bg-blue-600/5 border border-blue-500/10 rounded-3xl">
                      {(() => {
                        const selectedAnalyses = matches.map(m => ({
                          ...analyses[m.id],
                          id: m.id,
                          home_team: m.home_team,
                          away_team: m.away_team
                        }));

                        const analysesForTicket = selectedAnalyses.map(a => ({
                          // Garantir que tipsterEngine está presente
                          tipsterEngine: a?.tipsterEngine,
                          // Mapear campos de time corretamente
                          home_team: (a as any)?.matchData?.home_team
                            ?? a?.home_team
                            ?? (a as any)?.homeTeam
                            ?? 'Time Casa',
                          away_team: (a as any)?.matchData?.away_team
                            ?? a?.away_team
                            ?? (a as any)?.awayTeam
                            ?? 'Time Fora',
                          // Preservar todos os outros campos
                          ...a
                        }));

                        const validation = ticketService.generateTicket(
                          analysesForTicket,
                          bancaAtual
                        );
                        const ticket = validation.data;
                        


                        return (
                          <>
                            <div className="flex gap-4 mb-4">
                              <TrendingUp className="text-blue-500 shrink-0" size={20} />
                              <div>
                                <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Estratégia Neural</h4>
                                <p className="text-[11px] text-white/40 leading-relaxed font-medium">
                                  {ticket?.conselho ? <span>Perfil: <span>{ticket.conselho}</span>. </span> : ''}
                                  <span>O bilhete consolidou <span>{ticketItems.length}</span> eventos. Odd Total: <span>{ticket?.odds_total?.toFixed(2) ?? '---'}</span>.</span>
                                </p>

                              </div>
                            </div>

                            {ticket && (
                              <div className="grid grid-cols-1 gap-3 mb-4">
                                <div className="p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl flex items-center justify-between">
                                  <span className="text-[8px] text-white/20 uppercase font-black tracking-widest">Stake Recomendada</span>
                                  <span className="text-lg font-mono font-black text-emerald-400">
                                    R$ {(() => {
                                      const firstId = ticketItems[0]?.match?.id;
                                      const firstAnalysis = firstId ? analyses[firstId] : null;
                                      
                                      // Usar sempre stake calculada para o bilhete múltiplo
                                      const stakeValue = ticket.stake_recomendado;

                                      return stakeValue != null ? stakeValue.toFixed(2) : '0.00';
                                    })()}
                                  </span>
                                </div>
                              </div>
                            )}

                            {!validation.success && (
                              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2">
                                <ShieldCheck size={14} className="text-amber-500" />
                                <span className="text-[9px] text-amber-500/80 font-bold uppercase tracking-widest">{validation.error}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="p-8 pt-0 grid grid-cols-2 gap-4 flex-shrink-0">
               <button 
                onClick={copyTicket}
                disabled={ticketItems.length === 0}
                className="py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 disabled:opacity-30"
               >
                 {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                 <span>{copied ? 'Copiado!' : 'Copiar Bilhete'}</span>
               </button>

               <button 
                onClick={onClose}
                className="py-4 bg-white hover:bg-neutral-200 text-black rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2"
               >
                 <span>Fechar</span>
                 <ChevronRight size={14} />
               </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
