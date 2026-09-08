import { parseFinancialValue } from './value-parser.js';
const n=v=>Number(v||0),money=v=>n(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),percent=v=>`${(n(v)*100).toFixed(1).replace('.',',')}%`;
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const remainingOf=g=>n(g?.remaining)>0?n(g.remaining):Math.max(0,n(g?.target)-n(g?.current));

function goalScore(goal, question, memory={}) {
 const q=norm(question), name=norm(goal?.name), scoreBase=Number(goal?.priorityScore||0);
 let score=scoreBase;
 if(name && q.includes(name)) score+=1000;
 if(name && /(celular|telefone|moto|motocicleta|carro|viagem|casa|reserva|emergencia|investimento|meta|objetivo)/.test(q)){
   const words=name.split(/\s+/).filter(w=>w.length>3);
   if(words.some(w=>q.includes(w))) score+=300;
 }
 const recentGoals=(memory.goals||[]);
 const idx=recentGoals.findIndex(g=>String(g.id||'')===String(goal.id||'') || (Number(g.target||0)===Number(goal.target||0)&&String(g.name||'')===String(goal.name||'')));
 if(idx>=0) score+=500+(recentGoals.length-idx);
 const created=Date.parse(goal.createdAt||goal.updatedAt||'');
 if(Number.isFinite(created)) score+=Math.min(250,Math.max(0,(created-Date.now()+30*86400000)/(86400000)));
 const remaining=remainingOf(goal);
 if(remaining>0) score+=50;
 if(n(goal.target)>0 && n(goal.current)>=n(goal.target)) score-=500;
 return score;
}

export function selectRelevantGoal(goals=[], question='', memory={}) {
 const active=(goals||[]).filter(g=>n(g.target)>0 && remainingOf(g)>0);
 if(!active.length) return null;
 return [...active].sort((a,b)=>goalScore(b,question,memory)-goalScore(a,question,memory))[0]||null;
}

export function evaluatePurchase(question,context,memory={}){
 const parsed=parseFinancialValue(question),value=parsed.total,installments=parsed.installments||1,monthly=parsed.installmentValue;if(!value)return{ok:false,reason:'Valor da compra não identificado. Informe o valor, por exemplo: R$ 1.200 ou 1200.'};
 const current=context.current||{},budgetRemaining=context.budget?.remaining??null,future=context.future||{pay:0,receive:0,net:0},reserve=n(context.reserve),goals=context.goals||[],goal=selectRelevantGoal(goals,question,memory),reasons=[];
 if(budgetRemaining!=null&&monthly>budgetRemaining)reasons.push(`a margem do orçamento é ${money(budgetRemaining)} e o impacto mensal seria ${money(monthly)}`);
 if(current.planned-monthly<0)reasons.push(`o resultado planejado do período ficaria negativo em ${money(Math.abs(current.planned-monthly))}`);
 if(future.net<0&&future.net-monthly<0)reasons.push(`os próximos 30 dias já têm fluxo líquido negativo de ${money(Math.abs(future.net))}`);
 if(installments===1&&value>reserve&&reserve>0)reasons.push(`a compra à vista supera sua reserva atual de ${money(reserve)}`);
 let goalImpact=null;
 if(goal){
   const remaining=remainingOf(goal),share=remaining?value/remaining:0;
   goalImpact={name:goal.name,remaining,share,target:goal.target,current:goal.current};
   if(share>=.1)reasons.push(`a compra consome ${percent(share)} do valor que ainda falta para a meta ${goal.name}`);
 }
 const risk=reasons.length>=3||current.planned-monthly<0?'crítico':reasons.length===2?'elevado':reasons.length===1?'atenção':'baixo',verdict=risk==='crítico'?'Eu evitaria agora.':risk==='elevado'?'Eu teria bastante cautela.':risk==='atenção'?'É possível, mas eu faria com cautela.':'Pelos dados disponíveis, parece administrável.';
 return{ok:true,value,installments,monthly,risk,verdict,reasons,goalImpact,budgetRemaining,future,reserve};
}
export function explainPurchase(result){
 if(!result?.ok)return result?.reason||'Não consegui interpretar a compra.';
 const lines=[`**${result.verdict}**`,`Compra: ${money(result.value)}${result.installments>1?` em ${result.installments}x de ${money(result.monthly)}`:' à vista'}.`,`Impacto mensal: ${money(result.monthly)}.`];
 if(result.budgetRemaining!=null)lines.push(`Margem do orçamento antes da compra: ${money(result.budgetRemaining)}.`);
 lines.push(`Reserva de emergência: ${money(result.reserve)}.`,`Próximos 30 dias: ${money(result.future.receive)} a receber e ${money(result.future.pay)} a pagar.`);
 if(result.goalImpact){const g=result.goalImpact;lines.push(`Meta relacionada: ${g.name}; faltam ${money(g.remaining)}. A compra representa ${percent(g.share)} do que falta.`);if(g.share>=.1)lines.push(`Custo de oportunidade: ${money(result.value)} deixariam de ser direcionados à meta neste momento.`);}
 if(result.reasons.length)lines.push(`**Por que:** ${result.reasons.slice(0,4).join('; ')}.`);
 if(result.risk==='crítico'||result.risk==='elevado')lines.push('**Alternativas:** adiar, reduzir o valor da compra ou escolher uma parcela que caiba na margem sem comprometer a meta.');
 return lines.join('\n');
}
