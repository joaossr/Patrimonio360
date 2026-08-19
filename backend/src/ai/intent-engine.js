import { normalizeUserText } from './text-normalizer.js';
import { datasetIntentHint } from './dataset-v2-knowledge.js';

function hasAny(q, patterns){ return patterns.some(p => p.test(q)); }
function classifyFallback(q){
  const money=/r\$|\b\d{2,}\b|\b\d+[.,]\d{2}\b|\b\d+\s*mil\b/;
  const save=/guardar|guardo|poupar|poupo|economizar|economizo|juntar|junto|separar|guardar dinheiro|deixar.*conta|deixar.*parado/;
  const invest=/investir|invisto|investimento|aplicar|aplico|aplicacao|carteira/;
  const reserve=/reserva|emergencia|caixinha/;
  const expense=/gastei|gastos?|despesas?|torrei|paguei|gastando/;
  const budget=/orcamento|margem|folga|quanto posso gastar|quanto ainda posso|quanto sobra/;
  const cash=/a pagar|a receber|vencimento|compromissos?|fluxo|proximo mes|proximos dias/;
  const accounts=/saldo|conta|banco|dinheiro disponivel|quanto dinheiro|quanto tenho/;
  const cards=/cartao|cartoes|cartao de credito|cartoes de credito|fatura|faturas|limite|limites/;
  const purchase=/comprar|compra|parcelar|parcelado|parcela|celular|tv|notebook|produto|\b\d+\s*x\b/;
  const diagnosis=/diagnostico|saude financeira|raio x|analise completa|panorama|situacao financeira/;
  const goal=/meta|objetivo|chegar|atingir|juntar|aportar|aporte|ate dezembro|até dezembro/;
  if (/^(simule|simular|se eu|se minha|se eu receber|se eu aumentar|se eu reduzir)\b/.test(q)) return 'simulation';
  if (hasAny(q,[diagnosis])) return 'diagnosis';
  if (hasAny(q,[cards])) return 'cards';
  if (hasAny(q,[goal])) return 'goal';
  if (save.test(q)&&invest.test(q)) return 'save_vs_invest';
  if (invest.test(q) && !purchase.test(q)) return 'save_vs_invest';
  if (save.test(q) && !purchase.test(q)) return 'save_vs_invest';
  if (hasAny(q,[purchase])) return 'purchase';
  if (hasAny(q,[reserve])) return 'reserve';
  if (hasAny(q,[expense])) return 'expenses';
  if (hasAny(q,[budget])) return 'budget';
  if (hasAny(q,[cash])) return 'cashflow';
  if (hasAny(q,[accounts])) return 'accounts';
  if (money.test(q)&&hasAny(q,[/recebi|renda|salario|entrou|ganhei|sobrou|coloquei|aportei|tenho/])) return 'accounts';
  return null;
}

