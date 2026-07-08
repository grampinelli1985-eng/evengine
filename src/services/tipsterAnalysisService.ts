/**
 * tipsterAnalysisService.ts
 * Serviço standalone para análise de picks de tipster em apostas esportivas.
 * 100% compatível com projetos React/TypeScript (ex: Antigravity).
 * Sem dependências externas.
 *
 * FIX-01: Probabilidade derivada das odds de mercado (no-vig) como base.
 *   O score de confiança histórico do tipster atua como fator de Shrinkage
 *   Bayesiano sobre a probabilidade de mercado — nunca como probabilidade bruta.
 *
 *   Fórmula: p_final = α × p_market + (1 - α) × p_tipster_hist
 *   onde α = peso do mercado (inversamente proporcional à confiança no tipster)
 *
 *   p_market   = 1/odds * (1 + estimativa de overround)  → sem vig via Shin
 *   p_tipster  = winRate histórico do tipster (âncora bayesiana)
 *   α          = 1 - shrinkage_weight  (quanto mais confiável o tipster, menos α)
 */

export interface Match {
  homeTeam: string;
  awayTeam: string;
  date: string;
  competition?: string;
}

export interface Market {
  type: string;
  outcome: string;
}

export interface OddsHistory {
  current: number;
  history: number[];
}

export interface Stats {
  winRate: number;
  avgOdds: number;
  roi: number;
  dailyLimit: number;
}

export interface PickInput {
  match: Match;
  market: Market;
  odds: number;
  oddsHistory?: OddsHistory;
  bankroll: number;
  stake?: number;
}

export interface PickAnalysis {
  match: Match;
  market: Market;
  odds: number;
  oddsHistory?: OddsHistory;
  bankroll: number;
  /** Probabilidade implícita bruta nas odds (inclui vig) */
  impliedProbability: number;
  /** Probabilidade final blendada (market no-vig + shrinkage tipster) */
  blendedProbability: number;
  /** Probabilidade de mercado sem vig (Shin) */
  marketFairProbability: number;
  /** Peso dado ao tipster no blend (0-1) */
  tipsterShrinkageWeight: number;
  /** Odds justas baseadas na blendedProbability */
  fairOdds: number;
  /** Valor esperado (EV) */
  expectedValue: number;
  /** Score de confiança histórico do tipster (NÃO é probabilidade) */
  confidence: number;
  tier: Tier;
  kellyStake: number;
  recommendedStake: number;
  isValueBet: boolean;
}

export interface Tier {
  name: string;
  minConfidence: number;
  description: string;
}

export class TipsterAnalysisService {
  private dailyCount: number = 0;
  private kellyFraction: number = 0.25;

  private tiers: Tier[] = [
    { name: 'S', minConfidence: 0.75, description: 'Super aposta - Alta confiança' },
    { name: 'A', minConfidence: 0.65, description: 'Ótima aposta' },
    { name: 'B', minConfidence: 0.50, description: 'Boa aposta' },
    { name: 'C', minConfidence: 0.30, description: 'Risco médio' },
    { name: 'D', minConfidence: 0.00, description: 'Evitar - Baixo valor' }
  ].sort((a, b) => b.minConfidence - a.minConfidence);

  public analyzePick(input: PickInput, stats: Stats, incrementCount: boolean = false): PickAnalysis {
    const validation = this.validatePick(input, stats, incrementCount);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Pick inválido');
    }
    if (incrementCount) this.dailyCount++;

    const impliedProb = this.calculateImpliedProbRaw(input.odds);

    // FIX-01: probabilidade de mercado sem vig como âncora principal
    const marketFairProb = this.removeVigShin(input.odds);

    // Score de confiança do tipster (heurístico histórico, NÃO é probabilidade)
    const confidence = this.calculateConfidenceScore(input, stats);

    // Peso Bayesiano do tipster: quanto maior o score, mais peso na âncora histórica
    // Máximo 30% de influência tipster — mercado sempre domina (mínimo 70%)
    const tipsterShrinkageWeight = confidence * 0.30;

    // Probabilidade blendada: market fair + shrinkage bayesiano do tipster
    const blendedProbability = Math.max(0.01, Math.min(0.99,
      (1 - tipsterShrinkageWeight) * marketFairProb +
      tipsterShrinkageWeight * stats.winRate
    ));

