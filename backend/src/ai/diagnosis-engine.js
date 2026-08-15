const n=v=>Number(v||0);
const money=v=>n(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export function classifyRisk(context) {
  const income=n(context.current?.income), expense=n(context.current?.expenses), planned=n(context.current?.planned), reserve=n(context.reserve);
  const future=context.future||{pay:0,receive:0,net:0};
  const installment=context.analysis?.indicators?.installmentRatio||0;
  const goalPressure=(context.goals||[]).some(g=>g.remaining>0 && g.priority==='Alta');
  let score=0, reasons=[];
  if(income>0&&expense>income){score+=40;reasons.push('despesas acima da renda');}
  else if(income>0&&expense/income>=.8){score+=20;reasons.push('despesas consumindo pelo menos 80% da renda');}
  if(planned<0){score+=25;reasons.push('resultado mensal planejado negativo');}
  if(future.net<0){score+=15;reasons.push('fluxo dos próximos 30 dias negativo');}
  if(income>0&&installment>.25){score+=15;reasons.push('parcelamentos acima de 25% da renda');}
  if(income>0&&reserve<expense){score+=10;reasons.push('reserva inferior a um mês de despesas registradas');}
  if(goalPressure&&planned<=0){score+=10;reasons.push('meta prioritária sem margem mensal suficiente');}
  const level=score>=70?'crítico':score>=45?'elevado':score>=20?'atenção':'baixo';
  return {score:Math.min(100,score),level,reasons};
}

export function completeDiagnosis(context, analysis, profile, insights=[]) {
  const risk=classifyRisk({...context,analysis});
  const categories=context.categories||[];
  const problems=[];
  if(risk.reasons[0]) problems.push({title:'Pressão de caixa',reason:risk.reasons.join('; '),action:risk.level==='crítico'?'Evite novos compromissos e corrija o fluxo antes de aumentar gastos.':'Aumente a margem e acompanhe os compromissos futuros.'});
  if(categories[0]) problems.push({title:`Maior concentração: ${categories[0][0]}`,reason:`A categoria soma ${money(categories[0][1])} no período analisado.`,action:'Verifique se o valor é essencial, recorrente ou discricionário antes de cortar.'});
  const goal=(context.goals||[]).find(g=>g.remaining>0);
  if(goal) problems.push({title:`Meta: ${goal.name}`,reason:`Ainda faltam ${money(goal.remaining)}.`,action:'Defina o aporte mensal e compare compras novas com o prazo dessa meta.'});
  if(analysis?.cards?.spending>0) problems.push({title:'Crédito',reason:`Gastos no cartão no período: ${money(analysis.cards.spending)}.`,action:'Acompanhe fatura, limite disponível e parcelas futuras.'});
  return {risk, topProblems:problems.slice(0,3), facts:{income:analysis?.income?.total||0,expenses:analysis?.expenses?.total||0,planned:analysis?.cashflow?.planned||0,reserve},insights};
}
