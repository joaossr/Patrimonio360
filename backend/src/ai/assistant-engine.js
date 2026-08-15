import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { buildFinancialContext, historicalContext, resolveRequestedMonth } from './context-engine.js';
import { evaluatePurchase, explainPurchase } from './decision-engine.js';
import { completeDiagnosis } from './diagnosis-engine.js';
import { extractMemoryFromMessage } from '../memory/financial-memory.js';
import { scoreFinancialContext } from '../ml/financial-model.js';
import { reasonFinancially } from './natural-financial-engine.js';

const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const recentUser=(memory={})=>[...(memory.recent||[])].reverse().find(x=>x.role==='user')?.content||'';
function purchaseQuestion(question,memory={}){const parsed=parseFinancialValue(question),q=norm(question);const continuation=/^(e|entao|mas|se|e se|quanto|qual|como|isso|nesse caso)\b|^\d+\s*x\b|^em\s+\d+\s*(?:x|vezes|parcelas?)/i.test(q);if(!continuation)return question;const previous=[...(memory.recent||[])].reverse().find(x=>x.role==='user'&&parseFinancialValue(x.content||'').total>0)?.content;if(!previous)return question;const prior=parseFinancialValue(previous);if(prior.total>0&&parsed.installments>1&&(parsed.total===0||parsed.total===parsed.installments))return `${previous} em ${parsed.installments}x`;if(prior.total>0&&/parcel|vezes|\bx\b/.test(q))return `${previous} em ${parsed.installments||prior.installments}x`;return question;}
function findGoal(state,memory){const goals=state.goals||[];if(!goals.length)return null;const memGoals=memory.goals||[];return [...goals].sort((a,b)=>{const ai=memGoals.findIndex(g=>String(g.id)===String(a.id));const bi=memGoals.findIndex(g=>String(g.id)===String(b.id));return (bi<0?999:bi)-(ai<0?999:ai);})[0]||null;}
function monthlyGoalNeed(goal){const target=Number(goal?.target||0),current=Number(goal?.current||0),remaining=Math.max(0,target-current);const deadline=String(goal?.date||goal?.deadline||'');if(!remaining)return {remaining:0,monthly:0,months:0};if(!/^\d{4}-\d{2}$/.test(deadline))return {remaining,monthly:null,months:null};const [y,m]=deadline.split('-').map(Number),now=new Date(),months=Math.max(1,(y-now.getFullYear())*12+(m-(now.getMonth()+1))+1);return {remaining,monthly:remaining/months,months};}

