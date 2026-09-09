/**
 * pushNotificationService.ts
 *
 * Wrapper leve sobre a Web Notifications API.
 * Funciona enquanto o browser estiver aberto, mesmo com a aba em background.
 * Não requer service worker nem backend.
 */

export type NotifPermission = 'granted' | 'denied' | 'default';

export function getNotificationPermission(): NotifPermission {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission as NotifPermission;
}

export async function requestNotificationPermission(): Promise<NotifPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  const result = await Notification.requestPermission();
  return result as NotifPermission;
}

export function sendNotification(
  title: string,
  options?: { body?: string; icon?: string; tag?: string }
): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body: options?.body,
      icon: options?.icon ?? '/favicon.ico',
      tag: options?.tag,
    });
    // Fecha automaticamente após 8s
    setTimeout(() => n.close(), 8000);
  } catch (e) {
    console.warn('[Push] Falha ao exibir notificação:', e);
  }
}

/** Notifica resultado de jogo ao vivo */
export function notificarResultadoFinal(
  homeTeam: string,
  awayTeam: string,
  placar: string,
  apostasResolvidas: number
): void {
  const body = apostasResolvidas > 0
    ? `Placar: ${placar} · ${apostasResolvidas} aposta${apostasResolvidas > 1 ? 's' : ''} resolvida${apostasResolvidas > 1 ? 's' : ''} automaticamente`
    : `Placar final: ${placar}`;
  sendNotification(`⚽ ${homeTeam} × ${awayTeam}`, { body, tag: `result-${homeTeam}-${awayTeam}` });
}

/** Notifica quando análise é APROVADA */
export function notificarAnaliseAprovada(homeTeam: string, awayTeam: string, mercado: string): void {
  sendNotification(`✅ Entrada aprovada`, {
    body: `${homeTeam} × ${awayTeam} — ${mercado}`,
    tag: `approved-${homeTeam}-${awayTeam}`,
  });
}

/** Notifica ativação do stop-loss */
export function notificarStopLoss(streak: number): void {
  sendNotification('🛑 Stop Loss Ativado', {
    body: `${streak} reds consecutivos. Novas entradas bloqueadas até o próximo green.`,
    tag: 'stop-loss',
  });
}

/** Notifica steam move detectado */
export function notificarSteamMove(homeTeam: string, awayTeam: string): void {
  sendNotification('⚡ Steam Move detectado', {
    body: `${homeTeam} × ${awayTeam} — odds em movimento acelerado`,
    tag: `steam-${homeTeam}-${awayTeam}`,
  });
}
