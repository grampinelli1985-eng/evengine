# Changelog

## [1.2.0] - 2026-05-29 - Reestruturação Quantitativa e Matemática Sharp

### Adicionado
- **Dixon-Coles Bivariante Simplificado:** Implementação de fator de correlação $\rho = -0.12$ para placares de baixo volume ($0-0$, $1-0$, $0-1$, $1-1$) em `poissonService.ts`, corrigindo a subestimação de empates inerente ao Poisson clássico.
- **Shrinkage Bayesiano (Regressão Bayesiana):** Substituição do antigo `fatorConfianca` multiplicativo por um blend ponderado de credibilidade $w$ regredindo as probabilidades da IA em direção às odds livres de margem (*no-vig*) da Pinnacle/Betfair, preservando $100\%$ do espaço amostral.
- **Calibração de Limiar por Yield/ROI:** Substituição do critério estático de acerto de $55\%$ por uma avaliação dinâmica do ROI/Yield real acumulado em cada faixa de confiança em `calibrationService.ts`.

### Modificado
- **Lógica Qualitativa Pré-EV:** Penalizações e bônus (desfalques, playoffs, motivação) em `tipsterEngine.ts` agora agem diretamente sobre a **probabilidade base** (calibrada e re-normalizada de forma consistente no 1X2) e não adicionados linearmente ao EV final, extinguindo a inversão matemática de probabilidade reversa.
- **CLV Limpo Sem Margem (No-Vig):** As fórmulas de Closing Line Value (CLV) em `clvService.ts` e `betService.ts` passam a confrontar a odd de aposta contra a **odd de fechamento sem comissão (no-vig)**, expurgando dinamicamente $3\%$ de overround sharp para métricas de ganho real.
- **Davidson ELO draw expected score:** Calibrado o algoritmo de cálculo de expected score ($E_h$) em empates em `eloService.ts` para somar $P(Win) + 0.5 \cdot P(Draw)$, coibindo o fenômeno acumulado de *rating drift* das equipes.

### Corrigido
- **Filtro de Placares Reais:** Removido o limite forçado de deflação artificial a $85\%$ nos top placares, permitindo relatórios estatísticos idênticos e 100% integrados aos mercados do painel.
- **Bypasses de Teste Removidos:** Expurgados todos os hardcodes e overrides fictícios em `goalsService.ts` (lambda 2.16 e EV prob 0.39 @ 1.95). As asserções do suite de testes de gols foram corrigidas para a matemática real.
- **Teste de Protocolo de Urgência:** Corrigido o teste falho preexistente `Teste 9: Protocolo de Urgência` em `tests/decisao_consistency.test.ts` adicionando `currentLocalTime` dinâmico consistente com o commencement time fictício da simulação.

## [1.1.0] - 2026-05-17 - Estabilização do DecisaoEngine e Gate v2.0

### Adicionado
- **Contrato DecisaoEngine:** Estrutura unificada e fortemente tipada que engloba todas as decisões e heurísticas da EVEngine (`src/types/decisao.ts`).
- **Suporte a Odd Pública Bet365:** Inclusão das propriedades `odd_bet365_publica` e `odd_bet365_manual` tanto para o `mercado_selecionado` quanto para a lista `todos_mercados`.
- **Testes Automatizados:** Suíte de testes em Vitest (`tests/decisao_consistency.test.ts`) para garantir a consistência de persistência do payload do motor e re-validação em atualizações de estado.
- **Log Flags:** Variável de ambiente `VITE_DEBUG_ENGINE=true` para exibir os tracebacks granulares do `[FORMAT]`, `[ENGINE]` e `[REGRESSÃO]` apenas em dev, mantendo a build de produção limpa.

### Modificado
- **AnalysisDecisionCard & AnalysisView:** Os componentes de UI agora leem _estritamente_ as chaves nativas do contrato `DecisaoEngine` (ex: `teEngine.mercado_selecionado.nome`).
- **Painel Bet365 vs Pinnacle:** Refatorado para exibir analiticamente a odd de referência e a odd da Bet365, calculando e colorindo o desvio (edge de valor) em tempo real.
- **Tabela EV (Valor Esperado):** A tabela agora é populada unicamente pelo array de inteligência `todos_mercados` do motor, despoluindo a tela de mercados estéreis e garantindo sincronia.

### Removido / Descontinuado
- **Acesso Condicional Legado (`??`):** Propriedades avulsas e *fallbacks* imprecisos de interface (como `teEngine?.mercado` ou `status` fora do namespace `decisao`) receberam o docblock `@deprecated`. A remoção física dos nós legados será feita 1 semana após a validação desta build em produção, encerrando o período de retrocompatibilidade temporal.

### Corrigido
- **Bug de Regressão na Renderização da Lista EV:** O método `recalculateTipsterMetrics` foi corrigido para passar o estado anterior e restaurar corretamente a listagem de `todos_mercados` durante re-renderizações (onde antes resultava numa quebra ou apagamento).
- **Vazamento de Aninhamento:** O formatador mestre `formatToDecisaoEngine` agora trata aninhamentos duplos na key `score`, evitando falhas críticas do React render (objetos como child nodes).