export async function respondV2({question,state,currentMonth,memory,analysis,risk,profile,insights}){
 const intent=detectIntent(question,memory),month=resolveRequestedMonth(question,currentMonth);const context=buildFinancialContext(state,month,memory);context.analysis=analysis;context.risk=risk;context.budget=analysis?.budget||null;
 const financialModel=await scoreFinancialContext({analysis,goals:state.goals||[],reserve:analysis?.reserve?.current||0},{deviation:0});context.financialModel=financialModel;
 const memoryPatch=extractMemoryFromMessage(question);let answer=null,mutation=null;
 if(intent==='historical_income'){const h=historicalContext(state,month);answer=!h.found?`Não encontrei receitas cadastradas em ${month}. Não vou substituir esse período pelos dados de outro mês.`:`Em ${month}, encontrei ${money(h.income)} em receitas registradas. Desse valor, ${money(h.received)} já consta como recebido e ${money(h.income-h.received)} está pendente.`;}
 else if(intent==='save_vs_invest'){
   const reserve=Number(analysis?.reserve?.current||0),income=Number(analysis?.income?.total||0),expense=Number(analysis?.expenses?.total||0),planned=Number(analysis?.plannedResult??income-expense),goal=findGoal(state,memory);
   const g=monthlyGoalNeed(goal);const reserveWeak=income>0&&reserve<income*3;const cashTight=planned<=0;
   answer=`**Eu priorizaria guardar agora.**\n\nVocê tem ${money(reserve)} de reserva e o resultado planejado do período é ${money(planned)}.`;
   if(goal){answer+=` Sua meta ativa é **${goal.name}**, com ${money(g.remaining)} ainda faltando${g.monthly!=null?` e uma necessidade aproximada de ${money(g.monthly)}/mês até ${goal.date||goal.deadline}`:''}.`;}
   if(cashTight||reserveWeak) answer+=' Com pouca folga ou uma reserva ainda em formação, eu priorizaria liquidez e segurança antes de buscar retorno de investimentos.';
   else answer+=' Como sua reserva já está mais protegida, o próximo passo pode ser dividir o excedente entre reserva/meta e investimentos de acordo com prazo e risco.';
 }
 else if(intent==='purchase'){answer=explainPurchase(evaluatePurchase(purchaseQuestion(question,memory),context,memory));}
 else if(intent==='goal'){
   const parsed=parseGoal(question,new Date());const reference=/(quanto|mes|m[eê]s|guardar|aportar|preciso|nessa meta|essa meta|meta)/.test(norm(question));
   const existing=parsed?.target?(state.goals||[]).find(g=>Math.abs(Number(g.target||0)-parsed.target)<.01&&(!parsed.deadline||String(g.date||g.deadline||'').startsWith(parsed.deadline))):null;
   if(parsed?.target){
     if(existing) answer=`Já existe uma meta oficial de ${money(parsed.target)} cadastrada. Vou usá-la como referência nas próximas análises.`;
     else{const createdAt=new Date().toISOString();mutation={type:'createGoal',goal:{id:Date.now(),name:`Meta de ${money(parsed.target)}`,current:0,target:parsed.target,date:parsed.deadline||'',priority:'Alta',createdAt,updatedAt:createdAt}};answer=`Registrei a meta de ${money(parsed.target)}${parsed.deadline?` até ${parsed.deadline}`:''}. Ela passa a ser considerada nas análises de compras, aportes e fluxo.`;}
   } else if(reference){const goal=findGoal(state,memory);if(goal){const g=monthlyGoalNeed(goal);answer=`Sua meta registrada é **${goal.name}**: ${money(goal.current||0)} de ${money(goal.target||0)}. Faltam **${money(g.remaining)}**${g.monthly!=null?` e, considerando o prazo de ${goal.date||goal.deadline}, você precisa guardar aproximadamente **${money(g.monthly)} por mês** durante ${g.months} mês(es).`:'.'}`;}else answer='Não encontrei uma meta oficial registrada. Informe o valor e o prazo para eu calcular o aporte necessário.';}
   else answer='Posso acompanhar a meta, mas preciso do valor-alvo. Exemplo: “Quero chegar a R$ 5.000 até dezembro”.';
 }
 else if(intent==='diagnosis'){const d=completeDiagnosis(context,analysis,profile,insights);answer=`**Diagnóstico financeiro**\n\nRisco: **${d.risk.level}** (${d.risk.score}/100). ${d.risk.explanation||''}\n\n**3 prioridades:**\n${d.topProblems.map((p,i)=>`${i+1}. **${p.title}** — ${p.reason}\n   Primeiro passo: ${p.action}`).join('\n')||'Não encontrei três problemas sustentados pelos dados atuais.'}`;}
 else if(intent==='investments')answer=context.investments.length?`Você tem ${money(context.investments.reduce((s,i)=>s+Number(i.current??i.invested??0),0))} em investimentos cadastrados, distribuídos em ${context.investments.length} posição(ões). Estou usando os registros oficiais.`:'Não encontrei investimentos cadastrados no banco de dados. Não vou inventar uma carteira.';
 else if(intent==='feedback'){
   const priorityMatch=question.match(/(?:minha prioridade (?:agora )?(?:é|e)|prioridade (?:agora )?(?:é|e))\s*(.+?)(?:[.!?]|$)/i);
   if(priorityMatch){memoryPatch.preferences=[...(memoryPatch.preferences||[]),{key:'activeFinancialPriority',label:'Prioridade financeira atual',value:priorityMatch[1].trim(),source:'conversation',updatedAt:new Date().toISOString()}];context.activeFinancialPriority=priorityMatch[1].trim();answer=`Entendi. Registrei **${priorityMatch[1].trim()}** como sua prioridade financeira atual. Nas próximas decisões, ela terá precedência sobre metas antigas, salvo se você mudar essa prioridade.`;}
   else answer='Entendi a correção. Vou registrá-la na memória estruturada para evitar repetir esse erro.';
 }
 else if(intent==='memory')answer=`Tenho ${(memory.facts||[]).length} fato(s), ${(memory.goals||[]).length} meta(s), ${(memory.preferences||[]).length} preferência(s) e ${(memory.corrections||[]).length} correção(ões) na memória. Os dados financeiros oficiais continuam vindo do banco.`;
 if(!answer){const natural=await reasonFinancially({question,state,analysis,risk,profile,memory,goals:state.goals||[]});answer=natural.text;context.brazilBenchmark=natural.benchmark;}
 return {answer,intent,month,context,memoryPatch,mutation,financialModel};
}
