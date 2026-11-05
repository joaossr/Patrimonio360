// Consultas rápidas do bot do Telegram: tudo calculado a partir dos dados reais da conta
// (nada é inventado). Cada função devolve texto em HTML do Telegram, curto e fácil de ler no celular.

export const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SETTLED = ['Paga', 'Recebida', 'Concluído', 'Pago', 'Recebido'];
const settled = t => SETTLED.includes(String(t?.status || ''));
const fin = state => (Array.isArray(state.transactions) ? state.transactions : []).filter(t => t.type !== 'card_payment' && !t.legacyCardPayment);
const brNow = () => new Date(Date.now() - 3 * 3600e3); // horário de Brasília
export const monthNow = () => brNow().toISOString().slice(0, 7);
export const todayStr = () => brNow().toISOString().slice(0, 10);
const dm = d => { const [, m, day] = String(d || '').split('-'); return day && m ? `${day}/${m}` : '—'; };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthName = ym => { const [y, m] = String(ym).split('-'); return `${MONTHS[Number(m) - 1] || ym} de ${y}`; };
const bar = (pct, size = 10) => { const n = Math.max(0, Math.min(size, Math.round((pct / 100) * size))); return '▰'.repeat(n) + '▱'.repeat(size - n); };
const sum = (list, f = t => Number(t.value || 0)) => list.reduce((a, t) => a + f(t), 0);

// ---- Cálculos ---------------------------------------------------------------
export function accountBalances(state) {
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  const txs = fin(state).filter(t => settled(t) && t.payment !== 'cartao');
  const payments = Array.isArray(state.cardPayments) ? state.cardPayments : [];
  return accounts.map(a => {
    const delta = sum(txs.filter(t => t.account === a.name), t => (t.type === 'income' ? 1 : -1) * Number(t.value || 0))
      - sum(payments.filter(p => p.account === a.name), p => Number(p.value || 0));
    return { name: a.name, balance: Number(a.openingBalance ?? 0) + delta };
  });
}

export function monthTotals(state, month = monthNow()) {
  const list = fin(state).filter(t => String(t.date).slice(0, 7) === month);
  const income = sum(list.filter(t => t.type === 'income'));
  const expense = sum(list.filter(t => t.type === 'expense'));
  const pendingExpense = sum(list.filter(t => t.type === 'expense' && !settled(t)));
  const pendingIncome = sum(list.filter(t => t.type === 'income' && !settled(t)));
  return { income, expense, pendingExpense, pendingIncome, result: income - expense, count: list.length };
}

export function topCategories(state, month = monthNow()) {
  const by = new Map();
  fin(state).filter(t => t.type === 'expense' && String(t.date).slice(0, 7) === month)
    .forEach(t => by.set(t.category || 'Sem categoria', (by.get(t.category || 'Sem categoria') || 0) + Number(t.value || 0)));
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}

export function cardsSummary(state, month = monthNow()) {
  const cards = Array.isArray(state.cards) ? state.cards : [];
  const txs = fin(state).filter(t => t.type === 'expense' && t.payment === 'cartao');
  const paid = Array.isArray(state.cardPayments) ? state.cardPayments : [];
  return cards.map(c => {
    const invoice = sum(txs.filter(t => String(t.cardId) === String(c.id) && String(t.date).slice(0, 7) === month));
    const paidNow = sum(paid.filter(p => String(p.cardId) === String(c.id) && p.month === month), p => Number(p.value || 0));
    const used = sum(txs.filter(t => String(t.cardId) === String(c.id)), t => Number(t.value || 0))
      - sum(paid.filter(p => String(p.cardId) === String(c.id)), p => Number(p.value || 0));
    const limit = Number(c.limit || c.creditLimit || 0);
    return { id: c.id, name: c.name || 'Cartão', bank: c.bank, limit, invoice, open: Math.max(0, invoice - paidNow), used: Math.max(0, used), dueDay: c.dueDay || c.due };
  });
}

export function budgetStatus(state, month = monthNow()) {
  const budgets = (Array.isArray(state.budgets) ? state.budgets : []).filter(b => String(b.month) === month && Number(b.limit) > 0);
  const spent = new Map(topCategories(state, month));
  return budgets.map(b => ({ category: b.category, limit: Number(b.limit), spent: spent.get(b.category) || 0 }))
    .map(b => ({ ...b, pct: (b.spent / b.limit) * 100 })).sort((a, b) => b.pct - a.pct);
}

