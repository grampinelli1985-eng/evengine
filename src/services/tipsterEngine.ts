import { callGeminiAPI } from './geminiService';
import { podeEntrarNovaAposta, carregarStopLossState } from './bancaService';

const SYSTEM_PROMPT = `Você é GATE V2.0 — SHARP DECISION ENGINE, o módulo de decisão final do EVEngine.
Seu papel é proteger o capital do usuário emitindo decisões matemáticas precisas e fundamentadas.

Você recebe o payload estruturado com dados factuais de Scout e ELO e o Score Composto pré-calculado pelo motor.

════════════════════════════════════════
REGRAS DE VALIDAÇÃO (Etapas 1 a 5)
════════════════════════════════════════
1. VALIDAÇÃO DO JOGO (Score Composto):
   - Score Composto mínimo exigido: 60/100 (jogo apostável)
   - Tiers aceitos: A e B apenas.
   
2. VALIDAÇÃO INDEPENDENTE DO MERCADO (Regra Crítica):
   - O mercado principal deve ter EV ajustado >= +3% confirmado.
   - Um score composto alto do jogo NUNCA substitui um EV de mercado ruim.
   - Se o mercado selecionado tiver EV < 3%, a aposta é BLOQUEADA [B-EV].
   - SEMPRE faça varredura de mercados alternativos com EV >= +3% e apresente-os no JSON de retorno como alternativa caso o mercado principal esteja bloqueado.

3. CONTEXTO SHARP E PENALIDADES:
   - Os valores de EV e Confiança já foram recalculados no payload pelo motor com base nas seguintes penalidades:
     - Desfalque crítico: -4pp no EV
     - Mandante sem vitória: -3pp no EV
     - Visitante sem motivo: +4pp no EV mandante
     - Playoff Game 2 (Leg 1 0-0): +5pp no EV visitante
     - Elo em calibração: -2pp confiança
     - H2H não verificado: -1pp confiança

4. CÓDIGOS DE BLOQUEIO ABSOLUTOS:
   - [B-EV]    -> EV do mercado selecionado abaixo de +3%
   - [B-CONF]  -> Confiança IA abaixo de 70%
   - [B-SCORE] -> Score composto abaixo de 60 ou Tier inadequado
   - [B-ODD]   -> Odd Bet365 abaixo da odd mínima
   - [B-DADOS] -> Dados específicos de cobertura ausentes (como lineup ou forma)
   - [B-SCOUT] -> Falha crítica de scouting

Retorne SEMPRE o JSON exato no formato:
{
  "status": "APROVADO" | "BLOQUEADO",
  "bloqueio": null | { "codigo": "B-EV" | "B-CONF" | "B-SCORE" | "B-ODD" | "B-DADOS", "motivo": "Explicar de forma direta e matemática" },
  "score": 0-100,
  "mercado": {
    "nome": "Mercado Selecionado",
    "ev": 4.2,
    "odd": 1.85,
    "probabilidade_ia": 68,
    "probabilidade_elo": 65,
    "perfil": "CONSERVADOR",
    "justificativa": "Texto fundamentado e claro detalhando a entrada ou a razão de bloqueio."
  }
}

=======================================================
REGRAS DE PROTEÇÃO PERMANENTES
=======================================================

Estas regras são verificadas pelo bancaService e nunca podem ser
ignoradas mesmo com score 100:

- Stop loss: após 3 REDs consecutivos - suspender apostas por 24h
- Máximo 3 entradas aprovadas por dia
- Nunca aumentar stake após RED (aguardar 2 vitórias consecutivas)
- Drawdown > 20% da banca - modo conservador (stake x 0.50 em tudo)
- Nunca apostar em mais de 2 jogos simultâneos
- Reavaliar análise se odd mudar > 5% entre análise e execução

=======================================================
GLOSSÁRIO INTERNO
=======================================================

EV = Expected Value = (probabilidade_ia x odd) - 1
Kelly = (prob x odd - 1) / (odd - 1)
CLV = (odd_apostada / odd_fechamento - 1) x 100
Steam Move = movimento de linha >= 8% em < 2 horas por sharp money
Reverse Line Move = linha vai contra o lado que recebe maior volume público
Delta ELOxGemini = |prob_elo - prob_gemini| em pontos percentuais
`;

import { DecisaoEngine, EngineInput } from '../types/decisao';
import { analyzeGoalsMarket, calculateTeamPower } from './goalsService';
import {
  calcNJogosEfetivos,
  calcCVLambda,
  calcShrinkageAlpha,
  gateConfiancaDados,
  JogoPonderado,
  pesoTemporalJogo
} from './valueBetService';

const gateCache = new Map<string, string>();

// Returns null when form data is unavailable so callers can trigger B-DADOS
// instead of silently feeding the Poisson model with invented goal counts.
// When form IS available, uses league-average goal distributions per result
// (win ~1.8 GF / 0.7 GA, draw ~1.1 / 1.1, loss ~0.6 GF / 1.9 GA) so that
// the lambda estimates are statistically grounded, not fixed proxies.
function mapFormToGoals(form: string[] | undefined, _isHome: boolean): { lastGoalsFor: number[]; lastGoalsAgainst: number[]; isSynthetic?: boolean } | null {
  if (!form || form.length === 0) return null;

  const lastGoalsFor: number[] = [];
  const lastGoalsAgainst: number[] = [];

  form.forEach(char => {
    const c = char.toUpperCase();
    if (c === 'V' || c === 'W') {
      // Win: avg ~1.8 GF, ~0.7 GA (rounded to nearest integer for Poisson seed)
      lastGoalsFor.push(2);
      lastGoalsAgainst.push(1);
    } else if (c === 'E') {
      // Draw: avg ~1.1 / 1.1
      lastGoalsFor.push(1);
      lastGoalsAgainst.push(1);
    } else if (c === 'D' || c === 'L') {
      // Loss: avg ~0.6 GF, ~1.9 GA
      lastGoalsFor.push(1);
      lastGoalsAgainst.push(2);
    } else {
      lastGoalsFor.push(1);
      lastGoalsAgainst.push(1);
    }
  });

  return { lastGoalsFor, lastGoalsAgainst, isSynthetic: true };
}

export interface SanidadeOddsResult {
  passo1_limite: 'OK' | 'ODD_IMPLAUSIVEL';
  passo2_simetria: 'OK' | 'COMPARACAO_INVERTIDA';
  passo3_desvio: 'OK' | 'DESVIO_IMPLAUSIVEL' | 'DESVIO_CONFIRMADO';
  retry_executado: boolean;
  retry_resultado: 'CORRIGIDO' | 'FALHOU' | 'N/A';
  odd_pinnacle_final: number;
  odd_bet365_final: number;
  desvio_final: number | null;
  desvio_valido: boolean;
  observacao: string;
  mapeamento_status?: 'FALHOU' | 'OK';
  erro_tipo?: string;
  desvio_calculado?: number | null;
  recomendacao?: string;
}

export function checkOddsSanity(
  analysis: any,
  chosenCandidate: { nome: string; type: string; odd_api: number },
  oddBet365: number | null
): SanidadeOddsResult {
  const result: SanidadeOddsResult = {
    passo1_limite: 'OK',
    passo2_simetria: 'OK',
    passo3_desvio: 'OK',
    retry_executado: false,
    retry_resultado: 'N/A',
    odd_pinnacle_final: chosenCandidate.odd_api,
    odd_bet365_final: oddBet365 ?? 0,
    desvio_final: null,
    desvio_valido: false,
    observacao: ''
  };

  if (oddBet365 === null || isNaN(oddBet365) || oddBet365 <= 0) {
    result.observacao = 'Odd Bet365 não informada ou inválida.';
    return result;
  }

  const nameLower = chosenCandidate.nome.toLowerCase();

  // ─── PASSO 1: LIMITES DE ODD POR MERCADO ───
  let maxOddLimit = Infinity;
  let minOddLimit = 1.01;
  let isML = chosenCandidate.type === '1x2';
  let isDC = chosenCandidate.type === 'double_chance' || chosenCandidate.nome.startsWith('Dupla Chance');
  let isGoals = chosenCandidate.type === 'goals' || nameLower.includes('gols') || nameLower.includes('ambos') || nameLower.includes('over') || nameLower.includes('under') || nameLower.includes('btb');

  if (isGoals) {
    if (nameLower.includes('over 0.5')) maxOddLimit = 1.30;
    else if (nameLower.includes('over 1.5')) maxOddLimit = 1.80;
    else if (nameLower.includes('over 2.5')) maxOddLimit = 3.00;
    else if (nameLower.includes('over 3.5')) maxOddLimit = 4.50;
    else if (nameLower.includes('under 0.5')) minOddLimit = 3.00;
    else if (nameLower.includes('under 1.5')) minOddLimit = 1.80;
    else if (nameLower.includes('under 2.5')) minOddLimit = 1.40;
  } else if (isDC) {
    if (chosenCandidate.nome.includes('1X')) maxOddLimit = 1.60;
    else if (chosenCandidate.nome.includes('X2')) maxOddLimit = 2.00;
    else if (chosenCandidate.nome.includes('12')) maxOddLimit = 1.50;
  } else if (isML) {
    const homeElo = analysis?.elo?.ranking?.home_ranking ?? 1500;
    const awayElo = analysis?.elo?.ranking?.away_ranking ?? 1500;
    const eloDelta = Math.abs(homeElo - awayElo);
    const isCasaFav = homeElo >= awayElo;
    const isMLCasa = chosenCandidate.nome === 'Vitória Casa';
    const isMLFora = chosenCandidate.nome === 'Vitória Fora';
    const isFavSelected = (isMLCasa && isCasaFav) || (isMLFora && !isCasaFav);

    if (isFavSelected) {
      if (eloDelta > 150) maxOddLimit = 1.50;
      else if (eloDelta >= 100) maxOddLimit = 1.80;
      else if (eloDelta >= 50) maxOddLimit = 2.20;
      else maxOddLimit = 2.80;
    }
  }

  if (oddBet365 > maxOddLimit || oddBet365 < minOddLimit) {
    result.passo1_limite = 'ODD_IMPLAUSIVEL';
  }

  // ─── PASSO 2: VERIFICAÇÃO DE SIMETRIA ───
  let passo2_simetria: 'OK' | 'COMPARACAO_INVERTIDA' = 'OK';
  if (analysis?.odds?.comparacao_invertida === true) {
    passo2_simetria = 'COMPARACAO_INVERTIDA';
  } else if (analysis?.odds?.bet365_market_name) {
    const bet365Name = analysis.odds.bet365_market_name.toLowerCase();
    const pinnName = chosenCandidate.nome.toLowerCase();

    const isOverP = pinnName.includes('over');
    const isUnderP = pinnName.includes('under');
    const isOverB = bet365Name.includes('over');
    const isUnderB = bet365Name.includes('under');

    if ((isOverP && isUnderB) || (isUnderP && isOverB)) {
      passo2_simetria = 'COMPARACAO_INVERTIDA';
    }

    const isCasaP = pinnName.includes('casa') || pinnName.includes('1');
    const isForaP = pinnName.includes('fora') || pinnName.includes('2');
    const isCasaB = bet365Name.includes('casa') || bet365Name.includes('1');
    const isForaB = bet365Name.includes('fora') || bet365Name.includes('2');

    if ((isCasaP && isForaB) || (isForaP && isCasaB)) {
      passo2_simetria = 'COMPARACAO_INVERTIDA';
    }
  }
  result.passo2_simetria = passo2_simetria;

  // ─── PASSO 3: LIMITE DE DESVIO POR MERCADO ───
  let limite_mercado = 20; // default 20%
  if (isGoals) {
    if (nameLower.includes('over 0.5') || nameLower.includes('under 0.5')) limite_mercado = 8;
    else if (nameLower.includes('over 1.5') || nameLower.includes('under 1.5')) limite_mercado = 12;
    else if (nameLower.includes('over 2.5') || nameLower.includes('under 2.5')) limite_mercado = 18;
    else if (nameLower.includes('over 3.5') || nameLower.includes('under 3.5')) limite_mercado = 22;
  } else if (isDC) {
    limite_mercado = 15;
  } else if (isML) {
    const homeElo = analysis?.elo?.ranking?.home_ranking ?? 1500;
    const awayElo = analysis?.elo?.ranking?.away_ranking ?? 1500;
    const isCasaFav = homeElo >= awayElo;
    const isMLCasa = chosenCandidate.nome === 'Vitória Casa';
    const isMLFora = chosenCandidate.nome === 'Vitória Fora';
    const isFavSelected = (isMLCasa && isCasaFav) || (isMLFora && !isCasaFav);
    limite_mercado = isFavSelected ? 25 : 20;
  } else if (nameLower.includes('handicap') || nameLower.includes('asiático') || nameLower.includes('asiatico')) {
    limite_mercado = 20;
  }

  const rawDesvio = ((oddBet365 - chosenCandidate.odd_api) / chosenCandidate.odd_api) * 100;
  if (Math.abs(rawDesvio) > limite_mercado * 2) {
    result.passo3_desvio = 'DESVIO_IMPLAUSIVEL';
  }

  // ─── PASSO 4: PROTOCOLO DE RETRY ───
  let finalOddBet365 = oddBet365;
  let finalPasso1 = result.passo1_limite;
  let finalPasso2 = result.passo2_simetria;
  let finalPasso3 = result.passo3_desvio;

  if (result.passo1_limite !== 'OK' || result.passo2_simetria !== 'OK' || result.passo3_desvio !== 'OK') {
    result.retry_executado = true;

    // Check if backup odd resolves the issues
    const backupOdd = analysis?.odds?.retry_odd ?? analysis?.odds?.backup_odd;
    if (backupOdd && backupOdd !== oddBet365) {
      // Re-run Passo 1 check for backupOdd
      let backupPasso1: 'OK' | 'ODD_IMPLAUSIVEL' = 'OK';
      if (backupOdd > maxOddLimit || backupOdd < minOddLimit) {
        backupPasso1 = 'ODD_IMPLAUSIVEL';
      }

      // Re-run Passo 3 check for backupOdd
      let backupPasso3: 'OK' | 'DESVIO_IMPLAUSIVEL' = 'OK';
      const backupDesvio = ((backupOdd - chosenCandidate.odd_api) / chosenCandidate.odd_api) * 100;
      if (Math.abs(backupDesvio) > limite_mercado * 2) {
        backupPasso3 = 'DESVIO_IMPLAUSIVEL';
      }

      if (backupPasso1 === 'OK' && finalPasso2 === 'OK' && backupPasso3 === 'OK') {
        finalOddBet365 = backupOdd;
        finalPasso1 = 'OK';
        finalPasso3 = 'OK';
        result.retry_resultado = 'CORRIGIDO';
      } else {
        result.retry_resultado = 'FALHOU';
      }
    } else {
      result.retry_resultado = 'FALHOU';
    }
  }

  // Set final values after retry
  result.odd_bet365_final = finalOddBet365;
  result.passo1_limite = finalPasso1;
  result.passo2_simetria = finalPasso2;

  const finalDesvio = ((finalOddBet365 - chosenCandidate.odd_api) / chosenCandidate.odd_api) * 100;
  result.desvio_final = parseFloat(finalDesvio.toFixed(1));

  if (finalPasso1 === 'OK' && finalPasso2 === 'OK') {
    if (finalPasso3 === 'OK') {
      result.desvio_valido = true;
    } else if (finalPasso3 === 'DESVIO_IMPLAUSIVEL' && result.retry_resultado === 'FALHOU') {
      // Retry failed to correct the implausible deviation -> Confirm it as valid but flagged
      result.passo3_desvio = 'DESVIO_CONFIRMADO';
      result.desvio_valido = true;
      result.observacao = `Desvio ${result.desvio_final}% excede limite plausível de ${limite_mercado}% para mercado ${chosenCandidate.nome}. Mapeamento verificado e desvio confirmado por retry.`;
    }
  } else {
    result.desvio_valido = false;
    result.desvio_final = null;
    if (finalPasso1 === 'ODD_IMPLAUSIVEL') {
      result.observacao = `Odd ${finalOddBet365} incompatível com mercado ${chosenCandidate.nome}. Reverificar mapeamento na Bet365 antes de continuar.`;
      result.mapeamento_status = 'FALHOU';
      result.erro_tipo = 'ODD_IMPLAUSIVEL';
      result.desvio_calculado = null;
      result.recomendacao = 'Não calcular B-DESVIO. Análise sem comparativo de linha disponível.';
    } else if (finalPasso2 === 'COMPARACAO_INVERTIDA') {
      result.observacao = `Inversão de comparação detectada no mercado ${chosenCandidate.nome} vs Bet365.`;
      result.mapeamento_status = 'FALHOU';
      result.erro_tipo = 'COMPARACAO_INVERTIDA';
      result.desvio_calculado = null;
      result.recomendacao = 'Não calcular B-DESVIO. Análise sem comparativo de linha disponível.';
    }
  }

  return result;
}

