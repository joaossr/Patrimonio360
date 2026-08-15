import assert from 'node:assert/strict';
import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { neuralIntent } from './neural-conversation-engine.js';

// Large, deterministic conversational corpus. The goal is to exercise many
// natural phrasings at once so regressions are found in batches, not manually.
const groups = {
  goalCreation: [
    'quero chegar a 5 mil ate dezembro', 'quero juntar R$ 5.000 até dezembro', 'preciso ter cinco mil em dezembro',
    'quero guardar 5000 até o fim do ano', 'vou economizar para chegar em 5 mil', 'pretendo atingir R$ 5.000',
    'meu objetivo é 5 mil', 'quero formar uma reserva de 5 mil',
    'quero ter 5 mil', 'quero atingir 5000', 'quero juntar 5 mil', 'quero guardar 5 mil',
    'pretendo guardar R$ 5.000', 'preciso guardar 5000', 'quero economizar 5 mil', 'vou economizar 5000',
    'minha meta é 5 mil', 'tenho objetivo de 5000', 'objetivo de 5 mil reais', 'meta de R$ 5.000',
    'quero chegar nos 5000', 'quero chegar aos 5 mil', 'quero atingir os 5 mil', 'quero formar uma reserva de 5000',
    'preciso ter R$ 5.000 até dezembro', 'pretendo chegar em 5 mil até dezembro', 'quero juntar cinco mil até dezembro',
    'quero guardar cinco mil até dezembro', 'vou economizar cinco mil até dezembro', 'meu objetivo é chegar a 5 mil',
    'minha meta é juntar R$ 5.000', 'quero ter cinco mil na reserva', 'preciso formar uma reserva de cinco mil',
    'quero construir uma reserva de 5 mil', 'quero alcançar uma reserva de R$ 5.000', 'pretendo ter 5000 até dezembro',
    'quero economizar para ter 5 mil', 'quero juntar dinheiro para chegar em 5 mil', 'preciso chegar a 5000',
    'quero atingir a meta de 5 mil'
  ],
  goalProjection: [
    'quanto preciso guardar por mes para chegar nessa meta?', 'quanto tenho que poupar por mês?',
    'qual aporte preciso fazer?', 'quanto falta para minha meta?', 'quando vou alcançar essa meta?',
    'em quanto tempo chego nos 5 mil?', 'qual a projeção do meu objetivo?', 'quanto preciso aportar até dezembro?',
    'quanto devo guardar por mês?', 'quanto devo poupar por mês?', 'quanto preciso economizar por mês?',
    'qual valor preciso aportar?', 'quanto preciso colocar por mês?', 'quanto falta para atingir a meta?',
    'quanto falta para alcançar o objetivo?', 'quando vou atingir minha meta?', 'quando chego na minha meta?',
    'quando alcanço o objetivo?', 'quanto tempo falta para a meta?', 'quanto tempo até chegar na meta?',
    'qual é a projeção da minha meta?', 'como fica a projeção do objetivo?', 'qual aporte mensal eu preciso?',
    'quanto tenho que colocar até dezembro?', 'quanto preciso juntar até dezembro?', 'quanto guardar até dezembro?',
    'qual deve ser meu aporte mensal?', 'quanto preciso investir por mês para chegar na meta?',
    'quanto tenho que economizar até dezembro?', 'quanto falta para chegar nos 5 mil?', 'em quanto tempo atinjo os 5 mil?',
    'qual a previsão para alcançar a meta?', 'quando minha reserva chega em 5 mil?', 'qual o valor mensal para chegar em 5000?',
    'quanto devo separar todo mês?', 'quanto preciso reservar por mês?', 'qual aporte mensal para atingir o objetivo?',
    'quanto falta para minha reserva?', 'quando vou ter 5 mil?', 'qual a projeção para chegar aos 5 mil?'
  ],
  saveInvest: [
    'guardo ou invisto?', 'é melhor deixar parado ou investir?', 'poupar ou aplicar?', 'coloco na reserva ou invisto?',
    'deixo na conta ou aplico?', 'vale mais guardar esse dinheiro ou investir?', 'guardo esse dinheiro ou aplico?',
    'é melhor poupar ou investir?', 'devo guardar ou investir?', 'devo poupar ou aplicar?',
    'deixo na conta ou invisto?', 'deixo parado ou aplico?', 'guardo na reserva ou invisto?',
    'reserva ou investimento?', 'poupança ou investimento?', 'guardar dinheiro ou investir?',
    'melhor deixar na conta ou investir?', 'vale a pena guardar ou aplicar?', 'onde é melhor deixar esse dinheiro?',
    'o que faço com o dinheiro, guardo ou invisto?', 'coloco na reserva ou aplico?', 'faço reserva ou invisto?',
    'guardo primeiro ou invisto?', 'devo manter na conta ou investir?', 'melhor economizar ou investir?',
    'é melhor formar reserva ou investir?', 'devo juntar ou aplicar?', 'guardar ou aplicar, qual é melhor?',
    'invisto agora ou guardo?', 'aplico agora ou deixo na reserva?', 'vale mais a pena poupar ou investir?',
    'esse dinheiro fica guardado ou investido?', 'coloco esse valor na reserva ou na carteira?',
    'melhor reserva ou carteira de investimentos?', 'deixo o dinheiro líquido ou invisto?',
    'guardo para emergência ou invisto?', 'reserva de emergência ou aplicação?', 'poupo para a reserva ou invisto?',
    'o dinheiro deve ficar parado ou aplicado?', 'qual é melhor, guardar ou investir?'
  ],
  purchase: [
    'posso comprar um celular de 1200?', 'vale a pena comprar uma tv de 2 mil?', 'quero comprar em 10x',
    'posso parcelar?', 'e se eu fizer em 5 parcelas?', 'comprei por 1200 em 5x', 'essa compra cabe no meu orçamento?',
    'posso comprar um celular de R$ 1.200?', 'consigo comprar uma tv de 2000?', 'posso gastar 500 nessa compra?',
    'essa compra de 1200 cabe no meu bolso?', 'dá para comprar por 1500?', 'posso parcelar em 10x?',
    'e se eu parcelar em 5x?', 'posso fazer em 12 parcelas?', 'vale a pena comprar esse produto?',
    'essa compra é segura para meu orçamento?', 'posso fazer essa compra?', 'cabe uma compra de 800 no orçamento?',
    'posso gastar 1200?', 'quero comprar um notebook de 3000', 'quero comprar um violão de 440',
    'posso comprar um celular em 10 vezes?', 'posso parcelar essa compra?', 'se eu fizer em 5 parcelas?',
    'e se for em 6x?', 'comprei por 1200 parcelado em 5x', 'comprei por R$ 1.200 em 5 vezes',
    'essa compra vai comprometer muito minha renda?', 'vale a pena parcelar?', 'posso assumir essa parcela?',
    'essa parcela cabe no meu orçamento?', 'qual o impacto de comprar por 2000?', 'simule uma compra de 1500',
    'simula uma compra de 2000 em 10x', 'posso comprar por 900 reais?', 'quero gastar 700 em um produto',
    'essa compra de R$ 2.000 é viável?', 'consigo parcelar 1800 em 6x?'
  ],
  casualMoney: [
    'coloquei 1200', 'gastei 1.200,50', 'sobrou 300', 'recebi 1950', 'tenho 2 mil sobrando',
    'entrou 800', 'paguei 240', 'torrei 100 reais', 'recebi R$ 1.950', 'entrou R$ 800',
    'gastei 500', 'paguei R$ 240', 'sobrou R$ 300', 'tenho 2000 sobrando', 'coloquei R$ 1.200',
    'recebi 2200', 'minha renda é 2200', 'ganhei 1500', 'entrou 950', 'paguei 350',
    'gastei R$ 1.000', 'torrei 250 reais', 'sobrou 450 reais', 'tenho 3 mil sobrando',
    'recebi cinco mil', 'recebi 5 mil', 'entrou cinco mil', 'gastei dois mil', 'paguei 300 reais',
    'coloquei 730 na reserva', 'aportei 500', 'investi 1000', 'guardei 600', 'economizei 400',
    'recebi 1950 reais', 'entrou 1950 reais', 'me pagaram 1950', 'meu salário é R$ 1.950',
    'minha renda mensal é de 1950', 'tenho R$ 2.000 sobrando'
  ],
  reserve: [
    'quanto tenho na reserva?', 'como está minha reserva?', 'preciso aumentar minha reserva', 'minha reserva está boa?',
    'quanto falta para minha reserva?', 'quero montar uma reserva', 'quero formar reserva de emergência',
    'como construir minha reserva?', 'qual o tamanho ideal da reserva?', 'quanto devo deixar na reserva?',
    'minha reserva de emergência está suficiente?', 'devo reforçar minha reserva?', 'quanto guardar para emergência?',
    'quanto preciso ter de reserva?', 'quero chegar na reserva de 5 mil', 'minha reserva está baixa',
    'como melhorar minha reserva?', 'devo priorizar a reserva?', 'quanto falta para completar a reserva?',
    'quero aumentar o dinheiro da reserva'
  ],
  expenses: [
    'onde estou gastando mais?', 'quais são meus maiores gastos?', 'meus gastos estão altos?', 'como reduzir minhas despesas?',
    'quero cortar gastos', 'analise minhas despesas', 'quanto gastei este mês?', 'qual categoria pesa mais?',
    'onde posso economizar?', 'quais despesas posso cortar?', 'meus gastos aumentaram?', 'estou gastando demais?',
    'qual é minha maior despesa?', 'quanto tenho gasto com lazer?', 'quanto foi gasto com transporte?',
    'minhas despesas estão sob controle?', 'como diminuir meus gastos?', 'tem alguma categoria exagerada?',
    'onde meu dinheiro está indo?', 'quero entender meus gastos'
  ],
  budget: [
    'quanto posso gastar?', 'qual minha margem para gastar?', 'quanto ainda posso gastar este mês?', 'qual meu orçamento?',
    'quanto sobra no orçamento?', 'tenho margem para uma compra?', 'meu orçamento aguenta?', 'qual meu limite de gasto?',
    'quanto posso comprometer?', 'quanto posso gastar sem prejudicar minhas metas?', 'qual valor posso gastar?',
    'quanto tenho disponível para gastar?', 'posso gastar mais este mês?', 'quanto ainda cabe no meu orçamento?',
    'qual minha folga financeira?', 'qual minha margem mensal?', 'quanto posso separar para lazer?',
    'quanto posso gastar com uma compra?', 'tenho espaço no orçamento?', 'como está meu orçamento?'
  ],
  cards: [
    'como está meu cartão?', 'quanto está minha fatura?', 'qual o limite do cartão?', 'quanto já usei do cartão?',
    'minha fatura está alta?', 'quando vence minha fatura?', 'quanto tenho disponível no cartão?', 'qual meu limite?',
    'quanto falta para o limite?', 'tem alguma compra no cartão?', 'minha fatura aumentou?', 'quanto devo no cartão?',
    'qual o valor da próxima fatura?', 'quanto do cartão já comprometi?', 'meu cartão está comprometido?',
    'quanto posso usar do cartão?', 'qual é minha fatura atual?', 'como está meu limite?', 'tenho limite disponível?',
    'quanto está comprometido no cartão?'
  ],
  cashflow: [
    'o que tenho para pagar?', 'o que tenho para receber?', 'quais contas vencem em breve?', 'como está meu fluxo futuro?',
    'quanto vou pagar nos próximos meses?', 'tenho compromissos futuros?', 'quais pagamentos estão próximos?',
    'o que vence este mês?', 'o que recebo este mês?', 'quanto tenho a pagar?', 'quanto tenho a receber?',
    'quais despesas estão chegando?', 'quais receitas estão previstas?', 'como ficam minhas contas futuras?',
    'tenho algum vencimento próximo?', 'quanto entra nos próximos dias?', 'quanto sai nos próximos dias?',
    'meu fluxo de caixa está saudável?', 'como está meu fluxo de dinheiro?', 'quais compromissos estão pela frente?'
  ],
  accounts: [
    'qual meu saldo?', 'quanto dinheiro tenho?', 'quanto tenho disponível?', 'como estão minhas contas?',
    'quanto tenho no banco?', 'qual meu dinheiro disponível?', 'quanto está meu saldo bancário?', 'tenho dinheiro disponível?',
    'quanto tenho nas contas?', 'como estão meus saldos?', 'qual o total nas contas bancárias?', 'quanto dinheiro está disponível?',
    'meu saldo está quanto?', 'quanto tenho hoje?', 'qual meu saldo atual?', 'quanto está sobrando nas contas?',
    'tenho saldo suficiente?', 'quanto dinheiro está em conta?', 'qual o valor disponível nas contas?', 'como está meu dinheiro?'
  ],
  diagnosis: [
    'faça um diagnóstico da minha vida financeira', 'analise minha saúde financeira', 'quero uma análise completa',
    'como está minha situação financeira?', 'me dê um raio x das minhas finanças', 'faça um raio-x financeiro',
    'quero saber minha saúde financeira', 'analise minha situação', 'faça um diagnóstico completo',
    'como você avalia minhas finanças?', 'me diga como está minha vida financeira', 'quero um diagnóstico financeiro',
    'analise tudo das minhas finanças', 'quero uma análise geral das minhas finanças', 'faça uma avaliação completa',
    'qual meu diagnóstico financeiro?', 'minha saúde financeira está boa?', 'me dê um panorama financeiro',
    'quero entender minha situação financeira', 'faça um raio x das minhas finanças'
  ],
  historicalIncome: [
    'qual foi minha renda em janeiro?', 'quanto recebi em fevereiro?', 'qual meu salário em março?',
    'quanto entrou em abril?', 'minha renda de maio foi quanto?', 'quanto ganhei em junho?', 'qual foi minha receita em julho?',
    'quanto recebi em agosto?', 'qual minha renda em setembro?', 'quanto ganhei em outubro?', 'quanto recebi em novembro?',
    'qual minha renda em dezembro?', 'quanto recebi em janeiro de 2026?', 'qual meu salário em 2025?',
    'quanto entrou em 2026-01?', 'qual minha renda em 2026/02?', 'quanto recebi em março de 2025?',
    'quanto ganhei em dezembro de 2025?', 'qual foi minha receita em 2024?', 'minha renda em agosto de 2026 foi quanto?'
  ],
  feedback: [
    'isso está errado', 'você interpretou errado', 'não foi isso que eu quis dizer', 'corrija sua resposta',
    'essa informação está errada', 'não é isso', 'você errou', 'corrija esse cálculo', 'minha prioridade é outra',
    'você entendeu errado', 'não foi isso', 'essa análise está errada', 'preciso corrigir uma informação',
    'a resposta não está certa', 'isso não corresponde ao que falei', 'interpretei diferente', 'corrija a interpretação',
    'não quero essa prioridade', 'você calculou errado', 'essa conclusão está errada'
  ]
};

