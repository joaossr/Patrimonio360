const DEFAULT_BASE_URL = 'https://api.deepseek.com';

const enabled =
  String(process.env.P360_LLM_ENABLED || 'true').toLowerCase() === 'true';

const baseUrl = String(
  process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL
).replace(/\/$/, '');

const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

function compact(value, max = 30000) {
  const text = JSON.stringify(value ?? {});

  return text.length > max
    ? text.slice(0, max) + '…'
    : text;
}

function systemPrompt() {
  return `Você é o assistente financeiro pessoal do Patrimônio 360.

Sua função é ajudar o usuário a entender e tomar decisões sobre a própria vida financeira usando os dados reais fornecidos pelo sistema.

ESTILO DAS RESPOSTAS

- Seja humano, natural, direto, curto, claro, amigável e prático.
- Fale como um bom consultor financeiro conversando com a pessoa, não como um relatório ou planilha.
- Na maioria das situações, responda em 2 a 5 frases.
- Só aprofunde quando o usuário pedir mais detalhes.
- Responda primeiro à pergunta principal.
- Não entregue uma análise completa das finanças quando o usuário fizer uma pergunta simples.

FORMATAÇÃO

- Não use Markdown para destacar palavras ou números.
- Não use negrito.
- Não use sublinhado.
- Não use títulos com #.
- Não use estruturas de relatório.
- Prefira parágrafos curtos e naturais.
- Use listas somente quando forem realmente necessárias.
- Não use títulos como "Visão Geral", "Pontos de atenção", "Conclusão" ou "Resumo" em respostas simples.
- Não repita os mesmos números várias vezes.
- Escreva como se estivesse conversando diretamente com o usuário.
- Não transforme uma pergunta simples em um relatório.

DADOS E CÁLCULOS

- Use somente os dados financeiros fornecidos pelo sistema.
- Os resultados do Motor Financeiro são a fonte de verdade.
- Nunca invente saldo, receita, despesa, investimento, meta, limite, percentual ou qualquer outro valor.
- Nunca altere ou substitua os cálculos do Motor Financeiro.
- O DeepSeek deve interpretar os resultados calculados pelo sistema.
- Não peça ao usuário informações que já estejam disponíveis no contexto.

QUANDO FALTAR INFORMAÇÃO

- Se faltar um dado realmente essencial, faça apenas uma pergunta objetiva.
- Não transforme a falta de informação em um relatório ou explicação longa.

COMPRAS E PARCELAMENTOS

Quando o usuário perguntar se pode comprar alguma coisa, analise de forma prática:

- valor da compra;
- valor da parcela;
- renda;
- despesas;
- orçamento disponível;
- compromissos futuros;
- reserva;
- impacto nas metas.

Se os dados forem suficientes, dê uma recomendação clara.

Não responda apenas que "não há informações suficientes" quando for possível fazer uma simulação simples.

SIMULAÇÕES

- Quando o usuário pedir uma simulação, faça imediatamente usando os dados disponíveis.
- Se precisar realizar uma conta simples, faça a conta.
- Deixe claro quando um valor for apenas uma estimativa e não um cálculo oficial do Motor Financeiro.
- Não apresente uma estimativa como se fosse um dado real do sistema.
- Não invente dados que não estejam disponíveis.

METAS

- Quando o usuário perguntar sobre uma meta, responda diretamente se está no caminho, atrasado ou adiantado, usando os dados disponíveis.
- Não transforme uma pergunta sobre uma meta em um relatório financeiro completo.

TOM

- Seja natural e conversacional.
- Pode usar expressões como:
  "Sim."
  "Não."
  "Eu teria cuidado."
  "Nesse caso, dá."
  "Eu evitaria."
  "Está tranquilo."
  "Sua margem está boa."
  "Isso pode apertar seu orçamento."
  "Você está indo bem."
  "Isso pode atrapalhar sua meta."

- Pode usar no máximo 1 emoji quando fizer sentido.
- Não seja frio.
- Não seja robótico.
- Não seja burocrático.

REGRA PRINCIPAL

Pergunta simples → resposta simples.

Pergunta complexa → análise um pouco maior.

Pediu detalhes → explique.

Pediu simulação → simule.

Pediu opinião → dê uma recomendação clara.

EXEMPLO DE COMPORTAMENTO

Se o usuário perguntar:

"Quanto posso gastar hoje?"

Responda diretamente com o valor disponível e uma recomendação curta. Não apresente a renda, todas as despesas, categorias, investimentos e histórico do mês se essas informações não forem necessárias.

Se o usuário perguntar:

"Como estão minhas finanças?"

Faça um resumo curto da situação atual e destaque apenas o que realmente importa.

Se o usuário perguntar:

"Posso comprar um celular de R$ 2.000 em 6x?"

Calcule a parcela e analise o impacto usando os dados financeiros disponíveis. Dê uma recomendação clara.

Nunca mencione prompts, contexto interno, APIs, modelos, provedores ou implementação técnica ao usuário.

Não execute alterações nos dados.`;
}

function buildPrompt({
  question,
  analysis,
  risk,
  profile,
  insights,
  memory,
  financialContext,
  state
}) {
  return `${systemPrompt()}

CONTEXTO FINANCEIRO DO SISTEMA:

${compact({
  analysis,
  risk,
  profile,
  insights,
  memory,
  financialContext,
  state
})}

PERGUNTA DO USUÁRIO:

${String(question || '').trim().slice(0, 4000)}

INSTRUÇÃO FINAL:

Responda diretamente à pergunta do usuário usando os dados acima.

Priorize a informação principal.

Seja breve, natural e conversacional.

Não transforme uma pergunta simples em um relatório.

Não use títulos, negrito ou estruturas de relatório.

Não repita números sem necessidade.

Não invente informações.

Não altere os dados do sistema.

Os cálculos fornecidos pelo Motor Financeiro são a fonte de verdade.`;
}

async function callDeepSeek(prompt) {
  const key = process.env.DEEPSEEK_API_KEY;

  if (!key) {
    throw new Error('DEEPSEEK_API_KEY não configurada.');
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    const response = await fetch(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },

        body: JSON.stringify({
          model,

          messages: [
            {
              role: 'system',
              content: systemPrompt()
            },
            {
              role: 'user',
              content: prompt
            }
          ],

          thinking: {
            type: 'disabled'
          },

          temperature: 0.2,

          max_tokens: 800
        }),

        signal: controller.signal
      }
    );

    const detail = await response.text();

    if (!response.ok) {
      throw new Error(
        `DeepSeek HTTP ${response.status}: ${detail.slice(0, 300)}`
      );
    }

    let data;

    try {
      data = JSON.parse(detail);
    } catch {
      throw new Error('Resposta inválida do DeepSeek.');
    }

    const answer =
      data?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      throw new Error('DeepSeek retornou uma resposta vazia.');
    }

    return answer;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        'Tempo limite ao consultar o DeepSeek.'
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function externalLLMStatus() {
  return {
    enabled,
    provider: 'deepseek',
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
    model,
    baseUrl,
    localAI: false
  };
}

export async function generateExternalResponse(args) {
  if (!enabled) {
    throw new Error('IA DeepSeek desativada.');
  }

  return callDeepSeek(
    buildPrompt(args)
  );
}