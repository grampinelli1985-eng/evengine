/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from 'motion/react';
import { WifiOff, AlertTriangle, X, RefreshCw } from 'lucide-react';
import { ApiErrorType } from '../services/liveTrackerService';

export type { ApiErrorType };

interface ApiErrorBannerProps {
  errorType: ApiErrorType;
  onDismiss: () => void;
}

const KIND_CONFIG = {
  suspended: {
    title: 'API de Placares Bloqueada',
    fallbackDetail: 'A conta da API-Football foi suspensa ou a chave é inválida.',
    icon: AlertTriangle,
    color: 'red',
  },
  quota: {
    title: 'Cota ODDS_API Esgotada',
    fallbackDetail: 'O limite de requisições da API-Football foi atingido. A cota renova no início do próximo mês.',
    icon: RefreshCw,
    color: 'amber',
  },
  network: {
    title: 'Erro de Conexão com API de Placares',
    fallbackDetail: 'Não foi possível conectar à API-Football.',
    icon: WifiOff,
    color: 'blue',
  },
} as const;

export default function ApiErrorBanner({ errorType, onDismiss }: ApiErrorBannerProps) {
  const cfg = errorType ? KIND_CONFIG[errorType.kind] : null;

  return (
    <AnimatePresence>
      {errorType && cfg && (
        <motion.div
          key="api-error-banner"
          initial={{ opacity: 0, y: -16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.25 }}
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-2rem)] max-w-md bg-[#141416]/95 backdrop-blur-xl border rounded-2xl shadow-2xl p-4 flex items-start gap-3 ${cfg.color === 'red' ? 'border-red-500/30' :
              cfg.color === 'amber' ? 'border-amber-500/30' : 'border-blue-500/30'
            }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cfg.color === 'red' ? 'bg-red-500/10' :
              cfg.color === 'amber' ? 'bg-amber-500/10' : 'bg-blue-500/10'
            }`}>
            <cfg.icon size={16} className={
              cfg.color === 'red' ? 'text-red-400' :
                cfg.color === 'amber' ? 'text-amber-400' : 'text-blue-400'
            } />
          </div>

          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-black uppercase tracking-widest mb-0.5 ${cfg.color === 'red' ? 'text-red-300' :
                cfg.color === 'amber' ? 'text-amber-300' : 'text-blue-300'
              }`}>
              {cfg.title}
            </p>
            <p className="text-[10px] text-white/40 leading-relaxed">
              {errorType.statusCode && (
                <span className={`font-mono font-black mr-1 ${cfg.color === 'red' ? 'text-red-400/60' :
                    cfg.color === 'amber' ? 'text-amber-400/60' : 'text-blue-400/60'
                  }`}>
                  HTTP {errorType.statusCode} ·
                </span>
              )}
              {errorType.detail ?? cfg.fallbackDetail}
            </p>
          </div>

          <button
            onClick={onDismiss}
            className="p-1 text-white/20 hover:text-white/60 transition-colors shrink-0 mt-0.5"
          >
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