export function parseTimestamp(ts: string | any, currentLocalTime?: string): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;

  const baseDate = currentLocalTime
    ? new Date(currentLocalTime)
    : new Date();

  if (typeof ts === 'string') {
    if (ts.includes('T') || ts.includes('-')) {
      const parsed = new Date(ts);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    const matches = ts.match(/^(\d{1,2}):(\d{2})$/);
    if (matches) {
      const hours = parseInt(matches[1], 10);
      const minutes = parseInt(matches[2], 10);
      const d = new Date(baseDate);
      d.setHours(hours, minutes, 0, 0);
      return d;
    }
  } else if (typeof ts === 'number') {
    return new Date(ts);
  }
  return null;
}

export function isTimestampWithin15Mins(tsDate: Date | null, currentLocalTime?: string): boolean {
  if (!tsDate) return false;
  const now = currentLocalTime ? new Date(currentLocalTime) : new Date();
  const diffMs = Math.abs(now.getTime() - tsDate.getTime());
  return diffMs <= 15 * 60 * 1000;
}

export interface Bloco6Result {
  linha: {
    odd_abertura: number;
    odd_atual: number;
    fonte: string;
    timestamp: string;
    timestamp_valido: boolean;
    movimento_pts: number;
    movimento_direcao: 'caiu' | 'subiu' | 'estavel';
    movimento_classificacao: 'minimo' | 'moderado' | 'relevante' | 'forte' | 'extremo';
    sinal_sharp: 'SHARP_COMPRANDO' | 'SHARP_VENDENDO' | 'NEUTRO';
    validacao_cruzada: 'CONSISTENTE' | 'DIVERGENTE' | 'LINHA_DESATUALIZADA';
    odd_usada_ev: number;
    ev_abertura: number;
    ev_real: number;
    diferenca_ev: number;
    alerta_movimento: boolean;
  };
  adjustedConfianca: number;
  block?: { codigo: string; motivo: string };
  alerta_mensagem?: string;
  lineFlags: string[];
}

