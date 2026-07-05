import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

// Custom Event Name
const EVENGINE_TOAST_EVENT = 'evengine_toast';

/**
 * Dispatch a beautiful toast notification from anywhere in the codebase.
 */
export function showToast(message: string, type: ToastType = 'info', duration = 4000) {
  const event = new CustomEvent(EVENGINE_TOAST_EVENT, {
    detail: { message, type, duration }
  });
  window.dispatchEvent(event);
}

// Shortcuts
showToast.success = (msg: string, duration?: number) => showToast(msg, 'success', duration);
showToast.error = (msg: string, duration?: number) => showToast(msg, 'error', duration);
showToast.warning = (msg: string, duration?: number) => showToast(msg, 'warning', duration);
showToast.info = (msg: string, duration?: number) => showToast(msg, 'info', duration);

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handleNewToast = (e: Event) => {
      const { message, type, duration } = (e as CustomEvent).detail;
      const id = Math.random().toString(36).substring(2, 9);
      
      setToasts((prev) => [...prev, { id, message, type, duration }]);

      // Auto-remove
      const timeout = duration ?? 4000;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, timeout);
    };

    window.addEventListener(EVENGINE_TOAST_EVENT, handleNewToast);
    return () => window.removeEventListener(EVENGINE_TOAST_EVENT, handleNewToast);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3 w-full max-w-sm pointer-events-none px-4 sm:px-0">
      <AnimatePresence>
        {toasts.map((toast) => {
          // Determine styles based on type
          let bgColor = 'bg-[#0b0c0e]/95';
          let borderColor = 'border-white/10';
          let Icon = Info;
          let iconColor = 'text-blue-400';
          let glowColor = 'shadow-black/40';

          switch (toast.type) {
            case 'success':
              borderColor = 'border-emerald-500/20';
              Icon = CheckCircle2;
              iconColor = 'text-emerald-400';
              glowColor = 'shadow-emerald-500/5';
              break;
            case 'error':
              borderColor = 'border-red-500/20';
              Icon = AlertCircle;
              iconColor = 'text-red-400';
              glowColor = 'shadow-red-500/5';
              break;
            case 'warning':
              borderColor = 'border-amber-500/20';
              Icon = AlertTriangle;
              iconColor = 'text-amber-400';
              glowColor = 'shadow-amber-500/5';
              break;
            case 'info':
              borderColor = 'border-blue-500/20';
              Icon = Info;
              iconColor = 'text-blue-400';
              glowColor = 'shadow-blue-500/5';
              break;
          }

          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className={`pointer-events-auto flex gap-3.5 items-start p-4 rounded-2xl ${bgColor} border ${borderColor} shadow-2xl ${glowColor} backdrop-blur-xl`}
            >
              {/* Icon Container */}
              <div className={`p-1.5 rounded-lg bg-white/5 ${iconColor} flex-shrink-0 mt-0.5`}>
                <Icon size={18} />
              </div>

              {/* Message */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white leading-relaxed tracking-tight break-words">
                  {toast.message}
                </p>
              </div>

              {/* Close Button */}
              <button
                onClick={() => removeToast(toast.id)}
                className="p-1 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/5 transition-all flex-shrink-0"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
