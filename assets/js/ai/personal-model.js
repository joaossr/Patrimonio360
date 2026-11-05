// P360 Mind — modelo pessoal: aprende com o histórico de CADA usuário.
// É retreinado a partir das movimentações sempre que os dados mudam (leva milissegundos),
// então fica mais preciso conforme o usuário usa o sistema. Nada é compartilhado entre usuários.
import { NaiveBayes } from './nlu.js';
import { normalize, words, shiftMonth } from './text.js';

const SETTLED = new Set(['Paga', 'Recebida', 'Concluído', 'Pago', 'Recebido']);
export const isSettled = t => SETTLED.has(String(t?.status || ''));
const val = t => Math.abs(Number(t?.value || 0)) || 0;
const monthOf = t => String(t?.date || '').slice(0, 7);
const isReserveIn = t => t.allocationType === 'reserve' && t.type === 'expense';
const isReserveOut = t => t.allocationType === 'reserve_withdrawal' || (t.allocationType === 'reserve' && (t.reserveAction === 'withdrawal' || t.type === 'income'));

export function financialTx(state) {
  return (state.transactions || []).filter(t => t && t.type !== 'card_payment' && !t.legacyCardPayment && /^\d{4}-\d{2}/.test(String(t.date || '')));
}

// ---- Fotografia financeira (mesmas regras do app) ---------------------------
export function snapshot(state, month, today = new Date()) {
  const tx = financialTx(state);
  const inMonth = tx.filter(t => monthOf(t) === month);
  const sum = list => list.reduce((a, t) => a + val(t), 0);
  const income = sum(inMonth.filter(t => t.type === 'income'));
  const expenses = sum(inMonth.filter(t => t.type === 'expense'));
  const pendingIn = sum(inMonth.filter(t => t.type === 'income' && !isSettled(t)));
  const pendingOut = sum(inMonth.filter(t => t.type === 'expense' && !isSettled(t)));

  const accounts = (state.accounts || []).map(a => {
    let bal = Number(a.openingBalance ?? a.initialBalance ?? 0) || 0;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(state.preferences?.balanceFrom || '')) ? state.preferences.balanceFrom : '';
    (state.transactions || []).forEach(t => {
      if (t.account !== a.name || !isSettled(t) || t.payment === 'cartao' || t.type === 'card_payment' || t.legacyCardPayment) return;
      if (from && String(t.date || '') < from) return;
      bal += t.type === 'income' ? val(t) : -val(t);
    });
    (state.cardPayments || []).forEach(p => { if (p.account === a.name && (!from || String(p.date || '') >= from)) bal -= val(p); });
    return { name: a.name, balance: bal };
  });
  const balance = accounts.reduce((a, x) => a + x.balance, 0);

  const cards = (state.cards || []).map(c => {
    const invoice = sum(tx.filter(t => t.type === 'expense' && t.payment === 'cartao' && String(t.cardId) === String(c.id) && monthOf(t) === month));
    const paid = (state.cardPayments || []).filter(p => String(p.cardId) === String(c.id) && p.month === month).reduce((a, p) => a + val(p), 0);
    const futureOpen = sum(tx.filter(t => t.type === 'expense' && t.payment === 'cartao' && String(t.cardId) === String(c.id) && monthOf(t) >= month))
      - (state.cardPayments || []).filter(p => String(p.cardId) === String(c.id) && p.month >= month).reduce((a, p) => a + val(p), 0);
    const limit = Number(c.limit || 0);
    const open = Math.max(0, invoice - paid);
    return { id: c.id, name: c.name || c.bank || 'Cartão', limit, invoice: open, due: c.due, used: limit ? Math.max(0, futureOpen) / limit : 0, available: Math.max(0, limit - Math.max(0, futureOpen)) };
  });

  let reserve = 0;
  tx.forEach(t => { if (!isSettled(t)) return; if (isReserveOut(t)) reserve -= val(t); else if (isReserveIn(t)) reserve += val(t); });
  const investments = (state.investments || []).reduce((a, i) => a + Number(i.current || i.invested || 0), 0);

  const byCategory = {};
  inMonth.filter(t => t.type === 'expense').forEach(t => { const c = t.category || 'Sem categoria'; byCategory[c] = (byCategory[c] || 0) + val(t); });

  // Limites: manuais do mês + Investimentos/Lazer pela distribuição da renda (igual ao Orçamento).
  const dist = state.preferences?.distribution || { fixed: 60, investment: 35, leisure: 5 };
  const limits = {};
  (state.budgets || []).filter(b => String(b.month) === month).forEach(b => { limits[b.category] = Number(b.limit || 0); });
  if (income > 0) { limits.Investimentos = income * Number(dist.investment || 0) / 100; limits.Lazer = income * Number(dist.leisure || 0) / 100; }

  const start = new Date(today); start.setHours(0, 0, 0, 0);
  const upcoming = days => {
    const end = new Date(start); end.setDate(end.getDate() + days);
    return tx.filter(t => { if (isSettled(t)) return false; const d = new Date(t.date + 'T12:00:00'); return d >= start && d <= end; })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };
  const overdue = tx.filter(t => !isSettled(t) && new Date(t.date + 'T12:00:00') < start).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const subs = (state.subscriptions || []).filter(s => String(s.status || 'Ativa').toLowerCase() === 'ativa');
  return {
    month, income, expenses, result: income - expenses, pendingIn, pendingOut, accounts, balance, cards, reserve, investments,
    byCategory, limits, upcoming, overdue, subscriptions: subs, subscriptionsMonthly: subs.reduce((a, s) => a + Number(s.monthly ?? s.value ?? 0), 0),
    goals: (state.goals || []).map(g => ({ ...g, current: Number(g.current || 0), target: Number(g.target || 0) })),
    reserveTarget: Number(state.reserve?.target || 0), essential: Number(state.reserve?.essential || 0),
    txCount: inMonth.length
  };
}

