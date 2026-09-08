const number = value => Number(value || 0);
const sum = (items, getter) => items.reduce((total, item) => total + number(getter(item)), 0);
const getMonth = transaction => String(transaction?.date || '').slice(0, 7);
const distributionFor = (state, month, income) => { const d = state.preferences?.distribution || {fixed:60, investment:35, leisure:5}; return { fixed: income * Number(d.fixed||0)/100, investment: income * Number(d.investment||0)/100, leisure: income * Number(d.leisure||0)/100 }; };
const norm = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizeStatus = status => String(status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function analyzeFinancialState(state = {}, selectedMonth) {
    const transactions = state.transactions || [];
    const subscriptions = state.subscriptions || [];
    const cards = state.cards || [];
    const budgets = state.budgets || [];
    const monthTransactions = transactions.filter(transaction => getMonth(transaction) === selectedMonth);

    const incomes = monthTransactions.filter(transaction => transaction.type === 'income');
    const incomeTotal = sum(incomes, transaction => transaction.value);
    const receivedIncome = sum(incomes.filter(transaction => {
        const status = normalizeStatus(transaction.status);
        return status === 'recebido' || status === 'recebida' || status === 'pago' || status === 'paga';
    }), transaction => transaction.value);
    const pendingIncome = Math.max(0, incomeTotal - receivedIncome);

    const expenses = monthTransactions.filter(transaction => transaction.type === 'expense');
    const expenseTotal = sum(expenses, transaction => transaction.value);
    const paidExpenses = sum(expenses.filter(transaction => {
        const status = normalizeStatus(transaction.status);
        return status === 'pago' || status === 'paga';
    }), transaction => transaction.value);
    const pendingExpenses = Math.max(0, expenseTotal - paidExpenses);

    const plannedBalance = incomeTotal - expenseTotal;
    const realizedBalance = receivedIncome - paidExpenses;

    const categories = {};
    expenses.forEach(transaction => {
        const category = transaction.category || 'Sem categoria';
        categories[category] = (categories[category] || 0) + number(transaction.value);
    });
    const categoryRanking = Object.entries(categories)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    const monthBudgets = budgets.filter(budget => budget.month === selectedMonth);
    const distribution = distributionFor(state, selectedMonth, incomeTotal);
    const explicitBudgetTotal = sum(monthBudgets, budget => budget.limit);
    const explicitCategories = new Set(monthBudgets.map(b => norm(b.category)));
    const variableAuto = (explicitCategories.has('investimentos') ? 0 : distribution.investment) + (explicitCategories.has('lazer') ? 0 : distribution.leisure);
    const budgetTotal = explicitBudgetTotal + variableAuto;
    const budgetRemaining = budgetTotal - expenseTotal;
    const budgetUsage = budgetTotal > 0 ? expenseTotal / budgetTotal : 0;
    const investmentSpent = expenses.filter(t => norm(t.category) === 'investimentos').reduce((s,t)=>s+number(t.value),0);
    const leisureSpent = expenses.filter(t => norm(t.category) === 'lazer').reduce((s,t)=>s+number(t.value),0);

    const monthlySubscriptions = sum(
        subscriptions.filter(subscription => subscription.active !== false),
        subscription => subscription.monthly || subscription.value
    );

    const creditCardSpending = sum(
        expenses.filter(transaction => transaction.payment === 'cartao'),
        transaction => transaction.value
    );

    const reserve = number(state.reserve?.current ?? state.reserve?.amount);
    const savingsRate = incomeTotal > 0 ? plannedBalance / incomeTotal : 0;
    const expenseRatio = incomeTotal > 0 ? expenseTotal / incomeTotal : 0;
    const fixedCommitmentRatio = incomeTotal > 0 ? monthlySubscriptions / incomeTotal : 0;
    const installmentCommitment = expenses.filter(t => number(t.installments) > 1).reduce((s,t) => s + number(t.value) / Math.max(1, number(t.installments)), 0);
    const installmentRatio = incomeTotal > 0 ? installmentCommitment / incomeTotal : 0;

    return {
        month: selectedMonth,
        income: { total: incomeTotal, received: receivedIncome, pending: pendingIncome },
        expenses: { total: expenseTotal, paid: paidExpenses, pending: pendingExpenses },
        cashflow: { planned: plannedBalance, realized: realizedBalance },
        categories: { ranking: categoryRanking, top: categoryRanking[0] || null },
        budget: { planned: budgetTotal, spent: expenseTotal, remaining: budgetRemaining, usage: budgetUsage },
        distribution: { fixed: distribution.fixed, investment: distribution.investment, leisure: distribution.leisure, investmentSpent, leisureSpent },
        cards: { registered: cards.length, spending: creditCardSpending },
        subscriptions: { monthly: monthlySubscriptions, annual: monthlySubscriptions * 12 },
        reserve: { current: reserve },
        indicators: { savingsRate, expenseRatio, fixedCommitmentRatio, installmentRatio, installmentCommitment }
    };
}
