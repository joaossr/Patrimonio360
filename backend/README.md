# Patrimônio 360 — Backend

O backend mantém apenas duas responsabilidades:

1. **Motor Financeiro determinístico**: calcula receitas, despesas, orçamento, risco, perfil e indicadores.
2. **DeepSeek**: única camada generativa/conversacional, usando os cálculos oficiais do Motor Financeiro como contexto.

## IA

A IA usa exclusivamente o DeepSeek pela API oficial. Não há modelo local, fallback local, Gemini ou outro provedor.

Configure no `.env`:

```env
P360_LLM_ENABLED=true
DEEPSEEK_API_KEY=sua_chave
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

A chave fica somente no backend.

## Executar

```bash
npm install
npm run doctor
npm run dev
```

O servidor local usa a porta `8787` por padrão. Teste `http://localhost:8787/health`.

## Fluxo

`Frontend → Firebase Auth → Backend → Motor Financeiro → DeepSeek → resposta`

Se o DeepSeek estiver indisponível, a API retorna erro. **Não existe fallback para IA antiga ou local.**

## Telegram

O backend mantém apenas a geração segura de códigos de vinculação. O antigo bot com IA local não faz parte desta arquitetura.