export function upcoming(state, days = 10) {
  const today = todayStr();
  const end = new Date(brNow().getTime() + days * 864e5).toISOString().slice(0, 10);
  const pend = fin(state).filter(t => !settled(t) && t.payment !== 'cartao');
  return {
    overdue: pend.filter(t => t.date < today).sort((a, b) => a.date.localeCompare(b.date)),
    soon: pend.filter(t => t.date >= today && t.date <= end).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function recent(state, n = 8) {
  return fin(state).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id)).slice(0, n);
}

// ---- Textos ---------------------------------------------------------------
export function textBalance(state) {
  const rows = accountBalances(state);
  if (!rows.length) return '🏦 <b>Saldo</b>\n\nVocê ainda não cadastrou contas no Patrimônio 360.';
  const total = sum(rows, r => r.balance);
  const month = monthTotals(state);
  const lines = rows.map(r => `• ${esc(r.name)}: <b>${money(r.balance)}</b>`).join('\n');
  const free = total - month.pendingExpense + month.pendingIncome;
  return `🏦 <b>Saldo nas contas</b>\n\n${lines}\n\n💼 Total: <b>${money(total)}</b>\n⏳ A pagar neste mês: ${money(month.pendingExpense)}\n✅ Projeção ao fim do mês: <b>${money(free)}</b>`;
}

export function textSummary(state, month = monthNow()) {
  const t = monthTotals(state, month);
  if (!t.count) return `📊 <b>${monthName(month)}</b>\n\nAinda não há movimentações neste mês.`;
  const rate = t.income > 0 ? Math.round((t.result / t.income) * 100) : null;
  const top = topCategories(state, month)[0];
  return `📊 <b>Resumo de ${monthName(month)}</b>\n\n💰 Receitas: <b>${money(t.income)}</b>\n💸 Despesas: <b>${money(t.expense)}</b>\n${t.result >= 0 ? '📈' : '📉'} Resultado: <b>${money(t.result)}</b>${rate !== null ? ` (${rate}% da renda)` : ''}\n⏳ Ainda a pagar: ${money(t.pendingExpense)}${top ? `\n🏷️ Maior gasto: <b>${esc(top[0])}</b> (${money(top[1])})` : ''}`;
}

export function textCategories(state, month = monthNow()) {
  const list = topCategories(state, month);
  if (!list.length) return `🏷️ <b>Gastos por categoria</b>\n\nSem despesas em ${monthName(month)}.`;
  const total = sum(list, ([, v]) => v);
  const lines = list.slice(0, 7).map(([c, v]) => `${bar((v / total) * 100)} <b>${esc(c)}</b>\n      ${money(v)} · ${Math.round((v / total) * 100)}%`).join('\n');
  const more = list.length > 7 ? `\n\n+ ${list.length - 7} categorias menores (${money(sum(list.slice(7), ([, v]) => v))})` : '';
  return `🏷️ <b>Para onde foi o dinheiro</b> · ${monthName(month)}\n\n${lines}${more}\n\nTotal: <b>${money(total)}</b>`;
}

export function textRecent(state, n = 8) {
  const list = recent(state, n);
  if (!list.length) return '🧾 Você ainda não tem movimentações.';
  const lines = list.map(t => `${t.type === 'income' ? '🟢' : '🔴'} ${dm(t.date)} · ${esc(t.name || t.category || 'Movimentação')}\n      <b>${t.type === 'income' ? '+' : '−'} ${money(t.value)}</b>${settled(t) ? '' : ' · pendente'}${t.payment === 'cartao' ? ' · cartão' : ''}`).join('\n');
  return `🧾 <b>Últimas movimentações</b>\n\n${lines}`;
}

export function textUpcoming(state, days = 10) {
  const { overdue, soon } = upcoming(state, days);
  const cards = cardsSummary(state).filter(c => c.open > 0);
  if (!overdue.length && !soon.length && !cards.length) return `📅 <b>Vencimentos</b>\n\nNada pendente nos próximos ${days} dias. 🎉`;
  const row = t => `${t.type === 'income' ? '🟢' : '🔴'} ${dm(t.date)} · ${esc(t.name || t.category)} — <b>${money(t.value)}</b>`;
  let out = `📅 <b>Vencimentos</b> · próximos ${days} dias`;
  if (overdue.length) out += `\n\n⚠️ <b>Atrasados (${overdue.length})</b>\n${overdue.slice(0, 6).map(row).join('\n')}`;
  if (soon.length) out += `\n\n🗓️ <b>A vencer</b>\n${soon.slice(0, 8).map(row).join('\n')}`;
  if (cards.length) out += `\n\n💳 <b>Faturas abertas</b>\n${cards.map(c => `• ${esc(c.name)}: <b>${money(c.open)}</b>`).join('\n')}`;
  return out;
}

