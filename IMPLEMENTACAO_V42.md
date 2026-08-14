# Patrimônio 360 — v42

## Escopo
Evolução somente do Calendário Financeiro e do Orçamento Mensal, preservando o restante da plataforma.

## Calendário Financeiro
- Popup agora é criado como uma janela flutuante `position: fixed`, fora da célula.
- Fundo totalmente sólido usando `var(--card-solid)`.
- Posicionamento dinâmico considerando célula, cursor e viewport.
- Prioridade: direita, esquerda, baixo e cima conforme espaço real disponível.
- Nunca deixa a janela sair da viewport.
- Mantém a posição estável enquanto o cursor permanece na mesma data.
- Todas as movimentações do dia são apresentadas.
- Altura máxima com rolagem interna quando necessário.
- Valores preservam `+ R$ ...` / `- R$ ...` em uma única linha.
- Reposicionamento em resize/scroll sem acumular listeners.

## Orçamento Mensal
- Um único resumo com Renda, Planejado, Total gasto e Disponível.
- Distribuição Financeira integrada ao mês selecionado.
- Investimentos e Lazer recebem limite automático com base na renda do mês.
- Exemplo: renda R$ 1.920, distribuição 60/35/5 => Investimentos R$ 672 e Lazer R$ 96.
- Limites de despesas fixas continuam manuais.
- Categorias separadas em Despesas Fixas e Despesas Variáveis.
- Gastos sem categoria continuam no total geral.
- Gráficos compactos: Planejado x Realizado, Gastos por Categoria, Fixas x Variáveis e comparação mensal.
- Área de atenção compacta para categorias próximas/acima do limite.

## Categorias e despesas
- Clique em categoria abre detalhes.
- Editar categoria renomeia a categoria e atualiza seus vínculos.
- Alterar limite modifica apenas o limite manual do mês.
- Alterar categoria move a despesa para outra categoria.
- Remover da categoria transforma a despesa em `Sem categoria` sem excluí-la.
- Excluir despesa remove efetivamente a movimentação.
- Excluir categoria preserva as despesas, deixando-as sem categoria.

## Testes realizados
- `node --check app.js`
- `node --check backend/src/server.js`
- Teste lógico de orçamento com renda R$ 1.920: Investimentos R$ 672 e Lazer R$ 96.
- Teste de contabilização de `Sem categoria`.
- Testes de posicionamento do popup no centro, laterais, parte inferior e cantos.

Observação: o teste de execução do backend completo requer as dependências de `backend/package.json` instaladas no ambiente.
