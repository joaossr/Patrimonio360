// Testes da IA própria (P360 Mind). Rodar: npm run test:ai
import test from 'node:test';
import assert from 'node:assert/strict';
import { P360Mind, CORPUS } from '../../assets/js/ai/engine.js';
import { NaiveBayes } from '../../assets/js/ai/nlu.js';
import { extractMoney, extractInstallments, extractMonth, extractCategory } from '../../assets/js/ai/text.js';

const TODAY = '2026-11-12T12:00:00';

// Histórico fictício de 7 meses: salário, aluguel, mercado no cartão, uber, lazer e Netflix.
function fixture() {
  let id = 1;
  const tx = [];
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  months.forEach((m, k) => {
    const cur = m === '2026-11';
    tx.push({ id: id++, name: 'Salário', type: 'income', value: 5000, date: `${m}-05`, category: 'Salário', account: 'Banco', status: 'Recebida' });
    tx.push({ id: id++, name: 'Aluguel', type: 'expense', value: 1500, date: `${m}-10`, category: 'Moradia', account: 'Banco', status: cur ? 'Pendente' : 'Paga' });
    tx.push({ id: id++, name: 'Supermercado Extra', type: 'expense', value: 600 + k * 10, date: `${m}-08`, category: 'Alimentação', payment: 'cartao', cardId: 1, status: 'Paga' });
    tx.push({ id: id++, name: 'Uber viagem', type: 'expense', value: 120, date: `${m}-03`, category: 'Transporte', account: 'Banco', status: 'Paga' });
    tx.push({ id: id++, name: 'Netflix', type: 'expense', value: 39.9, date: `${m}-12`, category: 'Assinaturas', account: 'Banco', status: 'Paga' });
    if (!cur) tx.push({ id: id++, name: 'Cinema', type: 'expense', value: 150, date: `${m}-20`, category: 'Lazer', account: 'Banco', status: 'Paga' });
  });
  // Mês atual com um gasto de lazer muito acima do normal.
  tx.push({ id: id++, name: 'Show internacional', type: 'expense', value: 900, date: '2026-11-07', category: 'Lazer', account: 'Banco', status: 'Paga' });
  return {
    selectedMonth: '2026-11', transactions: tx,
    accounts: [{ name: 'Banco', openingBalance: 2000 }], cards: [{ id: 1, name: 'Nubank', limit: 4000, due: '15' }],
    categories: ['Salário', 'Moradia', 'Alimentação', 'Transporte', 'Assinaturas', 'Lazer'].map((n, i) => ({ id: i, name: n, kind: n === 'Salário' ? 'Receita' : 'Despesa' })),
    budgets: [{ month: '2026-11', category: 'Alimentação', limit: 700 }],
    goals: [{ id: 1, name: 'Viagem', current: 1000, target: 6000, date: '2027-11-01' }],
    reserve: { target: 15000, essential: 2500 }, subscriptions: [], preferences: { distribution: { fixed: 60, investment: 30, leisure: 10 } }
  };
}

test('extração de entidades em português', () => {
  assert.equal(extractMoney('posso comprar um celular de R$ 2.500,90?'), 2500.9);
  assert.equal(extractMoney('quero juntar 10 mil'), 10000);
  assert.equal(extractMoney('compra de 1500 em 10x'), 1500);
  assert.equal(extractMoney('gastei 2k no mercado'), 2000);
  assert.equal(extractInstallments('compra de 1500 em 10x'), 10);
  assert.equal(extractInstallments('parcelado em doze vezes'), 12);
  assert.equal(extractMonth('e no mês passado?', '2026-11'), '2026-10');
  assert.equal(extractMonth('quanto gastei em março', '2026-11'), '2026-03');
  assert.equal(extractCategory('quanto gastei com alimentacao', ['Alimentação', 'Lazer']), 'Alimentação');
  assert.equal(extractCategory('gastos de transportes', ['Transporte']), 'Transporte');
});

// Frases que NÃO estão no corpus, com erros de digitação, gírias e sem acento.
const HELD_OUT = {
  overview: ['como ta meu mes', 'me fala como estao minhas financas', 'faz um resumao pra mim'],
  can_spend: ['qto ainda posso gastar esse mes', 'quanto da pra gastar por dia'],
  forecast: ['vou fechar o mes no negativo?', 'previsao de como termino o mes'],
  spending_top: ['onde to gastando mais', 'pra onde ta indo meu dinheiro'],
  save_tips: ['como faco pra economizar', 'onde da pra cortar gasto'],
  upcoming: ['quais contas vencem essa semana', 'o que tenho que pagar'],
  cards: ['quanto ta minha fatura', 'qual cartao eu uso'],
  reserve: ['quantos meses minha reserva cobre', 'minha reserva ta boa?'],
  goals: ['vou conseguir bater minha meta', 'como estao minhas metas'],
  anomalies: ['tem algum gasto esquisito', 'algo fora do padrao?'],
  subscriptions: ['quanto pago de assinatura', 'minhas assinaturas ativas'],
  health: ['qual minha nota de saude financeira'],
  profile: ['o que vc aprendeu sobre mim'],
  greeting: ['bom diaa', 'oii'],
  thanks: ['vlw obrigadao']
};

