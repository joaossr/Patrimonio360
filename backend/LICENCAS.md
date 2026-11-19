# Acesso vitalício por compra (Kiwify)

O Patrimônio 360 é vendido como **pagamento único (acesso vitalício)** na Kiwify. Não existe mais chave de acesso: quem compra cria a conta com **o mesmo e-mail da compra** e o acesso é liberado sozinho.

## Como funciona
1. A pessoa compra na Kiwify. A Kiwify chama `POST /api/kiwify/webhook` no backend (Render) a cada venda aprovada.
2. O backend confere a **assinatura** do aviso (HMAC-SHA1 do corpo com `KIWIFY_WEBHOOK_TOKEN`, enviada em `?signature=`). Avisos sem assinatura válida levam 401 e são ignorados.
3. O e-mail do comprador é gravado em `purchases` (ID = hash do e-mail; coleção fechada para o navegador).
4. A pessoa cria a conta (e-mail e senha, ou Google) com o mesmo e-mail e **confirma o e-mail** (com Google já vem confirmado). O backend grava no usuário os claims `licensed: true`, `until` (2099) e `purchase: true`.
5. As regras do Firestore (`firestore.rules`) só deixam ler/gravar os dados do app quando o token tem esses claims. O bot do Telegram também recusa quem está sem acesso.
6. **Reembolso ou chargeback:** o webhook marca a compra como reembolsada, retira os claims e invalida as sessões. Administrador e contas antigas (`legacy`) não são afetados. Um aviso antigo de "pago" reenviado depois do reembolso do mesmo pedido é ignorado.
7. Quem compra e ainda não tem conta: o e-mail fica "esperando cadastro". O acesso sai no primeiro login.
8. **Contas criadas antes de `LICENSE_CUTOFF` (padrão 06/11/2026) entram sem pagar e sem vencimento.**

## Configuração no Render (uma vez)
| Variável | Valor |
| --- | --- |
| `KIWIFY_WEBHOOK_TOKEN` | o token secreto do webhook (o mesmo cadastrado na Kiwify em Apps → Webhooks). Sem ele o webhook responde 503. |
| `KIWIFY_PRODUCT_ID` | (opcional) ID do produto na Kiwify; só use se tiver certeza do valor, pois avisos de outro ID são ignorados. O próprio webhook já é limitado ao produto. |
| `ADMIN_EMAILS` | seu e-mail de administrador (vários separados por vírgula). **O e-mail precisa estar confirmado.** Prefira entrar com Google. |
| `ADMIN_PIN` | (opcional, recomendado) PIN longo exigido pelo painel além do login; 5 erros bloqueiam por 15 min. |
| `ADMIN_SESSION_HOURS` | (opcional) horas de validade do login do administrador no painel (padrão 12). |
| `LICENSE_CUTOFF` | (opcional) data ISO; contas criadas antes dela entram sem pagar. Padrão `2026-11-06T00:00:00Z`. |

## Painel `/admin.html`
- Lista de assinantes e de compras registradas.
- **Liberar acesso por e-mail** (cortesia, comprou com outro e-mail, suporte) e **cancelar acesso**. Tudo fica no registro `adminLog`.

## Ordem segura para publicar
1. Publicar o site (Firebase Hosting) e o backend (Render).
2. Definir `KIWIFY_WEBHOOK_TOKEN`, `ADMIN_EMAILS` (e `ADMIN_PIN`) no Render.
3. Entrar uma vez com **cada conta antiga**: é nesse login que ela ganha o acesso sem prazo.
4. Só então publicar as regras: `firebase deploy --only firestore:rules`.
5. Para voltar atrás: restaurar o `firestore.rules` anterior e publicar de novo.

## Segurança
- Webhook: assinatura em tempo constante, limite de 120 chamadas/min por IP, corpo de no máximo 256 KB.
- O acesso só é concedido com e-mail **confirmado**: ninguém consegue usar a compra de outra pessoa cadastrando o e-mail dela sem ter acesso à caixa de entrada.
- O painel administrativo exige `ADMIN_EMAILS` + e-mail confirmado + login recente (+ PIN, se definido).
