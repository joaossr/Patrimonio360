import assert from 'node:assert/strict';
import { detectIntent } from './intent-engine.js';

const scenarios = [
  {
    name: 'goal-follow-up',
    turns: ['quero juntar R$ 5.000 até dezembro', 'quanto preciso guardar por mês?'],
    want: 'goal'
  },
  {
    name: 'purchase-installment-follow-up',
    turns: ['quero comprar um celular de R$ 1.200', 'e se eu fizer em 5 parcelas?'],
    want: 'purchase'
  },
  {
    name: 'income-follow-up',
    turns: ['recebo R$ 1.950 por mês', 'quanto posso gastar?'],
    want: 'budget'
  },
  {
    name: 'reserve-follow-up',
    turns: ['tenho R$ 1.100 guardados', 'como está minha reserva?'],
    want: 'reserve'
  },
  {
    name: 'expense-follow-up',
    turns: ['gastei R$ 800 este mês', 'onde estou gastando mais?'],
    want: 'expenses'
  },
  {
    name: 'save-invest-follow-up',
    turns: ['tenho R$ 2.000 disponíveis', 'guardo ou invisto?'],
    want: 'save_vs_invest'
  },
  {
    name: 'card-follow-up',
    turns: ['usei bastante o cartão este mês', 'quanto está minha fatura?'],
    want: 'cards'
  },
  {
    name: 'cashflow-follow-up',
    turns: ['tenho algumas contas para pagar', 'o que vence este mês?'],
    want: 'cashflow'
  },
  {
    name: 'account-follow-up',
    turns: ['tenho dinheiro no banco', 'qual meu saldo atual?'],
    want: 'accounts'
  },
  {
    name: 'diagnosis-follow-up',
    turns: ['quero organizar melhor minhas finanças', 'faça um diagnóstico completo'],
    want: 'diagnosis'
  },
  {
    name: 'goal-pronoun-follow-up',
    turns: ['minha meta é chegar em R$ 5.000', 'quanto falta para ela?'],
    want: 'goal'
  },
  {
    name: 'purchase-pronoun-follow-up',
    turns: ['estou pensando em comprar uma TV de R$ 2.000', 'essa compra cabe no meu orçamento?'],
    want: 'purchase'
  },
  {
    name: 'installment-reference',
    turns: ['quero comprar um notebook', 'posso parcelar em 10 vezes?'],
    want: 'purchase'
  },
  {
    name: 'reserve-priority-follow-up',
    turns: ['ainda não tenho reserva de emergência', 'devo priorizar a reserva?'],
    want: 'reserve'
  },
  {
    name: 'budget-purchase-follow-up',
    turns: ['quanto ainda posso gastar este mês?', 'tenho margem para uma compra?'],
    want: 'budget'
  },
  {
    name: 'short-installment',
    turns: ['quero comprar um celular', 'em 12x?'],
    want: 'purchase'
  },
  {
    name: 'short-goal',
    turns: ['quero chegar em R$ 5.000 até dezembro', 'e por mês?'],
    want: 'goal'
  },
  {
    name: 'short-reserve',
    turns: ['quero montar uma reserva', 'quanto devo deixar?'],
    want: 'reserve'
  },
  {
    name: 'short-budget',
    turns: ['estou controlando meus gastos', 'quanto posso comprometer?'],
    want: 'budget'
  },
  {
    name: 'short-investment',
    turns: ['tenho dinheiro sobrando', 'e investir?'],
    want: 'save_vs_invest'
  }
];

function buildMemory(turns) {
  return {
    recent: turns.slice(0, -1).map((content, index) => ({
      role: 'user',
      content,
      turn: index + 1
    }))
  };
}

let passed = 0;
const failures = [];

for (const scenario of scenarios) {
  const currentText = scenario.turns.at(-1);
  const memory = buildMemory(scenario.turns);

  try {
    const got = detectIntent(currentText, memory);
    assert.equal(got, scenario.want);
    passed++;
  } catch (error) {
    failures.push({
      name: scenario.name,
      turns: scenario.turns,
      want: scenario.want,
      got: error.actual ?? error.message
    });
  }
}

console.log(JSON.stringify({
  suite: 'P360 conversational reasoning regression',
  scenarios: scenarios.length,
  passed,
  failed: failures.length,
  passRate: Number((passed / scenarios.length).toFixed(4)),
  failuresByGroup: failures.reduce((acc, failure) => {
    const group = failure.name.split('-')[0];
    acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {}),
  failures
}, null, 2));

if (failures.length) process.exitCode = 1;
