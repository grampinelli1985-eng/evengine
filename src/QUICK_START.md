# Quick Start - EVEngine Tipster Engine

Siga estes passos para começar a usar o novo motor de análise:

1. **Atualize o App**: O `App.tsx` já foi configurado para usar o `MatchCardTipster`.
2. **Mock Data**: Use `src/mocks/mockData.ts` para testar componentes sem depender de APIs externas.
3. **Análise IA**: Agora cada análise do Gemini inclui automaticamente métricas de EV e Kelly via `geminiService.ts`.
4. **Bilhetes**: Abra o `TicketModal` para ver o novo validador de apostas múltiplas em ação.

## Comandos Úteis
- `npm run dev`: Inicia o servidor de desenvolvimento.
- `npm run lint`: Verifica erros de tipagem.

## Estrutura de Pastas
- `/src/services`: Motores lógicos.
- `/src/components`: Interface visual.
- `/src/mocks`: Dados de teste.
