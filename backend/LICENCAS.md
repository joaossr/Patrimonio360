# Assinatura por chave de acesso

Cada pessoa só cria conta com uma **chave de acesso única** (`P360-XXXX-XXXX-XXXX-XXXX`). A chave só pode ser usada **uma vez** e libera o sistema por um prazo (30 dias, 90 dias, 6 meses, 1 ano ou sem vencimento). Para renovar, a pessoa digita uma nova chave em **Configurações → Assinatura**; o prazo novo é somado ao que ela ainda tem.

## Como funciona (resumo técnico)
- As chaves ficam no Firestore (`accessKeys`) **só como hash SHA-256**. Quem ler o banco não consegue usar nenhuma chave.
- Ao usar uma chave, o backend (`src/license.js`) a marca como usada dentro de uma transação e grava no usuário os claims `licensed: true` e `until` (data de vencimento, em milissegundos).
- As regras do Firestore (`firestore.rules`) só deixam ler/gravar os dados do app quando o token tem esses claims e `until` ainda não passou. Mesmo quem tentar burlar a tela não consegue ler nem gravar.
- O bot do Telegram e o código de vínculo também recusam quem está sem assinatura.
- **Contas criadas antes de `LICENSE_CUTOFF` (padrão 06/11/2026) entram sem chave e sem vencimento.** O app pede isso ao servidor no primeiro login depois da atualização.

## Configuração no Render (uma vez)
| Variável | Valor |
| --- | --- |
| `ADMIN_EMAILS` | seu e-mail de administrador (vários separados por vírgula). **O e-mail precisa estar confirmado** na conta. |
| `LICENSE_CUTOFF` | (opcional) data/hora ISO; contas criadas antes dela entram sem chave. Padrão `2026-11-06T00:00:00Z`. |

## Gerar chaves
1. Entre no app com a conta administradora e abra **`/admin.html`** (também há o botão em Configurações → Assinatura).
2. Escolha quantidade, validade e para quem é. Copie a chave (ou a mensagem pronta para o WhatsApp). **O texto da chave só aparece nesse momento.**
3. Na mesma tela você vê quais chaves foram usadas, por quem, e pode cancelar as ainda disponíveis.

Alternativa pelo computador (precisa do `service-account.json`):
```bash
cd backend
node scripts/gerar-chaves.js 5 365 "Turma de novembro"   # 5 chaves, 365 dias, rótulo
```

## Ordem segura para ligar a trava de verdade
1. Publicar o site (Firebase Hosting) e o backend (Render) — a tela de chave no cadastro e a ativação passam a funcionar.
2. Definir `ADMIN_EMAILS` no Render e confirmar o e-mail da conta administradora.
3. Entrar uma vez com **cada conta antiga** (ou pelo menos com a sua): é nesse login que ela ganha o acesso sem prazo.
4. Só então publicar as regras: `firebase deploy --only firestore:rules`.
   Antes do passo 4 a tela já exige a chave, mas o banco ainda aceita acessos diretos; depois do passo 4 a trava vale no servidor.
5. Para voltar atrás: restaurar o `firestore.rules` anterior e publicar de novo.

## Segurança
- Rate limit: 12 tentativas de ativação e 20 conferências por 10 minutos (por usuário/IP). A chave tem ~80 bits de entropia, então adivinhar não é viável.
- Se gravar o acesso falhar, a chave volta para o estoque (não "queima").
- O painel administrativo exige `ADMIN_EMAILS` + e-mail confirmado, validados no servidor com o token do Firebase.
