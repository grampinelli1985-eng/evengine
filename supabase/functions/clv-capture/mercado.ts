/**
 * Classificação de mercados para o clv-capture — módulo puro (sem Deno/rede) para
 * poder ser testado com vitest e compartilhado entre a extração da odd de
 * fechamento (index.ts) e a decisão de QUAIS mercados pedir à Odds API.
 *
 * Por que isso importa em créditos: /sports/{sport}/odds custa 1 crédito por
 * mercado pedido. O cron roda a cada 5 min, então pedir mercados que nenhuma
 * entrada pendente usa (ou entradas que nunca têm fechamento extraível) é gasto
 * puro.
 */

export function normalizeMercado(mercado: string): string {
  return mercado.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface H2hSide {
  isHomeWin: boolean;
  isAwayWin: boolean;
  isDraw: boolean;
}

/** `m` deve estar normalizado (normalizeMercado). */
export function h2hSide(m: string): H2hSide {
  return {
    isHomeWin:
      m.includes('vitoria casa') ||
      m.includes('home') ||
      m.includes('casa') ||
      (m.includes('1x2') && m.includes('1')),
    isAwayWin:
      m.includes('vitoria visitante') ||
      m.includes('vitoria fora') || // nome que o tipsterEngine grava para o mercado
      m.includes('away') ||
      m.includes('visitante') ||
      (m.includes('1x2') && m.includes('2') && !m.includes('x2')),
    isDraw:
      m.includes('empate') ||
      m.includes('draw') ||
      (m.includes('1x2') && m.includes('x') && !m.includes('x2') && !m.includes('1x')),
  };
}

export function isH2hMercado(m: string): boolean {
  const s = h2hSide(m);
  return s.isHomeWin || s.isAwayWin || s.isDraw;
}

export function isTotalsMercado(m: string): boolean {
  return (
    m.includes('over') || m.includes('mais de') || m.includes('acima') ||
    m.includes('under') || m.includes('menos de') || m.includes('abaixo')
  );
}

export function isSpreadMercado(m: string): boolean {
  return m.includes('handicap') || m.includes('spread') || m.includes('asian');
}

export function isDuplaChanceMercado(m: string): boolean {
  return m.includes('dupla') || m.includes('chance');
}

/**
 * Mercados cuja odd de fechamento NÃO sai de h2h/totals/spreads da Pinnacle no
 * endpoint em lote. Sem este filtro eles caem por engano nos ramos acima
 * ("Empate Anula - Casa" casa com 'casa'/'empate' → h2h; "Mais de 9.5
 * escanteios" casa com 'mais de' → totals de GOLS) e gravam um CLV comparado
 * com a odd errada — além de manter a entrada sendo reprocessada a cada 5 min.
 */
export function isUnsupportedMercado(m: string): boolean {
  return (
    m.includes('anula') || m.includes('dnb') || m.includes('draw no bet') ||
    m.includes('ambas') || m.includes('btts') || m.includes('both teams') ||
    m.includes('escanteio') || m.includes('corner') ||
    m.includes('finaliza') || m.includes('shot') ||
    m.includes('cartao') || m.includes('cartoes') || m.includes('card')
  );
}

export type MercadoKind = 'h2h' | 'totals' | 'spreads' | 'double_chance' | 'unsupported';

/** Mesma ordem de precedência que extractClosingOdd usa. */
export function classifyMercado(mercado: string): MercadoKind {
  const m = normalizeMercado(mercado);
  if (isUnsupportedMercado(m)) return 'unsupported';
  if (isH2hMercado(m)) return 'h2h';
  if (isTotalsMercado(m)) return 'totals';
  if (isSpreadMercado(m)) return 'spreads';
  if (isDuplaChanceMercado(m)) return 'double_chance';
  return 'unsupported';
}

/** Mercados da Odds API necessários para fechar as entradas dadas (sem duplicar, sem os não suportados). */
export function requiredMarkets(mercados: string[]): string[] {
  const needed = new Set<string>();
  for (const mercado of mercados) {
    switch (classifyMercado(mercado)) {
      case 'h2h':
      case 'double_chance': needed.add('h2h'); break;
      case 'totals': needed.add('totals'); break;
      case 'spreads': needed.add('spreads'); break;
      default: break;
    }
  }
  return [...needed];
}
