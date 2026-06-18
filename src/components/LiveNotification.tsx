/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import { Radio, X } from 'lucide-react';
import { Match } from '../types';

interface LiveNotificationProps {
  key?: string;
  match: Match;
  onClose: (id: string) => void;
}

export default function LiveNotification({ match, onClose }: LiveNotificationProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      className="bg-[#141416]/95 backdrop-blur-xl border border-blue-500/30 p-3 sm:p-4 rounded-2xl shadow-2xl flex items-center gap-3 sm:gap-4 w-[280px] sm:w-80 pointer-events-auto group"
    >
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-500 transition-colors group-hover:bg-blue-600/20">
          <Radio size={16} className="sm:size-5 animate-pulse" />
        </div>
        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-500 rounded-full border-2 border-[#141416]" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="w-1 h-1 rounded-full bg-red-500 animate-ping" />
          <p className="text-[8px] sm:text-[9px] font-black text-blue-400 uppercase tracking-[0.2em]">Partida Ao Vivo</p>
        </div>
        <p className="text-xs sm:text-sm font-bold text-white truncate tracking-tight">{match.home_team} vs {match.away_team}</p>
        <p className="text-[9px] sm:text-[10px] text-white/30 font-bold uppercase tracking-widest mt-0.5">Scout Atualizado</p>
      </div>

      <button 
        onClick={() => onClose(match.id)}
        className="p-1 text-white/10 hover:text-white transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
