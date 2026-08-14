export function generateInsights(analysis={},risk={},neural={},profile={}){
  const out=[];
  if(analysis.cashflow?.planned<0)out.push({type:'warning',key:'negative-cashflow',title:'Fluxo mensal negativo',message:'As despesas planejadas estão acima das receitas do mês.'});
  if((analysis.budget?.usage||0)>=1)out.push({type:'danger',key:'budget-over',title:'Orçamento excedido',message:'Os gastos já atingiram ou ultrapassaram o orçamento mensal.'});
  else if((analysis.budget?.usage||0)>=.8)out.push({type:'warning',key:'budget-near',title:'Orçamento próximo do limite',message:'Mais de 80% do orçamento mensal já foi comprometido.'});
  if((analysis.expenses?.pending||0)>0)out.push({type:'info',key:'pending-expenses',title:'Pagamentos pendentes',message:'Existem despesas registradas que ainda não foram marcadas como pagas.'});
  if(risk.level==='alto')out.push({type:'danger',key:'high-risk',title:'Risco financeiro alto',message:(risk.reasons||[])[0]||'Os indicadores financeiros exigem atenção.'});
  if(neural.available&&analysis.expenses?.total>0&&neural.forecast30d>analysis.expenses.total*1.15)out.push({type:'warning',key:'forecast-rise',title:'Tendência de alta nos gastos',message:'O P360 projeta despesas dos próximos 30 dias acima do nível atual.'});
  if((profile.behavior?.positiveMonthRate||0)>=.75&&profile.monthsAnalyzed>=3)out.push({type:'positive',key:'positive-history',title:'Histórico consistente',message:'A maior parte dos meses analisados terminou com saldo positivo.'});
  return out.slice(0,6);
}
