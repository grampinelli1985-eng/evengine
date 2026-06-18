# Integração Tipster - EVEngine AI

Este guia descreve como utilizar os novos serviços de análise tipster e geração de bilhetes.

## 🚀 Novos Serviços

### 1. TipsterAnalysisService
Localizado em `src/services/tipsterAnalysisService.ts`.
Este serviço calcula:
- **EV (Expected Value)**: Valor esperado da aposta.
- **Kelly Criterion**: Stake sugerido baseado na vantagem sobre a casa.
- **Tiers (S, A, B, C, D)**: Categorização automática por nível de confiança.

### 2. TicketGenerationService
Localizado em `src/services/ticketGenerationService.ts`.
Gerencia a composição de bilhetes múltiplos:
- Valida se o bilhete segue regras de gestão de risco.
- Calcula odds acumuladas e fair odds do bilhete.
- Sugere stake total para o bilhete.

## 📱 Componentes

### MatchCardTipster
Substituto moderno para o `MatchCard.tsx`.
- Exibe o Tier da aposta.
- Mostra EV e Confiança em tempo real.
- Botão de ação inteligente 🟢🟡🔴.

## 🛠️ Como usar

### Analisando um jogo manualmente
```typescript
import TipsterAnalysisService from './services/tipsterAnalysisService';

const service = new TipsterAnalysisService();
const analysis = service.analyzePick(input, stats);
```

### Gerando um bilhete
```typescript
import { TicketGenerationService } from './services/ticketGenerationService';

const ticketService = new TicketGenerationService();
const result = ticketService.generateTicket(picks, bankroll);
```
