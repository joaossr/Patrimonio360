# Patrimônio 360 — IA Financeira Contextual v39

Esta versão evolui a IA local para uma conversa contextual. Ela não depende de um provedor externo de LLM.

## O que mudou

- Mantém histórico recente da conversa no Firebase.
- Entende perguntas de continuação como:
  - "E se eu parcelar em 5x?"
  - "E em 10x?"
  - "E no Nubank?"
  - "E mês que vem?"
  - "Quanto ficaria por mês?"
- Reaproveita o valor e o assunto da pergunta anterior quando a nova mensagem é curta.
- Simula compras à vista e parceladas.
- Compara o impacto da primeira parcela com a sobra planejada.
- Consulta cartões, faturas, limites, disponibilidade e compras cadastradas.
- Analisa categorias e, quando existe orçamento por categoria, informa margem/estouro.
- Consulta compromissos a pagar e receitas a receber.
- Analisa reserva, meta da reserva e cobertura por despesas essenciais.
- Analisa metas e progresso.
- Analisa investimentos, patrimônio aplicado e concentração básica.
- Analisa assinaturas mensais e anuais.
- Analisa contas bancárias e saldo cadastrado.
- Faz diagnóstico, previsão, otimização e sugestões de economia sem inventar dados ausentes.
- Evita repetir sempre a mesma resposta de menu.
- Diferencia dados registrados de projeções.

## Segurança de interpretação

A IA continua determinística e baseada nos dados do Patrimônio 360. Ela não inventa limite de cartão, prazo, orçamento, renda ou meta que não esteja cadastrado.

Quando faltar um dado necessário, a resposta informa o que precisa ser cadastrado ou perguntado.