export function processBloco6(
  analysis: any,
  chosenCandidate: { nome: string; type: string; odd_api: number; prob_ia: number; probabilidadeIaCalibrada?: number },
  baseConfianca: number,
  currentLocalTime?: string
): Bloco6Result {
  const now = currentLocalTime
    ? new Date(currentLocalTime)
    : (analysis?.currentLocalTime ? new Date(analysis.currentLocalTime) : new Date());

  const formatHHMM = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const hasBloco6Fields = !!(
    analysis?.linha !== undefined ||
    analysis?.odds?.pinnacle_direto_odd ||
    analysis?.odds?.oddschecker_odd ||
    analysis?.odds?.betfair_odd ||
    analysis?.odds?.agregador_odd
  );

  let odd_atual: number | null = null;
  let fonte = '';
  let timestamp = '';
  let timestamp_valido = false;
  let adjustedConfianca = baseConfianca;
  let blockObj: { codigo: string; motivo: string } | undefined = undefined;

  if (!hasBloco6Fields) {
    // Backward compatibility: use chosenCandidate.odd_api as odd_atual
    odd_atual = chosenCandidate.odd_api;
    fonte = 'pinnacle_direto';
    timestamp = formatHHMM(now);
    timestamp_valido = true;
  } else {
    // Extract source candidates
    const pinnacle_direto_odd = analysis.linha?.pinnacle_direto_odd ?? analysis.odds?.pinnacle_direto_odd ?? analysis.odds?.pinnacle_com;
    const pinnacle_direto_timestamp = analysis.linha?.pinnacle_direto_timestamp ?? analysis.linha?.timestamp ?? analysis.odds?.pinnacle_timestamp ?? analysis.odds?.timestamp ?? analysis.odds?.last_update;

    const oddschecker_odd = analysis.linha?.oddschecker_odd ?? analysis.odds?.oddschecker_odd ?? analysis.linha?.oddschecker_pinnacle ?? analysis.odds?.oddschecker_pinnacle;
    const betfair_odd = analysis.linha?.betfair_odd ?? analysis.odds?.betfair_odd ?? analysis.linha?.betfair_equivalente ?? analysis.odds?.betfair_equivalente;

    const agregador_odd = analysis.linha?.agregador_odd ?? analysis.odds?.agregador_odd ?? analysis.linha?.secundaria_odd ?? analysis.odds?.secundaria_odd ?? analysis.odds?.secundaria ?? analysis.linha?.agregador ?? analysis.odds?.agregador;

    // Source 1: Direct pinnacle.com
    let isFonte1Valid = false;
    if (pinnacle_direto_odd && !isNaN(pinnacle_direto_odd)) {
      const parsedTs = parseTimestamp(pinnacle_direto_timestamp, currentLocalTime);
      if (parsedTs && isTimestampWithin15Mins(parsedTs, currentLocalTime)) {
        odd_atual = pinnacle_direto_odd;
        fonte = 'pinnacle_direto';
        timestamp = typeof pinnacle_direto_timestamp === 'string' && pinnacle_direto_timestamp.match(/^\d{1,2}:\d{2}$/)
          ? pinnacle_direto_timestamp
          : formatHHMM(parsedTs);
        timestamp_valido = true;
        isFonte1Valid = true;
      }
    }

    // Source 2: oddschecker/betfair
    if (!isFonte1Valid) {
      if ((oddschecker_odd && !isNaN(oddschecker_odd)) || (betfair_odd && !isNaN(betfair_odd))) {
        if (oddschecker_odd && betfair_odd) {
          const diffPercent = Math.abs(oddschecker_odd - betfair_odd) / oddschecker_odd * 100;
          if (diffPercent <= 2) {
            odd_atual = (oddschecker_odd + betfair_odd) / 2;
          } else {
            odd_atual = Math.min(oddschecker_odd, betfair_odd);
          }
          fonte = 'oddschecker';
        } else {
          odd_atual = oddschecker_odd ?? betfair_odd;
          fonte = oddschecker_odd ? 'oddschecker' : 'betfair';
        }
        timestamp = formatHHMM(now);
        timestamp_valido = true;
      }
    }

    // Source 3: agregadores gerais
    if (odd_atual === null) {
      if (agregador_odd && !isNaN(agregador_odd)) {
        odd_atual = agregador_odd;
        fonte = 'fonte_secundaria';
        timestamp = formatHHMM(now);
        timestamp_valido = true;
        adjustedConfianca -= 5;
      }
    }

    // Fallback: use generic fields
    if (odd_atual === null) {
      const fallbackOdd = analysis.linha?.odd_atual ?? analysis.odds?.atual;
      const fallbackFonte = analysis.linha?.fonte ?? analysis.odds?.fonte ?? 'pinnacle_direto';
      const fallbackTs = analysis.linha?.timestamp ?? analysis.odds?.timestamp ?? analysis.odds?.last_update;

      if (fallbackOdd && !isNaN(fallbackOdd)) {
        odd_atual = fallbackOdd;
        fonte = fallbackFonte;

        const parsedTs = parseTimestamp(fallbackTs, currentLocalTime);
        if (parsedTs) {
          timestamp_valido = isTimestampWithin15Mins(parsedTs, currentLocalTime);
          timestamp = typeof fallbackTs === 'string' && fallbackTs.match(/^\d{1,2}:\d{2}$/) ? fallbackTs : formatHHMM(parsedTs);
        } else {
          timestamp_valido = true;
          timestamp = formatHHMM(now);
        }

        if (fonte === 'fonte_secundaria') {
          adjustedConfianca -= 5;
        }
      }
    }

    // Stale Pinnacle directe fallback
    if (odd_atual === null && pinnacle_direto_odd && !isNaN(pinnacle_direto_odd)) {
      odd_atual = pinnacle_direto_odd;
      fonte = 'pinnacle_direto';
      const parsedTs = parseTimestamp(pinnacle_direto_timestamp, currentLocalTime);
      timestamp = parsedTs ? formatHHMM(parsedTs) : (typeof pinnacle_direto_timestamp === 'string' ? pinnacle_direto_timestamp : '');
      timestamp_valido = false;
    }
  }

  // LINHA_INDISPONIVEL veto
  if (odd_atual === null) {
    return {
      linha: {
        odd_abertura: chosenCandidate.odd_api,
        odd_atual: 0,
        fonte: 'LINHA_INDISPONIVEL',
        timestamp: '',
        timestamp_valido: false,
        movimento_pts: 0,
        movimento_direcao: 'estavel',
        movimento_classificacao: 'minimo',
        sinal_sharp: 'NEUTRO',
        validacao_cruzada: 'CONSISTENTE',
        odd_usada_ev: 0,
        ev_abertura: 0,
        ev_real: 0,
        diferenca_ev: 0,
        alerta_movimento: false
      },
      adjustedConfianca,
      block: {
        codigo: 'B-SCOUT',
        motivo: 'Odd Pinnacle indisponível em tempo real. EV não calculável com segurança.'
      },
      lineFlags: []
    };
  }

  // Step 2: Line movement
  const odd_abertura = analysis?.linha?.odd_abertura ?? analysis?.odds?.abertura ?? analysis?.odds?.opening ?? chosenCandidate.odd_api;
  const movimento_pts = odd_abertura - odd_atual;
  let movimento_direcao: 'caiu' | 'subiu' | 'estavel' = 'estavel';
  let sinal_sharp: 'SHARP_COMPRANDO' | 'SHARP_VENDENDO' | 'NEUTRO' = 'NEUTRO';
  let mag_pts = 0;

  if (movimento_pts > 0.0001) {
    movimento_direcao = 'caiu';
    sinal_sharp = 'SHARP_COMPRANDO';
    mag_pts = movimento_pts;
  } else if (movimento_pts < -0.0001) {
    movimento_direcao = 'subiu';
    sinal_sharp = 'SHARP_VENDENDO';
    mag_pts = Math.abs(movimento_pts);
  } else {
    movimento_direcao = 'estavel';
    sinal_sharp = 'NEUTRO';
    mag_pts = 0;
  }

  let movimento_classificacao: 'minimo' | 'moderado' | 'relevante' | 'forte' | 'extremo' = 'minimo';
  let lineFlags: string[] = [];

  if (mag_pts <= 0.05) {
    movimento_classificacao = 'minimo';
  } else if (mag_pts <= 0.15) {
    movimento_classificacao = 'moderado';
  } else if (mag_pts <= 0.30) {
    movimento_classificacao = 'relevante';
    if (sinal_sharp === 'SHARP_COMPRANDO') {
      adjustedConfianca += 5;
    } else if (sinal_sharp === 'SHARP_VENDENDO') {
      adjustedConfianca -= 5;
    }
  } else if (mag_pts <= 0.50) {
    movimento_classificacao = 'forte';
    lineFlags.push('LINE_MOVEMENT_FORTE');
    if (sinal_sharp === 'SHARP_COMPRANDO') {
      adjustedConfianca += 10;
    } else if (sinal_sharp === 'SHARP_VENDENDO') {
      adjustedConfianca -= 10;
    }
  } else {
    movimento_classificacao = 'extremo';
    lineFlags.push('LINE_MOVEMENT_EXTREMO');
    lineFlags.push('REVISAO_MANUAL_OBRIGATORIA');
    if (sinal_sharp === 'SHARP_COMPRANDO') {
      adjustedConfianca += 15;
    } else if (sinal_sharp === 'SHARP_VENDENDO') {
      adjustedConfianca -= 15;
    }
  }

  // Step 3: Source cross validation
  let validacao_cruzada: 'CONSISTENTE' | 'DIVERGENTE' | 'LINHA_DESATUALIZADA' = 'CONSISTENTE';
  let diff_cruzada = 0;

  if (hasBloco6Fields) {
    const pinnacle_direto_odd = analysis.linha?.pinnacle_direto_odd ?? analysis.odds?.pinnacle_direto_odd ?? analysis.odds?.pinnacle_com;
    const oddschecker_odd = analysis.linha?.oddschecker_odd ?? analysis.odds?.oddschecker_odd ?? analysis.linha?.oddschecker_pinnacle ?? analysis.odds?.oddschecker_pinnacle;
    const betfair_odd = analysis.linha?.betfair_odd ?? analysis.odds?.betfair_odd ?? analysis.linha?.betfair_equivalente ?? analysis.odds?.betfair_equivalente;

    if (pinnacle_direto_odd && (oddschecker_odd || betfair_odd)) {
      const f1 = pinnacle_direto_odd;
      const f2 = oddschecker_odd ?? betfair_odd;
      diff_cruzada = Math.abs(f1 - f2) / f1 * 100;

      if (diff_cruzada <= 2) {
        validacao_cruzada = 'CONSISTENTE';
        odd_atual = (f1 + f2) / 2;
      } else if (diff_cruzada <= 5) {
        validacao_cruzada = 'DIVERGENTE';
        odd_atual = Math.min(f1, f2);
      } else {
        validacao_cruzada = 'LINHA_DESATUALIZADA';
        lineFlags.push('LINHA_DESATUALIZADA');
        odd_atual = Math.min(f1, f2);
      }
    }
  }

  // Step 4: EV Recalculation
  const prob_ia = chosenCandidate.probabilidadeIaCalibrada ?? chosenCandidate.prob_ia;
  const ev_abertura = parseFloat((((prob_ia / 100) * odd_abertura - 1) * 100).toFixed(2));
  const ev_real = parseFloat((((prob_ia / 100) * odd_atual - 1) * 100).toFixed(2));
  const diferenca_ev = parseFloat((ev_abertura - ev_real).toFixed(2));

  // Step 5: Urgency Protocol
  const commence_time = analysis?.matchData?.commence_time ?? analysis?.commence_time;
  let alerta_movimento = false;
  let alerta_mensagem = '';

  if (commence_time) {
    const kickoffMs = new Date(commence_time).getTime();
    const nowMs = now.getTime();
    const diffHours = (kickoffMs - nowMs) / (1000 * 60 * 60);

    if (diffHours > 0 && diffHours < 2) {
      if (mag_pts > 0.15) {
        alerta_movimento = true;
        const dirText = movimento_direcao === 'caiu' ? 'caiu' : 'subiu';
        const novoEV = ev_real;
        const statusPos = novoEV >= 3 ? 'APROVADO MANTIDO' : 'RECLASSIFICADO';

        alerta_mensagem = `⚡ LINHA MOVEU: ${chosenCandidate.nome}\nOdd anterior: ${odd_abertura.toFixed(2)} → Odd atual: ${odd_atual.toFixed(2)}\nMovimento: ${mag_pts.toFixed(2)} pts (${dirText})\nEV recalculado: ${novoEV.toFixed(1)}%\n[${statusPos}]`;

        if (novoEV < 3) {
          blockObj = {
            codigo: 'B-EV',
            motivo: `Bloqueado via Protocolo de Urgência (<2h kickoff): EV recalculado com a odd atual (${odd_atual.toFixed(2)}) caiu abaixo de +3% (EV real: ${novoEV.toFixed(1)}%).`
          };
        }
      }
    }
  }

  // Default stale timestamp check blocking
  if (!blockObj && !timestamp_valido) {
    blockObj = {
      codigo: 'B-SCOUT',
      motivo: `Timestamp da Pinnacle desatualizado (> 15 min). Rebuscar linha antes de qualquer decisão.`
    };
  }

  return {
    linha: {
      odd_abertura,
      odd_atual,
      fonte,
      timestamp,
      timestamp_valido,
      movimento_pts: parseFloat(mag_pts.toFixed(2)),
      movimento_direcao,
      movimento_classificacao,
      sinal_sharp,
      validacao_cruzada,
      odd_usada_ev: odd_atual,
      ev_abertura,
      ev_real,
      diferenca_ev,
      alerta_movimento
    },
    adjustedConfianca: Math.max(0, Math.min(100, adjustedConfianca)),
    block: blockObj,
    alerta_mensagem,
    lineFlags
  };
}

