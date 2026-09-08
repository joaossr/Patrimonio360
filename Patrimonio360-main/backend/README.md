# Patrimônio 360 V10 — P360 Intelligence

Esta versão não usa OpenAI. O backend combina um Financial Engine determinístico com a rede neural própria motor preditivo P360, usada para estimar despesas dos próximos 30 dias.

## 1. Instalar
```bash
npm install
```

## 2. Configurar Firebase Admin
Copie `.env.example` para `.env` e informe `FIREBASE_PROJECT_ID`.

O Firebase Admin também precisa de credenciais no computador/servidor. A forma recomendada para desenvolvimento é definir `GOOGLE_APPLICATION_CREDENTIALS` apontando para o JSON de uma conta de serviço do seu projeto Firebase. Não coloque esse JSON dentro do frontend e não faça commit dele.

Windows PowerShell (exemplo):
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\\caminho\\service-account.json"
```

## 3. Treinar/recriar a P360
O projeto já inclui um modelo em `models/expense-net.json`. Para recriá-lo:
```bash
npm run train:neural
```
O treino atual usa dados sintéticos e é um protótipo. O desempenho precisa ser comparado com baselines e validado antes de qualquer uso real.

## 4. Executar o backend
```bash
npm run dev
```
Deve aparecer:
```text
P360 Own AI em http://localhost:8787
```

Teste no navegador:
```text
http://localhost:8787/health
```
A resposta deve indicar `ok: true` e se a P360 foi carregada.

## 5. Abrir o frontend
Mantenha o backend acima rodando e abra o projeto pelo Live Server. Faça login normalmente pelo Firebase Authentication.

Na tela IA Financeira aparecerá:
- **P360 Intelligence online**: backend, Financial Engine, P360 e memória do servidor disponíveis.
- **P360 Intelligence offline**: somente o motor local do navegador está disponível.

## Arquitetura
- Firebase Authentication: identifica o usuário
- Firestore: estado financeiro individual por UID
- Financial Engine: cálculos determinísticos
- P360: previsão neural de despesas
- Memória: histórico recente por UID
- Motor local: fallback quando o backend está indisponível

## Próximas redes
1. CashFlowNet — fluxo de caixa 30/60/90 dias
2. RiskNet — risco de déficit
3. AnomalyDetector — gastos fora do padrão

A rede neural nunca deve movimentar dinheiro ou alterar registros automaticamente.


## Telegram

1. Crie o bot no @BotFather.
2. Copie `.env.example` para `.env`.
3. Coloque um token novo em `TELEGRAM_BOT_TOKEN`.
4. Configure `GOOGLE_APPLICATION_CREDENTIALS` apontando para a credencial de serviço do Firebase Admin.
5. Rode `npm install` e `npm run dev`.
6. No Patrimônio 360, abra Configurações → Telegram → Conectar Telegram.
7. Envie no bot `/vincular P360-XXXXXX`.

A integração usa long polling no desenvolvimento local, então não exige domínio público/HTTPS para o primeiro teste. Antes de produção, prefira webhook HTTPS.

Comandos e mensagens suportadas inicialmente: `gastei 45 no mercado`, `recebi 1950 de salário`, `aportei 300 na reserva`, `investi 500 em investimento`, `sacar 200 da reserva`, `/saldo` e `/reserva`. Todo lançamento é apresentado para confirmação antes de ser gravado.
