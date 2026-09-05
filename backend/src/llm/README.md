# IA do Patrimônio 360

A camada conversacional do Patrimônio 360 usa exclusivamente a API oficial do DeepSeek.

O backend mantém separado o **motor financeiro determinístico**, responsável pelos cálculos de receitas, despesas, orçamento, risco, perfil e indicadores. O DeepSeek recebe esses dados calculados e transforma o contexto em uma resposta conversacional.

## Configuração

Defina no `.env`:

```env
P360_LLM_ENABLED=true
DEEPSEEK_API_KEY=sua_chave
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

A chave nunca deve ser colocada no frontend.

## Arquitetura

`Frontend → Backend autenticado → Motor Financeiro → DeepSeek → Frontend`

Não existe fallback para IA local, modelo neural local, Gemini ou outro provedor.
