# P360 Mind — a IA própria do Patrimônio 360

IA financeira feita sob medida para o sistema. **Não usa nenhuma API externa** (o DeepSeek foi removido), não precisa de GPU nem de servidor: roda no navegador do usuário e também no Node (bot do Telegram), em JavaScript puro e sem dependências.

## Por que esse desenho

Um modelo de linguagem genérico (tipo ChatGPT) rodando localmente pesaria gigabytes, não caberia no celular nem no plano gratuito do Render, e poderia inventar números. Para finanças pessoais, o que importa é:

1. **entender a pergunta** em português informal,
2. **calcular a resposta com os dados reais** (sem inventar),
3. **aprender o padrão de cada pessoa** com o tempo.

Por isso a IA é dividida em três camadas leves e explicáveis.

| Arquivo | Papel |
| --- | --- |
| `text.js` | Normalização do português (acentos, gírias, "R$", "2 mil", "10x", "mês passado") e extração de valores, parcelas, meses e categorias. |
| `nlu.js` | Classificador de intenções **Complement Naive Bayes** com n-gramas de caracteres (tolera erros de digitação) + corpus de ~390 frases em 26 intenções. Aprende de forma incremental. |
| `personal-model.js` | **Modelo pessoal**, retreinado a partir do histórico de cada usuário: classificador "descrição → categoria", gasto típico por categoria (média com peso maior para os meses recentes), desvio e tendência, renda (média, estabilidade e dia de pagamento), gastos recorrentes, hábitos, previsão de fechamento do mês, anomalias e índice de saúde financeira. |
| `skills.js` | Respostas (resumo, quanto posso gastar, previsão, avaliação de compra, economia, metas, cartões, etc.), sempre a partir dos números calculados. |
| `engine.js` | Orquestra tudo: entende a frase, mantém o contexto da conversa ("e em 5x?", "e no mês passado?"), responde, coleta feedback e gerencia a memória. |

## Como ela aprende com cada usuário

- **Com os dados**: a cada uso o modelo pessoal é retreinado com as movimentações (leva milissegundos). Com mais meses de histórico, as previsões, os alertas de "fora do seu padrão" e as sugestões de categoria ficam mais precisas. A página da IA mostra o nível de conhecimento (sem histórico → inicial → média → alta).
- **Com as conversas**: 👍 reforça a interpretação; 👎 ou uma pergunta que ela não entendeu abre "Me ensine: sobre o que era a pergunta?". A frase ensinada entra no classificador do usuário com peso maior.
- **Com o que o usuário conta**: "minha renda é 4000", "quero guardar 500 por mês", "minha prioridade é a reserva" viram fatos usados nos cálculos.
- **Com o uso**: os temas mais perguntados viram as sugestões iniciais; o estilo (curto, normal ou detalhado) é ajustável.
- **Categorias**: ao digitar a descrição de uma movimentação, a IA sugere a categoria aprendida com os lançamentos anteriores e mede a própria taxa de acerto.

A memória fica em `state.aiModel`, na conta do próprio usuário (Firestore), sincronizada entre aparelhos e com o bot do Telegram. Os dados de um usuário nunca treinam o modelo de outro. O usuário pode apagar a memória na página da IA.

## Testes

```bash
cd backend
npm run test:ai
```

Medem a precisão em frases que não estão no corpus (100% em 28 frases com erros de digitação e gírias), a validação cruzada do corpus, o aprendizado de frases ensinadas, o modelo pessoal (categorias, recorrência, renda, anomalias) e as respostas com números reais.

## Como evoluir

- Acrescente frases em `CORPUS` (`nlu.js`) e rode os testes.
- Uma nova habilidade = uma intenção nova no `CORPUS` + `INTENT_LABELS` + função em `SKILLS`.
- As frases que os usuários ensinam (`aiModel.examples`) são uma boa fonte para ampliar o corpus base, desde que revisadas e com o consentimento deles.