export function detectIntent(question, memory = {}) {
  const q = normalizeUserText(question);
  const previous = [...(memory.recent || [])].reverse().find(x => x.role === 'user')?.content || '';
  const hasHistory = Boolean(previous);

  if (/corrig|esta errado|nao e|não é|interpretei|quis dizer|nao foi isso|não foi isso|minha prioridade/.test(q)) return 'feedback';

  // Explicit comparisons must beat both purchase aliases and generic save/invest terms.
  if (/\b(?:deixo|deixar|mantenho|manter)\b.*\b(?:conta|banco|parado)\b.*\b(?:ou|versus|vs)\b.*\b(?:aplicar|inv?estir|investimento|rendimento|render)\b/.test(q)) return 'save_vs_invest';
  if (/\b(?:aplicar|investir|investimento|rendimento|render)\b.*\b(?:ou|versus|vs)\b.*\b(?:guardar|poupar|deixar|manter)\b/.test(q)) return 'save_vs_invest';

  // High-confidence domain requests are resolved before generic words such as "compra", "conta" or "meta".
  if (/analise.*cart(?:ao|oes)|analis[ae].*cart(?:ao|oes)|fatura.*cart(?:ao|oes)|limite.*cart(?:ao|oes)|cart(?:ao|oes).*credito|cart(?:ao|oes).*fatura/.test(q)) return 'cards';
  if (/o que tenho para (?:pagar|receber)|o que tenho.*(?:pagar|receber)|a pagar|a receber|proximas semanas|proximos dias|proximo mes|compromissos|vencimentos/.test(q)) return 'cashflow';
  if (/como posso melhorar.*orcamento|melhorar.*orcamento|organizar.*orcamento|como.*orcamento|quanto (?:posso|ainda posso) gastar|qual minha margem|quanto sobra no orcamento|tenho margem para uma compra|tenho espaco no orcamento|meu orcamento aguenta|quanto posso comprometer/.test(q)) return 'budget';
  if (/analise.*(?:gastos|despesas)|analisar.*(?:gastos|despesas)|meus gastos|minhas despesas|onde gasto|cortar gastos|estou gastando demais|onde posso economizar|quanto gastei/.test(q)) return 'expenses';
  if (/quanto tenho.*(?:conta|contas|banco)|saldo.*(?:conta|contas|banco)|dinheiro disponivel|saldo das contas|quanto tenho no banco|quanto tenho nas contas/.test(q)) return 'accounts';

  const purchaseFollowUp = hasHistory && /^(e se|se eu|e|entao|mas|quanto|qual|como|isso|esse|essa|nesse caso)\b/.test(q) && /comprar|compra|parcelar|parcelado|parcela|\b\d+\s*x\b|vezes|parcelas/.test(`${q} ${normalizeUserText(previous)}`);
  if (purchaseFollowUp) return 'purchase';

  if (/^(e se|se eu|se minha|se eu receber|se eu aumentar|se eu reduzir|simule|simular)\b/.test(q)) return 'simulation';
  if (/diagnost|analise completa|saude financeira|situacao financeira|raio.?x|panorama/.test(q)) return 'diagnosis';
  if (/salario|renda|receit/.test(q) && /janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2}/.test(q)) return 'historical_income';

  const save=/guardar|guardo|poupar|poupo|economizar|economizo|juntar|junto|separar|deixar.*conta|deixar.*parado|reserva|caixinha|dinheiro parado/;
  const invest=/investir|invisto|investimento|aplicar|aplico|aplicacao|carteira/;
  const purchase=/comprar|compra|parcelar|parcelado|parcela|celular|tv|notebook|produto|posso gastar.*compra|vale a pena comprar|simule.*compra|\b\d+\s*x\b/;
  const goalProjection=/(quanto|qual|como|quando|prazo|tempo).*(guardar|poupar|economizar|aportar|aporte|meta|objetivo)|quanto falta.*(meta|objetivo)|projec[aã]o|em quanto tempo.*(chego|atingir|alcan[cç]ar)|ate dezembro|até dezembro/;
  const goalCreation=/(meta|objetivo|quero chegar|quero atingir|quero juntar|vou economizar|pretendo guardar|quero guardar|preciso guardar|formar uma reserva)/;

  if (goalProjection.test(q) || goalCreation.test(q)) return 'goal';
  if (save.test(q) && invest.test(q)) return 'save_vs_invest';
  if (/(deixar|manter).*(conta|parado).*(ou|versus|vs).*(investir|aplicar)|investir.*(ou|versus|vs).*(guardar|deixar.*conta|poupar)/.test(q)) return 'save_vs_invest';

  const datasetHint = datasetIntentHint(q);
  if (datasetHint && datasetHint !== 'purchase') return datasetHint;

  if (save.test(q) && !purchase.test(q) && (/(conta|parado|guardar|poupar|economizar|juntar|separar)/.test(q))) return 'save_vs_invest';
  if (invest.test(q) && !purchase.test(q)) return 'save_vs_invest';

  if (purchase.test(q)) return 'purchase';
  if (/cartao|fatura|limite/.test(q)) return 'cards';
  if (/orcamento|quanto posso gastar|margem|folga|quanto ainda posso|quanto sobra/.test(q)) return 'budget';
  if (/a pagar|a receber|vencimento|compromiss|fluxo|proximo mes|proximos dias|o que tenho para pagar|o que tenho para receber/.test(q)) return 'cashflow';
  if (/reserva|emergencia/.test(q)) return 'reserve';
  if (/gastei|gastos?|despesas?|categoria|onde gasto|cortar|gastando demais|gasto mais|torrei|paguei/.test(q)) return 'expenses';
  if (/saldo|contas bancarias|dinheiro disponivel|quanto dinheiro|quanto tenho no banco|quanto tenho nas contas|quanto tenho em conta/.test(q)) return 'accounts';
  if (/memoria|lembra|esqueceu/.test(q)) return 'memory';
  if (hasHistory && /^(e|entao|mas|se|quanto|qual|como|isso|esse|essa|ele|ela|nesse caso|e se)\b/.test(q)) return 'continuation';
  return classifyFallback(q)||'general';
}
