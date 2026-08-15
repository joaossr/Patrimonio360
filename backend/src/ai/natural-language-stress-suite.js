import assert from 'node:assert/strict';
import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { neuralIntent } from './neural-conversation-engine.js';

const groups = {
  goalCreation: [
    'quero chegar a 5 mil ate dezembro', 'quero juntar R$ 5.000 até dezembro', 'preciso ter cinco mil em dezembro',
    'quero guardar 5000 até o fim do ano', 'vou economizar para chegar em 5 mil', 'pretendo atingir R$ 5.000',
    'meu objetivo é 5 mil', 'quero formar uma reserva de 5 mil'
  ],
  goalProjection: [
    'quanto preciso guardar por mes para chegar nessa meta?', 'quanto tenho que poupar por mês?',
    'qual aporte preciso fazer?', 'quanto falta para minha meta?', 'quando vou alcançar essa meta?',
    'em quanto tempo chego nos 5 mil?', 'qual a projeção do meu objetivo?', 'quanto preciso aportar até dezembro?'
  ],
  saveInvest: [
    'guardo ou invisto?', 'é melhor deixar parado ou investir?', 'poupar ou aplicar?', 'coloco na reserva ou invisto?',
    'deixo na conta ou aplico?', 'vale mais guardar esse dinheiro ou investir?'
  ],
  purchase: [
    'posso comprar um celular de 1200?', 'vale a pena comprar uma tv de 2 mil?', 'quero comprar em 10x',
    'posso parcelar?', 'e se eu fizer em 5 parcelas?', 'comprei por 1200 em 5x', 'essa compra cabe no meu orçamento?'
  ],
  casualMoney: [
    'coloquei 1200', 'gastei 1.200,50', 'sobrou 300', 'recebi 1950', 'tenho 2 mil sobrando',
    'entrou 800', 'paguei 240', 'torrei 100 reais'
  ]
};

const expected = {
  goalCreation: 'goal', goalProjection: 'goal', saveInvest: 'save_vs_invest', purchase: 'purchase'
};

let total=0, passed=0;
const failures=[];
for (const [group, phrases] of Object.entries(groups)) {
  for (const text of phrases) {
    total++;
    let ok=true, reason='';
    if (expected[group]) {
      const intent=detectIntent(text, { recent: [] });
      ok=intent===expected[group];
      reason=`expected ${expected[group]} got ${intent}`;
    } else {
      ok = parseFinancialValue(text).total > 0;
      reason='money parser returned no value';
    }
    const neural=neuralIntent(text,{recent:[]});
    if (!neural?.intent) { ok=false; reason='neural intent missing'; }
    if (group === 'goalCreation' && !parseGoal(text,new Date('2026-08-15T12:00:00Z'))?.target) { ok=false; reason='goal parser missed target'; }
    if (ok) passed++; else failures.push({group,text,reason});
  }
}

assert.equal(failures.length,0,JSON.stringify(failures,null,2));
console.log(JSON.stringify({suite:'P360 natural language stress',passed,total,failed:failures.length,passRate:passed/total},null,2));
