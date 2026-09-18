/**
 * lineShoppingService.ts — Comparação de preço entre bookmakers (H2H)
 *
 * O sistema sempre usou Pinnacle/Betfair Exchange como REFERÊNCIA de valor
 * justo, nunca como sugestão de "onde apostar" — o usuário tinha que
 * descobrir e digitar manualmente a odd de outra casa (campo "odd manual",
 * comparado contra a Pinnacle). Este serviço automatiza a parte de "qual das
 * casas retornadas pela API oferece o melhor preço agora", escalando
 * automaticamente conforme mais bookmakers forem incluídos na busca
 * (oddsService.ts SHARP_BOOKMAKERS) — hoje isso já compara Pinnacle vs
 * Betfair Exchange vs Bet365 (quando disponível na sua região/plano da Odds
 * API).
 */

export interface MelhorPreco {
  odd: number;
  bookmaker: string;
  bookmakerTitle: string;
  totalCotacoes: number; // quantas casas tinham esse mercado, para o usuário calibrar confiança
}

export interface MelhoresPrecosH2H {
  home: MelhorPreco | null;
  draw: MelhorPreco | null;
  away: MelhorPreco | null;
}

function melhorPrecoParaOutcome(bookmakers: any[], outcomeName: string): MelhorPreco | null {
  let melhor: MelhorPreco | null = null;
  let total = 0;

  for (const bk of bookmakers || []) {
    const market = bk?.markets?.find((m: any) => m.key === 'h2h');
    const outcome = market?.outcomes?.find((o: any) => o.name === outcomeName);
    if (!outcome?.price) continue;

    total++;
    if (!melhor || outcome.price > melhor.odd) {
      melhor = {
        odd: outcome.price,
        bookmaker: bk.key,
        bookmakerTitle: bk.title || bk.key,
        totalCotacoes: 0, // preenchido no final, quando `total` está fechado
      };
    }
  }

  if (melhor) melhor.totalCotacoes = total;
  return melhor;
}

/**
 * Compara o preço do H2H (casa/empate/fora) entre todos os bookmakers
 * retornados pela Odds API para esta partida e retorna a melhor odd
 * disponível para cada lado. Retorna null nos lados sem nenhuma cotação.
 */
export function encontrarMelhoresPrecosH2H(
  homeTeam: string,
  awayTeam: string,
  bookmakers: any[]
): MelhoresPrecosH2H {
  return {
    home: melhorPrecoParaOutcome(bookmakers, homeTeam),
    draw: melhorPrecoParaOutcome(bookmakers, 'Draw'),
    away: melhorPrecoParaOutcome(bookmakers, awayTeam),
  };
}
