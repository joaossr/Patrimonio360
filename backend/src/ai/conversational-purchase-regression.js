import assert from 'node:assert/strict';
import { detectIntent } from './intent-engine.js';
import { parseFinancialValue } from './value-parser.js';

const user = (...content) => ({ recent: content.map(x => ({ role: 'user', content: x })) });

const cases = [
  ['Quero comprar um celular.', 'purchase'],
  ['Quero comprar um notebook para estudar.', 'purchase'],
  ['Estou pensando em comprar uma TV.', 'purchase'],
  ['Posso comprar um celular?', 'purchase'],
  ['Vale a pena comprar um celular?', 'purchase'],
  ['Quero fazer uma compra nova.', 'purchase'],
  ['Quero parcelar uma compra.', 'purchase'],
  ['Quero comprar um produto.', 'purchase'],
  ['Quero comprar um celular de R$ 1.300.', 'purchase'],
  ['Um notebook de 2500 em 10x.', 'purchase'],
  ['5x de 240', 'purchase'],
  ['1200 em 5 parcelas', 'purchase'],
  ['1200 em cinco vezes', 'purchase'],
  ['R$ 1.200,50 em 5x', 'purchase']
];

let passed = 0;
const failures = [];

for (const [question, expected] of cases) {
  const actual = detectIntent(question);
  if (actual === expected) passed++;
  else failures.push({ question, expected, actual });
}

const values = [
  ['1200', 1200],
  ['1.200', 1200],
  ['1.200,50', 1200.50],
  ['1,2 mil', 1200],
  ['1200 em 5x', 1200],
  ['5x de 240', 240]
];

for (const [input, expectedMinimum] of values) {
  const parsed = parseFinancialValue(input);
  if (parsed.total === expectedMinimum || parsed.installmentValue === expectedMinimum || parsed.monthly === expectedMinimum) passed++;
  else failures.push({ input, expectedMinimum, parsed });
}

// New conversation behavior: a fresh question must not inherit purchase intent.
const afterPurchase = user(
  'Quero comprar um celular.',
  'Ele custa R$ 1.200 em 5x.'
);

const unrelated = [
  ['qto gastei esse mês', 'expenses'],
  ['onde estou gastando mais?', 'expenses'],
  ['analise meus cartões', 'cards'],
  ['o que tenho para pagar e receber?', 'cashflow'],
  ['como posso melhorar meu orçamento?', 'budget'],
  ['faça um diagnóstico completo da minha vida financeira', 'diagnosis']
];

for (const [question, expected] of unrelated) {
  const actual = detectIntent(question, afterPurchase);
  if (actual === expected) passed++;
  else failures.push({ question, expected, actual, group: 'stale-purchase-context' });
}

const followUps = [
  ['Posso comprar?', 'purchase'],
  ['Em 5x.', 'purchase'],
  ['Ele custa R$ 1.200.', 'purchase'],
  ['Qual seria o impacto?', 'purchase']
];

const purchaseContext = user('Quero comprar um celular.', 'Ele custa R$ 1.200.');
for (const [question, expected] of followUps) {
  const actual = detectIntent(question, purchaseContext);
  if (actual === expected) passed++;
  else failures.push({ question, expected, actual, group: 'purchase-follow-up' });
}

console.log(JSON.stringify({
  suite: 'P360 conversational purchase regression',
  passed,
  failed: failures.length,
  total: passed + failures.length,
  passRate: (passed / (passed + failures.length || 1)),
  failures
}, null, 2));

assert.equal(failures.length, 0, `Conversational purchase regression failed: ${failures.length} failure(s)`);