// ---- Estatística simples e robusta ---------------------------------------
function ewma(values, alpha = 0.4) { let m = null; values.forEach(v => { m = m == null ? v : alpha * v + (1 - alpha) * m; }); return m ?? 0; }
function stdev(values) { if (values.length < 2) return 0; const m = values.reduce((a, b) => a + b, 0) / values.length; return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1)); }
function slope(values) { const n = values.length; if (n < 3) return 0; const xm = (n - 1) / 2, ym = values.reduce((a, b) => a + b, 0) / n; let num = 0, den = 0; values.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; }); return den ? num / den : 0; }
function median(values) { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const merchantKey = name => words(String(name || '').replace(/\(\d+\/\d+\)/, '')).filter(w => !/^\d+$/.test(w)).slice(0, 3).join(' ');

// ---- Treino do modelo pessoal ---------------------------------------------
export function trainPersonalModel(state, { month, today = new Date() } = {}) {
  const tx = financialTx(state);
  const currentMonth = month || today.toISOString().slice(0, 7);
  // Meses de histórico COMPLETOS antes do mês analisado (no máximo 12): base do aprendizado.
  const allMonths = [...new Set(tx.map(monthOf))].sort();
  const history = allMonths.filter(m => m < currentMonth).slice(-12);

  // 1) Classificador de categorias: aprende "descrição -> categoria" com cada lançamento do usuário.
  const categorizer = new NaiveBayes();
  let catExamples = 0;
  tx.forEach(t => {
    const c = String(t.category || '').trim();
    if (!c || c === 'Sem categoria' || !t.name) return;
    categorizer.learn(String(t.name).replace(/\(\d+\/\d+\)/, ''), `${t.type === 'income' ? 'income' : 'expense'}|${c}`);
    catExamples++;
  });

  // 2) Perfil de gastos por categoria: média ponderada (meses recentes pesam mais), desvio e tendência.
  const catMonthly = {};
  tx.filter(t => t.type === 'expense').forEach(t => {
    const c = t.category || 'Sem categoria', m = monthOf(t);
    ((catMonthly[c] ||= {})[m] = (catMonthly[c][m] || 0) + val(t));
  });
  const categories = {};
  Object.entries(catMonthly).forEach(([c, byMonth]) => {
    const series = history.map(m => byMonth[m] || 0);
    const active = series.filter(v => v > 0).length;
    categories[c] = {
      typical: ewma(series), mean: series.length ? series.reduce((a, b) => a + b, 0) / series.length : 0, std: stdev(series),
      trend: slope(series.slice(-6)), months: series.length, activeMonths: active, current: byMonth[currentMonth] || 0,
      txMedian: median(tx.filter(t => t.type === 'expense' && (t.category || 'Sem categoria') === c && monthOf(t) < currentMonth).map(val))
    };
  });

  // 3) Renda: média, estabilidade (coeficiente de variação) e dia em que costuma cair.
  const incomeSeries = history.map(m => tx.filter(t => t.type === 'income' && monthOf(t) === m && !isReserveOut(t)).reduce((a, t) => a + val(t), 0));
  const incomeMean = incomeSeries.length ? incomeSeries.reduce((a, b) => a + b, 0) / incomeSeries.length : 0;
  const incomeCV = incomeMean ? stdev(incomeSeries) / incomeMean : 0;
  const payDays = tx.filter(t => t.type === 'income' && val(t) >= incomeMean * 0.4).map(t => Number(String(t.date).slice(8, 10)));
  const income = { typical: ewma(incomeSeries), mean: incomeMean, stability: incomeSeries.length < 2 ? 'desconhecida' : incomeCV < 0.12 ? 'estável' : incomeCV < 0.35 ? 'variável' : 'muito variável', cv: incomeCV, payDay: payDays.length ? Math.round(median(payDays)) : null };
  const expenseSeries = history.map(m => tx.filter(t => t.type === 'expense' && monthOf(t) === m).reduce((a, t) => a + val(t), 0));
  const expense = { typical: ewma(expenseSeries), mean: expenseSeries.length ? expenseSeries.reduce((a, b) => a + b, 0) / expenseSeries.length : 0, trend: slope(expenseSeries.slice(-6)) };

  // 4) Gastos recorrentes: mesmo "estabelecimento" em vários meses com valor parecido.
  const groups = {};
  tx.filter(t => t.type === 'expense' && history.slice(-6).includes(monthOf(t)) && !t.installmentIndex).forEach(t => {
    const k = merchantKey(t.name); if (!k) return;
    (groups[k] ||= []).push(t);
  });
  const subNames = new Set((state.subscriptions || []).map(s => merchantKey(s.name)));
  const recurring = Object.entries(groups).map(([k, list]) => {
    const months = new Set(list.map(monthOf));
    const values = list.map(val), avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { key: k, name: list[list.length - 1].name, months: months.size, avg, cv: avg ? stdev(values) / avg : 1, day: Math.round(median(list.map(t => Number(String(t.date).slice(8, 10))))), category: list[0].category, isSubscription: subNames.has(k) };
  }).filter(r => r.months >= 3 && r.cv < 0.3 && r.months >= Math.min(3, history.slice(-6).length)).sort((a, b) => b.avg - a.avg);

  // 5) Hábitos: compras pequenas frequentes, uso do cartão, fim de semana.
  const recentTx = tx.filter(t => t.type === 'expense' && history.slice(-3).includes(monthOf(t)));
  const nMonths = Math.max(1, Math.min(3, history.length));
  const small = recentTx.filter(t => val(t) < 50);
  const card = recentTx.filter(t => t.payment === 'cartao').reduce((a, t) => a + val(t), 0);
  const total = recentTx.reduce((a, t) => a + val(t), 0);
  const weekend = recentTx.filter(t => [0, 6].includes(new Date(t.date + 'T12:00:00').getDay())).reduce((a, t) => a + val(t), 0);
  const savingsRates = history.slice(-3).map(m => { const i = history.indexOf(m), inc = incomeSeries[i] || 0, exp = expenseSeries[i] || 0; return inc ? (inc - exp) / inc : null; }).filter(v => v != null);
  const merchants = {};
  recentTx.forEach(t => { const k = merchantKey(t.name); if (k) merchants[k] = (merchants[k] || 0) + val(t); });
  const habits = {
    smallPerMonth: small.length / nMonths, smallTotalPerMonth: small.reduce((a, t) => a + val(t), 0) / nMonths,
    cardShare: total ? card / total : 0, weekendShare: total ? weekend / total : 0,
    savingsRate: savingsRates.length ? savingsRates.reduce((a, b) => a + b, 0) / savingsRates.length : null,
    topMerchants: Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ name, perMonth: value / nMonths }))
  };

  return {
    trainedAt: new Date().toISOString(), month: currentMonth, historyMonths: history.length, transactions: tx.length, categorizerExamples: catExamples,
    categorizer, categories, income, expense, recurring, habits,
    maturity: history.length >= 6 ? 'alta' : history.length >= 3 ? 'média' : history.length >= 1 ? 'inicial' : 'sem histórico'
  };
}

