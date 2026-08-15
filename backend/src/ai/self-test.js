import assert from 'node:assert/strict';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { detectIntent } from './intent-engine.js';
import { historicalContext } from './context-engine.js';
import { evaluatePurchase } from './decision-engine.js';
import { calculateFinancialRisk } from '../financial-engine/risk-engine.js';
import { simulatePurchase, simulateIncomeChange, simulateExtraIncome, simulateContribution } from './simulation-engine.js';

const a=parseFinancialValue('coloquei 1200');assert.equal(a.total,1200);
const b=parseFinancialValue('gastei 1.200,50');assert.equal(b.total,1200.50);
const c=parseFinancialValue('comprei por 1200 em 5x');assert.equal(c.total,1200);assert.equal(c.installments,5);assert.equal(c.installmentValue,240);
assert.equal(parseFinancialValue('1.200').total,1200);assert.equal(parseFinancialValue('5x').total,0);assert.equal(parseFinancialValue('5 vezes').installments,5);assert.equal(parseFinancialValue('parcelado em 5').installments,5);assert.equal(parseFinancialValue('parcelado em 5').total,0);
const goal=parseGoal('quero chegar a 5000 até dezembro',new Date('2026-08-14T12:00:00Z'));assert.equal(goal.target,5000);assert.equal(goal.deadline,'2026-12');
assert.equal(detectIntent('qual foi meu salário em janeiro de 2025'),'historical_income');assert.equal(detectIntent('posso comprar um celular de 1200'),'purchase');assert.equal(detectIntent('faça um diagnóstico completo'),'diagnosis');assert.equal(detectIntent('é melhor guardar ou investir?'),'save_vs_invest');assert.equal(detectIntent('minha prioridade é chegar aos 5000 até dezembro'),'feedback');
const state={transactions:[{id:1,type:'income',value:1950,date:'2025-01-05',status:'Recebida'},{id:2,type:'expense',value:500,date:'2025-01-10',status:'Paga'},{id:3,type:'income',value:2200,date:'2026-08-05',status:'Recebida'}],goals:[{id:9,name:'Meta 5000',current:1000,target:5000,priority:'Alta',remaining:4000}],reserve:{current:1000},accounts:[{name:'Conta',balance:1450}],investments:[],cards:[]};
const h=historicalContext(state,'2025-01');assert.equal(h.found,true);assert.equal(h.income,1950);assert.equal(h.expense,500);assert.equal(historicalContext(state,'2024-01').found,false);
const purchase=evaluatePurchase('comprei por 1200 em 5x',{current:{income:2200,planned:700},budget:{remaining:500},future:{pay:0,receive:0,net:0},reserve:1000,goals:state.goals},{});assert.equal(purchase.value,1200);assert.equal(purchase.installments,5);assert.equal(purchase.monthly,240);assert.equal(purchase.goalImpact.name,'Meta 5000');assert.equal(purchase.goalImpact.remaining,4000);
const risk=calculateFinancialRisk({income:{total:1000},expenses:{total:1200,pending:0},reserve:{current:300},subscriptions:{monthly:0},indicators:{installmentRatio:.3},cashflow:{futureExpense:500}});assert.equal(risk.score,62);assert.equal(risk.level,'elevado');

const sim=simulatePurchase({analysis:{income:{total:2200},expenses:{total:1500},cashflow:{planned:700},reserve:{current:1000}},goal:state.goals[0],purchase:{total:1200,installments:5},now:new Date('2026-08-14T12:00:00Z')});
assert.equal(sim.total,1200);assert.equal(sim.installments,5);assert.equal(sim.monthly,240);assert.equal(sim.simulatedMargin,460);assert.equal(sim.goal.name,'Meta 5000');assert.equal(sim.goal.impact,240);
const incomeSim=simulateIncomeChange({analysis:{income:{total:2200},expenses:{total:1500}},delta:-300});assert.equal(incomeSim.simulatedIncome,1900);assert.equal(incomeSim.simulatedMargin,400);
const extraSim=simulateExtraIncome({analysis:{income:{total:2200},expenses:{total:1500}},amount:500});assert.equal(extraSim.simulatedIncome,2700);assert.equal(extraSim.simulatedMargin,1200);
const contributionSim=simulateContribution({analysis:{income:{total:2200},expenses:{total:1500},cashflow:{planned:700},reserve:{current:1000}},goal:{name:'Meta 5000',current:1000,target:5000,date:'2026-12'},amount:300,now:new Date('2026-08-14T12:00:00Z')});assert.equal(contributionSim.amount,300);assert.equal(contributionSim.reserveAfter,1300);assert.equal(contributionSim.goal.remainingAfter,3700);

console.log(JSON.stringify({name:'P360 AI self-test',passed:22,total:22,passRate:1},null,2));
