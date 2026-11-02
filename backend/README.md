# Patrimônio 360 — Backend

Servidor Node.js + Express. Ele **não** responde as perguntas da IA: a IA própria (P360 Mind, em `../assets/js/ai/`) roda no navegador do usuário, sem API externa.

O backend cuida de:

- gerar o código de vínculo do Telegram (`POST /api/telegram/link-code`, exige login);
- rodar o bot do Telegram, que usa a mesma IA do site (opcional);
- servir o frontend (sem expor código, credenciais nem arquivos internos).

## Rodar

```bash
npm install
cp .env.example .env   # preencha a credencial do Firebase Admin
npm run dev
```

Abre em `http://localhost:8787`. `GET /api/status` mostra se o Firebase Admin está pronto.

A credencial do Firebase Admin vai em `FIREBASE_SERVICE_ACCOUNT_JSON` (recomendado no Render) ou em um arquivo apontado por `GOOGLE_APPLICATION_CREDENTIALS`. Nunca faça commit dela.

## Bot do Telegram

1. Crie o bot no @BotFather e coloque o token em `TELEGRAM_BOT_TOKEN`.
2. Defina `TELEGRAM_POLLING=true` para o servidor iniciar o bot.
3. No app, vá em Configurações → Telegram → Conectar Telegram e envie `/vincular P360-XXXXXXXXXX` ao bot.

Detalhes em [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md).

## Testes da IA

```bash
npm run test:ai
```

## Diagnóstico

```bash
npm run doctor
```
