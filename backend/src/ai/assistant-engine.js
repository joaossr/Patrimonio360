import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { buildFinancialContext, historicalContext, resolveRequestedMonth } from './context-engine.js';
import { evaluatePurchase, explainPurchase } from './decision-engine.js';
import { completeDiagnosis } from './diagnosis-engine.js';
import { extractMemoryFromMessage } from '../memory/financial-memory.js';

const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

function purchaseQuestion(question,memory={}){
  const parsed=parseFinancialValue(question), q=norm(question);
  const continuation=/^(e|entao|mas|se|e se|quanto|qual|como|isso|nesse caso)\b|^\d+\s*x\b|^em\s+\d+\s*(?:x|vezes|parcelas?)/i.test(q);
  if(!continuation) return question;
  const previous=[...(memory.recent||[])].reverse().find(x=>x.role==='user'&&parseFinancialValue(x.content||'').total>0)?.content;
  if(!previous) return question;
  const prior=parseFinancialValue(previous);
  if(prior.total>0&&parsed.installments>1&&(parsed.total===0||parsed.total===parsed.installments)) return `${previous} em ${parsed.installments}x`;
  if(prior.total>0&&/parcel|vezes|\bx\b/.test(q)) return `${previous} em ${parsed.installments||prior.installments}x`;
  return question;
}

export function respondV2({question,state,currentMonth,memory,analysis,risk,profile,insights}){
  const intent=detectIntent(question,memory), month=resolveRequestedMonth(question,currentMonth);
  const context=buildFinancialContext(state,month,memory);
  context.analysis=analysis; context.risk=risk; context.budget=analysis?.budget||null;
  const memoryPatch=extractMemoryFromMessage(question);
  let answer=null, mutation=null;
  if(intent==='historical_income'){
    const h=historicalContext(state,month);
    answer=!h.found?`Não encontrei receitas cadastradas em ${month}. Não vou substituir esse período pelos dados de outro mês.`:`Em ${month}, encontrei ${money(h.income)} em receitas registradas. Desse valor, ${money(h.received)} já consta como recebido e ${money(h.income-h.received)} está pendente.`;
  } else if(intent==='purchase'){
    answer=explainPurchase(evaluatePurchase(purchaseQuestion(question,memory),context,memory));
  } else if(intent==='goal'){
    const parsed=parseGoal(question,new Date());
    const existing=parsed?.target?(state.goals||[]).find(g=>Math.abs(Number(g.target||0)-parsed.target)<0.01&&(!parsed.deadline||String(g.date||g.deadline||'').startsWith(parsed.deadline))):null;
    if(parsed?.target){
      if(existing) answer=`Já existe uma meta oficial de ${money(parsed.target)} cadastrada. Vou usá-la como referência nas próximas análises.`;
      else{
        const createdAt=new Date().toISOString();
        mutation={type:'createGoal',goal:{id:Date.now(),name:`Meta de ${money(parsed.target)}`,current:0,target:parsed.target,date:parsed.deadline||'',priority:'Alta',createdAt,updatedAt:createdAt}};
        answer=`Registrei a meta de ${money(parsed.target)}${parsed.deadline?` até ${parsed.deadline}`:''}. Ela passa a ser considerada nas análises de compras, aportes e fluxo.`;
      }
    }else answer='Posso acompanhar a meta, mas preciso do valor-alvo. Exemplo: “Quero chegar a R$ 5.000 até dezembro”.';
  } else if(intent==='diagnosis'){
    const d=completeDiagnosis(context,analysis,profile,insights);answer=`**Diagnóstico financeiro**\n\nRisco: **${d.risk.level}** (${d.risk.score}/100). ${d.risk.explanation||''}\n\n**3 prioridades:**\n${d.topProblems.map((p,i)=>`${i+1}. **${p.title}** — ${p.reason}\n   Primeiro passo: ${p.action}`).join('\n')||'Não encontrei três problemas sustentados pelos dados atuais.'}`;
  } else if(intent==='investments') answer=context.investments.length?`Você tem ${money(context.investments.reduce((s,i)=>s+Number(i.current??i.invested??0),0))} em investimentos cadastrados, distribuídos em ${context.investments.length} posição(ões). Estou usando os registros oficiais.`:'Não encontrei investimentos cadastrados no banco de dados. Não vou inventar uma carteira.';
  else if(intent==='feedback') answer='Entendi a correção. Vou registrá-la na memória estruturada para evitar repetir esse erro. Isso não altera pesos do modelo.';
  else if(intent==='memory') answer=`Tenho ${(memory.facts||[]).length} fato(s), ${(memory.goals||[]).length} meta(s), ${(memory.preferences||[]).length} preferência(s) e ${(memory.corrections||[]).length} correção(ões) na memória. Os dados financeiros oficiais continuam vindo do banco.`;
  return {answer,intent,month,context,memoryPatch,mutation};
}
