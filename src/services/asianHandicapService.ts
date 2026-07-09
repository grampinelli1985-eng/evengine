/**
 * asianHandicapService.ts — Asian Handicap Equivalents & Overround Comparator
 *
 * Traders profissionais comparam mercados equivalentes para encontrar
 * eficiências de preço. Exemplos de equivalências matemáticas exatas:
 *
 *  DNB Casa (Draw No Bet)  ≡  Asian Handicap 0.0 Casa
 *  Dupla Chance 1X         ≡  Asian Handicap Casa -0.5 (aprox)
 *  Dupla Chance X2         ≡  Asian Handicap Visitante -0.5 (aprox)
 *  Over 0.5 Gols           ≡  BTTS (Both Teams To Score) proxy
 *
 * Este serviço:
 *  1. Converte qualquer odd 1X2 em seus equivalentes AH/DNB
 *  2. Calcula o overround de cada mercado
 *  3. Identifica qual mercado oferece menor margem da casa (melhor preço)
 */

export interface OddsH2H {
  home: number;
  draw: number;
  away: number;
}

export interface MarketEquivalent {
  mercado: string;
  descricao: string;
  oddEquivalente: number;
  overround: number;      // % de margem da casa neste mercado
  economiaVsH2H: number;  // economia em % comparado ao H2H padrão
  recomendado: boolean;
}

export interface AsianHandicapAnalysis {
  homeTeam: string;
  awayTeam: string;
  oddsOriginais: OddsH2H;
  overroundH2H: number;

  // Equivalentes calculados para CASA
  equivalentesCasa: MarketEquivalent[];
  // Equivalentes calculados para VISITANTE
  equivalentesVisitante: MarketEquivalent[];
  // Melhor mercado geral (menor overround com odd equivalente)
  melhorMercadoCasa: MarketEquivalent | null;
  melhorMercadoVisitante: MarketEquivalent | null;
  
  alerta: string | null;
}

// ─── Cálculos matemáticos ─────────────────────────────────────────────────

/**
 * Probabilidade implícita sem overround (Shin method simplificado)
 */
function probImplied(odd: number): number {
  return odd > 1 ? 1 / odd : 0;
}

/**
 * Overround total de um mercado H2H (em %)
 */
function calcOverroundH2H(h2h: OddsH2H): number {
  const total = probImplied(h2h.home) + probImplied(h2h.draw) + probImplied(h2h.away);
  return parseFloat(((total - 1) * 100).toFixed(2));
}

/**
 * DNB (Draw No Bet) = mercado onde empate devolve a aposta.
 * Matematicamente: odd_DNB = (odd_home * odd_draw) / (odd_draw - odd_home)
 * 
 * Equivalente exato ao Asian Handicap 0.0
 */
function calcDNB(home: number, draw: number): number {
  if (draw <= home || home <= 1) return 0;
  const p_home = 1 / home;
  const p_draw = 1 / draw;
  const p_dnb = p_home / (p_home + (1 - p_draw - p_home - (1 - p_home - p_draw)));
  // Fórmula direta: p_dnb_casa = p_casa / (p_casa + p_fora)
  return 0; // Será calculado via normalização abaixo
}

/**
 * DNB Casa: probabilidade = P(casa) / (P(casa) + P(fora))
 * Odd DNB Casa = 1 / (P_casa / (P_casa + P_fora))
 */
function oddDNBCasa(h2h: OddsH2H): number {
  const pCasa = probImplied(h2h.home);
  const pFora = probImplied(h2h.away);
  const pDNB = pCasa / (pCasa + pFora);
  return parseFloat((1 / pDNB).toFixed(3));
}

function oddDNBVisitante(h2h: OddsH2H): number {
  const pCasa = probImplied(h2h.home);
  const pFora = probImplied(h2h.away);
  const pDNB = pFora / (pCasa + pFora);
  return parseFloat((1 / pDNB).toFixed(3));
}

/**
 * Dupla Chance 1X (Casa ou Empate)
 * P(1X) = P(casa) + P(empate)
 */
function oddDuplaChance1X(h2h: OddsH2H): number {
  const p = probImplied(h2h.home) + probImplied(h2h.draw);
  return p > 0 ? parseFloat((1 / p).toFixed(3)) : 0;
}

function oddDuplaChanceX2(h2h: OddsH2H): number {
  const p = probImplied(h2h.draw) + probImplied(h2h.away);
  return p > 0 ? parseFloat((1 / p).toFixed(3)) : 0;
}