export async function runTipsterEngine(
  input: EngineInput,
  legacyMatchCardValues?: any // Mantido para compatibilidade temporária
): Promise<DecisaoEngine & any> {
  const { analysis, matchCardValues: inputMatchCard, oddManualBet365, bancaTotal, userConfirmedAudit, currentLocalTime } = input;

  if (!podeEntrarNovaAposta(input.pendentesCount)) {
    const estado = carregarStopLossState();
    return {
      status: 'BLOQUEADO',
      bloqueado: true,
      motivo: 'STOP_LOSS_ATIVO',
      streak: estado.redStreakAtual,
      bloqueio: {
        codigo: 'B-STOP-LOSS',
        motivo: `Stop Loss Ativado: ${estado.redStreakAtual} apostas consecutivas perdidas.`
      },
      mercado: {
        nome: 'Nenhum',
        ev: 0,
        odd: 0,
        probabilidade_ia: 0,
        probabilidade_elo: 0,
        perfil: 'CONSERVADOR',
        justificativa: `Novas entradas estão bloqueadas pelo Stop Loss ativo (${estado.redStreakAtual} reds consecutivos).`
      }
    };
  }

  try {
    // ─── VALUES FROM MATCHCARD ──────────────────────────
    const tier = inputMatchCard?.tier ?? legacyMatchCardValues?.tier ?? 'C';
    const confianca = inputMatchCard?.confianca ?? legacyMatchCardValues?.confianca ?? 0;

    // Helper for mapping Win/Draw/Loss form to goal arrays
    const homeForm = analysis.scouting?.home_form;
    const awayForm = analysis.scouting?.away_form;
    const homeGoals = analysis.scouting?.home_goals || mapFormToGoals(homeForm, true);
    const awayGoals = analysis.scouting?.away_goals || mapFormToGoals(awayForm, false);
    const goalsDataUnavailable = homeGoals === null || awayGoals === null;
    // Fallback neutral power when form is unavailable; goals markets will be
    // excluded from candidates below to avoid Poisson estimates from null data.
    const NEUTRAL_GOALS = { lastGoalsFor: [1, 1, 1, 1, 1], lastGoalsAgainst: [1, 1, 1, 1, 1] };
    const homePower = calculateTeamPower(homeGoals ?? NEUTRAL_GOALS);
    const awayPower = calculateTeamPower(awayGoals ?? NEUTRAL_GOALS);

    // Extract bookmaker odds
    const bookmaker = analysis.matchData?.bookmakers?.[0] || analysis.valueBet?.report?.bookmakers?.[0];
    const totalsMarket = bookmaker?.markets?.find((m: any) => m.key === 'totals');
    const bttsMarket = bookmaker?.markets?.find((m: any) => m.key === 'btts' || m.key === 'btb');

    let over_0_5 = totalsMarket?.outcomes?.find((o: any) => o.name === 'Over 0.5' || o.name === 'Over 0.5 Goals')?.price;
    let over_1_5 = totalsMarket?.outcomes?.find((o: any) => o.name === 'Over 1.5' || o.name === 'Over 1.5 Goals')?.price;
    let over_2_5 = totalsMarket?.outcomes?.find((o: any) => o.name === 'Over 2.5' || o.name === 'Over 2.5 Goals')?.price;
    let over_3_5 = totalsMarket?.outcomes?.find((o: any) => o.name === 'Over 3.5' || o.name === 'Over 3.5 Goals')?.price;
    let btb = bttsMarket?.outcomes?.find((o: any) => o.name === 'Yes' || o.name === 'btb' || o.name === 'Ambos' || o.name === 'Both')?.price;

    if (!over_0_5) over_0_5 = 1.05;
    if (!over_1_5) over_1_5 = 1.25;
    if (!over_2_5) over_2_5 = 1.85;
    if (!over_3_5) over_3_5 = 3.10;
    if (!btb) btb = 1.80;

    const goalsOdds = { over_0_5, over_1_5, over_2_5, over_3_5, btb };

    // Run analyzeGoalsMarket
    const goalsAnalysis = await analyzeGoalsMarket(
      analysis.matchData?.home_team || 'Home',
      analysis.matchData?.away_team || 'Away',
      homePower.attackPower,
      homePower.defensePower,
      awayPower.attackPower,
      awayPower.defensePower,
      goalsOdds,
      analysis.scouting,
      analysis.scouting,
      undefined,
      undefined,
      analysis.matchData?.id ? Number(analysis.matchData.id) : undefined
    );

    // Candidates list
    const candidates: any[] = [];

    // 1. Add 1X2 Moneyline candidates
    let mlMarkets = analysis.valueBet?.report?.mercados || [];
    if (mlMarkets.length === 0 && analysis.valueBet?.report?.melhor_value) {
      mlMarkets = [analysis.valueBet.report.melhor_value];
    }
    mlMarkets.forEach((m: any) => {
      if (
        m.market === 'Vitória Casa' || m.market === 'Vitória Fora' || m.market === 'Empate' ||
        m.market === 'Dupla Chance 1X' || m.market === 'Dupla Chance X2' || m.market === 'Dupla Chance 12'
      ) {
        candidates.push({
          nome: m.market,
          type: m.market.startsWith('Dupla Chance') ? 'double_chance' : '1x2',
          prob_ia: m.prob_ia,
          odd_api: m.odd_api,
          prob_elo: 50,
          ev: m.edge !== undefined ? m.edge * 100 : ((m.prob_ia / 100) * m.odd_api - 1) * 100,
        });
      }
    });

    if (candidates.length === 0) {
      const h2hOdds = analysis.matchData?.bookmakers?.[0]?.markets?.find((m: any) => m.key === 'h2h')?.outcomes;
      const oddHome = h2hOdds?.find((o: any) => o.name === analysis.matchData.home_team)?.price || 2.0;
      const oddDraw = h2hOdds?.find((o: any) => o.name === 'Draw')?.price || 3.2;
      const oddAway = h2hOdds?.find((o: any) => o.name === analysis.matchData.away_team)?.price || 3.5;

      const probML = analysis.probabilidades_ml || { casa: 33, empate: 34, fora: 33 };

      candidates.push({
        nome: 'Vitória Casa',
        type: '1x2',
        prob_ia: probML.casa,
        odd_api: oddHome,
        prob_elo: 33,
        ev: ((probML.casa / 100) * oddHome - 1) * 100
      });
      candidates.push({
        nome: 'Empate',
        type: '1x2',
        prob_ia: probML.empate,
        odd_api: oddDraw,
        prob_elo: 33,
        ev: ((probML.empate / 100) * oddDraw - 1) * 100
      });
      candidates.push({
        nome: 'Vitória Fora',
        type: '1x2',
        prob_ia: probML.fora,
        odd_api: oddAway,
        prob_elo: 33,
        ev: ((probML.fora / 100) * oddAway - 1) * 100
      });
    }

    candidates.forEach(c => {
      if (c.type === '1x2') {
        if (c.nome === 'Vitória Casa') {
          c.prob_elo = analysis.elo?.probabilidades?.casa ?? 40;
        } else if (c.nome === 'Empate') {
          c.prob_elo = analysis.elo?.probabilidades?.empate ?? 30;
        } else if (c.nome === 'Vitória Fora') {
          c.prob_elo = analysis.elo?.probabilidades?.fora ?? 30;
        }
      } else if (c.type === 'double_chance') {
        const casa = analysis.elo?.probabilidades?.casa ?? 40;
        const empate = analysis.elo?.probabilidades?.empate ?? 30;
        const fora = analysis.elo?.probabilidades?.fora ?? 30;
        if (c.nome === 'Dupla Chance 1X') {
          c.prob_elo = casa + empate;
        } else if (c.nome === 'Dupla Chance X2') {
          c.prob_elo = empate + fora;
        } else if (c.nome === 'Dupla Chance 12') {
          c.prob_elo = casa + fora;
        }
      }
    });

    // 2. Add Goals candidates — only when real form data is available.
    // Without real goal counts the Poisson lambda is unreliable, so we skip
    // goals markets entirely and let B-DADOS surface instead of silently
    // returning inflated probabilities from the neutral-power fallback.
    const hasGoalsOdds = !!(totalsMarket || bttsMarket) && !goalsDataUnavailable;
    if (hasGoalsOdds) {
      goalsAnalysis.markets?.forEach((gm: any) => {
        let poissonProb = 50;
        if (gm.marketKey === 'over_0.5') poissonProb = goalsAnalysis.probabilities.over0_5;
        else if (gm.marketKey === 'over_1.5') poissonProb = goalsAnalysis.probabilities.over1_5;
        else if (gm.marketKey === 'over_2.5') poissonProb = goalsAnalysis.probabilities.over2_5;
        else if (gm.marketKey === 'over_3.5') poissonProb = goalsAnalysis.probabilities.over3_5;
        else if (gm.marketKey === 'btb') poissonProb = goalsAnalysis.probabilities.btb;

        candidates.push({
          nome: gm.market,
          type: 'goals',
          prob_ia: gm.prob_ia,
          odd_api: gm.odd_api,
          prob_elo: poissonProb,
          ev: gm.edge * 100
        });
      });
    }

    // ─── SHARP CONTEXT ENRICHMENT LAYER v1.0 ─────────
    const checkTopPlayerAbsent = (injuriesList: any, teamSummary: string): boolean => {
      if (!Array.isArray(injuriesList)) return false;
      const summaryLower = (teamSummary || '').toLowerCase();
      const hasKeywords = summaryLower.includes('artilheiro') ||
        summaryLower.includes('goleador') ||
        summaryLower.includes('assistente') ||
        summaryLower.includes('principal desfalque') ||
        summaryLower.includes('top scorer');
      if (hasKeywords) return true;

      // Lista de referência — atualizar por temporada conforme transfers e impacto real.
      // Nomes genéricos (ex: 'martinez') foram removidos por alto risco de falso positivo.
      const keyPlayers = ['mbappe', 'haaland', 'salah', 'kane', 'lewandowski', 'vinicius', 'messi', 'ronaldo', 'de bruyne', 'palmer', 'saka', 'bellingham', 'griezmann', 'leao', 'wahi'];
      return injuriesList.some(name => {
        const nameLower = name.toString().toLowerCase();
        return keyPlayers.some(kp => nameLower.includes(kp));
      });
    };

    const homeFormArr = analysis.scouting?.home_form || [];
    const awayFormArr = analysis.scouting?.away_form || [];
    const formaCasa5j = homeFormArr.length > 0 ? homeFormArr.join('/') : 'N/A';
    const formaVisitante5j = awayFormArr.length > 0 ? awayFormArr.join('/') : 'N/A';

    const homeWins = homeFormArr.filter((r: string) => r.toUpperCase() === 'V' || r.toUpperCase() === 'W').length;
    const mandanteMenos2Vitorias = homeFormArr.length > 0 && !homeFormArr.includes('?') && homeWins < 2;

    const summaryText = (analysis.scouting?.scout_summary || '') + ' ' + (analysis.resumo || '');
    const summaryLower = summaryText.toLowerCase();

    const isPlayoff = summaryLower.includes('playoff') ||
      summaryLower.includes('ida/volta') ||
      summaryLower.includes('jogo 2') ||
      summaryLower.includes('volta') ||
      summaryLower.includes('eliminatorio') ||
      summaryLower.includes('mata-mata');

    const isPlayoffGame2_0_0 = isPlayoff &&
      (summaryLower.includes('jogo 2') || summaryLower.includes('volta') || summaryLower.includes('second leg')) &&
      (summaryLower.includes('0-0') || summaryLower.includes('empate sem gols') || summaryLower.includes('zero a zero'));

    const isEndSeasonPressure = summaryLower.includes('rebaixamento') ||
      summaryLower.includes('relegation') ||
      summaryLower.includes('acesso') ||
      summaryLower.includes('promotion') ||
      summaryLower.includes('fim de temporada');

    const isCupFinal = summaryLower.includes('final de copa') ||
      summaryLower.includes('final da copa') ||
      summaryLower.includes('cup final') ||
      summaryLower.includes('final de taça') ||
      summaryLower.includes('final da taça') ||
      summaryLower.includes('decisão da taça');

    const desfalquesVerificados = analysis.scouting?.data_source === 'real' ||
      analysis.scouting?.data_source === 'api-football' ||
      (Array.isArray(analysis.scouting?.desfalques) && analysis.scouting.desfalques.length > 0);

    const alertsList: string[] = [];

    const homeInjuriesList = analysis.scouting?.desfalques || [];
    const awayInjuriesList = analysis.scouting?.away_desfalques || [];
    const homeHasCriticalInjury = desfalquesVerificados && checkTopPlayerAbsent(homeInjuriesList, summaryText);
    const awayHasCriticalInjury = desfalquesVerificados && checkTopPlayerAbsent(awayInjuriesList, summaryText);

    const visitanteSemMotivo = summaryLower.includes('eliminado') ||
      summaryLower.includes('sem motivo') ||
      summaryLower.includes('cumprir tabela') ||
      summaryLower.includes('sem ambições') ||
      summaryLower.includes('desmotivado');

    const homeTeamName = (analysis.matchData?.home_team || '').toLowerCase();
    const awayTeamName = (analysis.matchData?.away_team || '').toLowerCase();
    const isHomeUnderPressure = isEndSeasonPressure && homeTeamName && summaryLower.includes(homeTeamName);
    const isAwayUnderPressure = isEndSeasonPressure && awayTeamName && summaryLower.includes(awayTeamName);

    const eloCalibradoFlag = analysis?.elo?.jogos_minimos_atingidos;
    const isEloCalibrated = eloCalibradoFlag !== undefined ? eloCalibradoFlag : true;
    const h2hVerificado = analysis.h2h?.fonte === 'api_football' || analysis.h2h?.fonte === 'api-football' || analysis.h2h?.fonte === 'gemini_factual';

    // Calcule a confiança base e ajustada do jogo (ETAPA 3 — CONTEXTO SHARP)
    const baseConfianca = confianca;
    let adjustedConfianca = baseConfianca;
    if (!isEloCalibrated) {
      adjustedConfianca -= 2;
    }
    if (!h2hVerificado) {
      adjustedConfianca -= 1;
    }
    adjustedConfianca = Math.max(0, Math.min(100, adjustedConfianca));

    // Process and evaluate each candidate (ETAPA 3 - CONTEXTO SHARP)
    candidates.forEach(c => {
      // Penalidades e bônus são aplicados DIRETAMENTE no EV (em pp), não na
      // probabilidade dividida pela odd. Aplicar na probabilidade como
      // `probAdj = Xpp / odd` produz penalidades que crescem/encolhem com a
      // odd, distorcendo o ajuste dependendo do mercado.
      const baseEV = ((c.prob_ia / 100) * c.odd_api - 1) * 100;
      let evAdj = 0;

      // Incerteza de desfalques não verificados: -3pp no EV
      if (!desfalquesVerificados) {
        evAdj -= 3;
      }

      // 1. Desfalque crítico confirmado -> -4pp no EV do time afetado
      if (c.nome.includes("Casa") || c.nome.includes("1X")) {
        if (homeHasCriticalInjury) evAdj -= 4;
        // 2. Mandante sem vitória nos últimos 5 -> -3pp
        if (homeFormArr.length > 0 && mandanteMenos2Vitorias) evAdj -= 3;
        // 3. Visitante eliminado/sem motivo -> +4pp mandante
        if (visitanteSemMotivo) evAdj += 4;
        // 4. Pressão de fim de temporada -> +3pp mandante
        if (isHomeUnderPressure) evAdj += 3;
      } else if (c.nome.includes("Fora") || c.nome.includes("X2")) {
        if (awayHasCriticalInjury) evAdj -= 4;
        // 5. Jogo 2 playoff + jogo1 = 0-0 -> +5pp visitante
        if (isPlayoffGame2_0_0) evAdj += 5;
        // 6. Pressão de fim de temporada -> +3pp visitante
        if (isAwayUnderPressure) evAdj += 3;
      }

      // Converter EV ajustado de volta para probabilidade calibrada
      // prob_calibrada = (evAdj/100 + 1) / odd_api
      const evAjustado = baseEV + evAdj;
      const probCalibrada = ((evAjustado / 100) + 1) / c.odd_api * 100;
      c.probabilidadeIaCalibrada = Math.min(95, Math.max(1, parseFloat(probCalibrada.toFixed(1))));

      // EV final a partir da probabilidade calibrada
      c.evFinal = parseFloat((((c.probabilidadeIaCalibrada / 100) * c.odd_api - 1) * 100).toFixed(1));

      const diffEV = parseFloat((c.evFinal - baseEV).toFixed(1));
      if (Math.abs(diffEV) > 0.01) {
        c.adjustmentAppliedText = `${diffEV > 0 ? '+' : ''}${diffEV.toFixed(1)}pp EV por sharp context`;
      } else {
        c.adjustmentAppliedText = "Nenhum";
      }


      // Quarter Kelly (0.25x) com teto rígido de 3.0% para preservação de capital sharp
      const fullKellyVal = (((c.probabilidadeIaCalibrada / 100) * c.odd_api - 1) / (c.odd_api - 1) * 100);
      c.kellyFinal = Math.max(0, parseFloat((fullKellyVal * 0.25).toFixed(2)));
      c.kellyFinal = Math.min(c.kellyFinal, 3.0);

      c.block = null;
    });

    // PASSO 2A — Selecionar mercado com maior EV ajustado priorizando validez Sharp (+3.0% <= EV <= +12.0% e Odd <= 5.0).
    // Evita selecionar mercados de odds extremas/distorções com EV irrealista (>12%) quando existem apostas de valor válidas no jogo.
    const isRealisticValue = (c: any) => c.evFinal >= 3.0 && c.evFinal <= 12.0 && (c.odd_api ?? 2.0) <= 5.0;
    const isUnderEV = (c: any) => c.evFinal < 3.0;

    const realisticCandidates = candidates.filter(isRealisticValue);
    const underEvCandidates = candidates.filter(isUnderEV);
    const overEvCandidates = candidates.filter(c => !isRealisticValue(c) && !isUnderEV(c));

    const sortFn = (a: any, b: any) => {
      const evDiff = b.evFinal - a.evFinal;
      if (Math.abs(evDiff) > 0.5) return evDiff; // diferença relevante → ordena por EV
      const deltaA = Math.abs(a.probabilidadeIaCalibrada - a.prob_elo);
      const deltaB = Math.abs(b.probabilidadeIaCalibrada - b.prob_elo);
      return deltaA - deltaB;
    };

    let chosenCandidate: any;
    if (realisticCandidates.length > 0) {
      realisticCandidates.sort(sortFn);
      chosenCandidate = realisticCandidates[0];
    } else if (underEvCandidates.length > 0) {
      underEvCandidates.sort(sortFn);
      chosenCandidate = underEvCandidates[0];
    } else if (overEvCandidates.length > 0) {
      // Quando só existem candidatos >12%, ordena do menor para o maior excesso de EV
      overEvCandidates.sort((a, b) => a.evFinal - b.evFinal);
      chosenCandidate = overEvCandidates[0];
    } else {
      chosenCandidate = candidates[0];
    }

    // ─── BLOCO 6 — ATUALIZAÇÃO E VALIDAÇÃO DE LINHA ───
    const bloco6 = processBloco6(analysis, chosenCandidate, adjustedConfianca, analysis?.currentLocalTime);
    if (bloco6.linha.odd_atual > 0) {
      chosenCandidate.odd_api = bloco6.linha.odd_atual;
      chosenCandidate.evFinal = bloco6.linha.ev_real;
      const fullKellyVal = (((chosenCandidate.probabilidadeIaCalibrada / 100) * chosenCandidate.odd_api - 1) / (chosenCandidate.odd_api - 1) * 100);
      chosenCandidate.kellyFinal = Math.min(3.0, Math.max(0, parseFloat((fullKellyVal * 0.25).toFixed(2))));
    }
    adjustedConfianca = bloco6.adjustedConfianca;
    let bloco6Veto = bloco6.block;
    const ensureBloco6AlertIsLast = () => {
      if (bloco6.alerta_mensagem) {
        const idx = alertsList.indexOf(bloco6.alerta_mensagem);
        if (idx > -1) {
          alertsList.splice(idx, 1);
        }
        alertsList.push(bloco6.alerta_mensagem);
      }
    };
    if (bloco6.alerta_mensagem) {
      alertsList.push(bloco6.alerta_mensagem);
    }

    // ─── BLOCO 5 — SANIDADE DE ODDS E MAPEAMENTO ───
    const oddBet365Actual = oddManualBet365 || 0;
    const sanidade = checkOddsSanity(analysis, chosenCandidate, oddBet365Actual);
    const oddBet365Manual = sanidade.desvio_valido ? sanidade.odd_bet365_final : null;

    // ─── ETAPA 2.5 — VALIDAÇÃO DE DESVIO EXTREMO ───
    let desvioClassificacao = 'Normal';
    let desvioAviso = '';
    let desvioFlags: string[] = [];
    if (bloco6.lineFlags) {
      bloco6.lineFlags.forEach(f => {
        if (!desvioFlags.includes(f)) {
          desvioFlags.push(f);
        }
      });
    }
    let isBDesvioBlocked = false;

    if (sanidade.desvio_valido && oddBet365Manual && chosenCandidate.odd_api) {
      const dVal = ((oddBet365Manual - chosenCandidate.odd_api) / chosenCandidate.odd_api) * 100;
      const isPopularFavorite = summaryLower.includes('favorito') || summaryLower.includes('torcida') || summaryLower.includes('popular');
      const isDerbyClasico = summaryLower.includes('clássico') || summaryLower.includes('classico') || summaryLower.includes('derby') || summaryLower.includes('derbi');
      const isSingleLegPlayoff = isPlayoff && (summaryLower.includes('jogo único') || summaryLower.includes('jogo unico') || summaryLower.includes('single match') || summaryLower.includes('single leg') || summaryLower.includes('decisão') || summaryLower.includes('decisao') || summaryLower.includes('final'));
      const isDecisiveMatch = isCupFinal || isSingleLegPlayoff || summaryLower.includes('playoff_jogo_unico') || summaryLower.includes('playoff_jogo_1');

      const desvioResult = calcDesvioClassificacao(
        dVal,
        isDecisiveMatch,
        isPlayoff,
        isCupFinal,
        isPopularFavorite,
        isDerbyClasico,
        chosenCandidate.odd_api,
        oddBet365Manual
      );

      desvioClassificacao = desvioResult.classificacao;
      desvioAviso = desvioResult.aviso;
      isBDesvioBlocked = desvioResult.blocked;
      adjustedConfianca += desvioResult.confAdjustment;
      desvioResult.flags.forEach(f => {
        if (!desvioFlags.includes(f)) {
          desvioFlags.push(f);
        }
      });
    }

    adjustedConfianca = Math.max(0, Math.min(100, adjustedConfianca));
    if (desvioAviso) {
      alertsList.push(desvioAviso);
    }
    if (!sanidade.desvio_valido) {
      alertsList.push("Desvio indisponível por erro de mapeamento no Scout. Análise sem comparativo de linha.");
      desvioClassificacao = undefined as any;
      desvioAviso = undefined as any;
      desvioFlags = bloco6.lineFlags || [];
    }

    // ETAPA 1 — VALIDAÇÃO DO JOGO (Score Composto)
    // 1. EV do mercado principal (30%)
    let scoreEV = 0;
    const evVal = chosenCandidate.evFinal;
    if (evVal >= 15) {
      scoreEV = 100;
    } else if (evVal >= 3) {
      scoreEV = 50 + ((evVal - 3) / 12) * 50;
    } else if (evVal >= 0) {
      scoreEV = (evVal / 3) * 50;
    } else {
      scoreEV = 0;
    }

    // 2. Convergência Modelo vs Referência (ELO/Poisson) (20%)
    const chosenDelta = Math.abs(chosenCandidate.probabilidadeIaCalibrada - chosenCandidate.prob_elo);
    const scoreGP = Math.max(0, 100 - (chosenDelta * 5));

    // 3. Tier da liga (15%)
    let scoreTier = 0;
    if (tier === 'A') scoreTier = 100;
    else if (tier === 'B') scoreTier = 80;
    else if (tier === 'C') scoreTier = 40;

    // 4. Confiança IA (15%)
    const scoreConfianca = adjustedConfianca;

    // 5. Sinal CLV (10%)
    const clvDelta = analysis.clv?.delta || 0;
    let scoreCLV = 50;
    if (clvDelta > 0) scoreCLV = 100;
    else if (clvDelta < 0) scoreCLV = 0;

    // 6. Line Movement & Deviation Safety (10%)
    let scoreLine = 100;
    if (sanidade.desvio_valido && chosenCandidate.odd_api && oddBet365Manual && oddBet365Manual < chosenCandidate.odd_api) {
      const desvioNegativo = (chosenCandidate.odd_api - oddBet365Manual) / chosenCandidate.odd_api;
      scoreLine = Math.max(0, 100 - (desvioNegativo / 0.03) * 100); // Zera o score se a odd estiver 3% abaixo da Pinnacle
    }

    const scoreComposto = Math.round(
      (scoreEV * 0.30) +
      (scoreGP * 0.20) +
      (scoreTier * 0.15) +
      (scoreConfianca * 0.15) +
      (scoreCLV * 0.10) +
      (scoreLine * 0.10)
    );

    // PASSO 2C — Varredura de mercados alternativos
    const alternativeMarkets = candidates.filter(c => c.nome !== chosenCandidate.nome && c.evFinal >= 3);
    const bestAlternative = alternativeMarkets.sort((a, b) => b.evFinal - a.evFinal)[0] || null;

    // PASSO 2D — Validação cruzada obrigatória e CÓDIGOS DE BLOQUEIO
    let blockObj: { codigo: string; motivo: string } | null = null;

    // ─── GATE 3: CONFIANÇA DE DADOS (v8.3) ───
    var montarPoolComPeso = function (
      fonte: any // { jogos: JogoComData[] } | { lastGoalsFor: number[]; lastGoalsAgainst: number[]; isSynthetic?: boolean } | null
    ): JogoPonderado[] {
      if (!fonte) return [];

      // Caso real (com data por jogo)
      if ('jogos' in fonte) {
        const agora = Date.now();
        return fonte.jogos.map((j: any) => {
          const peso = j.data
            ? pesoTemporalJogo((agora - new Date(j.data).getTime()) / (1000 * 60 * 60 * 24))
            : 1.0; // sem data confiável → peso neutro, sem decaimento
          return { pesoTotal: peso, golsMarcados: j.gols_for, fonteSintetica: false };
        });
      }

      // Caso sintético (mapFormToGoals)
      if (fonte.lastGoalsFor) {
        return fonte.lastGoalsFor.map((g: number) => ({ pesoTotal: 1.0, golsMarcados: g, fonteSintetica: fonte.isSynthetic }));
      }
      return [];
    }

    const dataPool: JogoPonderado[] = [
      ...montarPoolComPeso(homeGoals),
      ...montarPoolComPeso(awayGoals),
    ];

    const nJogosEfetivos = calcNJogosEfetivos(dataPool);
    const cvLambda = calcCVLambda(dataPool);
    const shrinkageAlpha = calcShrinkageAlpha(nJogosEfetivos);

    const confiancaGate = gateConfiancaDados({
      nJogosEfetivos,
      cvLambda,
      shrinkageAlpha
    });

    const criteriosFactuais = [
      { id: 'forma_casa', val: homeFormArr.length > 0 ? 'real' : 'unavailable' },
      { id: 'forma_visitante', val: awayFormArr.length > 0 ? 'real' : 'unavailable' },
      { id: 'h2h', val: h2hVerificado ? 'real' : 'unavailable' }
    ];
    const indisponiveis = criteriosFactuais.filter(item => item.val === 'unavailable');

    // Hard check B7 (Line Movement > 5%)
    let isLineMovementBlocked = false;
    let lineMoveDesvio = 0;
    if (sanidade.desvio_valido && chosenCandidate.odd_api && oddBet365Manual && oddBet365Manual > chosenCandidate.odd_api) {
      lineMoveDesvio = (oddBet365Manual - chosenCandidate.odd_api) / chosenCandidate.odd_api;
      if (lineMoveDesvio > 0.05) {
        isLineMovementBlocked = true;
      }
    }

    // Pinnacle deviation floor (< 1.0%)
    let isDeviationInsufficient = false;
    if (sanidade.desvio_valido && oddBet365Manual && chosenCandidate.odd_api && oddBet365Manual > chosenCandidate.odd_api && oddBet365Manual < chosenCandidate.odd_api * 1.01) {
      isDeviationInsufficient = true;
    }
    const DIVERGENCIA_ELO_MAXIMA = 45; // era 20 — recalibrado com base no P90 real (48.3pp), ver v8.16/v8.17
    const DIVERGENCIA_ELO_MAXIMA_UNCALIBRATED = 60; // era 35
    const currentDivergenciaMaxima = isEloCalibrated ? DIVERGENCIA_ELO_MAXIMA : DIVERGENCIA_ELO_MAXIMA_UNCALIBRATED;

    if (bloco6Veto) {
      blockObj = bloco6Veto;
    } else if (isBDesvioBlocked) {
      blockObj = {
        codigo: 'B-DESVIO',
        motivo: desvioAviso
      };
      // } else if (indisponiveis.length >= 3) {
      //   blockObj = {
      //     codigo: 'B-DADOS',
      //     motivo: `Dado específico ausente: [${indisponiveis.map(item => item.id).join(', ')}] | Segurança acionada`
      //   };
    } else if (isLineMovementBlocked) {
      blockObj = {
        codigo: 'B7',
        motivo: `Linha moveu dramaticamente contra sua posição (+${(lineMoveDesvio * 100).toFixed(1)}%) na Pinnacle. Sharp money do lado oposto.`
      };
    } else if (isDeviationInsufficient) {
      blockObj = {
        codigo: 'B-EV',
        motivo: `Desvio Bet365 (${(oddBet365Manual ?? 0).toFixed(2)}) vs Pinnacle (${chosenCandidate.odd_api.toFixed(2)}) é < +1.0%. Margem de segurança violada.`
      };
    } else if (chosenDelta > currentDivergenciaMaxima) {
      blockObj = {
        codigo: 'B-DIVERGENCIA-ELO',
        motivo: `Divergência ELO vs. Modelo excede limite: Δ${chosenDelta.toFixed(1)}pp (máximo: ${currentDivergenciaMaxima}pp). ELO confiável: ${isEloCalibrated ? 'Sim' : 'Não'}`
      };
    } else if (chosenCandidate.evFinal > 12.0) {
      blockObj = {
        codigo: 'B-EDGE',
        motivo: `EV irrealista (>12%), provável erro de linha/API (EV atual: ${chosenCandidate.evFinal.toFixed(1)}%).`
      };
    } else if (chosenCandidate.evFinal < 3) {
      if (bestAlternative && !isBDesvioBlocked && sanidade.desvio_valido) {
        const breakEvenOdd = bestAlternative.probabilidadeIaCalibrada > 0
          ? parseFloat((1 / (bestAlternative.probabilidadeIaCalibrada / 100)).toFixed(2))
          : bestAlternative.odd_api;
        blockObj = {
          codigo: 'B-EV',
          motivo: `Mercado principal bloqueado (EV ${chosenCandidate.evFinal.toFixed(1)}%). Alternativa disponível: ${bestAlternative.nome} EV ${bestAlternative.evFinal.toFixed(1)}% @ odd mínima ${breakEvenOdd.toFixed(2)}`
        };
      } else {
        blockObj = {
          codigo: 'B-EV',
          motivo: `EV do mercado selecionado abaixo de +3% (EV atual: ${chosenCandidate.evFinal.toFixed(1)}%). Nenhum mercado com EV+ disponível neste jogo.`
        };
      }
    } else if (!confiancaGate.passou) {
      blockObj = {
        codigo: 'B-DADOS',
        motivo: confiancaGate.motivo || 'Confiança de dados insuficiente.'
      };
    } else if (adjustedConfianca < 70) {
      blockObj = {
        codigo: 'B-CONF',
        motivo: `Confiança IA abaixo de 70% (Confiança ajustada: ${adjustedConfianca.toFixed(0)}%).`
      };
    } else if (scoreComposto < 60) {
      blockObj = {
        codigo: 'B-SCORE',
        motivo: `Score composto abaixo de 60 (Score obtido: ${scoreComposto}/100).`
      };
    } else if (oddBet365Manual && chosenCandidate.odd_api && oddBet365Manual < (1 / (chosenCandidate.probabilidadeIaCalibrada / 100))) {
      const minOdd = parseFloat((1 / (chosenCandidate.probabilidadeIaCalibrada / 100)).toFixed(2));
      blockObj = {
        codigo: 'B-ODD',
        motivo: `Odd Bet365 (${oddBet365Manual.toFixed(2)}) abaixo da odd mínima calculada (${minOdd.toFixed(2)}).`
      };
    } else if (!['A', 'B'].includes(tier)) {
      blockObj = {
        codigo: 'B-SCORE',
        motivo: `Tier da liga ${tier} insuficiente. Exigido: A ou B.`
      };
    }

    if (!desfalquesVerificados) {
      const timeName = analysis.matchData?.home_team || 'Time';
      alertsList.push(`⚠️ DADO AUSENTE: Suspensões não verificadas para ${timeName}. Probabilidade ajustada com penalidade de incerteza de -3pp. Recomendação: aguardar confirmação de lineup.`);
    }

    // Encontra a probabilidade final pós-ajuste do mandante
    const casaCand = candidates.find(c => c.nome === 'Vitória Casa' || c.nome.includes('Casa'));
    const homeProbFinal = casaCand ? casaCand.probabilidadeIaCalibrada : (analysis.probabilidades_ml?.casa ?? 40);

    const contextoCompeticaoText = isPlayoffGame2_0_0
      ? "playoff_jogo2 | jogo1_resultado: 0-0"
      : isPlayoff
        ? "playoff"
        : isCupFinal
          ? "final_copa"
          : isEndSeasonPressure
            ? "rebaixamento/acesso"
            : "regular_season";

    const sharpContextObj: any = {
      desfalques_verificados: desfalquesVerificados,
      forma_casa_5j: formaCasa5j,
      forma_visitante_5j: formaVisitante5j,
      nJogosEfetivos,
      cvLambda,
      shrinkageAlpha,
      contexto_competicao: contextoCompeticaoText,
      ajuste_probabilidade_aplicado: chosenCandidate.adjustmentAppliedText || "Nenhum",
      probabilidade_final_casa: homeProbFinal,
      ev_ajustado: chosenCandidate.evFinal,
      decisao_gate: blockObj && !userConfirmedAudit ? 'BLOQUEADO' as const : 'APROVADO' as const,
      motivo_especifico: blockObj ? blockObj.motivo : "Critérios atendidos com sucesso.",
      score_composto: scoreComposto,
      confianca_ajustada: adjustedConfianca,
      desvio_classificacao: desvioClassificacao,
      desvio_aviso: desvioAviso,
      desvio_flags: desvioFlags,
      sanidade_odds: {
        passo1_limite: sanidade.passo1_limite,
        passo2_simetria: sanidade.passo2_simetria,
        passo3_desvio: sanidade.passo3_desvio,
        retry_executado: sanidade.retry_executado,
        retry_resultado: sanidade.retry_resultado,
        odd_pinnacle_final: sanidade.odd_pinnacle_final,
        odd_bet365_final: sanidade.odd_bet365_final,
        desvio_final: sanidade.desvio_final,
        desvio_valido: sanidade.desvio_valido,
        observacao: sanidade.observacao
      },
      mercado_alternativo: bestAlternative && !isBDesvioBlocked && sanidade.desvio_valido ? {
        nome: bestAlternative.nome,
        odd: bestAlternative.odd_api,
        ev: bestAlternative.evFinal
      } : null
    };

    if (!sanidade.desvio_valido && sanidade.retry_resultado === 'FALHOU') {
      sharpContextObj.mapeamento_status = sanidade.mapeamento_status;
      sharpContextObj.odd_pinnacle = sanidade.odd_pinnacle_final;
      sharpContextObj.odd_bet365_tentada = oddBet365Actual;
      sharpContextObj.erro_tipo = sanidade.erro_tipo;
      sharpContextObj.desvio_calculado = null;
      sharpContextObj.recomendacao = sanidade.recomendacao;
    }

    const mercadoObj = {
      nome: chosenCandidate.nome,
      odd: chosenCandidate.odd_api,
      probabilidade_ia: chosenCandidate.probabilidadeIaCalibrada,
      probabilidade_elo: chosenCandidate.prob_elo || 50,
      ev: chosenCandidate.evFinal,
      perfil: 'CONSERVADOR',
      justificativa: blockObj
        ? `[${blockObj.codigo}] ${blockObj.motivo}`
        : `Análise finalizada: mercado de ${chosenCandidate.nome} selecionado com Kelly stake de ${chosenCandidate.kellyFinal.toFixed(2)}%.`
    };

    // Helper para bloqueio padronizado
    const retornarBloqueio = (codigo: string, motivo: string) => {
      ensureBloco6AlertIsLast();
      const res = formatToDecisaoEngine({
        status: 'BLOQUEADO',
        bloqueio: { codigo, motivo },
        linha: bloco6.linha,
        score: scoreComposto,
        ev: chosenCandidate.evFinal,
        confianca: adjustedConfianca,
        tier,
        stake: { stake_final: 0, modificador: 0, kelly_base: chosenCandidate.kellyFinal },
        mercado: mercadoObj,
        sharp_context: sharpContextObj,
        alertas: alertsList,
        todos_mercados: candidates.map(c => ({
          nome: c.nome,
          probabilidade_final: c.probabilidadeIaCalibrada,
          odd_referencia: c.odd_api,
          break_even_odd: c.probabilidadeIaCalibrada > 0 ? parseFloat((1 / (c.probabilidadeIaCalibrada / 100)).toFixed(2)) : 0,
          selecionado: c.nome === chosenCandidate.nome
        })),
        regras_protecao: {
          stop_loss_ativo: false,
          reds_consecutivos: 0,
          apostas_hoje: 0,
          limite_diario_atingido: false
        }
      }, analysis, oddManualBet365, bancaTotal, userConfirmedAudit);
      res.goalsAnalysis = goalsAnalysis;
      return res;
    };

    // Apply veto if selected candidate is blocked and not overridden
    if (blockObj && !userConfirmedAudit) {
      return retornarBloqueio(blockObj.codigo, blockObj.motivo);
    }

    // ─── PAYLOAD FINAL ──────────────────────────────────
    const payload = {
      ev: chosenCandidate.evFinal,
      kelly: Math.min(chosenCandidate.kellyFinal, 3.0),
      kelly_final: Math.min(chosenCandidate.kellyFinal / 100, 0.03),
      tier: tier,
      confianca: adjustedConfianca,
      convergenciaOk: blockObj === null,
      tipoAposta: analysis.ticket?.tipo || 'simples',
      sharp_context: sharpContextObj,
      clv: {
        valorAtual: chosenCandidate.odd_api,
        valorFechamentoEsperado: chosenCandidate.odd_api * 0.95,
        delta: analysis.clv?.delta || 0
      },
      lineMovement: {
        tipo: analysis.lineMovement?.tipo || 'ESTAVEL',
        direcao: analysis.lineMovement?.direcao || 'NEUTRO',
        magnitude: analysis.lineMovement?.magnitude || 0
      },
      probElo: chosenCandidate.type === 'goals'
        ? { casa: chosenCandidate.prob_elo, empate: 0, fora: 0 }
        : analysis.elo?.probabilidades,
      probGemini: chosenCandidate.type === 'goals'
        ? { casa: chosenCandidate.prob_ia, empate: 0, fora: 0 }
        : analysis.gemini?.probabilidades,
      qualidade: {
        forma: analysis.scouting?.forma || 50,
        h2h: analysis.fixtureStats?.h2h || 50,
        motivacao: analysis.scouting?.motivacao || 50,
        desfalques: analysis.scouting?.desfalques || 50
      },
      protecao: {
        redsConsecutivos: analysis.banca?.redsConsecutivos || 0,
        apostasHoje: analysis.banca?.apostasHoje || 0,
        drawdownPercentual: analysis.banca?.drawdownPercentual || 0
      }
    };

    if (import.meta.env.DEV) {
      console.log('Payload enviado à Gemini:', {
        ev: payload.ev,
        kelly: payload.kelly,
        tier: payload.tier,
        confianca: payload.confianca
      });
    }

    const engineData = {
      status: 'APROVADO',
      score: scoreComposto,
      stake: { percentual: chosenCandidate.kellyFinal },
      mercado: {
        nome: chosenCandidate.nome,
        probabilidade_ia: chosenCandidate.probabilidadeIaCalibrada,
        odd: chosenCandidate.odd_api
      }
    };

    if (engineData) {
      engineData.score = scoreComposto;
      engineData.status = blockObj && !userConfirmedAudit ? 'BLOQUEADO' : 'APROVADO';

      // Injetar stake para que formatToDecisaoEngine não receba undefined e retorne 0
      if (engineData.status === 'APROVADO' && !engineData.stake) {
        const kellyBase = chosenCandidate.kellyFinal ?? 0;
        engineData.stake = {
          kelly_base: kellyBase,
          modificador: 1.0,
          stake_final: kellyBase,
          valor_reais: parseFloat(((bancaTotal * kellyBase) / 100).toFixed(2))
        };
      }

      engineData.todos_mercados = candidates.map(c => ({
        nome: c.nome,
        probabilidade_final: c.probabilidadeIaCalibrada,
        odd_referencia: c.odd_api,
        break_even_odd: c.probabilidadeIaCalibrada > 0 ? parseFloat((1 / (c.probabilidadeIaCalibrada / 100)).toFixed(2)) : 0,
        selecionado: c.nome === chosenCandidate.nome
      }));

      engineData.mercado = {
        nome: chosenCandidate.nome,
        ev: chosenCandidate.evFinal,
        odd: chosenCandidate.odd_api,
        probabilidade_ia: chosenCandidate.probabilidadeIaCalibrada,
        probabilidade_elo: chosenCandidate.prob_elo || 50,
        perfil: 'CONSERVADOR',
        justificativa: engineData.mercado?.justificativa || mercadoObj.justificativa
      };

      engineData.market = chosenCandidate.nome;
      engineData.sharp_context = sharpContextObj;
      engineData.alertas = alertsList;
      engineData.linha = bloco6.linha;
    }

    ensureBloco6AlertIsLast();
    const finalOutput = formatToDecisaoEngine(engineData, analysis, oddManualBet365, bancaTotal, userConfirmedAudit);
    finalOutput.goalsAnalysis = goalsAnalysis;
    if (import.meta.env.VITE_DEBUG_ENGINE === 'true') {
      console.log('[ENGINE] Retornando:', {
        has_decisao: !!finalOutput?.decisao,
        has_mercado_selecionado: !!finalOutput?.mercado_selecionado,
        has_todos_mercados: !!finalOutput?.todos_mercados,
        keys: Object.keys(finalOutput || {})
      });
    }
    return finalOutput;
  } catch (error: any) {
    console.error('TipsterEngine erro:', {
      message: error.message,
      stack: error.stack,
      geminiKey: !!import.meta.env.VITE_GEMINI_API_KEY,
      oddsKey: !!import.meta.env.VITE_ODDS_API_KEY
    });

    const fallbackError = {
      status: 'BLOQUEADO',
      bloqueio: {
        codigo: 'ERRO',
        motivo: `Erro na análise: ${error.message}`
      },
      score: 0,
      alertas: [],
      regras_protecao: {
        stop_loss_ativo: false,
        reds_consecutivos: 0,
        apostas_hoje: 0,
        limite_diario_atingido: false
      }
    };

    const finalOutputError = formatToDecisaoEngine(fallbackError, analysis, oddManualBet365, bancaTotal, userConfirmedAudit);
    return finalOutputError;
  }
}

