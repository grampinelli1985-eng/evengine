export const LIGAS_OPERAVEIS = [
  'soccer_epl',                    // Premier League
  'soccer_spain_la_liga',          // La Liga
  'soccer_germany_bundesliga',     // Bundesliga
  'soccer_italy_serie_a',          // Serie A (Italia)
  'soccer_france_ligue_one',       // Ligue 1
  'soccer_brazil_campeonato',      // Brasileirão Série A
  'soccer_uefa_champs_league',     // Champions
  'soccer_uefa_europa_league',     // Europa League
  'soccer_netherlands_eredivisie',  // Eredivisie (Holanda)
  'soccer_portugal_primeira_liga',  // Primeira Liga (Portugal)
  'soccer_efl_champ',               // Championship (Inglaterra B)
  'soccer_brazil_serie_b',     // Brasileirão Série B
] as const;

export type LigaOperavel = typeof LIGAS_OPERAVEIS[number];

export function isLigaOperavel(liga: string): boolean {
  return LIGAS_OPERAVEIS.includes(liga as LigaOperavel);
}
