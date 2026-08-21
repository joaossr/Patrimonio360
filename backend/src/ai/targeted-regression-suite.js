import assert from 'node:assert/strict';
import { parseFinancialValue, parseInstallments } from './value-parser.js';
import { detectIntent } from './intent-engine.js';

const cases = [
  ['1200', 1200, 1, 1200], ['1.200', 1200, 1, 1200], ['1200,50', 1200.5, 1, 1200.5], ['1,2 mil', 1200, 1, 1200],
  ['1200 em 5x', 1200, 5, 240], ['1200 em 5 parcelas', 1200, 5, 240], ['5x de 240', 1200, 5, 240], ['5 parcelas de 240', 1200, 5, 240]
];
for (const [text,total,installments,monthly] of cases) {
  const parsed=parseFinancialValue(text);
  assert.equal(parsed.total,total,`total: ${text}`);
  if (installments>1) { assert.equal(parsed.installments,installments,`parcelas: ${text}`); assert.equal(parsed.installmentValue,monthly,`parcela: ${text}`); }
}
assert.equal(parseInstallments('1200 em 5x'),5);
assert.equal(parseInstallments('1200 em 5 parcelas'),5);
assert.equal(parseInstallments('5x de 240'),5);

const intentCases = [
  ['oi','greeting'], ['Olá, tudo bem?','greeting'], ['bom dia','greeting'], ['o que você consegue fazer?','capabilities'],
  ['qto gastei esse mês','expenses'], ['onde estou gastando mais?','expenses'], ['quero organizar minha vida financeira','budget'],
  ['posso comprar um celular?','purchase'], ['posso comprar um celular de 1200 em 5x?','purchase'], ['quero chegar a 5000 até dezembro','goal'],
  ['quanto gastei em março de 2024?','historical_expenses'], ['qual foi meu salário em janeiro de 2025?','historical_income'],
  ['o que tenho para pagar nos próximos dias?','cashflow']
];
for (const [text,expected] of intentCases) assert.equal(detectIntent(text,{}),expected,`intent: ${text}`);

const conversationMemory={recent:[{role:'user',content:'Quero comprar um celular'},{role:'assistant',content:'Qual o valor?'},{role:'user',content:'1500 em 6x'}]};
assert.equal(detectIntent('Posso comprar?',conversationMemory),'purchase');
assert.equal(detectIntent('E se eu fizer em 5 parcelas?',conversationMemory),'purchase');

console.log(JSON.stringify({suite:'P360 targeted AI regression',passed:cases.length+intentCases.length+5,failed:0,passRate:1},null,2));
