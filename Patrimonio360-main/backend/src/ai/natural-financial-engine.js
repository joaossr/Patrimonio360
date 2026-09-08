// P360 Natural Financial Reasoner v3
// Produces concise, task-specific explanations from deterministic calculations + ML scores + memory.
// Population benchmarks are internal context only and are never exposed as dataset metadata.
import { scoreFinancialContext } from '../ml/financial-model.js';
import { getBrazilBenchmarks } from '../ml/brazilian-dataset-v2.js';

const money=v=>Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'não disponível';
const pct=v=>`${(Number(v||0)*100).toFixed(0)}%`;
const n=v=>Number.isFinite(Number(v)) ? Number(v) : 0;
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const settled=t=>['pago','paga','recebido','recebida','confirmado','confirmada','concluido','concluida'].includes(norm(t?.status));

function upcoming(state={}) {
  const today=new Date().toISOString().slice(0,10);
  const limit=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  return (state.transactions||[])
    .filter(t=>!settled(t)&&String(t.date||'')>=today&&String(t.date||'')<=limit)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}

function taskResponse(question,state,analysis){
  const q=norm(question), transactions=state?.transactions||[];
  const future=upcoming(state);

  if(/o que tenho para pagar|o que tenho para receber|a pagar|a receber|vencimento|proximos dias|proximo mes|compromiss/.test(q)){
    const pay=future.filter(t=>t.type==='expense'), receive=future.filter(t=>t.type==='income');
    const totalPay=pay.reduce((s,t)=>s+n(t.value),0), totalReceive=receive.reduce((s,t)=>s+n(t.value),0);
    const lines=['**Próximos 30 dias**'];
    lines.push(`A receber: **${money(totalReceive)}** em ${receive.length} lançamento(s).`);
    lines.push(`A pagar: **${money(totalPay)}** em ${pay.length} lançamento(s).`);
    lines.push(`Fluxo líquido previsto: **${money(totalReceive-totalPay)}**.`);
    if(pay.length) lines.push(`\n**Pagamentos:**\n${pay.slice(0,8).map(t=>`- ${t.date||'sem data'} — ${t.description||t.name||t.category||'Despesa'}: ${money(t.value)}`).join('\n')}`);
    if(receive.length) lines.push(`\n**Recebimentos:**\n${receive.slice(0,8).map(t=>`- ${t.date||'sem data'} — ${t.description||t.name||t.category||'Receita'}: ${money(t.value)}`).join('\n')}`);
    return lines.join('\n');
  }

  if(/analise.*cart|cartao|fatura|limite/.test(q)){
    const cards=state?.cards||[];
    if(!cards.length)return 'Não encontrei cartões cadastrados no seu cadastro. Se você cadastrar os cartões e as faturas, consigo analisar limite, utilização e pressão sobre o orçamento.';
    const rows=cards.map(c=>{
      const limit=n(c.limit??c.creditLimit??c.limite), used=n(c.used??c.usedLimit??c.currentInvoice??c.invoice??c.fatura), available=n(c.available??c.availableLimit??c.limiteDisponivel);
      const utilization=limit>0?used/limit:null;
      return {name:c.name||c.bank||c.institution||c.cardName||'Cartão',limit,used,available:available||Math.max(0,limit-used),utilization};
    });
    const totalLimit=rows.reduce((s,r)=>s+r.limit,0), totalUsed=rows.reduce((s,r)=>s+r.used,0), utilization=totalLimit?totalUsed/totalLimit:0;
    return `**Análise dos cartões**\n\nCartões cadastrados: **${rows.length}**.\nLimite total identificado: **${money(totalLimit)}**.\nUtilização identificada: **${money(totalUsed)} (${pct(utilization)})**.\n\n${rows.map(r=>`- **${r.name}** — usado ${money(r.used)} de ${money(r.limit)}; disponível ${money(r.available)}${r.utilization!=null?`; utilização ${pct(r.utilization)}`:''}.`).join('\n')}\n\n${utilization>=0.8?'A utilização está alta; eu evitaria assumir novas parcelas sem verificar o fluxo dos próximos 30 dias.':utilization>=0.5?'A utilização merece acompanhamento para não pressionar o orçamento.':'A utilização identificada está relativamente baixa; ainda assim, a fatura deve ser analisada junto do orçamento.'}`;
  }

  if(/como posso melhorar.*orcamento|melhorar.*orcamento|organizar.*orcamento|orcamento/.test(q)){
    const income=n(analysis?.income?.total), expense=n(analysis?.expenses?.total), planned=n(analysis?.cashflow?.planned), budget=analysis?.budget||{};
    const remaining=Number.isFinite(Number(budget.remaining))?Number(budget.remaining):income-expense;
    const categories=Array.isArray(analysis?.expenses?.categories)?analysis.expenses.categories:[];
    const top=categories.slice(0,3).map(c=>Array.isArray(c)?`${c[0]} (${money(c[1])})`:`${c.name||c.category||'Categoria'} (${money(c.value||c.total)})`).join(', ');
    return `**Como melhorar seu orçamento**\n\nReceitas no período: **${money(income)}**.\nDespesas: **${money(expense)}**.\nResultado planejado: **${money(planned)}**.\nMargem identificada: **${money(remaining)}**.\n\n${top?`As maiores categorias identificadas são: **${top}**.\n\n`:''}1. Preserve uma margem mensal positiva antes de aumentar gastos fixos.\n2. Separe primeiro o valor da sua reserva/meta e só depois distribua o restante para consumo.\n3. Revise as maiores categorias de despesa; cortar pouco nas categorias pequenas costuma ter menos efeito.\n4. Antes de assumir uma parcela nova, compare a parcela com a margem e com os compromissos dos próximos 30 dias.`;
  }

  if(/onde gasto|gastei|meus gastos|minhas despesas|analis.*despesas|analis.*gastos|cortar gastos/.test(q)){
    const categories=analysis?.expenses?.categories||analysis?.categories||[];
    if(Array.isArray(categories)&&categories.length){
      return `**Análise das despesas**\n\n${categories.slice(0,8).map((c,i)=>{const name=Array.isArray(c)?c[0]:(c.name||c.category||'Sem categoria'), value=Array.isArray(c)?c[1]:(c.value||c.total||0);return `${i+1}. **${name}** — ${money(value)}`;}).join('\n')}\n\nEu começaria a revisão pelas maiores categorias, porque elas têm maior potencial de alterar seu resultado mensal.`;
    }
  }

  if(/saldo|contas bancarias|dinheiro disponivel|quanto dinheiro|quanto tenho.*(banco|conta)/.test(q)){
    const accounts=state?.accounts||[];
    const total=accounts.reduce((s,a)=>s+n(a.balance??a.saldo??a.current),0);
    return `**Contas e saldo**\n\n${accounts.length?accounts.map(a=>`- **${a.name||a.bank||a.institution||'Conta'}**: ${money(a.balance??a.saldo??a.current)}`).join('\n'):'Não encontrei contas bancárias cadastradas.'}\n\nSaldo total identificado: **${money(total)}**.`;
  }

  return null;
}