const expected = {
  goalCreation: 'goal', goalProjection: 'goal', saveInvest: 'save_vs_invest', purchase: 'purchase',
  reserve: 'reserve', expenses: 'expenses', budget: 'budget', cards: 'cards', cashflow: 'cashflow',
  accounts: 'accounts', diagnosis: 'diagnosis', historicalIncome: 'historical_income', feedback: 'feedback'
};

let total = 0;
let passed = 0;
const failures = [];

for (const [group, phrases] of Object.entries(groups)) {
  for (const text of phrases) {
    total++;
    let ok = true;
    let reason = '';

    if (expected[group]) {
      const intent = detectIntent(text, { recent: [] });
      ok = intent === expected[group];
      reason = `expected ${expected[group]} got ${intent}`;
    } else {
      ok = parseFinancialValue(text).total > 0;
      reason = 'money parser returned no value';
    }

    const neural = neuralIntent(text, { recent: [] });
    if (!neural?.intent) {
      ok = false;
      reason = 'neural intent missing';
    }

    if (group === 'goalCreation' && !parseGoal(text, new Date('2026-08-15T12:00:00Z'))?.target) {
      ok = false;
      reason = 'goal parser missed target';
    }

    if (ok) {
      passed++;
    } else {
      failures.push({ group, text, reason });
    }
  }
}

// Report failures as a compact batch summary instead of dumping every phrase.
const byGroup = failures.reduce((acc, failure) => {
  acc[failure.group] = (acc[failure.group] || 0) + 1;
  return acc;
}, {});

const summary = {
  suite: 'P360 natural language stress',
  passed,
  total,
  failed: failures.length,
  passRate: total ? passed / total : 1,
  casesByGroup: Object.fromEntries(Object.entries(groups).map(([name, phrases]) => [name, phrases.length])),
  failuresByGroup: byGroup
};

assert.equal(failures.length, 0, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