// Sugere a categoria de uma nova movimentação a partir do que o usuário já lançou.
export function suggestCategory(pm, name, type = 'expense') {
  if (!pm?.categorizer || pm.categorizerExamples < 3 || !normalize(name)) return null;
  const preds = pm.categorizer.predict(name).filter(p => p.intent.startsWith(type === 'income' ? 'income|' : 'expense|'));
  if (!preds.length || !preds[0].known) return null;
  const sum = preds.reduce((a, p) => a + p.confidence, 0);
  const top = preds[0], conf = sum ? top.confidence / sum : 0;
  return conf >= 0.55 ? { category: top.intent.split('|')[1], confidence: conf } : null;
}

// ---- Previsão de fechamento do mês -----------------------------------------
export function forecastMonth(state, pm, snap, today = new Date()) {
  const [y, m] = snap.month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const nowMonth = today.toISOString().slice(0, 7);
  const elapsed = snap.month < nowMonth ? daysInMonth : snap.month > nowMonth ? 0 : today.getDate();
  const remaining = Math.max(0, (daysInMonth - elapsed) / daysInMonth);
  // Para cada categoria: o que já está lançado + o que costuma faltar, proporcional aos dias restantes.
  const lines = [];
  let projectedExpenses = 0;
  const cats = new Set([...Object.keys(snap.byCategory), ...Object.keys(pm.categories).filter(c => pm.categories[c].activeMonths >= Math.max(2, pm.historyMonths / 2))]);
  cats.forEach(c => {
    const registered = snap.byCategory[c] || 0, typical = pm.categories[c]?.typical || 0;
    const projected = registered + Math.max(0, typical - registered) * remaining;
    projectedExpenses += projected;
    if (projected - registered > 1) lines.push({ category: c, registered, projected });
  });
  const projectedIncome = snap.income + Math.max(0, (pm.income.typical || 0) - snap.income) * (pm.income.stability === 'estável' ? (elapsed < (pm.income.payDay || 1) ? 1 : 0) : remaining);
  return { daysInMonth, elapsed, remaining, projectedIncome, projectedExpenses, projectedResult: projectedIncome - projectedExpenses, extra: lines.sort((a, b) => (b.projected - b.registered) - (a.projected - a.registered)) };
}