function formatToDecisaoEngine(
  engineData: any,
  analysis: any,
  oddManualBet365?: number | null,
  bancaTotal?: number,
  userConfirmedAudit?: boolean
): DecisaoEngine & any {
  if (import.meta.env.VITE_DEBUG_ENGINE === 'true') {
    console.log('[FORMAT] formatToDecisaoEngine CHAMADA:', {
      input_status: engineData?.status,
      has_decisao: !!engineData?.decisao,
      caller: new Error().stack?.split('\n')[2]
    });
  }

  const isApproved = engineData.status === 'APROVADO';
  const scoreVal = typeof engineData.score === 'object' && engineData.score !== null
    ? (engineData.score.valor ?? 0)
    : (engineData.score || 0);

  const todos_mercados: any[] = [];

  const probCasa = analysis?.probabilidades_ml?.casa ?? analysis?.gemini?.probabilidades?.casa ?? 40;
  const probEloCasa = analysis?.elo?.probabilidades?.casa ?? 40;

  if (Array.isArray(engineData?.todos_mercados)) {
    engineData.todos_mercados.forEach((m: any) => {
      todos_mercados.push({ ...m, selecionado: m.selecionado || false });
    });
  } else if (analysis?.valueBet?.report?.mercados) {
    analysis.valueBet.report.mercados.forEach((m: any) => {
      todos_mercados.push({
        nome: m.market,
        probabilidade_final: m.prob_ia,
        odd_referencia: m.odd_api,
        break_even_odd: m.prob_ia > 0 ? parseFloat((1 / (m.prob_ia / 100)).toFixed(2)) : 0,
        odd_bet365_publica: undefined,
        selecionado: false
      });
    });
  }

  const mercadoNome = engineData.mercado?.nome || 'Vitória Casa';
  let mercadoEncontrado = todos_mercados.find(m => m.nome === mercadoNome);

  if (!mercadoEncontrado) {
    const probIa = engineData.mercado?.probabilidade_ia ?? probCasa;
    mercadoEncontrado = {
      nome: mercadoNome,
      probabilidade_final: probIa,
      odd_referencia: engineData.mercado?.odd ?? 1.85,
      break_even_odd: probIa > 0 ? parseFloat((1 / (probIa / 100)).toFixed(2)) : 0,
      selecionado: true
    };
    todos_mercados.push(mercadoEncontrado);
  } else {
    mercadoEncontrado.selecionado = true;
    if (engineData.mercado?.probabilidade_ia !== undefined) {
      mercadoEncontrado.probabilidade_final = engineData.mercado.probabilidade_ia;
      mercadoEncontrado.break_even_odd = mercadoEncontrado.probabilidade_final > 0
        ? parseFloat((1 / (mercadoEncontrado.probabilidade_final / 100)).toFixed(2))
        : 0;
    }
  }

  const eloCalibradoFlag = analysis?.elo?.jogos_minimos_atingidos;
  const isEloCalibrated = eloCalibradoFlag !== undefined ? eloCalibradoFlag : true;

  let stakeMultiplier = 1.0;
  if (isApproved && !isEloCalibrated) {
    stakeMultiplier = 0.60;
  }

  let pct = engineData.stake?.stake_final || engineData.stake?.percentual || 0;
  if (isApproved && pct > 0 && stakeMultiplier < 1.0) {
    pct = parseFloat((pct * stakeMultiplier).toFixed(2));
  }

  const bancaValue = bancaTotal || 1000;
  const valorReais = parseFloat(((bancaValue * pct) / 100).toFixed(2));

  const probIA = engineData.mercado?.probabilidade_ia ?? probCasa;
  const evRecalculado = oddManualBet365 ? ((probIA / 100) * oddManualBet365 - 1) : null;
  const isAudit = !!(userConfirmedAudit && evRecalculado !== null && evRecalculado < 0.03);

  const calculatedEV = engineData.evExecution ?? engineData.mercado?.ev ?? engineData.ev ?? engineData.sharp_context?.ev_ajustado ?? 0;

  const decisaoFormatada: DecisaoEngine = {
    decisao: {
      status: isApproved ? 'APROVADO' : 'BLOQUEADO'
    },
    score: {
      valor: scoreVal,
      motivos_bloqueio: engineData.bloqueio ? [`[${engineData.bloqueio.codigo}] ${engineData.bloqueio.motivo}`] : (engineData.score?.motivos_bloqueio || [])
    },
    linha: engineData.linha || undefined,
    mercado_selecionado: {
      nome: mercadoEncontrado.nome,
      probabilidade_final: mercadoEncontrado.probabilidade_final,
      odd_referencia: mercadoEncontrado.odd_referencia,
      break_even_odd: mercadoEncontrado.break_even_odd,
      odd_bet365_publica: engineData?.mercado_selecionado?.odd_bet365_publica || undefined,
      odd_bet365_manual: oddManualBet365 || null,
      probabilidade_elo: engineData.mercado?.probabilidade_elo ?? probEloCasa,
      selecionado: true,
      ev: calculatedEV
    },
    todos_mercados,
    stake: {
      percentual: pct,
      valor_reais: valorReais,
      stake_final: pct
    },
    modo_auditoria: isAudit,
    aviso_ev_negativo: isAudit ? evRecalculado : null,
    audit_mode: {
      ativo: !!userConfirmedAudit,
      odd_manual: oddManualBet365 || null,
      ev_recalculado: evRecalculado,
      motivo: "Usuário forçou auditoria com EV negativo"
    },
    alertas: engineData.alertas || []
  };

  return {
    ...engineData,
    ...decisaoFormatada
  };
}

