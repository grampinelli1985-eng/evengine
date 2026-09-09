/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { carregarStopLossState, salvarStopLossState, getStopLossAlertKey } from '../services/bancaService';

export function useStopLoss() {
  const [stopLossState, setStopLossState] = useState(() => {
    const state = carregarStopLossState();
    // Auto-correção na inicialização: suspensão inválida com streak < 3 → limpa
    if (state.suspensaoAtiva && state.redStreakAtual < 3) {
      const corrected = { ...state, suspensaoAtiva: false, redStreakAtual: 0 };
      salvarStopLossState(corrected);
      return corrected;
    }
    return state;
  });
  const [alertDismissed, setAlertDismissed] = useState(() => {
    return localStorage.getItem(getStopLossAlertKey()) === 'true';
  });

  useEffect(() => {
    const handleStopLossChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.suspensaoAtiva && !stopLossState.suspensaoAtiva) {
        localStorage.setItem(getStopLossAlertKey(), 'false');
        setAlertDismissed(false);
      }
      setStopLossState(carregarStopLossState());
    };
    window.addEventListener('evengine_stop_loss_changed', handleStopLossChange);
    return () => {
      window.removeEventListener('evengine_stop_loss_changed', handleStopLossChange);
    };
  }, [stopLossState.suspensaoAtiva]);

  return { stopLossState, alertDismissed, setAlertDismissed };
}