export async function reasonFinancially({question,state,analysis,risk,profile,memory,goals=[]}){
  const benchmark=await getBrazilBenchmarks();
  const model=await scoreFinancialContext({analysis,goals,reserve:analysis?.reserve?.current||0,incomeStability:profile?.incomeStability||0.7},{deviation:0});
  const q=norm(question);
  const task=taskResponse(question,state,analysis);
  if(task)return {text:task,model,benchmark};
  const purchase=/(comprar|compra|posso|gastar|celular|tv|televisao)/.test(q);
  const saving=/(guardar|poupar|reserva|economizar)/.test(q);
  const investing=/(investir|investimento|aplicar|rendimento)/.test(q);
  const parts=[];
  if(purchase) parts.push('Vou olhar primeiro para o impacto no seu orçamento, na reserva e nas metas — não apenas para a parcela.');
  else if(saving) parts.push('Aqui a decisão depende principalmente da sua folga mensal, da reserva e das metas que você já definiu.');
  else if(investing) parts.push('Antes de pensar em rentabilidade, vou verificar se o seu caixa e a sua reserva já permitem investir sem apertar o orçamento.');
  else parts.push('Vou separar os fatos do seu cadastro e responder diretamente ao que você perguntou.');

  const income=n(analysis?.income?.total), expense=n(analysis?.expenses?.total), planned=n(analysis?.cashflow?.planned);
  if(Number.isFinite(income)) parts.push(`Receitas no período: ${money(income)}; despesas: ${money(expense)}.`);
  if(Number.isFinite(planned)) parts.push(`Resultado planejado: ${money(planned)}.`);
  if(risk?.level) parts.push(`Risco financeiro calculado: ${risk.level}.`);
  if(model.available){const s=model.scores;parts.push(`Indicadores do modelo: capacidade de compra ${pct(s.purchaseAffordability)}, prioridade de reserva ${pct(s.reservePriority)} e prontidão para investir ${pct(s.investmentReadiness)}.`);}
  return {text:parts.join(' '),model,benchmark};
}
