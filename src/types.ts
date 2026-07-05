/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MarketReference {
  sharpBookmaker: 'pinnacle' | 'betfair_ex_eu' | null;
  rawOdds: number[];
  fairProbs: number[];
  overround: number;
  lastUpdate: string;
  hasReference: boolean;
}

export interface Outcome {
  name: string;
  price: number;
}

export interface Market {
  key: string;
  last_update: string;
  outcomes: Outcome[];
}

export interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: Market[];
}

export interface Match {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
  resultado_registrado?: boolean;
  resultado_placar?: string;
  resultado_data?: string;
  resultado_ignorado?: boolean;
  status?: string;
}

export interface GoalAnalysis {
  probabilidade: number;
  confianca: "alta" | "media" | "baixa";
  recomenda: boolean;
}

export interface DoubleChanceAnalysis {
  probabilidade: number;
  odd_equivalente: number;
  recomenda: boolean;
}

export interface EloData {
  home_rating: number;
  away_rating: number;
  delta: number;
  raw_delta: number;
  favorito: string;
  calibrando: boolean;
  confianca_home: string;
  confianca_away: string;
  jogos_minimos_atingidos: boolean;
  probabilidades?: {
    casa: number;
    empate: number;
    fora: number;
  };
}

export interface PoissonData {
  home_expected: number;
  away_expected: number;
  homeXg?: number;
  awayXg?: number;
  homeExpected?: number;
  awayExpected?: number;
  top_scores: Array<{ score: string; prob: number }>;
  btts_prob: number;
  probs_1x2?: { casa: number; empate: number; fora: number };
  fonteXg?: string;
  over_0_5?: number;
  over_1_5?: number;
  over_2_5?: number;
  over_3_5?: number;
}



export interface ScoutingReport {
  home_form: string[];
  away_form: string[];
  h2h: {
    date: string;
    score: string;
    winner: string;
  }[];
  scout_summary: string;
  data_source?: 'real' | 'unavailable' | 'gemini_inferido';
  confiavel?: boolean;
  forma?: number;
  motivacao?: number;
  desfalques?: number;
}


export interface TipsterEngineResult {
  status: 'APROVADO' | 'BLOQUEADO';
  bloqueio?: { codigo: string; motivo: string; };
  score: number;
  ev?: number;
  evExecution?: number;
  evMarketDeviation?: number | null;
  marketReference?: MarketReference;
  mercado?: {
    nome: string; ev: number; odd: number;
    probabilidade_ia: number; probabilidade_elo: number;
  };
  clv?: { sinal: 'POSITIVO'|'NEUTRO'|'NEGATIVO'; valor: number; impacto: string; };
  lineMovement?: {
    tipo: 'STEAM_MOVE'|'GRADUAL'|'ESTAVEL'|'ADVERSO'|'REVERSE';
    direcao: 'FAVOR'|'CONTRA'|'NEUTRO';
    magnitude: number; interpretacao: string;
  };
  stake?: { kelly_base: number; modificador: number; stake_final: number; valor_reais: number; };
  convergencia?: { elo_prob: number; gemini_prob: number; delta: number; status: 'CONVERGENTE'|'DIVERGENTE'; };
  alertas: string[];
  regras_protecao?: {
    stop_loss_ativo: boolean; reds_consecutivos: number;
    apostas_hoje: number; limite_diario_atingido: boolean;
  };
  // Campos auxiliares para telemetria
  tier?: string;
  market?: string;
  probIA?: number;
  iaConfidence?: number;
  compositeScore?: number;
  gateStatus?: string;
  blockReasons?: string[];
}

