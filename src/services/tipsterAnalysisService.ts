/**
 * tipsterAnalysisService.ts
 * Serviço standalone para análise de picks de tipster em apostas esportivas.
 * 100% compatível com projetos React/TypeScript (ex: Antigravity).
 * Sem dependências externas.
 */

export interface Match {
  /** Time da casa */
  homeTeam: string;
  /** Time visitante */
  awayTeam: string;
  /** Data do jogo (ISO string) */
  date: string;
  /** Competição opcional */
  competition?: string;
}

export interface Market {
  /** Tipo de mercado (ex: '1x2', 'overunder') */
  type: string;
  /** Resultado selecionado (ex: 'Home', 'Over') */
  outcome: string;
}

export interface OddsHistory {
  /** Odds atuais */
  current: number;
  /** Histórico de odds recentes */
  history: number[];
}

export interface Stats {
  /** Taxa de acerto (0 a 1) */
  winRate: number;
  /** Odds médias históricas */
  avgOdds: number;
  /** ROI histórico (ex: 0.12 para 12%) */
  roi: number;
  /** Limite máximo de picks por dia */
  dailyLimit: number;
}

export interface PickInput {
  match: Match;
  market: Market;
  /** Odds da aposta */
  odds: number;
  /** Histórico de odds (opcional) */
  oddsHistory?: OddsHistory;
  /** Bankroll disponível */
  bankroll: number;
  /** Stake sugerido (opcional, default 1) */
  stake?: number;
}

export interface PickAnalysis {
  match: Match;
  market: Market;
  odds: number;
  oddsHistory?: OddsHistory;
  bankroll: number;
  /** Probabilidade implícita nas odds */
  impliedProbability: number;
  /** Odds justas baseadas na confiança */
  fairOdds: number;
  /** Valor esperado (EV) */
  expectedValue: number;
  /** Nível de confiança calculado (0 a 1) */
  confidence: number;
  /** Tier da aposta */
  tier: Tier;
  /** Stake calculado pelo critério Kelly */
  kellyStake: number;
  /** Stake recomendado */
  recommendedStake: number;
  /** Indica se é uma aposta de valor */
  isValueBet: boolean;
}

export interface Tier {
  /** Nome do tier (S, A, B, etc.) */
  name: string;
  /** Confiança mínima requerida */
  minConfidence: number;
  /** Descrição */
  description: string;
}

export class TipsterAnalysisService {
  // Estado interno
  private dailyCount: number = 0;
  private kellyFraction: number = 0.25; // Fração Kelly padrão (1/4)

  // Tiers pré-definidos, ordenados decrescente
  private tiers: Tier[] = [
    { name: 'S', minConfidence: 0.75, description: 'Super aposta - Alta confiança' },
    { name: 'A', minConfidence: 0.65, description: 'Ótima aposta' },
    { name: 'B', minConfidence: 0.50, description: 'Boa aposta' },
    { name: 'C', minConfidence: 0.30, description: 'Risco médio' },
    { name: 'D', minConfidence: 0.00, description: 'Evitar - Baixo valor' }
  ].sort((a, b) => b.minConfidence - a.minConfidence);


  /**
   * Analisa um pick e retorna a análise completa.
   * Incrementa contador diário apenas se incrementCount for true.
   */
  public analyzePick(input: PickInput, stats: Stats, incrementCount: boolean = false): PickAnalysis {
    // Validação prévia
    const validation = this.validatePick(input, stats, incrementCount);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Pick inválido');
    }

    // Incrementa contador diário se solicitado
    if (incrementCount) {
      this.dailyCount++;
    }


    const stake = input.stake || 1;
    const impliedProb = this.calculateImpliedProbRaw(input.odds);
    const confidence = this.calculateConfidence(input, stats);
    const fairOdds = this.calculateFairOdds(confidence);
    const ev = this.calculateEV(confidence, input.odds, stake);
    const tier = this.getTier(confidence);
    const kellyStake = this.calculateKellyStake(confidence, input.odds, input.bankroll);