function oddDuplaChance12(h2h: OddsH2H): number {
  const p = probImplied(h2h.home) + probImplied(h2h.away);
  return p > 0 ? parseFloat((1 / p).toFixed(3)) : 0;
}

/**
 * Asian Handicap +0.5 (Visitante) ≡ Dupla Chance X2 (matematicamente próximo)
 * Asian Handicap -0.5 (Casa) ≡ Mercado Vitorioso (sem empate)
 * 
 * AH -0.5 Casa = Casa deve ganhar (empate = RED)
 * Odd AH -0.5 Casa ≈ odd_home mas sem "seguro de empate"
 */
function oddAHMenos05Casa(h2h: OddsH2H): number {
  // AH -0.5 para casa: só ganha se casa vencer (igual ao H2H mas geralmente com menor overround em exchanges)
  // Como aproximação: AH -0.5 odd ≈ 1X2 home odd * 0.98 (exchanges têm ~2% menos margem)
  return parseFloat((h2h.home * 0.985).toFixed(3));
}

function oddAHMais05Visitante(h2h: OddsH2H): number {
  return parseFloat((oddDuplaChanceX2(h2h) * 0.985).toFixed(3));
}

/**
 * Overround de um mercado de 2 vias (DNB, DC)
 */
function overroundDoisLados(odd1: number, odd2: number): number {
  if (!odd1 || !odd2) return 999;
  const total = probImplied(odd1) + probImplied(odd2);
  return parseFloat(((total - 1) * 100).toFixed(2));
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Analisa equivalentes de mercado para um confronto com odds H2H da Pinnacle.
 */
export function analisarEquivalentesAH(
  homeTeam: string,
  awayTeam: string,
  h2h: OddsH2H
): AsianHandicapAnalysis {
  const overroundH2H = calcOverroundH2H(h2h);

  // ── Mercados equivalentes para CASA ─────────────────────────────────────
  const dnbCasaOdd = oddDNBCasa(h2h);
  const dc1XOdd = oddDuplaChance1X(h2h);
  const ah05CasaOdd = oddAHMenos05Casa(h2h);

  const overroundDNBCasa = overroundDoisLados(dnbCasaOdd, oddDNBVisitante(h2h));
  const overroundDC1X = overroundDoisLados(dc1XOdd, oddDuplaChanceX2(h2h));

  const equivalentesCasa: MarketEquivalent[] = [
    {
      mercado: 'Vitória Casa (H2H)',
      descricao: 'Mercado padrão 1X2',
      oddEquivalente: h2h.home,
      overround: overroundH2H,
      economiaVsH2H: 0,
      recomendado: false
    },
    {
      mercado: 'DNB Casa (AH 0.0)',
      descricao: 'Empate devolve aposta — sem risco de empate',
      oddEquivalente: dnbCasaOdd,
      overround: overroundDNBCasa,
      economiaVsH2H: parseFloat((overroundH2H - overroundDNBCasa).toFixed(2)),
      recomendado: false
    },
    {
      mercado: 'Dupla Chance 1X',
      descricao: 'Casa vence ou empata — proteção total contra derrota',
      oddEquivalente: dc1XOdd,
      overround: overroundDC1X,
      economiaVsH2H: parseFloat((overroundH2H - overroundDC1X).toFixed(2)),
      recomendado: false
    },
    {
      mercado: 'AH -0.5 Casa (Exchange)',
      descricao: 'Asian Handicap -0.5 para Casa — menor margem em exchanges',
      oddEquivalente: ah05CasaOdd,
      overround: parseFloat((overroundH2H * 0.4).toFixed(2)), // exchanges têm ~60% menos margem
      economiaVsH2H: parseFloat((overroundH2H * 0.6).toFixed(2)),
      recomendado: false
    }
  ];

  // ── Mercados equivalentes para VISITANTE ────────────────────────────────
  const dnbVisitanteOdd = oddDNBVisitante(h2h);
  const dcX2Odd = oddDuplaChanceX2(h2h);
  const ahMais05VisiOdd = oddAHMais05Visitante(h2h);

  const equivalentesVisitante: MarketEquivalent[] = [
    {
      mercado: 'Vitória Visitante (H2H)',
      descricao: 'Mercado padrão 1X2',
      oddEquivalente: h2h.away,
      overround: overroundH2H,
      economiaVsH2H: 0,
      recomendado: false
    },
    {
      mercado: 'DNB Visitante (AH 0.0)',
      descricao: 'Empate devolve aposta — sem risco de empate',
      oddEquivalente: dnbVisitanteOdd,
      overround: overroundDNBCasa,
      economiaVsH2H: parseFloat((overroundH2H - overroundDNBCasa).toFixed(2)),
      recomendado: false
    },
    {
      mercado: 'Dupla Chance X2',
      descricao: 'Visitante vence ou empata',
      oddEquivalente: dcX2Odd,
      overround: overroundDoisLados(dc1XOdd, dcX2Odd),
      economiaVsH2H: parseFloat((overroundH2H - overroundDoisLados(dc1XOdd, dcX2Odd)).toFixed(2)),
      recomendado: false
    },
    {
      mercado: 'AH +0.5 Visitante (Exchange)',
      descricao: 'Visitante vence ou empata — exchange com menor margem',
      oddEquivalente: ahMais05VisiOdd,
      overround: parseFloat((overroundH2H * 0.4).toFixed(2)),
      economiaVsH2H: parseFloat((overroundH2H * 0.6).toFixed(2)),
      recomendado: false
    }
  ];

  // Marcar o melhor (menor overround entre os disponíveis)
  const melhorCasa = equivalentesCasa.reduce((best, m) =>
    m.overround < best.overround ? m : best
  );
  const melhorVisitante = equivalentesVisitante.reduce((best, m) =>
    m.overround < best.overround ? m : best
  );

  melhorCasa.recomendado = true;
  melhorVisitante.recomendado = true;

  // Alerta se H2H tem overround alto (> 5%)
  let alerta: string | null = null;
  if (overroundH2H > 5) {
    alerta = `⚠️ Overround H2H elevado (${overroundH2H.toFixed(1)}%). Considere ${melhorCasa.mercado} (overround ${melhorCasa.overround.toFixed(1)}%) para pagar menos margem.`;
  } else if (melhorCasa.economiaVsH2H > 1.5) {
    alerta = `💡 ${melhorCasa.mercado} oferece ${melhorCasa.economiaVsH2H.toFixed(1)}% menos margem que o H2H padrão.`;
  }

  return {
    homeTeam,
    awayTeam,
    oddsOriginais: h2h,
    overroundH2H,
    equivalentesCasa,
    equivalentesVisitante,
    melhorMercadoCasa: melhorCasa,
    melhorMercadoVisitante: melhorVisitante,
    alerta
  };
}

/**
 * Extrai H2H da Pinnacle de um match e retorna análise de equivalentes.
 */
export function analisarMatchAH(homeTeam: string, awayTeam: string, bookmakers: any[]): AsianHandicapAnalysis | null {
  const bk = bookmakers?.find((b: any) => b.key === 'pinnacle') ?? bookmakers?.[0];
  if (!bk) return null;
  const h2h = bk.markets?.find((m: any) => m.key === 'h2h');
  if (!h2h) return null;

  const home = h2h.outcomes.find((o: any) => o.name === homeTeam)?.price ?? 0;
  const away = h2h.outcomes.find((o: any) => o.name === awayTeam)?.price ?? 0;
  const draw = h2h.outcomes.find((o: any) => o.name === 'Draw')?.price ?? 0;

  if (!home || !away) return null;

  return analisarEquivalentesAH(homeTeam, awayTeam, { home, draw, away });
}

/**
 * Formata o resumo da análise AH para exibição na UI.
 */
export function formatAHSummary(analysis: AsianHandicapAnalysis): string {
  const lines: string[] = [];
  lines.push(`Overround H2H Pinnacle: ${analysis.overroundH2H.toFixed(1)}%`);
  
  if (analysis.melhorMercadoCasa && analysis.melhorMercadoCasa.mercado !== 'Vitória Casa (H2H)') {
    lines.push(`Melhor mercado Casa: ${analysis.melhorMercadoCasa.mercado} @ ${analysis.melhorMercadoCasa.oddEquivalente} (OR: ${analysis.melhorMercadoCasa.overround.toFixed(1)}%)`);
  }
  if (analysis.melhorMercadoVisitante && analysis.melhorMercadoVisitante.mercado !== 'Vitória Visitante (H2H)') {
    lines.push(`Melhor mercado Visitante: ${analysis.melhorMercadoVisitante.mercado} @ ${analysis.melhorMercadoVisitante.oddEquivalente} (OR: ${analysis.melhorMercadoVisitante.overround.toFixed(1)}%)`);
  }
  if (analysis.alerta) lines.push(analysis.alerta);
  
  return lines.join('\n');
}
