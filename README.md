# 🧠 EVEngine AI Analytical Engine

## ⚠️ COMO RODAR (LEIA ANTES)

Use SEMPRE este comando para subir o projeto:
```bash
npm run dev:all
```

Isso sobe simultaneamente:
- Frontend Vite (porta 3000)
- Backend Proxy API-Football (porta 3001)

Se rodar só `npm run dev`, as chamadas H2H falharão com CORS.

## 🛠 Arquitetura de Serviços

- **Gemini Service:** Orquestra as análises de IA usando o modelo `gemini-flash-latest`.
- **Scouting Service:** Busca dados de H2H e forma recente (via Proxy).
- **Poisson Service:** Calcula probabilidades matemáticas de gols e 1X2.
- **Telemetry Service:** Registra o desempenho do Gate v2.0 no Supabase.

## 📋 Pré-requisitos (.env)

Certifique-se de ter as chaves configuradas no arquivo `.env` da raiz:
- `VITE_ODDS_API_KEY`
- `VITE_GEMINI_API_KEY`
- `API_FOOTBALL_KEY` (Sem o prefixo VITE_ por segurança)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_DEBUG_ENGINE` (Use `true` em ambiente local para visualizar os logs de payload no console)

## 🧠 Arquitetura DecisaoEngine (Gate v2.0)

A EVEngine utiliza um contrato de dados restrito e fortemente tipado chamado `DecisaoEngine` para trafegar as decisões da IA para a interface visual.

### Fluxo de Dados:
1. **Ação do Usuário**: O usuário abre o modal de um jogo ou altera a odd manual (Bet365).
2. **Motor Analítico**: O `tipsterEngine.ts` executa as heurísticas e formata os dados.
3. **DecisaoEngine (Contrato)**: Todos os retornos (mesmo em caso de erros) passam pelo encapsulador `formatToDecisaoEngine`, que unifica o objeto `mercado_selecionado`, a lista de `todos_mercados`, e define o `status` APROVADO ou BLOQUEADO.
4. **Componentes Consumidores**: O front-end (ex: `AnalysisView.tsx`) consome exclusivamente a interface unificada, dispensando fallback getters (`??`) para propriedades legadas.

### Códigos de Bloqueio Implementados (Gate v2.5)
Quando o sistema bloqueia uma análise, ele aponta um motivo claro e embasado quantitativamente:
- **`B1` (EV Execução)**: EV insuficiente (< 3.0%). Calculado linearmente sobre a probabilidade calibrada por Shrinkage Bayesiano: $EV = P_{calibrada} \cdot Odd_{api} - 1$. Se o retorno esperado real não bater o piso de 3%, a operação é trancada.
- **`B2` (Kelly Mínimo)**: Kelly Criterion < 0.5%, indicando que a fração ideal de banca (Quarter-Kelly) é tão pequena que o edge não justifica a exposição ao risco residual.
- **`B3` (Convergência de Modelos)**: Divergência Gemini × Poisson > 15pp. Sinaliza conflito conceitual severo entre a IA qualitativa e o modelo estatístico físico.
- **`B5` (Tier Insuficiente)**: Jogo classificado fora dos Tiers operacionais elegíveis (Tiers A ou B). Evita mercados de baixa liquidez e ruído de informação.
- **`B7` (Line Movement Adverso)**: Linha de mercado moveu-se contra a nossa recomendação em casas profissionais (*sharp books*). Se a variação de odd indicar fluxo de dinheiro profissional (*sharp money*) contra a nossa posição com desvio $> 5\%$, o motor veta a entrada para proteção.
- **`B-UNDERDOG` (Calibração de Zebra)**: Bloqueia sob viés otimista de zebras se a divergência entre a IA qualitativa e o modelo físico (ELO) exceder 8pp para probabilidades $< 30\%$. Aplica também redutor de calibração de $0.70x$ sobre a projeção do modelo de linguagem.
- **`B-DADOS` (Data Coverage)**: Dados factuais insuficientes (≥ 3 critérios factuais faltando, como forma recente, confrontos diretos ou campo).
- **`B-NO-REF` (Sem Referência)**: Ausência de odds de referência limpas (Pinnacle/Betfair) para ancoragem analítica.

---

### Inovações Quantitativas Aplicadas (Padrão Sharp Money)

O motor do **EVEngine v8.0** foi reestruturado para extinguir distorções estatísticas comuns em modelos comerciais recreativos, aplicando as seguintes metodologias de ponta:

#### 1. Shrinkage Bayesiano (Regressão de Credibilidade)
Para evitar que a IA infle probabilidades e quebre a barreira dos 100% de probabilidade combinada, aplicamos uma Regressão Bayesiana. A probabilidade da IA ($P_{IA}$) é regredida em direção à probabilidade justa livre de margem (*no-vig*) do mercado sharp ($P_{sharp\_novig}$), ponderada por um fator de credibilidade ($w$) dependente da imprevisibilidade da liga:
$$P_{calibrada} = w \cdot P_{IA} + (1 - w) \cdot P_{sharp\_novig}$$
*Onde $w = 1.0$ (Ligas Normais), $w = 0.90$ (Alta imprevisibilidade) e $w = 0.80$ (Extrema imprevisibilidade).*

#### 2. Distribuição Bivariada de Gols com Ajuste Dixon-Coles
Modelos simples de Poisson sofrem de subestimação crônica da probabilidade de empates em jogos de poucos gols por tratarem os gols como variáveis independentes. Implementamos uma correção bivariada de **Dixon-Coles** com fator de correlação $\rho = -0.12$ para os placares de baixa frequência ($0-0, 1-0, 0-1, 1-1$). Adicionalmente, removemos o achatamento artificial de $85\%$, garantindo probabilidades de placares 100% exatas.

#### 3. Ajuste Qualitativo Pré-EV (Linearidade Pura)
Penalidades qualitativas (lesões, motivação de vestiário, clima) nunca devem ser somadas diretamente ao EV final, pois isso quebra a linearidade do retorno matemático. No EVEngine, os modificadores qualitativos do Scout atuam diretamente sobre a **probabilidade base** ($P_{ajustada} = P_{base} \pm \frac{EV_{ajuste}}{Odds}$), propagando-se harmonicamente para manter o espaço amostral normalizado, resultando em um cálculo de EV final limpo e real ($EV = P_{ajustada} \cdot Odd - 1$).

#### 4. Expected Score ELO (Modelo Davidson)
Para evitar o *rating drift* (descalibração acumulada de força relativa das equipes) comum em sistemas ELO padrão ao processar empates, calibramos o cálculo do Expected Score ($E_h$) de acordo com o modelo de Davidson para empates:
$$E_h = P_{casa} + 0.5 \cdot P_{empate}$$
$$E_a = P_{fora} + 0.5 \cdot P_{empate}$$

#### 5. CLV Real sem Overround (Vig-Free)
Nosso monitoramento de performance de *Paper Trading* e ROI mede a qualidade real do timing das suas entradas comparando a odd da aposta contra a odd de fechamento profissional deduzida de seu overround sharp estimado em $3.0\%$:
$$CLV = \left( \frac{Odd_{entrada}}{Odd_{fechamento} \cdot 1.03} \right) - 1$$

---

### Fórmula Analítica de Escolha de Mercado
A heurística do `tipsterEngine` seleciona o mercado quantitativamente dominante calculando:
1. `scoreVal` baseado na somatória: Confiança da IA (35%), Poisson Dixon-Coles (25%), H2H (20%) e ML Convergence (20%).
2. Um mercado só é APROVADO se atingir Score ≥ 70 **E** o Expected Value (EV) calculado contra a linha no-vig for $\ge +3.0\%$ (Gate B1).
3. Caso a convergência entre os modelos estatísticos e qualitativos seja dúbia, é dada preferência matemática automática para cotações de Dupla Chance ou Handicaps Asiáticos equivalentes.
