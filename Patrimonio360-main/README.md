# Patrimônio 360 — dados importados

Esta versão local contém os dados importados das planilhas CSV enviadas.

## Dados incluídos

- 1.602 movimentações consolidadas entre receitas, despesas e investimentos.
- 4 contas bancárias.
- 5 cartões.
- 22 categorias.
- 9 assinaturas.
- 39 transferências.
- 33 meses de histórico consolidado.
- IA financeira local usando o mês selecionado no dashboard.

## Como executar

1. Abra esta pasta no Visual Studio Code.
2. Instale a extensão Live Server.
3. Clique com o botão direito em `index.html`.
4. Escolha `Open with Live Server`.

## Primeiro acesso

Os dados são carregados automaticamente do arquivo `imported-data.js` e depois ficam salvos no navegador.

Para forçar uma nova importação, abra o console do navegador e execute:

```js
localStorage.removeItem('p360-state-importado');
location.reload();
```

## Arquivos

- `index.html`: entrada do sistema.
- `styles.css`: visual e responsividade.
- `app.js`: funcionalidades e IA local.
- `imported-data.js`: base importada das planilhas.
