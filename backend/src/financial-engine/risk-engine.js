export function calculateFinancialRisk(analysis = {}) {
  const income = Number(analysis.income?.total || 0);
  const expenses = Number(analysis.expenses?.total || 0);
  const pending = Number(analysis.expenses?.pending || 0);
  const reserve = Number(analysis.reserve?.current || 0);
  const subscriptions = Number(analysis.subscriptions?.monthly || 0);
  const installmentRatio = Number(analysis.indicators?.installmentRatio || 0);
  const future = Number(analysis.cashflow?.futureExpense || analysis.cashflow?.future?.pay || 0);
  const scoreParts = [];
  let score = 0;
  const reasons = [];
  const add = (points, reason) => { score += points; reasons.push(reason); scoreParts.push({ points, reason }); };

  if (income > 0 && expenses > income) add(35, 'As despesas do período estão acima das receitas.');
  else if (income > 0 && expenses / income >= 0.8) add(20, 'As despesas consomem pelo menos 80% da renda considerada.');
  if (income > 0 && pending / income > 0.30) add(12, 'Há um volume relevante de despesas ainda pendentes.');
  if (expenses > 0 && reserve < expenses) add(12, 'A reserva atual não cobre um mês das despesas registradas.');
  if (income > 0 && subscriptions / income > 0.15) add(8, 'Assinaturas representam parcela elevada da renda.');
  if (installmentRatio > 0.25) add(15, 'Parcelamentos comprometem mais de 25% da renda considerada.');
  if (future > 0 && income > 0 && future > income * 1.2) add(10, 'Compromissos futuros relevantes pressionam a margem de caixa.');

  score = Math.min(score, 100);
  const level = score >= 70 ? 'crítico' : score >= 45 ? 'elevado' : score >= 20 ? 'atenção' : 'baixo';
  return { score, level, reasons, scoreParts, explanation: reasons.length ? reasons.join(' ') : 'Não encontrei sinais relevantes de risco nos dados disponíveis.' };
}
