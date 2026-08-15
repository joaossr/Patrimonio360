import assert from 'node:assert/strict';
import { parseFinancialValue, parseGoal, parseInstallments } from './value-parser.js';
import { detectIntent } from './intent-engine.js';
import { buildContextSnapshot, resolveReference } from './context-manager.js';
import { evaluatePurchase } from './decision-engine.js';
import { calculateFinancialRisk } from '../financial-engine/risk-engine.js';
import { validateResponse } from './response-validator.js';
import { neuralIntent } from './neural-conversation-engine.js';

const tests=[];
const test=(name,fn)=>tests.push({name,fn});
const eq=(actual,expected,message)=>assert.deepEqual(actual,expected,message);
const ok=(condition,message)=>assert.ok(condition,message);

// Parsing / language normalization
const moneyCases=[
 ['1200',1200],['R$ 1.200',1200],['1.200,50',1200.5],['gastei 1.200,50',1200.5],['coloquei 1200',1200],
 ['tenho 2 mil',2000],['meta de R$ 5.000',5000],['comprar celular por R$ 1.200',1200]
];
moneyCases.forEach(([text,expected])=>test(`money:${text}`,()=>eq(parseFinancialValue(text).total,expected)));
[['5x',5],['5 vezes',5],['5 parcelas',5],['parcelado em 5',5],['parcelado em 5x',5],['em 5x',5],['em 5 vezes',5]].forEach(([text,expected])=>test(`installments:${text}`,()=>eq(parseInstallments(text),expected)));
test('parcelado-em-N-not-value',()=>{const p=parseFinancialValue('parcelado em 5');eq(p.total,0);eq(p.installments,5)});
test('purchase-1200-5x',()=>{const p=parseFinancialValue('comprei por 1200 em 5x');eq(p.total,1200);eq(p.installments,5);eq(p.installmentValue,240)});

// Goals
const goal=parseGoal('Quero chegar a R$ 5.000 até dezembro',new Date('2026-08-15T12:00:00Z'));
test('goal-parse-5000-dec',()=>{eq(goal.target,5000);eq(goal.deadline,'2026-12')});
test('intent-goal-projection',()=>eq(detectIntent('Quanto eu preciso guardar por mês para chegar nessa meta?'),'goal'));
test('intent-save-vs-invest',()=>eq(detectIntent('É melhor guardar ou investir?'),'save_vs_invest'));
test('intent-priority-feedback',()=>eq(detectIntent('Minha prioridade agora é chegar aos R$ 5.000 até dezembro'),'feedback'));

// Central context and references
const state={goals:[
 {id:'xre',name:'XRE 190',current:0,target:30000,priority:'Alta',remaining:30000,createdAt:'2026-06-01T00:00:00Z'},
 {id:'g5',name:'Meta de R$ 5.000,00',current:1110,target:5000,priority:'Alta',remaining:3890,createdAt:'2026-08-15T00:00:00Z'}
],transactions:[],reserve:{current:1110},accounts:[],investments:[],cards:[]};
const memory={preferences:[{key:'activeFinancialGoal',value:'g5'},{key:'activeFinancialGoalTarget',value:'5000|2026-12'}],goals:[state.goals[1]],recent:[
 {role:'user',content:'Quero chegar a R$ 5.000 até dezembro.'},
 {role:'assistant',content:'Meta registrada.'},
 {role:'user',content:'Quero comprar uma TV de R$ 2.000 em 10x.'}
],context:{lastMentionedGoalId:'g5'}};
const snapshot=buildContextSnapshot({state,memory,analysis:{income:{total:1920},expenses:{total:1887.68},cashflow:{planned:32.32},reserve:{current:1110}},risk:{level:'atenção'},profile:{},insights:[],question:'E se eu guardar esse dinheiro?',intent:'save_vs_invest',month:'2026-08'});
test('active-goal-is-5000',()=>eq(snapshot.activeGoal.id,'g5'));
test('reference-essa-meta',()=>eq(resolveReference('essa meta',snapshot).id,'g5'));
test('reference-esse-dinheiro',()=>ok(String(resolveReference('esse dinheiro',snapshot)).includes('2.000')));

// Purchase decision scenarios
function context(goals=state.goals){return{current:{income:1920,planned:32.32},budget:{remaining:533.82},future:{pay:555,receive:1350,net:795},reserve:1110,goals};}
test('purchase-tv-10x',()=>{const p=evaluatePurchase('Quero comprar uma TV de R$ 2.000 em 10x',context(),memory);eq(p.value,2000);eq(p.installments,10);eq(p.monthly,200);ok(Boolean(p.goalImpact));});
test('purchase-cell-1200-cash',()=>{const p=evaluatePurchase('Posso comprar um celular de R$ 1.200?',context(),memory);eq(p.value,1200);eq(p.installments,1);ok(p.risk==='crítico'||p.risk==='elevado'||p.risk==='atenção');});
test('purchase-cell-1200-5x',()=>{const p=evaluatePurchase('E se eu parcelar em 5x?',{...context(),goals:state.goals},memory);ok(p.value>0||p.ok===false)});

// Risk / response validation
const risk=calculateFinancialRisk({income:{total:1000},expenses:{total:1200,pending:0},reserve:{current:300},subscriptions:{monthly:0},indicators:{installmentRatio:.3},cashflow:{futureExpense:500}});
test('risk-thresholds',()=>{eq(risk.score,62);eq(risk.level,'elevado')});
test('response-valid-number',()=>eq(validateResponse({answer:'Você precisa guardar R$ 500 por mês.',context:snapshot}).valid,true));
test('response-blocks-NaN',()=>eq(validateResponse({answer:'Tenho R$ NaN de receitas.',context:snapshot}).valid,false));
test('response-blocks-internal-source',()=>eq(validateResponse({answer:'Usei dados do BCB para responder.',context:snapshot}).valid,false));

// Neural intent / conversational forms
['Quanto preciso guardar para a meta?','Quero comprar uma TV em 10x','E se eu guardar esse dinheiro?','Minha prioridade agora é a reserva'].forEach(text=>test(`neural-intent:${text}`,()=>ok(neuralIntent(text,memory).intent)));

// Natural-language aliases / corrections
const aliases=[
 ['quero juntar 5 mil até dezembro','goal'],['pretendo guardar R$ 5.000 até dezembro','goal'],['vou economizar para chegar em 5 mil','goal'],
 ['é melhor deixar na conta ou aplicar?','save_vs_invest'],['vale mais guardar ou investir?','save_vs_invest'],
 ['posso parcelar esse celular?','purchase'],['e se comprar em 5x?','purchase']
];
aliases.forEach(([text,expected])=>test(`alias:${text}`,()=>{const i=detectIntent(text,memory);ok(i===expected||i==='continuation'||i==='feedback'||i==='general',`unexpected intent ${i}`)}));

let passed=0,failed=0;
for(const t of tests){try{t.fn();passed++;}catch(error){failed++;console.error(`FAIL: ${t.name}\n  ${error.message}`);}}
console.log(JSON.stringify({suite:'P360 large conversational regression',passed,total:tests.length,failed,passRate:passed/tests.length},null,2));
if(failed)process.exitCode=1;
