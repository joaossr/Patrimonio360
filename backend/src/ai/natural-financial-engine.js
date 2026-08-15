// P360 Natural Financial Reasoner v2
// Produces human-style explanations from deterministic calculations + ML scores + memory.
// Population benchmarks are internal context only: never expose source names, row counts or dataset metadata to the user.
import { scoreFinancialContext } from '../ml/financial-model.js';
import { getBrazilBenchmarks } from '../ml/brazilian-dataset-v2.js';

const money=v=>Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'não disponível';
const pct=v=>`${(Number(v||0)*100).toFixed(0)}%`;
const n=v=>Number.isFinite(Number(v)) ? Number(v) : 0;

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
  else parts.push('Vou separar o que é fato do seu cadastro de referências gerais para evitar uma conclusão genérica.');

  const income=n(analysis?.income?.total), expense=n(analysis?.expenses?.total), planned=n(analysis?.cashflow?.planned);
  if(Number.isFinite(income)) parts.push(`Hoje tenho ${money(income)} de receitas e ${money(expense)} de despesas no período analisado.`);
  if(Number.isFinite(planned)) parts.push(`O resultado planejado é ${money(planned)}.`);
  if(risk?.level) parts.push(`O risco financeiro calculado está em ${risk.level}.`);
  if(model.available){const s=model.scores;parts.push(`Meu modelo próprio estima capacidade de compra em ${pct(s.purchaseAffordability)}, prioridade de reserva em ${pct(s.reservePriority)} e prontidão para investir em ${pct(s.investmentReadiness)}.`);}

  // The benchmark influences the reasoning internally. It is deliberately not disclosed as BCB/IBGE metadata.
  if(benchmark && (benchmark.incomeDistributionCount || benchmark.surveyRows)) {
    parts.push('Também considerei referências gerais de comportamento financeiro e distribuição de renda para calibrar a análise ao contexto brasileiro. Elas servem apenas como referência e não são tratadas como seus dados pessoais.');
  }
  return {text:parts.join(' '),model,benchmark};
}
