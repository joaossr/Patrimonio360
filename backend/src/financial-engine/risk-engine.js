export function calculateFinancialRisk(analysis = {}) {
    const income = analysis.income?.total || 0;
    const expenses = analysis.expenses?.total || 0;
    const pending = analysis.expenses?.pending || 0;
    const reserve = analysis.reserve?.current || 0;
    const subscriptions = analysis.subscriptions?.monthly || 0;
    const installmentRatio = analysis.indicators?.installmentRatio || 0;
    let score = 0;
    const reasons = [];

    if (expenses > income && income > 0) { score += 40; reasons.push('As despesas do mês estão acima das receitas.'); }
    else if (income > 0 && expenses / income >= 0.8) { score += 20; reasons.push('As despesas consomem pelo menos 80% da renda considerada.'); }
    if (income > 0 && pending / income > 0.30) { score += 15; reasons.push('Há um volume relevante de despesas ainda pendentes.'); }
    if (expenses > 0 && reserve < expenses) { score += 15; reasons.push('A reserva atual não cobre um mês das despesas registradas.'); }
    if (income > 0 && subscriptions / income > 0.15) { score += 10; reasons.push('As assinaturas representam uma parcela elevada da renda.'); }
    if (installmentRatio > 0.25) { score += 20; reasons.push('Parcelamentos registrados comprometem mais de 25% da renda considerada.'); }

    score = Math.min(score, 100);
    const level = score >= 75 ? 'crítico' : score >= 50 ? 'elevado' : score >= 25 ? 'atenção' : 'baixo';
    return { score, level, reasons };
}
