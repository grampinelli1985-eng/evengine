/**
 * lineShoppingService.ts — Comparação de preço entre bookmakers (H2H)
 *
 * O sistema usa Pinnacle/Betfair Exchange como REFERÊNCIA de valor justo, nunca como
 * sugestão de "onde apostar" — o usuário digita manualmente a odd da casa onde vai
 * apostar (campo "odd manual", ex.: bet365, que a Odds API não fornece).
 * Este serviço só compara o melhor preço entre as casas que a API devolve
 * (oddsService.ts SHARP_BOOKMAKERS), hoje Pinnacle e Betfair Exchange: é a melhor
 * referência sharp, não uma comparação entre casas de aposta de varejo. Escala
 * automaticamente se mais bookmakers forem incluídos na busca.
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
