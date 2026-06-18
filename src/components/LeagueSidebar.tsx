/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from 'motion/react';
import { X, Trophy, ChevronRight, Globe, LayoutGrid, Zap, Flame, Shield, Activity, Crown, Star, Sun, Compass, Award } from 'lucide-react';
import { LEAGUES, Match } from '../types';

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

interface LeagueSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLeagues: string[];
  onToggleLeague: (key: string) => void;
  matches: Match[];
}

export default function LeagueSidebar({ isOpen, onClose, selectedLeagues, onToggleLeague, matches }: LeagueSidebarProps) {
  const getMatchCount = (key: string) => {
    return matches.filter(m => m.sport_key === key).length;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] lg:hidden"
          />

          {/* Sidebar Area */}
          <motion.div
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed left-0 top-0 bottom-0 w-[280px] sm:w-80 bg-[#0d0d0f] border-r border-white/10 z-[101] flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <LayoutGrid size={18} className="text-white" />
                </div>
                <h2 className="text-lg font-bold text-white tracking-tight uppercase">Ligas & Competições</h2>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors text-white/40 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
              <button
                onClick={() => onToggleLeague('all')}
                className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between group ${
                  selectedLeagues.includes('all')
                    ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.1)]'
                    : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg transition-all ${selectedLeagues.includes('all') ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]' : 'bg-white/5 text-white/20 group-hover:text-white/40'}`}>
                    <LayoutGrid size={18} />
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-widest ${selectedLeagues.includes('all') ? 'text-blue-400' : 'text-white/40 group-hover:text-white/60'}`}>
                    Todas as Ligas
                  </span>
                </div>
                <div className="relative">
                  <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-full border ${
                    selectedLeagues.includes('all')
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      : 'bg-white/5 text-white/40 border-white/10'
                  }`}>
                    {matches.length}
                  </span>
                  {selectedLeagues.includes('all') && (
                    <motion.div 
                      layoutId="badge-glow-all"
                      className="absolute inset-0 bg-blue-500/20 blur-md rounded-full -z-10"
                    />
                  )}
                </div>
              </button>

              <div className="py-4">
                <div className="h-[1px] bg-white/5 w-full" />
              </div>

              {LEAGUES.map((league) => {
                const isSelected = selectedLeagues.includes(league.key);
                const count = getMatchCount(league.key);
                const Icon = leagueIcons[league.symbol as string] || Trophy;
                
                return (
                  <button
                    key={league.key}
                    onClick={() => onToggleLeague(league.key)}
                    className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between group ${
                      isSelected
                        ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.1)]'
                        : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg transition-colors ${isSelected ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]' : 'bg-white/5 text-white/20 group-hover:text-white/40'}`}>
                        <Icon size={18} />
                      </div>
                      <div className="text-left">
                        <span className={`block text-xs font-bold uppercase tracking-widest leading-none mb-1 ${isSelected ? 'text-blue-400' : 'text-white/40 group-hover:text-white/60'}`}>
                          {league.name}
                        </span>
                        <span className="text-[9px] font-mono text-white/10 uppercase tracking-tighter">
                          {league.key.replace('soccer_', '').replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    {count > 0 ? (
                      <div className="relative">
                        <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-full border ${
                          isSelected 
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' 
                            : 'bg-white/5 text-white/40 border-white/10'
                        }`}>
                          {count}
                        </span>
                        {isSelected && (
                          <motion.div
                            layoutId={`badge-glow-${league.key}`}
                            className="absolute inset-0 bg-blue-500/20 blur-md rounded-full -z-10"
                          />
                        )}
                      </div>
                    ) : (
                      <ChevronRight size={14} className="text-white/10 group-hover:text-white/30 transition-transform group-hover:translate-x-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-white/10">
              <div className="bg-blue-600/5 p-4 rounded-2xl border border-blue-500/10 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                  <span className="text-[9px] font-black italic text-blue-400 uppercase tracking-widest">IA Scouting Status</span>
                </div>
                <p className="text-[10px] text-white/30 font-medium leading-relaxed">
                  Monitorando {selectedLeagues.includes('all') ? LEAGUES.length : selectedLeagues.length} competições em tempo real.
                </p>
              </div>
              <button 
                onClick={onClose}
                className="w-full py-4 bg-white hover:bg-neutral-200 text-black rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2"
              >
                Ver {matches.length} Jogos
                <ChevronRight size={14} />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