    return {
      match: input.match,
      market: input.market,
      odds: input.odds,
      oddsHistory: input.oddsHistory,
      bankroll: input.bankroll,
      impliedProbability: impliedProb,
      fairOdds,
      expectedValue: ev,
      confidence,
      tier,
      kellyStake,
      recommendedStake: kellyStake,
      isValueBet: fairOdds < input.odds,
    };
  }

  /**
   * Reseta o contador de picks diários.
   */
  public resetDailyCount(): void {
    this.dailyCount = 0;
  }

  /**
   * Define a fração Kelly (0 a 1).
   */
  public setKellyFraction(fraction: number): void {
    this.kellyFraction = Math.max(0, Math.min(1, fraction));
  }

  /**
   * Valida um pick antes da análise.
   */
  public validatePick(input: PickInput, stats: Stats, checkLimit: boolean = true): { isValid: boolean; error?: string } {
    if (checkLimit && this.dailyCount >= stats.dailyLimit) {
      return { isValid: false, error: 'Limite diário de picks atingido.' };
    }

    if (input.odds < 1.01 || input.odds > 100) {
      return { isValid: false, error: 'Odds inválidas (deve ser > 1.01 e < 100).' };
    }
    if (input.bankroll <= 0) {
      return { isValid: false, error: 'Bankroll deve ser positivo.' };
    }
    if (stats.winRate < 0 || stats.winRate > 1 || stats.avgOdds < 1) {
      return { isValid: false, error: 'Estatísticas inválidas.' };
    }
    return { isValid: true };
  }

  // ===== MÉTODOS PRIVADOS =====

  /** 
   * Calcula probabilidade implícita BRUTA das odds (decimal).
   * ATENÇÃO: Inclui a margem da casa de aposta (overround/vig).
   * O valor retornado está inflado. Não utilizar como fair prob.
   */
  private calculateImpliedProbRaw(odds: number): number {
    return 1 / odds;
  }

  /** Calcula EV unitário (Expected Value por unidade de stake). */
  private calculateEV(prob: number, odds: number, _stake: number): number {
    return prob * (odds - 1) - (1 - prob);
  }

  /** Calcula odds justas baseadas na probabilidade. */
  private calculateFairOdds(prob: number): number {
    return prob > 0 ? 1 / prob : Infinity;
  }

  /** Calcula confiança baseada em stats e histórico. */
  private calculateConfidence(input: PickInput, stats: Stats): number {
    let confidence = stats.winRate;

    // Compatibilidade com odds médias
    const oddsMatch = 1 - Math.abs(input.odds - stats.avgOdds) / Math.max(input.odds, stats.avgOdds);
    confidence += oddsMatch * 0.2;

    // Penalidade por volatilidade
    let volatility = 0.1;
    if (input.oddsHistory?.history && input.oddsHistory.history.length > 1) {
      volatility = this.calculateVolatility(input.oddsHistory.history);
    }
    confidence -= volatility * 0.3;

    // Boost por ROI — clampado para evitar que ROI muito alto distorça a confiança
    confidence += Math.max(-0.2, Math.min(0.2, stats.roi * 0.5));

    return this.normalizeScore(confidence, 0, 1.2);

  }

  /** Normaliza score para 0-1. */
  private normalizeScore(score: number, min: number = 0, max: number = 1): number {
    return Math.max(0, Math.min(1, (score - min) / (max - min)));
  }

  /** Determina tier baseado na confiança. */
  private getTier(confidence: number): Tier {
    for (const tier of this.tiers) {
      if (confidence >= tier.minConfidence) {
        return tier;
      }
    }
    return this.tiers[this.tiers.length - 1];
  }

  /** Calcula stake Kelly fracionário. */
  private calculateKellyStake(prob: number, odds: number, bankroll: number): number {
    const b = odds - 1;
    const q = 1 - prob;
    const fullKelly = b > 0 ? (prob * b - q) / b : 0;
    const fractionKelly = fullKelly * this.kellyFraction;
    const stake = fractionKelly * bankroll;
    return Math.max(0, Math.min(stake, bankroll * 0.03));
  }

  /** Calcula volatilidade do histórico de odds. */
  private calculateVolatility(history: number[]): number {
    if (history.length < 2) return 0.5;
    const mean = history.reduce((sum, val) => sum + val, 0) / history.length;
    const variance = history.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / history.length;
    return Math.sqrt(variance) / mean;
  }
}

export default TipsterAnalysisService;
