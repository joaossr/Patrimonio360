// P360 Natural Financial Reasoner v1
// Produces human-style explanations from deterministic calculations + ML scores + memory.
// It does not invent missing facts and clearly separates user facts from population benchmarks.
import { scoreFinancialContext } from '../ml/financial-model.js';
import { getBrazilBenchmarks } from '../ml/brazilian-dataset-v2.js';

const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=v=>`${(Number(v||0)*100).toFixed(0)}%`;
const n=v=>Number(v||0);

export async function reasonFinancially({question,state,analysis,risk,profile,memory,goals=[]}){
  const benchmark=await getBrazilBenchmarks();
  const model=await scoreFinancialContext({analysis,goals,reserve:analysis?.reserve?.current||0,incomeStability:profile?.incomeStability||0.7},{deviation:0});
  const q=String(question||'').toLowerCase();
  const purchase=/(comprar|compra|posso|gastar|celular|tv|televisao|televisão)/.test(q);
  const saving=/(guardar|poupar|reserva|economizar)/.test(q);
  const investing=/(investir|investimento|aplicar|rendimento)/.test(q);
  const parts=[];
  if(purchase) parts.push('Vou olhar primeiro para o impacto no seu orçamento, na reserva e nas metas — não apenas para a parcela.');
  else if(saving) parts.push('Aqui a decisão depende principalmente da sua folga mensal, da reserva e das metas que você já definiu.');
  else if(investing) parts.push('Antes de pensar em rentabilidade, vou verificar se o seu caixa e a sua reserva já permitem investir sem apertar o orçamento.');
  else parts.push('Vou separar o que é fato do seu cadastro do que é referência estatística para evitar uma conclusão genérica.');

  if(analysis?.income!=null) parts.push(`Hoje tenho ${money(analysis.income)} de receitas e ${money(analysis.expense)} de despesas no período analisado.`);
  if(analysis?.planned!=null) parts.push(`O resultado planejado é ${money(analysis.planned)}.`);
  if(risk?.level) parts.push(`O risco financeiro calculado está em ${risk.level}.`);
  if(model.available){const s=model.scores;parts.push(`Meu modelo próprio estima capacidade de compra em ${pct(s.purchaseAffordability)}, prioridade de reserva em ${pct(s.reservePriority)} e prontidão para investir em ${pct(s.investmentReadiness)}.`);}
  parts.push(`Usei também referências agregadas do BCB e do IBGE (${benchmark.surveyRows} registros comportamentais e ${benchmark.incomeDistributionCount} pontos de distribuição disponíveis na fonte). Essas referências servem para contexto da população e não são tratadas como se fossem seus dados pessoais.`);
  return {text:parts.join(' '),model,benchmark};
}
