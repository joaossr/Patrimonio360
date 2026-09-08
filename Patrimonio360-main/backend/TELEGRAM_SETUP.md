# Patrimônio 360 + Telegram

## 1. Segurança
O token do BotFather é uma credencial. Como o token anterior foi exposto, gere **um novo token** no @BotFather e coloque somente no `.env` do backend.

## 2. Firebase Admin
Crie/baixe uma credencial de serviço do projeto Firebase `patrimonio360-e4190` e salve como:

`backend/service-account.json`

O arquivo não deve ser enviado ao frontend nem ao Git.

## 3. Configuração
Crie `backend/.env` a partir de `.env.example`:

```env
PORT=8787
FIREBASE_PROJECT_ID=patrimonio360-e4190
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
TELEGRAM_BOT_TOKEN=SEU_NOVO_TOKEN
TELEGRAM_BOT_USERNAME=Patrimonio360Bot
TELEGRAM_POLL_MS=1500
```

## 4. Iniciar
No terminal:

```powershell
cd backend
npm install
npm run dev
```

Abra o sistema por:

`http://localhost:8787/`

Não abra o `index.html` diretamente pelo Explorador de Arquivos se quiser usar o Telegram/backend local.

## 5. Testar
Abra:

`http://localhost:8787/health`

Deve aparecer JSON com `"ok": true`.

Depois, no Patrimônio 360:

`Configurações → Telegram → Conectar Telegram`

Gere o código e envie ao bot:

`/vincular P360-XXXXXX`

## 6. Se aparecer "Failed to fetch"
Isso significa que o navegador não conseguiu alcançar o backend. Verifique primeiro `http://localhost:8787/health` e confirme que `npm run dev` está rodando.

Se o frontend estiver hospedado em outro endereço (Firebase Hosting, Vercel etc.), configure o backend público em `localStorage`:

```js
localStorage.setItem('p360-ai-backend','https://SEU-BACKEND.exemplo.com')
```

Depois recarregue a página.


## 7. Menu `/start`
O backend já configura automaticamente os comandos do BotFather/Telegram ao iniciar:
- `/start` — abre o menu principal
- `/menu` — abre o menu principal
- `/ajuda` — mostra exemplos
- `/saldo` — consulta as contas
- `/reserva` — consulta a reserva

O `/start` também verifica se o Telegram está vinculado a uma conta do Patrimônio 360. Usuários não vinculados recebem somente a orientação de conexão; depois de vinculados, recebem os botões do menu.
