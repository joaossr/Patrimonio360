# Patrimônio 360 — IA Contextual v40

## Correções desta versão

- Memória contextual enviada também pelo frontend para o backend; a conversa continua mesmo quando a memória do Firestore ainda não foi carregada.
- Perguntas de continuação usam o assunto anterior antes de cair no fallback genérico.
- Compra parcelada recupera valor e contexto da pergunta anterior.
- Perguntas como “quanto ainda posso gastar em lazer?” identificam a categoria e usam o orçamento cadastrado.
- “Quanto falta para minha reserva chegar em R$ 4.000?” usa o valor informado na pergunta, não apenas a meta configurada.
- “O que tenho para pagar nas próximas semanas?” olha os próximos 30 dias, não apenas o mês selecionado.
- Análise de cartões pode continuar uma simulação de compra anterior.
- Corrigida pluralização de “cartões”.

## Teste recomendado

1. Reinicie o backend após substituir os arquivos.
2. Limpe/abra uma conversa nova na IA.
3. Teste em sequência:
   - Posso comprar um violão de R$ 1.000?
   - E se eu parcelar em 5 vezes?
   - E em 10x?
   - Qual cartão seria melhor?
   - E se eu esperar até setembro?
   - Quanto ainda posso gastar em lazer?
   - Quanto falta para minha reserva chegar em 4 mil?
   - O que eu tenho para pagar nas próximas semanas?
   - Como estão meus cartões?

Se uma resposta antiga continuar aparecendo, o backend antigo ainda está rodando. Feche o terminal/processo anterior e inicie o backend da nova pasta novamente.