export function calcularEVExecucao(
  probIA: number,
  oddBet365: number
): number | null {
  if (probIA == null || probIA <= 0 || probIA > 100) return null;
  if (oddBet365 == null || oddBet365 < 1.01) return null;

  const probDecimal = probIA > 1 ? probIA / 100 : probIA;
  const ev = (probDecimal * oddBet365) - 1;
  return parseFloat((ev * 100).toFixed(1));
}

export function recalculateTipsterMetrics(
  baseResult: any,
  oddManualBet365: number | null,
  marketReference: any,
  probIA: number,
  bancaTotal?: number,
  analysis?: any,
  userConfirmedAudit?: boolean
): any {
  // Deep copy to prevent React state mutation bugs
  const result = {
    ...baseResult,
    mercado: baseResult.mercado ? { ...baseResult.mercado } : null,
    stake: baseResult.stake ? { ...baseResult.stake } : null,
    bloqueio: baseResult.bloqueio ? { ...baseResult.bloqueio } : null,
    sharp_context: baseResult.sharp_context ? { ...baseResult.sharp_context } : null,
  };


  const isGoalsMarket = result.mercado?.nome?.includes('Gols') || result.mercado?.nome?.includes('Ambos') || result.mercado?.nome?.includes('Over') || result.mercado?.nome?.includes('btb');

  // ─── BLOCO 6 — ATUALIZAÇÃO E VALIDAÇÃO DE LINHA ───
  const pinnOdd = result.mercado?.odd_referencia || result.mercado?.odd || 1.85;
  const chosenCandidateMock = {
    nome: result.mercado?.nome || 'Vitória Casa',
    type: isGoalsMarket ? 'goals' : '1x2',
    odd_api: pinnOdd,
    prob_ia: probIA
  };
  const bloco6 = processBloco6(analysis || {}, chosenCandidateMock, baseResult.confianca ?? 70);
  if (bloco6.linha.odd_atual > 0) {
    result.linha = bloco6.linha;
    if (result.mercado) {
      result.mercado.odd_referencia = bloco6.linha.odd_atual;
    }
  }
  let bloco6Veto = bloco6.block;

  // probIA recebida aqui já é a probabilidadeIaCalibrada produzida em
  // runTipsterEngine.
  const calibratedProbIA = probIA;

  if (result.mercado) {
    result.mercado.probabilidade_ia = calibratedProbIA;
    result.mercado.probabilidade_final = calibratedProbIA;
  }

  // ─── BLOCO 5 — SANIDADE DE ODDS E MAPEAMENTO (RECALCULATE) ───
  const sanidade = checkOddsSanity(analysis, {
    nome: result.mercado?.nome || 'Vitória Casa',
    type: isGoalsMarket ? 'goals' : '1x2',
    odd_api: pinnOdd
  }, oddManualBet365);

  if (oddManualBet365 === null || isNaN(oddManualBet365)) {
    result.evExecution = result.mercado ? result.mercado.ev : null;
    result.evMarketDeviation = null;
    return formatToDecisaoEngine(result, analysis || {}, oddManualBet365, bancaTotal, userConfirmedAudit);
  }

  const probDecimal = calibratedProbIA > 1 ? calibratedProbIA / 100 : calibratedProbIA;
  const evExec = calcularEVExecucao(calibratedProbIA, oddManualBet365);
  result.evExecution = evExec;

  if (result.mercado) {
    result.mercado.ev = evExec;
  }

  // ─── ETAPA 2.5 — RECOMPUTAR DESVIO EXTREMO NO RECALCULATE ───
  let currentAdjConf = baseResult.confianca ?? 70;
  const eloCalibradoFlag = analysis?.elo?.jogos_minimos_atingidos;
  const isEloCalibrated = eloCalibradoFlag !== undefined ? eloCalibradoFlag : true;
  if (!isEloCalibrated) {
    currentAdjConf -= 2;
  }
  const h2hVerificado = analysis?.h2h?.fonte === 'api_football' || analysis?.h2h?.fonte === 'api-football' || analysis?.h2h?.fonte === 'gemini_factual';
  if (!h2hVerificado) {
    currentAdjConf -= 1;
  }

  let desvioClassificacao = 'Normal';
  let desvioAviso = '';
  let desvioFlags: string[] = [];
  let isBDesvioBlocked = false;

  const summaryText = (analysis?.scouting?.scout_summary || '') + ' ' + (analysis?.resumo || '');
  const summaryLower = summaryText.toLowerCase();

  const isPlayoff = summaryLower.includes('playoff') ||
    summaryLower.includes('ida/volta') ||
    summaryLower.includes('jogo 2') ||
    summaryLower.includes('volta') ||
    summaryLower.includes('eliminatorio') ||
    summaryLower.includes('mata-mata');

  const isCupFinal = summaryLower.includes('final de copa') ||
    summaryLower.includes('final da copa') ||
    summaryLower.includes('cup final') ||
    summaryLower.includes('final de taça') ||
    summaryLower.includes('final da taça') ||
    summaryLower.includes('decisão da taça');

  const isSingleLegPlayoff = isPlayoff && (summaryLower.includes('jogo único') || summaryLower.includes('jogo unico') || summaryLower.includes('single match') || summaryLower.includes('single leg') || summaryLower.includes('decisão') || summaryLower.includes('decisao') || summaryLower.includes('final'));
  const isDecisiveMatch = isCupFinal || isSingleLegPlayoff || summaryLower.includes('playoff_jogo_unico') || summaryLower.includes('playoff_jogo_1');

  const pinnacleOdd = pinnOdd;

  if (sanidade.desvio_valido && oddManualBet365 && pinnacleOdd) {
    const dVal = ((oddManualBet365 - pinnacleOdd) / pinnacleOdd) * 100;
    const isPopularFavorite = summaryLower.includes('favorito') || summaryLower.includes('torcida') || summaryLower.includes('popular');
    const isDerbyClasico = summaryLower.includes('clássico') || summaryLower.includes('classico') || summaryLower.includes('derby') || summaryLower.includes('derbi');

    const desvioResult = calcDesvioClassificacao(
      dVal,
      isDecisiveMatch,
      isPlayoff,
      isCupFinal,
      isPopularFavorite,
      isDerbyClasico,
      pinnacleOdd,
      oddManualBet365
    );

    desvioClassificacao = desvioResult.classificacao;
    desvioAviso = desvioResult.aviso;
    isBDesvioBlocked = desvioResult.blocked;
    currentAdjConf += desvioResult.confAdjustment;
    desvioResult.flags.forEach(f => {
      if (!desvioFlags.includes(f)) {
        desvioFlags.push(f);
      }
    });
  }

  if (!sanidade.desvio_valido) {
    desvioClassificacao = undefined as any;
    desvioAviso = undefined as any;
    desvioFlags = bloco6.lineFlags || [];
  }

  currentAdjConf = Math.max(0, Math.min(100, currentAdjConf));

  if (result.sharp_context) {
    result.sharp_context.confianca_ajustada = currentAdjConf;
    result.sharp_context.desvio_classificacao = desvioClassificacao;
    result.sharp_context.desvio_aviso = desvioAviso;
    result.sharp_context.desvio_flags = desvioFlags;
    result.sharp_context.sanidade_odds = {
      passo1_limite: sanidade.passo1_limite,
      passo2_simetria: sanidade.passo2_simetria,
      passo3_desvio: sanidade.passo3_desvio,
      retry_executado: sanidade.retry_executado,
      retry_resultado: sanidade.retry_resultado,
      odd_pinnacle_final: sanidade.odd_pinnacle_final,
      odd_bet365_final: sanidade.odd_bet365_final,
      desvio_final: sanidade.desvio_final,
      desvio_valido: sanidade.desvio_valido,
      observacao: sanidade.observacao
    };

    if (!sanidade.desvio_valido && sanidade.retry_resultado === 'FALHOU') {
      result.sharp_context.mapeamento_status = sanidade.mapeamento_status;
      result.sharp_context.odd_pinnacle = sanidade.odd_pinnacle_final;
      result.sharp_context.odd_bet365_tentada = oddManualBet365;
      result.sharp_context.erro_tipo = sanidade.erro_tipo;
      result.sharp_context.desvio_calculado = null;
      result.sharp_context.recomendacao = sanidade.recomendacao;
    }

    if (isBDesvioBlocked || !sanidade.desvio_valido) {
      result.sharp_context.mercado_alternativo = null;
    }
  }

  // Recalcule o Score Composto se o EV mudou (GATE V2.0)
  if (evExec !== null && result.sharp_context) {
    let scoreEV = 0;
    if (evExec >= 15) {
      scoreEV = 100;
    } else if (evExec >= 3) {
      scoreEV = 50 + ((evExec - 3) / 12) * 50;
    } else if (evExec >= 0) {
      scoreEV = (evExec / 3) * 50;
    } else {
      scoreEV = 0;
    }

    const chosenDelta = Math.abs(calibratedProbIA - (result.mercado?.probabilidade_elo ?? 50));
    const scoreGP = Math.max(0, 100 - (chosenDelta * 5));

    let scoreTier = 0;
    const tier = result.sharp_context.tier || baseResult.tier || 'C';
    if (tier === 'A') scoreTier = 100;
    else if (tier === 'B') scoreTier = 80;
    else if (tier === 'C') scoreTier = 40;

    const scoreConfianca = currentAdjConf;

    const clvDelta = result.clv?.delta || 0;
    let scoreCLV = 50;
    if (clvDelta > 0) scoreCLV = 100;
    else if (clvDelta < 0) scoreCLV = 0;

    // Line Movement & Deviation Safety
    let scoreLine = 100;
    if (sanidade.desvio_valido && result.mercado?.odd_referencia && oddManualBet365 && oddManualBet365 < result.mercado.odd_referencia) {
      const desvioNegativo = (result.mercado.odd_referencia - oddManualBet365) / result.mercado.odd_referencia;
      scoreLine = Math.max(0, 100 - (desvioNegativo / 0.03) * 100);
    }

    const newScoreComposto = Math.round(
      (scoreEV * 0.30) +
      (scoreGP * 0.20) +
      (scoreTier * 0.15) +
      (scoreConfianca * 0.15) +
      (scoreCLV * 0.10) +
      (scoreLine * 0.10)
    );

    result.score = newScoreComposto;
    result.sharp_context.score_composto = newScoreComposto;
  }

  // Atualizar o Kelly Base com a nova odd e EV
  if (evExec !== null) {
    if (!result.stake) {
      result.stake = { stake_final: 0, modificador: 1.0, kelly_base: 0 };
    }
    const kellyNew = (((probDecimal * oddManualBet365 - 1) / (oddManualBet365 - 1)) * 100) * 0.25;
    const kellyBaseVal = Math.min(3.0, Math.max(0, parseFloat(kellyNew.toFixed(2))));

    // Se o modificador é 0 (veio de um veto de bloqueio original), recuperamos para 1.0
    const mod = result.stake.modificador === 0 ? 1.0 : (result.stake.modificador ?? 1.0);

    result.stake.modificador = mod;
    result.stake.kelly_base = kellyBaseVal;
    result.stake.stake_final = Math.max(0, parseFloat((kellyBaseVal * mod).toFixed(2)));
  }

  if (marketReference && marketReference.hasReference && marketReference.fairProbs && result.mercado?.nome) {
    let fairProb = null;
    const nome = result.mercado.nome.toLowerCase();

    if (nome.includes('casa') || nome.includes('1x') || nome.includes('12')) {
      fairProb = marketReference.fairProbs[0];
    } else if (nome === 'empate') {
      fairProb = marketReference.fairProbs[1];
    } else if (nome.includes('fora') || nome.includes('x2')) {
      fairProb = marketReference.fairProbs[marketReference.fairProbs.length - 1]; // Away é o último
    }

    if (nome.includes('1x') && marketReference.fairProbs.length === 3) {
      fairProb = marketReference.fairProbs[0] + marketReference.fairProbs[1];
    } else if (nome.includes('x2') && marketReference.fairProbs.length === 3) {
      fairProb = marketReference.fairProbs[1] + marketReference.fairProbs[2];
    } else if (nome.includes('12') && marketReference.fairProbs.length === 3) {
      fairProb = marketReference.fairProbs[0] + marketReference.fairProbs[2];
    }

    if (fairProb && fairProb > 0) {
      const fairOdd = 1 / fairProb;
      const deviationRaw = (oddManualBet365 / fairOdd) - 1;
      result.evMarketDeviation = parseFloat((deviationRaw * 100).toFixed(1));
    } else {
      result.evMarketDeviation = null;
    }
  } else {
    result.evMarketDeviation = null;
  }

  // Atualizar Gate Status com base nas novas métricas de execução
  let currentStatus = baseResult.status;
  let currentBloqueio = baseResult.bloqueio;

  if (evExec !== null) {
    if (bloco6Veto) {
      currentStatus = 'BLOQUEADO';
      currentBloqueio = bloco6Veto;
    } else if (isBDesvioBlocked || !sanidade.desvio_valido) {
      currentStatus = 'BLOQUEADO';
      currentBloqueio = { codigo: 'B-DESVIO', motivo: desvioAviso || "Sanidade de odds falhou." };
    } else if (evExec < 3) {
      if (userConfirmedAudit) {
        currentStatus = 'APROVADO';
        currentBloqueio = undefined;
      } else {
        currentStatus = 'BLOQUEADO';
        currentBloqueio = { codigo: 'B-EV', motivo: `EV do mercado selecionado abaixo de +3% (EV atual: ${evExec.toFixed(1)}%). Score do jogo não substitui EV do mercado.` };
      }
    } else if (result.score && result.score < 60) {
      if (userConfirmedAudit) {
        currentStatus = 'APROVADO';
        currentBloqueio = undefined;
      } else {
        currentStatus = 'BLOQUEADO';
        currentBloqueio = { codigo: 'B-SCORE', motivo: `Score composto abaixo de 60 (Score obtido: ${result.score}/100).` };
      }
    } else if (result.stake && result.stake.stake_final < 0.5) {
      if (userConfirmedAudit) {
        currentStatus = 'APROVADO';
        currentBloqueio = undefined;
      } else {
        currentStatus = 'BLOQUEADO';
        currentBloqueio = { codigo: 'B-SCORE', motivo: `Kelly Stake insuficiente (${result.stake.stake_final}%). Mínimo: 0.5%.` };
      }
    } else {
      // Se passou nas validações de execução, e o bloqueio original era B-EV, B-SCORE ou B-DESVIO, nós unbloqueamos!
      if (baseResult.status === 'BLOQUEADO' && (baseResult.bloqueio?.codigo === 'B-EV' || baseResult.bloqueio?.codigo === 'B-SCORE' || baseResult.bloqueio?.codigo === 'B-DESVIO')) {
        currentStatus = 'APROVADO';
        currentBloqueio = undefined;
      }
    }
  }

  result.status = currentStatus;
  result.bloqueio = currentBloqueio;

  if (result.sharp_context) {
    result.sharp_context = {
      ...result.sharp_context,
      ev_ajustado: evExec !== null ? evExec : result.sharp_context.ev_ajustado,
      decisao_gate: currentStatus === 'APROVADO' ? 'APROVADO' as const : 'BLOQUEADO' as const,
      motivo_especifico: currentBloqueio ? currentBloqueio.motivo : "Critérios atendidos com sucesso.",
      score_composto: result.score !== undefined ? result.score : result.sharp_context.score_composto
    };
  }

  return formatToDecisaoEngine(result, analysis || {}, oddManualBet365, bancaTotal, userConfirmedAudit);
}

