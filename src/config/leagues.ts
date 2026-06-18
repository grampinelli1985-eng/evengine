export const LIGAS_OPERAVEIS = [
  'EPL',                    // Premier League
  'LA_LIGA',                // La Liga
  'BUNDESLIGA',             // Bundesliga
  'SERIE_A',                // Serie A (Italia)
  'LIGUE_1',                // Ligue 1
  'BRASILEIRAO_A',          // Brasileirão Série A
  'CHAMPIONS_LEAGUE',       // Champions
  'EUROPA_LEAGUE',          // Europa League
  'EREDIVISIE',             // Eredivisie (Holanda)
] as const;

export type LigaOperavel = typeof LIGAS_OPERAVEIS[number];

export function isLigaOperavel(liga: string): boolean {
  return LIGAS_OPERAVEIS.includes(liga as LigaOperavel);
}
