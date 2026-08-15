# P360 FinancialNet

Modelo próprio de machine learning para o Patrimônio 360.

## O que o modelo faz

O `FinancialNet` é uma MLP pequena que transforma 11 características financeiras em quatro sinais:

- `purchaseAffordability`
- `reservePriority`
- `goalImpact`
- `investmentReadiness`

Ele é um sinal complementar. Regras determinísticas, dados do Firestore e o Financial Engine continuam sendo a fonte de verdade.

## Treinamento

```bash
npm run train:financial
```

O treinamento atual usa dados sintéticos rotulados por regras transparentes. Isso existe para validar o pipeline de treinamento, salvamento e inferência sem depender de serviços pagos ou de uma GPU.

O modelo gerado fica em:

```text
backend/models/financial-net.json
```

Esse arquivo não deve ser versionado até existir uma validação adequada do dataset.

## Próxima etapa: dados públicos brasileiros

Adicionar um dataset versionado em `backend/data/benchmarks/` com dados públicos agregados e documentação da fonte. O dataset deve registrar fonte, período, indicador, unidade e metodologia.

Fontes prioritárias:

- Banco Central do Brasil
- IBGE
- CVM
- Tesouro Nacional
- B3

Dados pessoais dos usuários não devem ser usados para treinamento global. O comportamento individual deve permanecer na memória/perfil do próprio usuário.

## Segurança de decisão

O modelo nunca deve sozinho autorizar uma compra, recomendar um investimento ou alterar uma transação. Seus scores são evidências auxiliares para o pipeline de contexto, regras, simulação e validação.
