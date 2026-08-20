import assert from 'node:assert/strict';
import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';

const intentCases = [
  ['posso comprar um celular de 1200?', 'purchase'],
  ['vale a pena comprar uma tv de 2 mil?', 'purchase'],
  ['quero parcelar em 10x', 'purchase'],
  ['comprei por 1200 em 5x', 'purchase'],
  ['e se eu fizer em 5 parcelas?', 'purchase'],
  ['deixo na conta ou aplico?', 'save_vs_invest'],
  ['guardo ou invisto?', 'save_vs_invest'],
  ['é melhor deixar parado ou investir?', 'save_vs_invest'],
  ['poupar ou aplicar?', 'save_vs_invest'],
  ['coloco na reserva ou invisto?', 'save_vs_invest'],
  ['quanto tenho na reserva?', 'reserve'],
  ['devo priorizar a reserva?', 'reserve'],
  ['quanto posso gastar?', 'budget'],
  ['qual minha margem para gastar?', 'budget'],
  ['meu orçamento aguenta?', 'budget'],
  ['onde estou gastando mais?', 'expenses'],
  ['quero cortar gastos', 'expenses'],
  ['quanto gastei este mês?', 'expenses'],
  ['o que tenho para pagar?', 'cashflow'],
  ['o que tenho para receber?', 'cashflow'],
  ['quais contas vencem em breve?', 'cashflow'],
  ['qual meu saldo?', 'accounts'],
  ['quanto dinheiro tenho?', 'accounts'],
  ['quanto tenho no banco?', 'accounts'],
  ['qual o limite do cartão?', 'cards'],
  ['quanto está minha fatura?', 'cards'],
  ['quando vence minha fatura?', 'cards'],
  ['faça um diagnóstico da minha vida financeira', 'diagnosis'],
  ['analise minha saúde financeira', 'diagnosis'],
  ['quero uma análise completa', 'diagnosis'],
  ['quero chegar a 5 mil até dezembro', 'goal'],
  ['quanto preciso guardar por mês para chegar nessa meta?', 'goal'],
  ['qual aporte preciso fazer?', 'goal'],
  ['simule uma compra de 2000', 'simulation'],
  ['se eu receber 3000, quanto sobra?', 'simulation'],
  ['minha renda em janeiro foi 1950', 'historical_income'],
  ['quanto eu ganhei em dezembro de 2025?', 'historical_income'],
  ['você lembra da minha meta?', 'memory'],
  ['o que você lembra?', 'memory'],
  ['olá', 'general']
];

const moneyCases = [
  ['recebi 1950', 1950],
  ['recebi R$ 1.950', 1950],
  ['renda de 1.950,50', 1950.5],
  ['tenho 2 mil', 2000],
  ['tenho dois mil', 2000],
  ['meta de 5 mil', 5000],
  ['quero juntar R$ 5.000', 5000],
  ['comprei por 1200 em 5x', 1200],
  ['gastei 1.200,50', 1200.5],
  ['aportei 730', 730],
  ['recebi cinco mil', 5000],
  ['gastei dois mil', 2000],
  ['me pagaram 1950', 1950],
  ['minha renda é R$ 2.200', 2200],
  ['sobrou 450 reais', 450]
];

const goalCases = [
  ['quero chegar a 5 mil até dezembro', 5000],
  ['quero juntar R$ 5.000 até dezembro', 5000],
  ['preciso ter cinco mil em dezembro', 5000],
  ['meu objetivo é 5 mil', 5000],
  ['quero formar uma reserva de 5 mil', 5000],
  ['pretendo atingir R$ 5.000', 5000],
  ['vou economizar para chegar em 5 mil', 5000]
];

const tests = [];
for (const [text, want] of intentCases) tests.push({ kind: 'intent', text, want, group: 'intent' });
for (const [text, want] of moneyCases) tests.push({ kind: 'money', text, want, group: 'money' });
for (const [text, want] of goalCases) tests.push({ kind: 'goal', text, want, group: 'goal' });

let passed = 0;
const failures = [];

for (const test of tests) {
  try {
    if (test.kind === 'intent') assert.equal(detectIntent(test.text), test.want);
    if (test.kind === 'money') assert.equal(parseFinancialValue(test.text).total, test.want);
    if (test.kind === 'goal') assert.equal(parseGoal(test.text, new Date('2026-08-15T12:00:00Z'))?.target, test.want);
    passed++;
  } catch (error) {
    failures.push({
      kind: test.kind,
      group: test.group,
      text: test.text,
      want: test.want,
      got: error.actual ?? error.message
    });
  }
}

const total = tests.length;
console.log(JSON.stringify({
  suite: 'P360 adversarial AI regression',
  scenarios: total,
  passed,
  failed: failures.length,
  passRate: Number((passed / total).toFixed(4)),
  failuresByGroup: failures.reduce((acc, item) => {
    acc[item.group] = (acc[item.group] || 0) + 1;
    return acc;
  }, {}),
  failures
}, null, 2));

if (failures.length) process.exitCode = 1;
