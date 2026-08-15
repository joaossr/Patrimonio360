const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round(n(value) * 100) / 100;

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthsUntil(deadline, now = new Date()) {
  if (!/^\d{4}-\d{2}$/.test(String(deadline || ''))) return null;
  const [year, month] = String(deadline).split('-').map(Number);
  return Math.max(1, (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1)) + 1);
}

export function simulatePurchase({ analysis = {}, goal = null, purchase = {}, now = new Date() } = {}) {
  const income = n(analysis.income?.total);
  const expenses = n(analysis.expenses?.total);
  const reserve = n(analysis.reserve?.current);
  const currentMargin = money(n(analysis.cashflow?.planned ?? income - expenses));
  const total = money(purchase.total);
  const installments = Math.max(1, Math.floor(n(purchase.installments) || 1));
  const monthly = money(installments > 1 ? total / installments : total);
  const simulatedMargin = money(currentMargin - monthly);
  const goalRemaining = goal ? Math.max(0, n(goal.target) - n(goal.current)) : null;
  const deadlineMonths = goal ? monthsUntil(goal.date || goal.deadline, now) : null;
  const baselineGoalMonthly = goal && deadlineMonths ? money(goalRemaining / deadlineMonths) : null;
  const projectedGoalMonthly = goal && deadlineMonths ? money((goalRemaining + total) / deadlineMonths) : null;

  return {
    type: 'purchase',
    month: monthKey(now),
    total,
    installments,
    monthly,
    currentMargin,
    simulatedMargin,
    reserveBefore: reserve,
    reserveAfter: money(reserve - (installments === 1 ? total : 0)),
    goal: goal ? {
      name: goal.name || 'Meta ativa',
      target: n(goal.target),
      current: n(goal.current),
      remaining: goalRemaining,
      deadline: goal.date || goal.deadline || null,
      months: deadlineMonths,
      baselineMonthly: baselineGoalMonthly,
      projectedMonthly: projectedGoalMonthly,
      impact: money(projectedGoalMonthly != null && baselineGoalMonthly != null ? projectedGoalMonthly - baselineGoalMonthly : 0)
    } : null,
    assumptions: [
      'A simulação não altera os dados reais do usuário.',
      `A parcela considerada é ${monthly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por mês.`,
      'Não foram inventados juros, rendimentos ou despesas que não estejam nos dados fornecidos.'
    ]
  };
}

export function simulateIncomeChange({ analysis = {}, delta = 0 } = {}) {
  const income = n(analysis.income?.total);
  const expenses = n(analysis.expenses?.total);
  const nextIncome = money(income + n(delta));
  return {
    type: 'income-change',
    currentIncome: money(income),
    delta: money(delta),
    simulatedIncome: nextIncome,
    currentMargin: money(income - expenses),
    simulatedMargin: money(nextIncome - expenses),
    assumptions: ['Despesas atuais permanecem constantes.', 'A simulação não altera receitas reais cadastradas.']
  };
}

export function simulateExtraIncome({ analysis = {}, amount = 0 } = {}) {
  return simulateIncomeChange({ analysis, delta: Math.abs(n(amount)) });
}

export function simulateContribution({ analysis = {}, goal = null, amount = 0, now = new Date() } = {}) {
  const value = Math.abs(n(amount));
  const reserve = n(analysis.reserve?.current);
  const currentMargin = n(analysis.cashflow?.planned ?? n(analysis.income?.total) - n(analysis.expenses?.total));
  const remaining = goal ? Math.max(0, n(goal.target) - n(goal.current)) : null;
  const after = goal ? Math.max(0, remaining - value) : null;
  const months = goal ? monthsUntil(goal.date || goal.deadline, now) : null;
  return {
    type: 'contribution',
    amount: money(value),
    currentMargin: money(currentMargin),
    simulatedMargin: money(currentMargin - value),
    reserveBefore: money(reserve),
    reserveAfter: money(reserve + value),
    goal: goal ? { name: goal.name || 'Meta ativa', remainingBefore: money(remaining), remainingAfter: money(after), deadline: goal.date || goal.deadline || null, months, monthlyNeededAfter: months ? money(after / months) : null } : null,
    assumptions: ['O aporte é tratado como uma simulação temporária.', 'Nenhum dado real é alterado.']
  };
}
