import { parseFinancialValue } from './value-parser.js';

const n = v => Number(v || 0);
const money = v => n(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export function evaluatePurchase(question, context, memory = {}) {
  const parsed = parseFinancialValue(question);
  const value = parsed.total;
  const installments = parsed.installments || 1;
  if (!value) return { ok:false, reason:'Valor da compra não identificado.' };
  const monthly = parsed.installmentValue;
  const current = context.current || {};
  const budgetRemaining = context.budget?.remaining ?? null;
  const future = context.future || {pay:0,receive:0,net:0};
  const reserve = n(context.reserve);
  const goals = (context.goals || []).filter(g=>g.remaining>0).sort((a,b)=>a.remaining-b.remaining);
  const goal = goals.find(g=>g.priority==='Alta') || goals[0] || null;
  const reasons=[];
  if (budgetRemaining != null && monthly > budgetRemaining) reasons.push(`a margem do orçamento é ${money(budgetRemaining)} e o impacto mensal seria ${money(monthly)}`);
  if (current.planned - monthly < 0) reasons.push(`o resultado planejado do mês ficaria negativo em ${money(Math.abs(current.planned-monthly))}`);
  if (future.net < 0 && future.net-monthly < 0) reasons.push(`os próximos 30 dias já têm fluxo líquido negativo de ${money(Math.abs(future.net))}`);
  if (installments===1 && value>reserve && reserve>0) reasons.push(`a compra à vista supera sua reserva atual de ${money(reserve)}`);
  let goalImpact = null;
  if (goal) {
    const share = goal.remaining ? value/goal.remaining : 0;
    goalImpact = { name:goal.name, remaining:goal.remaining, share };
    if (share >= .25) reasons.push(`o valor representa ${(share*100).toFixed(1).replace('.',',')}% do que falta para a meta ${goal.name}`);
  }
  const risk = reasons.length >= 3 || current.planned-monthly < 0 ? 'crítico' : reasons.length===2 ? 'elevado' : reasons.length===1 ? 'atenção' : 'baixo';
  const verdict = risk==='crítico' ? 'Eu evitaria agora.' : risk==='elevado' ? 'Eu teria bastante cautela.' : risk==='atenção' ? 'É possível, mas eu faria com cautela.' : 'Pelos dados disponíveis, parece administrável.';
  return { ok:true, value, installments, monthly, risk, verdict, reasons, goalImpact, budgetRemaining, future, reserve };
}

export function explainPurchase(result) {
  if (!result?.ok) return result?.reason || 'Não consegui interpretar a compra.';
  const lines=[`**${result.verdict}**`,`Compra: ${money(result.value)}${result.installments>1?` em ${result.installments}x de ${money(result.monthly)}`:' à vista'}.`,`Impacto mensal: ${money(result.monthly)}.`];
  if (result.budgetRemaining != null) lines.push(`Margem do orçamento antes da compra: ${money(result.budgetRemaining)}.`);
  lines.push(`Reserva de emergência: ${money(result.reserve)}.`);
  lines.push(`Próximos 30 dias: ${money(result.future.receive)} a receber e ${money(result.future.pay)} a pagar.`);
  if (result.goalImpact) lines.push(`Meta relacionada: ${result.goalImpact.name}; faltam ${money(result.goalImpact.remaining)}.`);
  if (result.reasons.length) lines.push(`**Por que:** ${result.reasons.slice(0,4).join('; ')}.`);
  if (result.goalImpact?.share >= .25) lines.push('A decisão continua sendo sua; a recomendação é mostrar o custo de oportunidade e oferecer alternativas, não proibir a compra.');
  return lines.join('\n');
}
