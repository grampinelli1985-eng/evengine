export type DecisaoEngine = {
  decisao: {
    status: 'APROVADO' | 'BLOQUEADO' | 'ALERTA';
  };
  score: {
    valor: number;
    motivos_bloqueio: string[];
  };
  sharp_context?: {
    desfalques_verificados: boolean;
    forma_casa_5j: string;
    forma_visitante_5j: string;
    contexto_competicao: string;
    ajuste_probabilidade_aplicado: string;
    probabilidade_final_casa: number;
    ev_ajustado: number;
    decisao_gate: 'APROVADO' | 'BLOQUEADO';
    motivo_especifico: string;
    score_composto?: number;
    confianca_ajustada?: number;
    mercado_alternativo?: {
      nome: string;
      odd: number;
      ev: number;
    } | null;
    sanidade_odds?: any;
  };
  linha?: {
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
  mercado_selecionado: {
    nome: string;
    probabilidade_final: number; // probabilidade IA principal (ex: 68)
    odd_referencia: number;
    break_even_odd: number;
    odd_bet365_publica?: number;
    odd_bet365_manual?: number | null;
    probabilidade_elo: number;
    selecionado: boolean;
    ev?: number;
  };
  todos_mercados: {
    nome: string;
    probabilidade_final: number;
    odd_referencia: number;
    break_even_odd: number;
    odd_bet365_publica?: number;
    selecionado: boolean;
  }[];
  stake: {
    percentual: number;
    valor_reais: number;
    stake_final?: number;
    modificador?: number;
    kelly_base?: number;
  };
  
  // Auditoria
  modo_auditoria?: boolean;
  aviso_ev_negativo?: number | null;
  audit_mode?: {
    ativo: boolean;
    odd_manual: number | null;
    ev_recalculado: number | null;
    motivo: string;
  };
  
  alertas?: string[];
  
  /** @deprecated Use decisao.status em vez deste campo solto */
  status?: string;
  
  /** @deprecated Use mercado_selecionado em vez deste campo solto */
  mercado?: any;
  
  /** @deprecated O score no root deve ser tratado apenas como objeto. Não use como primitivo. */
  scoreNum?: number;
};

export type EngineInput = {
  analysis: any;
  matchCardValues?: {
    ev: number;
    kelly: number;
    tier: string;
    confianca: number;
    convergenciaOk: boolean;
  };
  oddManualBet365?: number | null;
  bancaTotal?: number; // valor total da banca em reais para calculo
  userConfirmedAudit?: boolean; // Confirmação de auditoria do usuário
  currentLocalTime?: string;
};