// ---- Detecção de anomalias ----------------------------------------------------
export function detectAnomalies(state, pm, snap) {
  const out = [];
  if (pm.historyMonths >= 2) {
    Object.entries(snap.byCategory).forEach(([c, spent]) => {
      const st = pm.categories[c];
      if (!st || st.activeMonths < 2) return;
      const limit = st.mean + 2 * st.std;
      if (spent > limit && spent > st.mean * 1.3 && spent - st.mean > 50) out.push({ level: spent > st.mean * 2 ? 'danger' : 'warning', kind: 'category', category: c, spent, usual: st.typical, text: `${c} está em ${brl(spent)}, bem acima do seu normal (${brl(st.typical)}/mês).` });
    });
  }
  financialTx(state).filter(t => t.type === 'expense' && monthOf(t) === snap.month).forEach(t => {
    const st = pm.categories[t.category || 'Sem categoria'];
    if (st && st.txMedian > 0 && val(t) > st.txMedian * 3 && val(t) > 150) out.push({ level: 'warning', kind: 'transaction', category: t.category, spent: val(t), text: `"${t.name}" (${brl(val(t))}) é ${Math.round(val(t) / st.txMedian)}x maior que um gasto típico seu em ${t.category}.` });
  });
  Object.entries(snap.limits).forEach(([c, lim]) => {
    const spent = snap.byCategory[c] || 0;
    if (lim > 0 && spent > lim) out.push({ level: 'danger', kind: 'budget', category: c, spent, text: `Orçamento de ${c} estourado: ${brl(spent)} de ${brl(lim)}.` });
    else if (lim > 0 && spent / lim >= 0.85) out.push({ level: 'warning', kind: 'budget', category: c, spent, text: `${c} já usou ${Math.round(spent / lim * 100)}% do limite (${brl(spent)} de ${brl(lim)}).` });
  });
  if (snap.overdue.length) out.push({ level: 'danger', kind: 'overdue', text: `${snap.overdue.length} lançamento(s) vencido(s) ainda pendente(s), somando ${brl(snap.overdue.reduce((a, t) => a + val(t), 0))}.` });
  const seen = new Set();
  return out.filter(a => { const k = a.kind + a.category + a.text; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.level === 'danger' ? 0 : 1) - (b.level === 'danger' ? 0 : 1));
}