export interface AnalysisResponse {
  resumo: string;
  gols: {
    over15: GoalAnalysis;
    over25: GoalAnalysis;
    over35: GoalAnalysis;
    btts?: GoalAnalysis;
  };
  escanteios: {
    faixa_esperada?: string;
    observacao?: string;
    probabilidade: number;
    total_min?: number;
    total_max?: number;
    media_home?: number;
    media_away?: number;
    fonte?: string;
  };
  finalizacoes: {
    faixa_esperada?: string;
    observacao?: string;
    probabilidade: number;
    total_min?: number;
    total_max?: number;
    media_home?: number;
    media_away?: number;
    fonte?: string;
  };
  dupla_chance: {
    "1X": DoubleChanceAnalysis;
    "X2": DoubleChanceAnalysis;
    "12": DoubleChanceAnalysis;
  };
  probabilidades_ml: {
    casa: number;
    empate: number;
    fora: number;
  };
  quality?: number; // Quality/Confidence score
  qualidade?: number; // Portuguese alias
  qualidade_score?: number;
  poisson?: PoissonData;
  elo?: EloData;
  dica_principal: string | null;
  scouting?: ScoutingReport;
  desfalques?: string[];
  motivacao?: number;
  tipsterEngine?: TipsterEngineResult;
  tipster?: any;
  kellyStake?: number;
  h2h?: {
    confrontos: Array<{
      data: string;
      homeTeam: string;
      awayTeam: string;
      placar: string;
      vencedor: 'home' | 'away' | 'draw';
    }>;
    resumo: {
      vitorias_home: number;
      empates: number;
      vitorias_away: number;
      media_gols_home: number;
      media_gols_away: number;
      over25_percentual: number;
    };
    fonte?: 'api-football' | 'estimado' | 'unavailable' | 'gemini_inferido';
    confiavel: boolean;
  } | null;

  marketReference?: MarketReference;
}

export interface MarketValueBet {
  market: string;
  odd_api: number;
  prob_ia: number;
  odd_fair: number;
  edge: number;
  is_value_bet: boolean;
  recomenda: boolean;
  odd_is_estimated: boolean;
  observacao?: string;
}

export interface ValueBetReport {
  mercados: MarketValueBet[];
  total_value_bets: number;
  tem_value: boolean;
  melhor_value: MarketValueBet | null;
}

export interface BancaState {
  total: number;
  pnl_diario: number;
  stake_recomendado: number;
  kelly: number;
  stops: { win: boolean; loss: boolean };
  bancaAtual?: number;
  redsConsecutivos?: number;
  apostasHoje?: number;
  stopLossAtivo?: boolean;
}

export interface League {
  key: string;
  name: string;
  symbol: string;
  imprevisibilidade: 'media' | 'alta' | 'muito_alta';
}

export const LEAGUES: League[] = [
  { key: 'soccer_epl', name: 'Premier League', symbol: 'zap', imprevisibilidade: 'media' },
  { key: 'soccer_spain_la_liga', name: 'La Liga', symbol: 'flame', imprevisibilidade: 'media' },
  { key: 'soccer_italy_serie_a', name: 'Serie A', symbol: 'shield', imprevisibilidade: 'media' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga', symbol: 'activity', imprevisibilidade: 'media' },
  { key: 'soccer_france_ligue_one', name: 'Ligue 1', symbol: 'crown', imprevisibilidade: 'media' },
  { key: 'soccer_uefa_champs_league', name: 'UEFA Champions League', symbol: 'star', imprevisibilidade: 'alta' },
  { key: 'soccer_brazil_campeonato', name: 'Brasileirão Série A', symbol: 'sun', imprevisibilidade: 'alta' },
  { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie', symbol: 'award', imprevisibilidade: 'media' },
  { key: 'soccer_conmebol_copa_libertadores', name: 'Copa Libertadores', symbol: 'compass', imprevisibilidade: 'muito_alta' },
  { key: 'soccer_conmebol_copa_sudamericana', name: 'Copa Sul-Americana', symbol: 'globe', imprevisibilidade: 'muito_alta' }
];

export interface SportmonksXGData {
  home: number | null;
  away: number | null;
  home_last5: number | null;
  away_last5: number | null;
  ppda_home: number | null;
  ppda_away: number | null;
  pressao_alta_home: boolean;
  pressao_alta_away: boolean;
  fonte: 'sportmonks' | 'estimado';
}

