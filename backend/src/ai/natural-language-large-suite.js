import assert from 'node:assert/strict';
import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { normalizeUserText } from './text-normalizer.js';

const groups = {
  goal: ['quero chegar a 5 mil ate dezembro','quero juntar 5000 ate dezembro','preciso ter cinco mil em dezembro','quero guardar 5 mil ate o fim do ano','vou economizar para chegar em 5 mil','pretendo atingir R$ 5.000','meu objetivo e 5 mil','quero formar uma reserva de 5 mil','quero ter 5000','minha meta e R$ 5.000'],
  goalProjection: ['quanto preciso guardar por mes para chegar nessa meta?','quanto tenho que poupar por mes?','qual aporte preciso fazer?','quanto falta para minha meta?','quando vou alcançar essa meta?','em quanto tempo chego nos 5 mil?','qual a projeção do meu objetivo?','quanto preciso aportar ate dezembro?','quanto devo guardar por mes?','qual valor preciso aportar?'],
  saveInvest: ['guardo ou invisto?','e melhor deixar parado ou investir?','poupar ou aplicar?','coloco na reserva ou invisto?','deixo na conta ou aplico?','vale mais guardar esse dinheiro ou investir?','guardo esse dinheiro ou aplico?','e melhor poupar ou investir?','devo guardar ou investir?','devo poupar ou aplicar?'],
  purchase: ['posso comprar um celular de 1200?','vale a pena comprar uma tv de 2 mil?','quero comprar em 10x','posso parcelar?','e se eu fizer em 5 parcelas?','comprei por 1200 em 5x','essa compra cabe no meu orçamento?','posso parcelar em 10x?','vale a pena parcelar?','consigo parcelar 1800 em 6x?'],
  reserve: ['quanto tenho na reserva?','como esta minha reserva?','preciso aumentar minha reserva','minha reserva esta boa?','quanto falta para minha reserva?','quero montar uma reserva','quero formar reserva de emergencia','como construir minha reserva?','quanto devo deixar na reserva?','devo priorizar a reserva?'],
  expenses: ['onde estou gastando mais?','quais sao meus maiores gastos?','meus gastos estao altos?','como reduzir minhas despesas?','quero cortar gastos','analise minhas despesas','quanto gastei este mes?','onde posso economizar?','estou gastando demais?','quero entender meus gastos'],
  budget: ['quanto posso gastar?','qual minha margem para gastar?','quanto ainda posso gastar este mes?','qual meu orçamento?','quanto sobra no orçamento?','tenho margem para uma compra?','meu orçamento aguenta?','quanto posso comprometer?','tenho espaço no orçamento?','como esta meu orçamento?'],
  cards: ['como esta meu cartao?','quanto esta minha fatura?','qual o limite do cartao?','quanto ja usei do cartao?','minha fatura esta alta?','quando vence minha fatura?','quanto tenho disponível no cartao?','quanto devo no cartao?','qual e minha fatura atual?','tenho limite disponível?'],
  cashflow: ['o que tenho para pagar?','o que tenho para receber?','quais contas vencem em breve?','como esta meu fluxo futuro?','quanto vou pagar nos próximos meses?','tenho compromissos futuros?','o que vence este mes?','o que recebo este mes?','quanto tenho a pagar?','quanto tenho a receber?'],
  accounts: ['qual meu saldo?','quanto dinheiro tenho?','quanto tenho disponível?','como estao minhas contas?','quanto tenho no banco?','qual meu dinheiro disponível?','quanto esta meu saldo bancario?','quanto tenho nas contas?','qual meu saldo atual?','quanto dinheiro esta em conta?'],
  diagnosis: ['faça um diagnóstico da minha vida financeira','analise minha saúde financeira','quero uma análise completa','como esta minha situação financeira?','me de um raio x das minhas finanças','faça um raio-x financeiro','quero saber minha saúde financeira','analise minha situação','faça um diagnóstico completo','como voce avalia minhas finanças?']
};
const expected={goal:'goal',goalProjection:'goal',saveInvest:'save_vs_invest',purchase:'purchase',reserve:'reserve',expenses:'expenses',budget:'budget',cards:'cards',cashflow:'cashflow',accounts:'accounts',diagnosis:'diagnosis'};
const mutations=[s=>s.toUpperCase(),s=>`  ${s}  `,s=>s.replace(/ /g,'  '),s=>s.replace(/quanto/g,'qnto'),s=>s.replace(/quero/g,'querro'),s=>s.replace(/guardar/g,'guardr')];
const tests=[];
for(const [group,phrases] of Object.entries(groups)) for(const phrase of phrases){tests.push({kind:'intent',group,text:phrase,want:expected[group]});for(const mutate of mutations)tests.push({kind:'intent',group,text:mutate(phrase),want:expected[group]});}
const money=[['recebi 1950',1950],['recebi R$ 1.950',1950],['renda de 1.950,50',1950.5],['tenho 2 mil',2000],['tenho dois mil',2000],['meta de 5 mil',5000],['quero juntar R$ 5.000',5000],['comprei por 1200 em 5x',1200],['gastei 1.200,50',1200.5],['aportei 730',730],['recebi cinco mil',5000],['gastei dois mil',2000],['me pagaram 1950',1950],['minha renda e R$ 2.200',2200],['sobrou 450 reais',450]];
for(const [text,want] of money){tests.push({kind:'money',text,want,group:'money'});for(const mutate of mutations.slice(0,4))tests.push({kind:'money',text:mutate(text),want,group:'money'});}
const goals=[['quero chegar a 5 mil ate dezembro',5000],['quero juntar R$ 5.000 até dezembro',5000],['preciso ter cinco mil em dezembro',5000],['meu objetivo e 5 mil',5000],['quero formar uma reserva de 5 mil',5000],['pretendo atingir R$ 5.000',5000],['vou economizar para chegar em 5 mil',5000]];
for(const [text,want] of goals)for(const mutate of mutations.slice(0,6))tests.push({kind:'goal',text:mutate(text),want,group:'goal'});
const installments=[['comprei por 1200 em 5x',5],['comprei por 1200 em 5 vezes',5],['parcelado em 10x',10],['quero fazer em 12 parcelas',12],['em 6x',6]];
for(const [text,want] of installments)for(const mutate of mutations.slice(0,4))tests.push({kind:'installment',text:mutate(text),want,group:'purchase'});
let passed = 0;
const failures = [];

