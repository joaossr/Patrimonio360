import { parseDateMonth } from './value-parser.js';

const n = v => Number(v || 0);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const monthOf = t => String(t?.date || '').slice(0, 7);
const settled = t => ['pago','paga','recebido','recebida','confirmado','confirmada','concluido','concluida'].includes(norm(t?.status));

export function transactionsForMonth(state, month) {
  return (state.transactions || []).filter(t => monthOf(t) === month);
}

export function historicalContext(state, requestedMonth) {
  const transactions = transactionsForMonth(state, requestedMonth);
  const income = transactions.filter(t => t.type === 'income').reduce((s,t)=>s+n(t.value),0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s,t)=>s+n(t.value),0);
  const received = transactions.filter(t => t.type === 'income' && settled(t)).reduce((s,t)=>s+n(t.value),0);
  const paid = transactions.filter(t => t.type === 'expense' && settled(t)).reduce((s,t)=>s+n(t.value),0);
  return { month: requestedMonth, found: transactions.length > 0, income, expense, received, paid, planned: income-expense, realized: received-paid, transactions };
}

export function buildFinancialContext(state = {}, month, memory = {}) {
  const tx = transactionsForMonth(state, month);
  const income = tx.filter(t=>t.type==='income').reduce((s,t)=>s+n(t.value),0);
  const expenses = tx.filter(t=>t.type==='expense').reduce((s,t)=>s+n(t.value),0);
  const received = tx.filter(t=>t.type==='income'&&settled(t)).reduce((s,t)=>s+n(t.value),0);
  const paid = tx.filter(t=>t.type==='expense'&&settled(t)).reduce((s,t)=>s+n(t.value),0);
  const categories = {};
  tx.filter(t=>t.type==='expense').forEach(t=>categories[t.category||'Sem categoria']=(categories[t.category||'Sem categoria']||0)+n(t.value));
  const goals = (state.goals||[]).map(g=>({ ...g, current:n(g.current), target:n(g.target), remaining:Math.max(0,n(g.target)-n(g.current)) }));
  const investments = state.investments||[];
  const cards = state.cards||[];
  const reserve = n(state.reserve?.current ?? state.reserve?.amount);
  const accounts = state.accounts||[];
  const accountBalance = accounts.reduce((s,a)=>s+n(a.balance ?? a.saldo ?? a.current),0);
  const upcoming = (state.transactions||[]).filter(t=>!settled(t)&&String(t.date||'')>=new Date().toISOString().slice(0,10)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const next30 = upcoming.filter(t=>String(t.date).slice(0,10) <= new Date(Date.now()+30*86400000).toISOString().slice(0,10));
  const futurePay = next30.filter(t=>t.type==='expense').reduce((s,t)=>s+n(t.value),0);
  const futureReceive = next30.filter(t=>t.type==='income').reduce((s,t)=>s+n(t.value),0);
  return {
    month,
    current: { income, expenses, received, paid, planned:income-expenses, realized:received-paid, pendingExpense:expenses-paid, pendingIncome:income-received },
    categories: Object.entries(categories).sort((a,b)=>b[1]-a[1]),
    goals,
    investments,
    cards,
    reserve,
    accounts,
    accountBalance,
    next30,
    future: { pay:futurePay, receive:futureReceive, net:futureReceive-futurePay },
    memory
  };
}

export function resolveRequestedMonth(question, currentMonth) {
  const explicit = parseDateMonth(question, new Date(`${currentMonth}-01T12:00:00`));
  return explicit || currentMonth;
}
