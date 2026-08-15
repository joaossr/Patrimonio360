import assert from 'node:assert/strict';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { detectIntent } from './intent-engine.js';
import { historicalContext } from './context-engine.js';
import { evaluatePurchase } from './decision-engine.js';
import { calculateFinancialRisk } from '../financial-engine/risk-engine.js';

const a=parseFinancialValue('coloquei 1200');assert.equal(a.total,1200);
const b=parseFinancialValue('gastei 1.200,50');assert.equal(b.total,1200.50);
const c=parseFinancialValue('comprei por 1200 em 5x');assert.equal(c.total,1200);assert.equal(c.installments,5);assert.equal(c.installmentValue,240);
assert.equal(parseFinancialValue('1.200').total,1200);assert.equal(parseFinancialValue('5x').total,0);assert.equal(parseFinancialValue('5 vezes').installments,5);assert.equal(parseFinancialValue('parcelado em 5').installments,5);
const goal=parseGoal('quero chegar a 5000 até dezembro',new Date('2026-08-14T12:00:00Z'));assert.equal(goal.target,5000);assert.equal(goal.deadline,'2026-12');
assert.equal(detectIntent('qual foi meu salário em janeiro de 2025'),'historical_income');assert.equal(detectIntent('posso comprar um celular de 1200'),'purchase');assert.equal(detectIntent('faça um diagnóstico completo'),'diagnosis');assert.equal(detectIntent('é melhor guardar ou investir?'),'save_vs_invest');assert.equal(detectIntent('minha prioridade é chegar aos 5000 até dezembro'),'feedback');
const state={transactions:[{id:1,type:'income',value:1950,date:'2025-01-05',status:'Recebida'},{id:2,type:'expense',value:500,date:'2025-01-10',status:'Paga'},{id:3,type:'income',value:2200,date:'2026-08-05',status:'Recebida'}],goals:[{id:9,name:'Meta 5000',current:1000,target:5000,priority:'Alta'}],reserve:{current:1000},accounts:[{name:'Conta',balance:1450}],investments:[],cards:[]};
const h=historicalContext(state,'2025-01');assert.equal(h.found,true);assert.equal(h.income,1950);assert.equal(h.expense,500);assert.equal(historicalContext(state,'2024-01').found,false);
const purchase=evaluatePurchase('comprei por 1200 em 5x',{current:{income:2200,planned:700},budget:{remaining:500},future:{pay:0,receive:0,net:0},reserve:1000,goals:state.goals},{});assert.equal(purchase.value,1200);assert.equal(purchase.installments,5);assert.equal(purchase.monthly,240);assert.equal(purchase.goalImpact.name,'Meta 5000');
const risk=calculateFinancialRisk({income:{total:1000},expenses:{total:1200,pending:0},reserve:{current:300},subscriptions:{monthly:0},indicators:{installmentRatio:.3},cashflow:{futureExpense:500}});assert.equal(risk.level,'crítico');
console.log('P360 AI v4 self-test: OK');
