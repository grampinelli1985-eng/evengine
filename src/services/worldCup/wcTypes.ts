/**
 * wcTypes.ts — Tipos isolados do módulo Copa do Mundo
 * Não depende de src/types para manter isolamento total do módulo.
 */

export interface WCBookmakerOutcome {
  name: string;
  price: number;
}

export interface WCMarket {
  key: string;
  last_update: string;
  outcomes: WCBookmakerOutcome[];
}

export interface WCBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: WCMarket[];
}

export interface WCMatch {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: WCBookmaker[];
  phase?: 'grupos' | 'oitavas' | 'quartas' | 'semi' | 'final' | 'eliminatorias';
  group?: string; // ex: 'A', 'B', 'C'
  resultado_registrado?: boolean;
  resultado_placar?: string;
}

export interface WCNationalTeam {
  name: string;
  fifaRank: number;
  eloRating: number;
  confederation: 'UEFA' | 'CONMEBOL' | 'CAF' | 'AFC' | 'CONCACAF' | 'OFC';
  recentForm: ('W' | 'D' | 'L')[];
  avgGoalsScored: number;
  avgGoalsConceded: number;
}

export interface WCEloData {
  home_rating: number;
  away_rating: number;
  delta: number;
  probabilidades: {
    casa: number;
    empate: number;
    fora: number;
  };
  favorito: string;
}

export interface WCPoissonResult {
  lambda_home: number;
  lambda_away: number;
  over15: { probabilidade: number };
  over25: { probabilidade: number };
  over35: { probabilidade: number };
  btts: { probabilidade: number }; // Both Teams To Score
  resultado_mais_provavel: string;
  probabilidade_resultado_mais_provavel: number;
}

export interface WCGateResult {
  status: 'APROVADO' | 'BLOQUEADO';
  score: number;
  bloqueio?: {
    codigo: string;
    motivo: string;
  };
  mercado: {
    nome: string;
    ev: number;
    odd: number;
    probabilidade_ia: number;
    odd_referencia?: number;
    odd_api?: number;
  };
  stake: {
    kelly_base: number;
    stake_final: number;
    valor_reais: number;
  };
  alertas: string[];
}

export interface WCAnalysisResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  phase: WCMatch['phase'];
  elo: WCEloData;
  poisson: WCPoissonResult;
  gate: WCGateResult;
  timestamp: number;
}

export type WCTournament =
  | 'soccer_fifa_world_cup'
  | 'soccer_fifa_world_cup_qualifiers_europe'
  | 'soccer_fifa_world_cup_qualifiers_south_america'
  | 'soccer_conmebol_copa_america'
  | 'soccer_uefa_european_championship';

export const WC_TOURNAMENTS: { key: WCTournament; name: string; flag: string }[] = [
  { key: 'soccer_fifa_world_cup', name: 'Copa do Mundo FIFA', flag: '🌍' },
  { key: 'soccer_conmebol_copa_america', name: 'Copa América', flag: '🌎' },
  { key: 'soccer_uefa_european_championship', name: 'Eurocopa', flag: '🇪🇺' },
  { key: 'soccer_fifa_world_cup_qualifiers_south_america', name: 'Eliminatórias CONMEBOL', flag: '🇧🇷' },
  { key: 'soccer_fifa_world_cup_qualifiers_europe', name: 'Eliminatórias UEFA', flag: '🏟️' },
];