function calcDesvioClassificacao(
  dVal: number,
  isDecisiveMatch: boolean,
  isPlayoff: boolean,
  isCupFinal: boolean,
  isPopularFavorite: boolean,
  isDerbyClasico: boolean,
  pinnacleOdd: number,
  oddManualBet365: number
): { classificacao: string; aviso: string; flags: string[]; blocked: boolean; confAdjustment: number } {
  let classificacao = 'Normal';
  let aviso = '';
  let flags: string[] = [];
  let blocked = false;
  let confAdjustment = 0;

  if (dVal > 0) {
    if (dVal <= 5) {
      classificacao = 'Normal';
    } else if (dVal <= 10) {
      classificacao = 'Atenção';
      aviso = `⚠️ DESVIO POSITIVO MODERADO: +${dVal.toFixed(1)}%. Pinnacle: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}`;
    } else if (dVal <= 20) {
      classificacao = 'Suspeito';
      aviso = `⚠️ DESVIO SUSPEITO: +${dVal.toFixed(1)}%. Pinnacle: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}`;
    } else if (dVal <= 30) {
      classificacao = 'Odds infladas';
      confAdjustment = -15;
      flags.push('ODDS_INFLADAS_PUBLICO');
      flags.push('REVISAO_MANUAL_OBRIGATORIA');
      aviso = `⚠️ DESVIO EXTREMO: +${dVal.toFixed(1)}%\n Sharp money detectado no lado oposto.\n Pinnacle ref: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}\n EV pode estar inflado por distorção de mercado público.\n Valide manualmente antes de apostar.`;
    } else if (dVal <= 50) {
      classificacao = 'Armadilha pública';
      confAdjustment = -25;
      flags.push('ARMADILHA_PUBLICA');
      aviso = `🚨 PADRÃO DE ARMADILHA PÚBLICA\n Contexto com desvio extremo (+${dVal.toFixed(1)}%) é padrão clássico de linha manipulada para mercado casual.\n Risco elevado de EV ilusório.\n Pinnacle ref: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}`;
    } else {
      classificacao = 'Distorção severa';
      blocked = true;
      aviso = `🚨 DISTORÇÃO SEVERA POR DESVIO: +${dVal.toFixed(1)}% na Bet365. Pinnacle ref: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}`;
    }

    // Regra D2 - Contexto Amplificador
    if (dVal >= 20 && classificacao !== 'Distorção severa') {
      if (isCupFinal || isPlayoff || isPopularFavorite || isDerbyClasico) {
        const currentPen = classificacao === 'Odds infladas' ? 15 : 25;
        const extraPen = 25 - currentPen;
        confAdjustment -= extraPen;
        classificacao = 'Armadilha pública';
        if (!flags.includes('ARMADILHA_PUBLICA')) {
          flags.push('ARMADILHA_PUBLICA');
        }
        const compType = isCupFinal ? 'Final de competição' : isPlayoff ? 'Playoff eliminatório' : isPopularFavorite ? 'Favorito popular' : 'Clássico/Derby';
        aviso = `🚨 PADRÃO DE ARMADILHA PÚBLICA\n Contexto de ${compType} com desvio extremo (+${dVal.toFixed(1)}%) é padrão clássico de linha manipulada para mercado casual.\n Risco elevado de EV ilusório.\n Pinnacle ref: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}`;
      }
    }

    // Regra D4 - Bloqueio em jogo decisivo
    if (dVal >= 30 && isDecisiveMatch) {
      blocked = true;
      aviso = `Desvio de +${dVal.toFixed(1)}% em jogo decisivo indica distorção severa de mercado público. Nenhum mercado confiável para EV real. Não sugerir alternativa. O problema é o jogo, não o mercado.`;
    }
  } else if (dVal < 0) {
    const absD = Math.abs(dVal);
    if (absD <= 5) {
      classificacao = 'Normal';
    } else if (absD <= 15) {
      classificacao = 'Sharp entrando';
      flags.push('SHARP_ENTRANDO');
    } else if (absD <= 30) {
      classificacao = 'Sharp money confirmado';
      confAdjustment = 10;
      flags.push('SHARP_CONFIRMADO');
      aviso = `✅ SHARP MONEY CONFIRMADO\n Bet365 limitando exposição (-${absD.toFixed(1)}%).\n Pinnacle: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}\n Mercado profissional já nessa posição.\n Sinal de valor real confirmado.`;
    } else {
      classificacao = 'Sharp money pesado';
      confAdjustment = 15;
      flags.push('SHARP_PREMIUM');
      aviso = `✅ SHARP MONEY PESADO CONFIRMADO\n Bet365 se protegendo com linha pesada de apostadores sharp (-${absD.toFixed(1)}%).\n Pinnacle: ${pinnacleOdd.toFixed(2)} | Bet365: ${oddManualBet365.toFixed(2)}\n Mercado profissional já nessa posição.\n Sinal de valor real confirmado.`;
    }
  }

  return {
    classificacao,
    aviso,
    flags,
    blocked,
    confAdjustment
  };
}