for (const t of tests) {
  try {
    if (t.kind === 'intent') {
      assert.equal(detectIntent(t.text), t.want);
    }
    if (t.kind === 'money') {
      assert.equal(parseFinancialValue(t.text).total, t.want);
    }
    if (t.kind === 'goal') {
      assert.equal(parseGoal(t.text, new Date('2026-08-15T12:00:00Z'))?.target, t.want);
    }
    if (t.kind === 'installment') {
      assert.equal(parseFinancialValue(t.text).installments, t.want);
    }
    passed++;
  } catch (error) {
    failures.push({
      kind: t.kind,
      group: t.group,
      text: t.text,
      want: t.want,
      got: error.actual ?? error.message
    });
  }
}

const changed = tests.filter(
  t =>
    normalizeUserText(t.text) !==
    t.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
).length;

const byGroup = {};
for (const failure of failures) {
  byGroup[failure.group] = (byGroup[failure.group] || 0) + 1;
}

const total = tests.length;

console.log(JSON.stringify({
  suite: 'P360 natural language large stress',
  scenarios: total,
  passed,
  failed: failures.length,
  passRate: Number((passed / total).toFixed(4)),
  autocorrection: {
    enabled: true,
    scenariosChanged: changed,
    changeRate: Number((changed / total).toFixed(4))
  },
  failuresByGroup: byGroup,
  failures
}, null, 2));

if (failures.length) process.exitCode = 1;
