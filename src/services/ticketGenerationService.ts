export interface TicketPick {
  id: string;
  tier: string;
  odds: number;
  ev: number;
  confidence: number;
  market: string;
}

export interface TicketScenario {
  nome: string;
  probabilidade: number;
  retorno: number;
}

export interface GeneratedTicket {
  picks: TicketPick[];
  odds_total: number;
  fair_odds: number;
  ev_total: number;
  stake_recomendado: number;
  cenarios: TicketScenario[];
  roi_esperado: number;
  conselho: string;
  partidasBloqueadas?: any[];
}

export interface ValidationError {
  success: boolean;
  error?: string;
  data?: GeneratedTicket;
}

export class TicketGenerationService {
  generateTicket(analyses: any[], bankroll: number): ValidationError {
    // GATE v2.0 — filtro obrigatório e ÚNICO critério
    const aprovadas = analyses.filter(a => {
      const gateStatus = a?.tipsterEngine?.status;
      const gateAprovado = gateStatus === 'APROVADO';
      
      return gateAprovado;
    });

    if (aprovadas.length === 0) {
      return {
        success: false,
        error: 'Nenhuma partida aprovada pelo Gate v2.0.',
        data: {
          picks: [],
          partidasBloqueadas: analyses.map(a => ({
            partida: `${a?.home_team || 'Match'} vs ${a?.away_team || ''}`,
            motivo: a?.tipsterEngine?.bloqueio?.motivo ?? 'Status não APROVADO'
          }))
        } as any
      };
    }

    // Converter 'aprovadas' em 'picks'
    const picks: TicketPick[] = aprovadas.map(a => {
      const engineMercado = a.tipsterEngine?.mercado;
      const prob = (engineMercado?.probabilidade_ia ?? 70) / 100;
      const odd = engineMercado?.odd ?? 1.85;
      const ev = (engineMercado?.ev !== undefined) ? engineMercado.ev / 100 : (prob * (odd - 1) - (1 - prob));

      return {
        id: a.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
        tier: a.tipsterEngine?.tier || 'A',
        odds: odd,
        ev: ev,
        confidence: prob,
        market: engineMercado?.nome || 'Mercado Principal'
      };
    });

    const validation = this.validateTicketComposition(picks);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error!,
      };
    }

    const oddsCalc = this.calculateOddsAccumulated(picks);
    const { odds: odds_total, fair_odds } = oddsCalc;
    const prob_total = fair_odds > 0 ? 1 / fair_odds : 0;
    const ev_total = prob_total * (odds_total - 1) - (1 - prob_total);
    const stake_recomendado = this.calculateKellyStake(ev_total, odds_total, bankroll);

    const cenarios: TicketScenario[] = [
      {
        nome: "Todos os picks ganham",
        probabilidade: prob_total,
        retorno: odds_total,
      },
    ];

    if (picks.length >= 1) {
      let prob_perde_exatamente_um = 0;
      for (let i = 0; i < picks.length; i++) {
        let prob_except_i = 1;
        for (let j = 0; j < picks.length; j++) {
          if (j !== i) {
            prob_except_i *= picks[j].confidence;
          }
        }
        prob_perde_exatamente_um += prob_except_i * (1 - picks[i].confidence);
      }
      cenarios.push({
        nome: "Perde exatamente 1",
        probabilidade: prob_perde_exatamente_um,
        retorno: 0,
      });

      const prob_perde_mais = 1 - prob_total - prob_perde_exatamente_um;
      if (prob_perde_mais > 0) {
        cenarios.push({
          nome: "Perde 2 ou mais",
          probabilidade: prob_perde_mais,
          retorno: 0,
        });
      }
    }

    const conselho = this.getTicketAdvice(ev_total, stake_recomendado, bankroll);

    const ticket: GeneratedTicket = {
      picks,
      odds_total,
      fair_odds,
      ev_total,
      stake_recomendado,
      cenarios,
      roi_esperado: ev_total,
      conselho,
    };

    return {
      success: true,
      data: ticket,
    };
  }

  validateTicketComposition(picks: TicketPick[]): { isValid: boolean; error?: string } {
    // Gate v2.0 já validou — apenas verificar se há picks para gerar o bilhete
    if (picks.length === 0) {
      return {
        isValid: false,
        error: 'Nenhum pick aprovado pelo Gate v2.0.'
      };
    }
    return { isValid: true };
  }

  calculateOddsAccumulated(picks: TicketPick[]): { odds: number; fair_odds: number } {
    let odds = 1;
    let prob = 1;
    for (const pick of picks) {
      odds *= pick.odds;
      prob *= pick.confidence;
    }
    const fair_odds = prob > 0 ? 1 / prob : Infinity;
    return { odds, fair_odds };
  }

  calculateKellyStake(ev: number, odds: number, bankroll: number, fraction: number = 0.25): number {
    if (ev <= 0 || odds <= 1 || bankroll <= 0) return 0;

    const p = (ev + 1) / odds;
    if (p <= 0 || p >= 1) return 0;

    const b = odds - 1;
    const f = (p * b - (1 - p)) / b;
    if (f <= 0) return 0;

    const stake = f * fraction * bankroll;
    return Math.min(stake, bankroll * 0.03); // Cap a 3% do bankroll (consistente com o resto do engine)
  }

  getTicketAdvice(ev: number, stake: number, bankroll: number): string {
    const stakePct = bankroll > 0 ? (stake / bankroll) * 100 : 0;
    const parts: string[] = [];

    if (stakePct > 8) {
      parts.push("Agressivo");
    } else if (stakePct < 3) {
      parts.push("Conservador");
    }

    if (ev > 0.15) {
      parts.push("Alta confiança");
    } else if (ev < 0.08) {
      parts.push("Valor baixo");
    }

    return parts.length > 0 ? parts.join(" | ") : "Equilibrado";
  }
}