// ---- Índice de saúde financeira (0 a 100), com os motivos ------------------------
export function healthScore(snap, pm) {
  const parts = [];
  const inc = snap.income || pm.income.typical;
  const rate = inc ? (inc - (snap.expenses || pm.expense.typical)) / inc : null;
  parts.push({ label: 'Sobra do mês', points: rate == null ? 10 : rate >= 0.2 ? 30 : rate >= 0.1 ? 22 : rate >= 0 ? 14 : 0, max: 30, detail: rate == null ? 'sem renda registrada' : `${Math.round(rate * 100)}% da renda` });
  const essential = snap.essential || pm.expense.typical || 0;
  const cover = essential ? snap.reserve / essential : 0;
  parts.push({ label: 'Reserva de emergência', points: cover >= 6 ? 25 : cover >= 3 ? 18 : cover >= 1 ? 10 : cover > 0 ? 5 : 0, max: 25, detail: essential ? `${cover.toFixed(1).replace('.', ',')} meses de despesas` : 'sem despesa essencial definida' });
  const maxUse = Math.max(0, ...snap.cards.map(c => c.used));
  parts.push({ label: 'Uso do cartão', points: !snap.cards.length ? 15 : maxUse < 0.3 ? 15 : maxUse < 0.6 ? 10 : maxUse < 0.9 ? 5 : 0, max: 15, detail: snap.cards.length ? `${Math.round(maxUse * 100)}% do limite no cartão mais usado` : 'sem cartões' });
  const over = Object.entries(snap.limits).filter(([c, l]) => l > 0 && (snap.byCategory[c] || 0) > l).length;
  parts.push({ label: 'Orçamento', points: !Object.keys(snap.limits).length ? 8 : over === 0 ? 15 : over === 1 ? 8 : 0, max: 15, detail: Object.keys(snap.limits).length ? `${over} categoria(s) acima do limite` : 'sem limites definidos' });
  parts.push({ label: 'Contas em dia', points: snap.overdue.length ? 0 : 15, max: 15, detail: snap.overdue.length ? `${snap.overdue.length} pendência(s) vencida(s)` : 'nada vencido' });
  const score = parts.reduce((a, p) => a + p.points, 0);
  return { score, level: score >= 80 ? 'ótima' : score >= 65 ? 'boa' : score >= 45 ? 'de atenção' : 'crítica', parts };
}

export function brl(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
export { shiftMonth, monthOf };
