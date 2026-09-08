const num=v=>Number(v||0);
const avg=a=>a.length?a.reduce((s,v)=>s+num(v),0)/a.length:0;
const monthOf=t=>String(t?.date||'').slice(0,7);
const sum=a=>a.reduce((s,v)=>s+num(v),0);

export function buildFinancialProfile(state={}){
  const tx=state.transactions||[];
  const months=[...new Set(tx.map(monthOf).filter(Boolean))].sort().slice(-6);
  const history=months.map(month=>{
    const mt=tx.filter(t=>monthOf(t)===month);
    const income=sum(mt.filter(t=>t.type==='income').map(t=>t.value));
    const expenses=sum(mt.filter(t=>t.type==='expense').map(t=>t.value));
    return {month,income,expenses,balance:income-expenses};
  });
  const categories={};
  tx.filter(t=>t.type==='expense').forEach(t=>{const k=t.category||'Sem categoria';categories[k]=(categories[k]||0)+num(t.value);});
  const topCategories=Object.entries(categories).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,value])=>({name,value}));
  const cardExpenses=tx.filter(t=>t.type==='expense'&&t.payment==='cartao');
  const pending=tx.filter(t=>String(t.status||'').toLowerCase()==='pendente');
  const incomeAvg=avg(history.map(h=>h.income));
  const expenseAvg=avg(history.map(h=>h.expenses));
  const positiveMonths=history.filter(h=>h.balance>=0).length;
  return {
    version:'financial-profile-v1',
    monthsAnalyzed:history.length,
    averages:{income:incomeAvg,expenses:expenseAvg,balance:incomeAvg-expenseAvg},
    behavior:{topCategories,creditCardUsageRate:tx.length?cardExpenses.length/tx.length:0,pendingCount:pending.length,positiveMonthRate:history.length?positiveMonths/history.length:0},
    history,
    updatedAt:new Date().toISOString()
  };
}
