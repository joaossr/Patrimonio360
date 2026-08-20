import assert from 'node:assert/strict';
import { detectIntent } from './intent-engine.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (actual, expected, message) => assert.deepEqual(actual, expected, message);
const ok = (condition, message) => assert.ok(condition, message);

// P360 real-world benchmark v1.
// This suite intentionally evaluates realistic user phrasing without changing
// production AI behavior. It focuses on routing, context, informal language,
// typos, and short follow-ups.

const cases = [
  ['receita-informal', 'recebi meu salario hoje', 'historical_income'],
  ['receita-natural', 'caiu 1950 na minha conta', 'accounts'],
  ['despesa-natural', 'gastei 180 no mercado', 'expenses'],
  ['compra-direta', 'posso comprar um celular de 1200?', 'purchase'],
  ['compra-parcelada', 'quero comprar uma tv de 2000 em 10x', 'purchase'],
  ['meta', 'quero chegar em 5000 até dezembro', 'goal'],
  ['reserva', 'quero montar uma reserva de emergencia', 'reserve'],
  ['investimento', 'vale a pena investir esse dinheiro?', 'save_vs_invest'],
  ['cartao', 'quanto tenho de limite no cartão?', 'cards'],
  ['orcamento', 'quanto ainda posso gastar este mês?', 'budget'],
  ['fluxo', 'o que tenho para pagar nas próximas semanas?', 'cashflow'],
  ['historico', 'quanto eu ganhei em dezembro de 2025?', 'historical_income'],
  ['memoria', 'você lembra da minha meta?', 'memory'],
  ['typo-meta', 'quero chegra em 5000 ate dezembro', 'goal'],
  ['uppercase-compra', 'POSSO COMPRAR UM CELULAR DE 1200?', 'purchase'],
  ['whitespace-reserva', '  quero montar uma reserva  ', 'reserve']
];

for (const [name, text, expected] of cases) {
  test(name, () => eq(detectIntent(text), expected));
}

// Multi-turn realistic conversations.
const conversations = [
  {
    name: 'goal-follow-up',
    turns: ['minha meta é chegar em R$ 5.000', 'quanto falta para ela?'],
    expected: 'goal'
  },
  {
    name: 'goal-short-follow-up',
    turns: ['quero chegar em R$ 5.000 até dezembro', 'e por mês?'],
    expected: 'goal'
  },
  {
    name: 'reserve-follow-up',
    turns: ['quero montar uma reserva', 'quanto devo deixar?'],
    expected: 'reserve'
  },
  {
    name: 'purchase-follow-up',
    turns: ['quero comprar uma TV de R$ 2.000', 'e se eu fizer em 5 parcelas?'],
    expected: 'purchase'
  }
];

for (const scenario of conversations) {
  test(scenario.name, () => {
    let previous = '';
    for (const turn of scenario.turns) {
      const memory = previous ? { recent: [{ role: 'user', content: previous }] } : {};
      previous = turn;
      const actual = detectIntent(turn, memory);
      if (turn === scenario.turns.at(-1)) eq(actual, scenario.expected);
    }
    ok(previous.length > 0);
  });
}

let passed = 0;
let failed = 0;
const failures = [];

for (const item of tests) {
  try {
    item.fn();
    passed++;
  } catch (error) {
    failed++;
    failures.push({ name: item.name, message: error.message });
  }
}

const result = {
  suite: 'P360 real-world AI evaluation',
  scenarios: tests.length,
  passed,
  failed,
  passRate: tests.length ? passed / tests.length : 0,
  failures
};

console.log(JSON.stringify(result, null, 2));
if (failed) process.exitCode = 1;
