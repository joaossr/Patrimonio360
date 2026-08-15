import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { buildFinancialContext, historicalContext, resolveRequestedMonth } from './context-engine.js';
import { evaluatePurchase, explainPurchase } from './decision-engine.js';
import { completeDiagnosis } from './diagnosis-engine.js';
import { extractMemoryFromMessage } from '../memory/financial-memory.js';

const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

function previousUserMessages(memory={}) {
  return [...(memory.recent||[])].filter(x=>x.role==='user').slice(-6);
}

function contextualQuestion(question,memory={}) {
  const q=norm(question).trim();
  if(!/^(e|entao|mas|se|e se|quanto|qual|como|isso|nesse caso|em\s+\d+)/.test(q)) return question;
  const previous=previousUserMessages(memory);
  const prior=previous.at(-1)?.content||'';
  if(!prior) return question;
  const parsed=parseFinancialValue(question);
  const priorParsed=parseFinancialValue(prior);
  if(parsed.installments>1 && priorParsed.total>0) return `${prior} em ${parsed.installments}x`;
  if(/^(e se|se eu)/.test(q) && priorParsed.total>0) return `${prior} ${question}`;
  return question;
}

function findRelatedGoal(state={},memory={},parsedTarget=0){
  const official=Array.isArray(state.goals)?state.goals:[];
  const remembered=Array.isArray(memory.goals)?memory.goals:[];
  const all=[...official,...remembered];
  if(parsedTarget) return all.find(g=>Math.abs(Number(g.target||0)-parsedTarget)<0.01)||null;
  const recentTarget=remembered.at(-1)?.target;
  if(recentTarget) return all.find(g=>Math.abs(Number(g.target||0)-Number(recentTarget))<0.01)||remembered.at(-1);
  return official[0]||null;
}

export function respondV2({question,state,currentMonth,memory,analysis,risk,profile,insights}){
  const contextual=contextualQuestion(question,memory);
  const intent=detectIntent(question,memory), month=resolveRequestedMonth(question,currentMonth);
  const context=buildFinancialContext(state,month,memory);
  context.analysis=analysis; context.risk=risk; context.budget=analysis?.budget||null;
  context.activeGoal=findRelatedGoal(state,memory);
  const memoryPatch=extractMemoryFromMessage(question);
  let answer=null, mutation=null;

  if(intent==='historical_income'){
    const h=historicalContext(state,month);
    answer=!h.found?`Não encontrei receitas cadastradas em ${month}. Não vou substituir esse período pelos dados de outro mês.`:`Em ${month}, encontrei ${money(h.income)} em receitas registradas. Desse valor, ${money(h.received)} já consta como recebido e ${money(h.income-h.received)} está pendente.`;
  } else if(intent==='comparison'){
    answer='Vou comparar as opções usando seu contexto financeiro atual, sem registrar nenhuma delas como meta, receita ou despesa.';
  } else if(intent==='simulation'){
    answer=explainPurchase(evaluatePurchase(contextual,context,memory));
  } else if(intent==='purchase'){
    answer=explainPurchase(evaluatePurchase(contextual,context,memory));
  } else if(intent==='goal'){
    const parsed=parseGoal(question,new Date());
    const existing=parsed?.target?findRelatedGoal(state,memory,parsed.target):null;
    if(parsed?.target){
      if(existing) answer=`Já existe uma meta de ${money(parsed.target)} cadastrada. Vou usá-la como referência nas próximas análises.`;
      else{
        const createdAt=new Date().toISOString();
        mutation={type:'createGoal',goal:{id:Date.now(),name:`Meta de ${money(parsed.target)}`,current:0,target:parsed.target,date:parsed.deadline||'',priority:'Alta',createdAt,updatedAt:createdAt}};
        answer=`Registrei a meta de ${money(parsed.target)}${parsed.deadline?` até ${parsed.deadline}`:''}. Ela passa a ser considerada nas análises de compras, aportes e fluxo.`;
      }
    }else if(/quanto falta/.test(norm(question)) && context.activeGoal){
      const current=Number(context.activeGoal.current||context.activeGoal.value||0), target=Number(context.activeGoal.target||0);
      answer=`Para sua meta de ${money(target)}, faltam ${money(Math.max(0,target-current))}.`;
    }else answer='Posso acompanhar a meta, mas preciso do valor-alvo. Exemplo: “Quero chegar a R$ 5.000 até dezembro”.';
  } else if(intent==='diagnosis'){
    const d=completeDiagnosis(context,analysis,profile,insights);answer=`**Diagnóstico financeiro**\n\nRisco: **${d.risk.level}** (${d.risk.score}/100). ${d.risk.explanation||''}\n\n**3 prioridades:**\n${d.topProblems.map((p,i)=>`${i+1}. **${p.title}** — ${p.reason}\n   Primeiro passo: ${p.action}`).join('\n')||'Não encontrei três problemas sustentados pelos dados atuais.'}`;
  } else if(intent==='behavior'){
    answer='Vou avaliar seu comportamento com base na evolução dos gastos, categorias, recorrência, parcelamentos, margem, renda, reserva e metas — sem confundir isso com um simples resumo do mês.';
  } else if(intent==='cashflow'){
    const a=context.analysis||{};
    const income=Number(a.income||a.revenue||0), expenses=Number(a.expenses||a.totalExpenses||0), margin=income-expenses;
    answer=`Sua disponibilidade projetada precisa considerar receitas previstas, despesas, parcelas, compromissos e aportes. No período analisado, receitas somam ${money(income)}, despesas ${money(expenses)} e a margem antes dos demais compromissos é ${money(margin)}.`;
  } else if(intent==='investments') answer=context.investments.length?`Você tem ${money(context.investments.reduce((s,i)=>s+Number(i.current??i.invested??0),0))} em investimentos cadastrados, distribuídos em ${context.investments.length} posição(ões). Estou usando os registros oficiais.`:'Não encontrei investimentos cadastrados no banco de dados. Não vou inventar uma carteira.';
  else if(intent==='feedback') answer='Entendi a correção. Vou registrá-la na memória estruturada para evitar repetir esse erro. Isso não altera os pesos do modelo.';
  else if(intent==='memory') answer=`Tenho ${(memory.facts||[]).length} fato(s), ${(memory.goals||[]).length} meta(s), ${(memory.preferences||[]).length} preferência(s) e ${(memory.corrections||[]).length} correção(ões) na memória. Os dados financeiros oficiais continuam vindo do banco.`;
  return {answer,intent,month,context,memoryPatch,mutation};
}
