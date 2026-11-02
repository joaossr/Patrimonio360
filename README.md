# Patrimônio 360

Sistema de gestão financeira pessoal: dashboard, receitas, despesas, contas, cartões (com parcelamento), orçamento mensal, calendário, assinaturas, metas, reserva de emergência, investimentos, relatórios, simuladores, IA financeira e integração com Telegram. Funciona no computador e no celular (pode ser instalado como app pelo navegador).

## Arquitetura

- **Frontend** (raiz do repositório): HTML, CSS e JavaScript puros, sem etapa de build. `app.js` concentra as páginas; os dados de cada usuário ficam no Firestore em `users/{uid}/app/state`.
- **Autenticação**: Firebase Authentication (e-mail e senha).
- **IA própria** (`assets/js/ai/`): o P360 Mind roda no navegador, sem nenhuma API externa, e aprende com os dados e o feedback de cada usuário. Detalhes em [assets/js/ai/README.md](assets/js/ai/README.md).
- **Backend** (`backend/`): Node.js + Express. Atende o código de vínculo e o bot do Telegram (que usa a mesma IA) e também pode servir o frontend.
- **Hospedagem**: Firebase Hosting (frontend) e Render (backend).

## Como rodar localmente

### Frontend

Sirva a raiz do projeto com qualquer servidor estático (ex.: extensão Live Server do VS Code, ou `npx serve .`) e abra `login.html`.

### Backend

```bash
cd backend
npm install
cp .env.example .env   # preencha as chaves
npm run dev
```

Abre em `http://localhost:8787` (também serve o frontend). Variáveis importantes do `.env`:

| Variável | Para que serve |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` ou `FIREBASE_SERVICE_ACCOUNT_JSON` | Credencial do Firebase Admin (nunca commitar) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_POLLING=true` | Bot do Telegram (opcional) |
| `NODE_ENV=production` | No Render: bloqueia chamadas de origens `localhost` |
| `ALLOWED_ORIGINS` | Domínios extras autorizados a chamar a API |

## Publicação

```bash
firebase deploy --only hosting
firebase deploy --only firestore:rules
```

> **Importante:** as regras do Firestore (`firestore.rules`) precisam ser publicadas com o segundo comando. Sem elas, o banco depende das regras que estiverem configuradas no console do Firebase.

## Segurança

- Cada usuário só lê e grava os próprios dados (`firestore.rules`); coleções do Telegram ficam acessíveis apenas ao backend.
- O backend não serve código, credenciais, `.env`, `.git` nem documentação interna; CORS restrito às origens do app; limite de requisições no código do Telegram; cabeçalhos de segurança (CSP no Hosting, `X-Frame-Options`, `nosniff`, HSTS).
- O navegador não guarda mais os dados financeiros numa chave compartilhada: o cache local é separado por usuário e apagado ao sair.
- Se o Firestore não responder ao abrir o app, o sistema entra em **modo somente leitura** e não grava nada — evita sobrescrever os dados reais com um estado vazio.
- Exportação CSV protegida contra injeção de fórmulas; importação de backup validada.
- Cadastro exige senha com 8+ caracteres, letras e números, e envia e-mail de verificação.
- A chave `apiKey` do Firebase no frontend é pública por natureza; restrinja-a por domínio (HTTP referrer) no Google Cloud Console.

## Visual e usabilidade (v45)

- Ícones SVG próprios no menu e no topo; logo recortada e leve (52 KB em vez de 2 MB).
- Textos maiores em todo o sistema e ajuste de **Tamanho do texto** em Configurações.
- Seletor de mês fora da barra superior, logo abaixo do título das páginas mensais.
- Dashboard sem o bloco da IA (o atalho ✦ fica disponível em todas as páginas) e sem botão de exportar.
- Cartões de crédito na proporção real de um cartão, no dashboard (carrossel) e na página de cartões.
- Orçamento mensal refeito: limite editado na própria linha, média dos últimos 3 meses, copiar do mês anterior e sugestão de limites pela IA.
- Configurações completas: perfil e nome, tema, tamanho do texto, privacidade, conta e cartão padrão, página inicial, taxa CDI, distribuição da renda com presets, categorias, avisos, exportação CSV por período, Telegram e segurança.
- Central de compromissos em painel lateral: atrasados, próximos dias, resto do mês e faturas, com "Paguei/Recebi" direto.
- Gráficos novos (`assets/js/charts.js`): eixos legíveis, rótulos sem sobreposição e dica ao tocar.

## IA própria (v44)

- Substitui o DeepSeek: nenhuma conversa ou dado financeiro sai da conta do usuário para serviços de terceiros.
- Entende português informal, mantém o contexto da conversa e responde com os números reais.
- Aprende com cada usuário: padrões de gasto, renda, gastos recorrentes, previsão do mês, alertas fora do padrão, sugestão automática de categoria, frases ensinadas (👍/👎) e preferências.
- Aparece na página IA Financeira, no cartão de insights do Dashboard, no atalho flutuante, no formulário de movimentação e na importação de CSV.
- Testes: `cd backend && npm run test:ai`.

## Novidades da v43

- **Celular**: barra de navegação inferior com botão "+", menus e formulários em formato de folha, tabelas viram cartões, seletor de mês fixo no topo, botão "voltar" do celular funciona entre as páginas, toque abre os detalhes do calendário e das categorias.
- **Contas bancárias**: criar, editar, renomear (atualiza os vínculos) e excluir — antes o botão "+ Nova conta" quebrava.
- **Cartões**: edição completa; compras parceladas viram uma parcela em cada fatura.
- **Movimentações**: repetição mensal, categorias padrão e criação de categoria no próprio formulário, filtros por período/status e resumo dos totais.
- **Metas**: editar, registrar aporte e cálculo de quanto guardar por mês.
- **Controle de dados**: backup e restauração em JSON, importação de planilha CSV, detecção de duplicados e exclusão total.
- **Relatórios**: 12 meses, taxa de poupança, categorias com percentual, impressão/PDF.
- **Simuladores**: juros compostos, aporte necessário para uma meta e financiamento (tabela Price).
- **Configurações**: redefinir senha e sair; a distribuição financeira agora é aplicada de fato no orçamento.
- Correções: custo das assinaturas na IA, gráficos sem dados, IDs duplicados, página de patrimônio com valores fictícios removida.
