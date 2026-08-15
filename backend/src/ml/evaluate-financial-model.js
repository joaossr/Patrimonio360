// P360 model evaluation: deterministic scenario checks + model scores.
import fs from 'node:fs/promises';
import { makeUserFeatures, deriveDecisionLabels } from './brazilian-dataset-v3.js';
import { predictFinancialModel } from './financial-model.js';

const cases=[
 {name:'low-income-safe-purchase',features:makeUserFeatures({income:1950,expense:1200,reserve:1100,debt:0,installments:0,goalProgress:.3,goalUrgency:.8}),expect:'moderate'},
 {name:'strong-reserve-invest',features:makeUserFeatures({income:6000,expense:3000,reserve:30000,debt:0,installments:0,goalProgress:.8,goalUrgency:.2}),expect:'high'},
 {name:'high-debt-avoid',features:makeUserFeatures({income:3000,expense:2900,reserve:500,debt:6000,installments:700,goalProgress:.1,goalUrgency:.9}),expect:'low'}
];
const model=JSON.parse(await fs.readFile('models/financial-net.json','utf8'));
const quality=(scores,expected)=>{
  const a=scores.purchaseAffordability, r=scores.reservePriority, i=scores.investmentReadiness;
  if(expected==='high') return a>.7 && i>.5 && r<.5;
  if(expected==='low') return a<.4 && r>.4 && i<.4;
  return a>=.3 && a<.8;
};
const results=cases.map(c=>{
  const x=[c.features.income/15000,c.features.expense/15000,c.features.savingsRate,c.features.reserveMonths/6,c.features.debtToIncome,c.features.installmentToIncome,c.features.goalProgress,c.features.goalUrgency,c.features.discretionaryToIncome,c.features.incomeStability,0];
  const predicted=predictFinancialModel(x,model);
  const policy=deriveDecisionLabels(c.features);
  return {name:c.name,scores:predicted,policyLabels:policy,expected:c.expect,pass:quality(predicted,c.expect)};
});
const passed=results.filter(r=>r.pass).length;
console.log(JSON.stringify({model:model.version,passed,total:results.length,passRate:passed/results.length,results},null,2));
if(passed!==results.length) process.exitCode=2;
