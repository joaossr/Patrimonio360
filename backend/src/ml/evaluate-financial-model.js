// P360 model evaluation: holdout metrics + scenario regression tests.
import fs from 'node:fs/promises';
import { makeUserFeatures, deriveDecisionLabels } from './brazilian-dataset-v3.js';
import { predictFinancialModel } from './financial-model.js';

const cases=[
 {name:'low-income-safe-purchase',features:makeUserFeatures({income:1950,expense:1200,reserve:1100,debt:0,installments:0,goalProgress:.3,goalUrgency:.8}),expect:'moderate'},
 {name:'strong-reserve-invest',features:makeUserFeatures({income:6000,expense:3000,reserve:30000,debt:0,installments:0,goalProgress:.8,goalUrgency:.2}),expect:'high'},
 {name:'high-debt-avoid',features:makeUserFeatures({income:3000,expense:2900,reserve:500,debt:6000,installments:700,goalProgress:.1,goalUrgency:.9}),expect:'low'}
];
const avg=(a)=>a.reduce((s,x)=>s+x,0)/a.length;
const model=JSON.parse(await fs.readFile('models/financial-net.json','utf8'));
const results=cases.map(c=>{const x=Object.values(c.features).slice(0,11);const p=predictFinancialModel(x,model);return {...c.name,scores:p,expected:c.expect};});
console.log(JSON.stringify({model:model.version,results},null,2));