export function textCards(state) {
  const cards = cardsSummary(state);
  if (!cards.length) return '💳 Você ainda não cadastrou cartões no Patrimônio 360.';
  const lines = cards.map(c => {
    const pct = c.limit ? Math.round((c.used / c.limit) * 100) : null;
    return `💳 <b>${esc(c.name)}</b>${c.bank ? ` · ${esc(c.bank)}` : ''}\n      Fatura do mês: <b>${money(c.invoice)}</b>${c.open !== c.invoice ? ` (em aberto ${money(c.open)})` : ''}${c.limit ? `\n      Limite: ${money(c.limit)} · usado ${pct}%\n      ${bar(pct)}` : ''}`;
  }).join('\n\n');
  return `💳 <b>Seus cartões</b>\n\n${lines}`;
}

export function textBudget(state, month = monthNow()) {
  const list = budgetStatus(state, month);
  if (!list.length) return `🎯 <b>Orçamento</b>\n\nVocê não definiu limites por categoria em ${monthName(month)}. Defina em <b>Orçamento</b> no app.`;
  const lines = list.map(b => {
    const icon = b.pct >= 100 ? '🔴' : b.pct >= 80 ? '🟡' : '🟢';
    const left = b.limit - b.spent;
    return `${icon} <b>${esc(b.category)}</b> · ${Math.round(b.pct)}%\n      ${bar(b.pct)}\n      ${money(b.spent)} de ${money(b.limit)} — ${left >= 0 ? `sobram <b>${money(left)}</b>` : `estourou em <b>${money(-left)}</b>`}`;
  }).join('\n\n');
  return `🎯 <b>Orçamento</b> · ${monthName(month)}\n\n${lines}`;
}

export function textGoals(state) {
  const goals = Array.isArray(state.goals) ? state.goals : [];
  if (!goals.length) return '🎯 Você ainda não cadastrou metas.';
  const lines = goals.slice(0, 8).map(g => {
    const cur = Number(g.current ?? g.saved ?? 0), tgt = Number(g.target ?? g.goal ?? 0), pct = tgt ? Math.round((cur / tgt) * 100) : 0;
    return `🎯 <b>${esc(g.name || 'Meta')}</b> · ${pct}%\n      ${bar(pct)}\n      ${money(cur)} de ${money(tgt)}`;
  }).join('\n\n');
  return `🎯 <b>Suas metas</b>\n\n${lines}`;
}

export function textReserve(state) {
  const r = state.reserve || {};
  const cur = Number(r.current || 0), tgt = Number(r.target || 0);
  const pct = tgt ? Math.round((cur / tgt) * 100) : null;
  return `🛡️ <b>Reserva de emergência</b>\n\nAtual: <b>${money(cur)}</b>${tgt ? `\nMeta: <b>${money(tgt)}</b>\n${bar(pct)} ${pct}%\nFaltam: <b>${money(Math.max(0, tgt - cur))}</b>` : '\n\nDefina uma meta de reserva no app para acompanhar o progresso.'}`;
}

export function textInvestments(state) {
  const list = Array.isArray(state.investments) ? state.investments : [];
  if (!list.length) return '📈 Você ainda não cadastrou investimentos.';
  const val = x => Number(x.current ?? x.currentValue ?? x.value ?? x.amount ?? 0);
  const total = sum(list, val);
  const lines = list.slice().sort((a, b) => val(b) - val(a)).slice(0, 6).map(x => `• ${esc(x.name || x.title || 'Ativo')}: <b>${money(val(x))}</b>`).join('\n');
  return `📈 <b>Investimentos</b>\n\n${lines}${list.length > 6 ? `\n… e mais ${list.length - 6}` : ''}\n\nTotal: <b>${money(total)}</b> em ${list.length} ativo${list.length > 1 ? 's' : ''}`;
}