test('compreensão: acerta frases novas (generalização)', () => {
  const mind = new P360Mind({ state: fixture(), today: TODAY });
  let ok = 0, total = 0;
  const misses = [];
  for (const [intent, list] of Object.entries(HELD_OUT)) for (const q of list) {
    total++;
    const u = mind.understand(q);
    if (u.intent === intent) ok++; else misses.push(`${q} -> ${u.intent} (esperado ${intent})`);
  }
  const acc = ok / total;
  console.log(`  precisão em frases novas: ${(acc * 100).toFixed(0)}% (${ok}/${total})${misses.length ? '\n  erros: ' + misses.join('; ') : ''}`);
  assert.ok(acc >= 0.85, `precisão baixa: ${acc}`);
});

test('compreensão: validação cruzada deixando um de fora no corpus', () => {
  let ok = 0, total = 0;
  for (const [intent, list] of Object.entries(CORPUS)) list.forEach((q, i) => {
    const nb = new NaiveBayes();
    Object.entries(CORPUS).forEach(([it, l]) => l.forEach((x, j) => { if (!(it === intent && j === i)) nb.learn(x, it); }));
    total++; if (nb.predict(q)[0].intent === intent) ok++;
  });
  console.log(`  validação cruzada: ${(ok / total * 100).toFixed(0)}% (${ok}/${total})`);
  assert.ok(ok / total >= 0.6, `validação cruzada caiu: ${ok / total}`);
});

test('aprende frases ensinadas pelo usuário', () => {
  const mind = new P360Mind({ state: fixture(), today: TODAY });
  const phrase = 'bora ver a grana do rolê';
  const r = mind.teach(phrase, 'spending_top');
  assert.equal(r.intent, 'spending_top');
  assert.equal(mind.understand('bora ver a grana do role').intent, 'spending_top');
  // A memória é persistida e reconstrói o aprendizado em outra sessão/aparelho.
  const again = new P360Mind({ state: fixture(), memory: JSON.parse(JSON.stringify(mind.memory)), today: TODAY });
  assert.equal(again.understand('bora ver a grana do role').intent, 'spending_top');
});

test('modelo pessoal: aprende categorias, recorrências, renda e anomalias', () => {
  const mind = new P360Mind({ state: fixture(), today: TODAY });
  assert.equal(mind.suggestCategory('Supermercado Pão de Açúcar')?.category, 'Alimentação');
  assert.equal(mind.suggestCategory('uber pra casa')?.category, 'Transporte');
  const pm = mind.pm;
  assert.equal(pm.income.stability, 'estável');
  assert.equal(pm.income.payDay, 5);
  assert.ok(pm.recurring.some(r => /netflix/i.test(r.name)), 'deveria detectar Netflix como recorrente');
  const al = mind.ask('tem algo fora do normal?');
  assert.equal(al.intent, 'anomalies');
  assert.match(al.text, /Lazer/);
});

test('respostas usam os números reais e mantêm o contexto', () => {
  const mind = new P360Mind({ state: fixture(), today: TODAY, userName: 'Ana Souza' });
  const p = mind.ask('posso comprar um notebook de 3000 em 10x?');
  assert.equal(p.intent, 'purchase');
  assert.match(p.text, /10x de R\$\s?300,00/);
  const follow = mind.ask('e em 3x?');
  assert.equal(follow.intent, 'purchase');
  assert.match(follow.text, /3x de R\$\s?1\.000,00/);
  const ask = mind.ask('posso fazer uma compra?');
  assert.match(ask.text, /valor/i);
  const value = mind.ask('2000');
  assert.equal(value.intent, 'purchase');
  const cat = mind.ask('quanto gastei com alimentação?');
  assert.equal(cat.intent, 'spending_category');
  assert.match(cat.text, /Limite: R\$\s?700,00/);
  const prev = mind.ask('e no mês passado?');
  assert.match(prev.text, /outubro/);
  const plan = mind.ask('quero juntar 12 mil em 12 meses');
  assert.equal(plan.intent, 'saving_plan');
  assert.match(plan.text, /R\$\s?1\.000,00 por mês/);
  assert.match(mind.ask('oi').text, /Ana/);
});

test('guarda fatos que o usuário conta e lida com perguntas desconhecidas', () => {
  const mind = new P360Mind({ state: fixture(), today: TODAY });
  mind.ask('quero guardar 500 por mês');
  assert.equal(mind.memory.facts.monthlySaving, 500);
  mind.ask('minha renda é 5200');
  assert.equal(mind.memory.facts.income, 5200);
  const unk = mind.ask('qual a capital da mongólia');
  assert.equal(unk.intent, 'unknown');
  assert.ok(unk.needsTeach);
});

test('funciona com usuário novo sem nenhum dado', () => {
  const mind = new P360Mind({ state: { transactions: [] }, today: TODAY });
  for (const q of ['resumo do mês', 'quanto posso gastar', 'como vou fechar o mês', 'onde economizar', 'o que você aprendeu sobre mim', 'minhas metas', 'meus cartões'])
    assert.ok(mind.ask(q).text.length > 10, q);
  assert.ok(mind.insights().length >= 1);
});
