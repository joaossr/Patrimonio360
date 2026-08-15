import assert from 'node:assert/strict';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { detectIntent } from './intent-engine.js';
import { buildFinancialContext, historicalContext } from './context-engine.js';
import { evaluatePurchase } from './decision-engine.js';
import { classifyRisk } from './diagnosis-engine.js';

const v1=parseFinancialValue('1200');
assert.equal(v1.total,1200);
const v2=parseFinancialValue('1.200');
assert.equal(v2.total,1200);
const v3=parseFinancialValue('1.200,50');
assert.equal(v3.total,1200.50);
const v4=parseFinancialValue('comprei por 1200 em 5x');
assert.equal(v4.total,1200);
assert.equal(v4.installments,5);
assert.equal(v4.installmentValue,240);
assert.equal(parseFinancialValue('5x').total,0);
assert.equal(parseFinancialValue('5 vezes').installments,5);
const goal=parseGoal('quero chegar a 5000 até dezembro',new Date('2026-08-14T12:00:00Z'));
assert.equal(goal.target,5000);
assert.equal(goal.deadline,'2026-12');
assert.equal(detectIntent('qual foi meu salário em janeiro de 2025'), 'historical_income');
assert.equal(detectIntent('posso comprar um celular de 1200'), 'purchase');
assert.equal(detectIntent('faça um diagnóstico completo'), 'diagnosis');
const state={transactions:[
 {id:1,type:'income',value:1950,date:'2025-01-05',status:'Recebida'},
 {id:2,type:'expense',value:500,date:'2025-01-10',status:'Paga'},
 {id:3,type:'income',value:2200,date:'2026-08-05',status:'Recebida'}
],goals:[{id:9,name:'Reserva',current:1000,target:5000,priority:'Alta'}],reserve:{current:1000},accounts:[{name:'Conta',balance:1450}],investments:[],cards:[]};
const h=historicalContext(state,'2025-01');
assert.equal(h.found,true); assert.equal(h.income,1950); assert.equal(h.expense,500);
const ctx=buildFinancialContext(state,'2026-08',{}); assert.equal(ctx.current.income,2200);
const purchase=evaluatePurchase('comprei por 1200 em 5x',{...ctx,budget:{remaining:1000},future:{pay:0,receive:0,net:0}},{});
assert.equal(purchase.value,1200); assert.equal(purchase.installments,5); assert.equal(purchase.monthly,240);
const risk=classifyRisk({current:{income:1000,expenses:1200,planned:-200},reserve:300,future:{pay:500,receive:0,net:-500},goals:[]});
assert.equal(risk.level,'crítico');
console.log('P360 AI v2 self-test: OK');
