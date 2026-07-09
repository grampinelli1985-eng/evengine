/**
 * SteamBadge.tsx — Badge de Steam Move para MatchCardTipster
 *
 * Uso:
 *   import SteamBadge from './SteamBadge';
 *   import { getLineMovement } from '../services/lineMovementService';
 *
 *   // dentro do componente de card:
 *   const lm = getLineMovement(match.id);
 *   {lm?.tem_steam && <SteamBadge steamSide={lm.steam_side} sharpScore={lm.sharpScore} />}
 */

interface SteamBadgeProps {
  steamSide: 'home' | 'draw' | 'away' | null;
  sharpScore?: number;
  compact?: boolean;
}

const SIDE_LABEL: Record<string, string> = {
  home: 'Casa',
  draw: 'Empate',
  away: 'Visitante'
};

export default function SteamBadge({ steamSide, sharpScore = 85, compact = false }: SteamBadgeProps) {
  const sideLabel = steamSide ? SIDE_LABEL[steamSide] ?? steamSide : '';

  if (compact) {
    return (
      <span
        title={`Steam Move — Sharp money em ${sideLabel} (confiança ${sharpScore}%)`}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-400 text-[10px] font-bold leading-none"
      >
        🔥 STEAM
      </span>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
      <span className="text-lg leading-none mt-0.5">🔥</span>
      <div className="min-w-0">
        <p className="text-orange-300 font-bold text-xs leading-tight">STEAM MOVE</p>
        <p className="text-orange-200/70 text-[11px] leading-tight mt-0.5">
          Sharp money entrando em <strong>{sideLabel}</strong>
          {sharpScore >= 80 && <span className="ml-1 text-orange-400">· confiança alta</span>}
        </p>
      </div>
    </div>
  );
}
