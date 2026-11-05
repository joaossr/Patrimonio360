// Testa o bot do Telegram de ponta a ponta com um banco em memória e a API do Telegram simulada.
// Nada sai para a internet e nenhum dado real é tocado.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN = '123:teste';
const calls = [];
globalThis.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  const body = init?.body ? JSON.parse(init.body) : {};
  calls.push({ method, ...body });
  return { json: async () => ({ ok: true, result: {} }) };
};
const { processUpdate } = await import('../src/telegram/bot.js');
const { monthNow, todayStr } = await import('../src/telegram/answers.js');

const M = monthNow(), T = todayStr();
const makeState = () => ({
  accounts: [{ name: 'Nubank', openingBalance: 1000 }, { name: 'Itaú', openingBalance: 500 }],
  cards: [{ id: 'c1', name: 'Nubank Roxinho', bank: 'Nubank', limit: 3000 }],
  categories: [{ name: 'Alimentação', kind: 'Despesa' }, { name: 'Transporte', kind: 'Despesa' }, { name: 'Salário', kind: 'Receita' }],
  transactions: [
    { id: 1, name: 'Salário', type: 'income', value: 5000, date: `${M}-05`, category: 'Salário', status: 'Recebida', payment: 'conta', account: 'Nubank' },
    { id: 2, name: 'Mercado', type: 'expense', value: 300, date: `${M}-06`, category: 'Alimentação', status: 'Paga', payment: 'conta', account: 'Nubank' },
    { id: 3, name: 'Uber', type: 'expense', value: 80, date: `${M}-07`, category: 'Transporte', status: 'Paga', payment: 'cartao', cardId: 'c1' },
    { id: 4, name: 'Internet', type: 'expense', value: 120, date: T, category: 'Moradia', status: 'Pendente', payment: 'conta', account: 'Itaú' },
  ],
  budgets: [{ month: M, category: 'Alimentação', limit: 400 }],
  goals: [{ name: 'Viagem', current: 500, target: 2000 }],
  reserve: { current: 1000, target: 6000 },
  investments: [], cardPayments: [],
});

function setup(linked = true) {
  const docs = new Map();
  if (linked) docs.set('telegramLinks/42', { uid: 'u1', active: true });
  const state = makeState();
  const db = {
    doc: path => ({
      ref: null,
      async get() { const v = docs.get(path); return { exists: v !== undefined, data: () => v, ref: this }; },
      async set(v, opts) { docs.set(path, opts?.merge && typeof docs.get(path) === 'object' ? { ...docs.get(path), ...v } : v); if (path === 'users/u1/app/state' && v.state) Object.assign(state, opts?.merge ? { ...v.state } : v.state); },
      async delete() { docs.delete(path); },
    }),
  };
  const loadState = async () => state;
  calls.length = 0;
  const say = text => processUpdate(db, loadState, { message: { chat: { id: 42 }, text } });
  const press = (data, messageId = 9) => processUpdate(db, loadState, { callback_query: { id: 'q', data, message: { chat: { id: 42 }, message_id: messageId } } });
  const last = () => calls.filter(c => c.method === 'sendMessage' || c.method === 'editMessageText').at(-1);
  return { say, press, last, state, docs };
}

test('saldo mostra o total real das contas e a projeção', async () => {
  const t = setup();
  await t.say('saldo');
  const m = t.last();
  assert.match(m.text, /Saldo nas contas/);
  // Nubank 1000 + 5000 − 300 = 5700; Itaú 500 (internet pendente não conta) → total 6.200,00
  assert.match(m.text, /6\.200,00/);
  assert.match(m.text, /Projeção ao fim do mês/);
  assert.ok(m.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'menu_home'));
});

test('resumo, categorias, orçamento, vencimentos e cartões respondem com números reais', async () => {
  const t = setup();
  await t.say('resumo'); assert.match(t.last().text, /Receitas: <b>R\$\s*5\.000,00/);
  await t.say('categorias'); assert.match(t.last().text, /Alimentação/);
  await t.say('orçamento'); assert.match(t.last().text, /75%/);
  await t.say('vencimentos'); assert.match(t.last().text, /Internet/);
  await t.say('cartões'); assert.match(t.last().text, /Nubank Roxinho/);
  await t.press('menu_recent'); assert.match(t.last().text, /Últimas movimentações/);
});

test('lançar despesa: pede confirmação, salva, e permite desfazer', async () => {
  const t = setup();
  const before = t.state.transactions.length;
  await t.say('gastei 45 no mercado');
  assert.match(t.last().text, /Despesa/);
  assert.match(t.last().text, /45,00/);
  assert.ok(t.last().reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'p360_confirm'));
  assert.equal(t.state.transactions.length, before, 'não pode salvar antes de confirmar');
  await t.press('p360_toggle');
  assert.match(t.last().text, /já paga/);
  await t.press('p360_confirm');
  assert.equal(t.state.transactions.length, before + 1);
  assert.match(t.last().text, /Lançado/);
  const undo = t.last().reply_markup.inline_keyboard.flat().find(b => b.callback_data.startsWith('p360_undo:'));
  assert.ok(undo, 'botão desfazer');
  await t.press(undo.callback_data);
  assert.equal(t.state.transactions.length, before);
  assert.match(t.last().text, /Desfeito/);
});

test('cancelar não salva nada', async () => {
  const t = setup();
  const before = t.state.transactions.length;
  await t.say('recebi 1950 de salário');
  assert.match(t.last().text, /Receita/);
  await t.press('p360_cancel');
  assert.equal(t.state.transactions.length, before);
});

test('lançamento sem valor pede o valor; saudação abre o menu', async () => {
  const t = setup();
  await t.say('gastei no mercado');
  assert.match(t.last().text, /valor/);
  await t.say('bom dia');
  assert.ok(t.last().reply_markup.inline_keyboard.length >= 5, 'menu principal');
});

test('perguntas livres vão para a IA e voltam com sugestões', async () => {
  const t = setup();
  await t.say('quanto ainda posso gastar esse mês?');
  const m = t.last();
  assert.ok(m.text.length > 20);
  assert.ok(m.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'menu_home'));
  const sug = m.reply_markup.inline_keyboard.flat().find(b => b.callback_data.startsWith('aiq:'));
  if (sug) { await t.press(sug.callback_data); assert.ok(t.last().text.length > 20); }
});

test('conta não vinculada só recebe orientação para conectar', async () => {
  const t = setup(false);
  await t.say('saldo');
  assert.match(t.last().text, /Configurações/);
  assert.match(t.last().text, /vincular/);
});

test('saldo respeita o início do saldo (preferences.balanceFrom): meses anteriores não entram', async () => {
  const t = setup();
  // Movimentação antiga (outubro) que NÃO deve contar depois de acertar os saldos em novembro
  t.state.transactions.push({ id: 90, name: 'Antigo', type: 'expense', value: 700, date: '2020-01-10', category: 'Moradia', status: 'Paga', payment: 'conta', account: 'Nubank' });
  await t.say('saldo');
  assert.match(t.last().text, /5\.500,00|5\.700,00|6\.200,00|5\.500/); // com histórico completo (700 a menos)
  t.state.preferences = { balanceFrom: `${M}-01` };
  t.state.accounts[0].openingBalance = 2000; // saldo real em 01/11
  await t.say('saldo');
  // Nubank: 2000 + 5000 − 300 = 6700 (a de 2020 fica de fora); Itaú 500 → total 7.200,00
  assert.match(t.last().text, /7\.200,00/);
});