    const fairOdds = blendedProbability > 0 ? 1 / blendedProbability : Infinity;
    const ev = this.calculateEV(blendedProbability, input.odds);
    const tier = this.getTier(confidence);
    const kellyStake = this.calculateKellyStake(blendedProbability, input.odds, input.bankroll);

    return {
      match: input.match,
      market: input.market,
      odds: input.odds,
      oddsHistory: input.oddsHistory,
      bankroll: input.bankroll,
      impliedProbability: impliedProb,
      blendedProbability,
      marketFairProbability: marketFairProb,
      tipsterShrinkageWeight,
      fairOdds,
      expectedValue: ev,
      confidence,
      tier,
      kellyStake,
      recommendedStake: kellyStake,
      isValueBet: blendedProbability > impliedProb,
    };
  }

  public resetDailyCount(): void { this.dailyCount = 0; }
  public setKellyFraction(fraction: number): void {
    this.kellyFraction = Math.max(0, Math.min(1, fraction));
  }

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

  // ── Métodos privados ────────────────────────────────────────────────────────

  /** Probabilidade implícita bruta (inclui vig — apenas para display). */
  private calculateImpliedProbRaw(odds: number): number {
    return 1 / odds;
  }

  /**
   * Remove vig de odds individuais usando aproximação Shin (single-outcome).
   * Para mercados com 2+ outcomes, o ideal é passar todas as odds ao Shin completo.
   * Aqui usamos a estimativa conservadora: assume overround de 5% para casas soft,
   * 2% para sharp. Como não sabemos o bookmaker, usa 3.5% como estimativa central.
   */
  private removeVigShin(odds: number): number {
    const estimatedOverround = 0.035; // 3.5% — estimativa conservadora
    const impliedRaw = 1 / odds;
    // Aproximação: fair prob ≈ implied / (1 + overround * implied)
    const fairProb = impliedRaw / (1 + estimatedOverround * impliedRaw);
    return Math.max(0.01, Math.min(0.99, fairProb));
  }

  /** EV por unidade de stake usando blended probability. */
  private calculateEV(prob: number, odds: number): number {
    return prob * (odds - 1) - (1 - prob);
  }

  /**
   * Score de confiança histórico do tipster (0-1).
   * ATENÇÃO: Este é um score heurístico — NÃO é probabilidade de outcome.
   * Usado apenas como peso de Shrinkage no blend Bayesiano (máx 30%).
   */
  private calculateConfidenceScore(input: PickInput, stats: Stats): number {
    let score = stats.winRate;

    // Penaliza pick muito fora do perfil histórico de odds
    const oddsMatch = 1 - Math.abs(input.odds - stats.avgOdds) / Math.max(input.odds, stats.avgOdds);
    score += oddsMatch * 0.2;

    // Penalidade por volatilidade de linha
    let volatility = 0.1;
    if (input.oddsHistory?.history && input.oddsHistory.history.length > 1) {
      volatility = this.calculateVolatility(input.oddsHistory.history);
    }
    score -= volatility * 0.3;

    // Boost por ROI histórico (clampado)
    score += Math.max(-0.2, Math.min(0.2, stats.roi * 0.5));

    return this.normalizeScore(score, 0, 1.2);
  }

  private normalizeScore(score: number, min: number = 0, max: number = 1): number {
    return Math.max(0, Math.min(1, (score - min) / (max - min)));
  }

  private getTier(confidence: number): Tier {
    for (const tier of this.tiers) {
      if (confidence >= tier.minConfidence) return tier;
    }
    return this.tiers[this.tiers.length - 1];
  }

  /** Quarter-Kelly com cap de 5% da banca. */
  private calculateKellyStake(prob: number, odds: number, bankroll: number): number {
    const b = odds - 1;
    const q = 1 - prob;
    const fullKelly = b > 0 ? (prob * b - q) / b : 0;
    const fractionKelly = fullKelly * this.kellyFraction;
    return Math.max(0, Math.min(bankroll * 0.05, fractionKelly * bankroll));
  }

  private calculateVolatility(history: number[]): number {
    if (history.length < 2) return 0.5;
    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    const variance = history.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / history.length;
    return Math.sqrt(variance) / mean;
  }
}

export default TipsterAnalysisService;
