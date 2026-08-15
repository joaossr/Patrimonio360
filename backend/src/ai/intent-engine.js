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
  const cards=/cartao|fatura|limite/;
  const purchase=/comprar|compra|parcelar|parcelado|parcela|celular|tv|notebook|produto|\b\d+\s*x\b/;
  const diagnosis=/diagnostico|saude financeira|raio x|analise completa|panorama|situacao financeira/;
  const goal=/meta|objetivo|chegar|atingir|juntar|aportar|aporte|ate dezembro|até dezembro/;
  if (/^(simule|simular|se eu|se minha|se eu receber|se eu aumentar|se eu reduzir)\b/.test(q)) return 'simulation';
  if (hasAny(q,[diagnosis])) return 'diagnosis';
  if (hasAny(q,[cards])) return 'cards';
  if (save.test(q)&&invest.test(q)) return 'save_vs_invest';
  if (invest.test(q) && !purchase.test(q)) return 'save_vs_invest';
  if (save.test(q) && !purchase.test(q)) return 'save_vs_invest';
  if (hasAny(q,[purchase])) return 'purchase';
  if (hasAny(q,[goal])) return 'goal';
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

  if (/corrig|esta errado|está errado|nao e|não é|interpretei|quis dizer|nao foi isso|não foi isso|minha prioridade/.test(q)) return 'feedback';

  const purchaseFollowUp = hasHistory && /^(e se|se eu|e|entao|mas|quanto|qual|como|isso|esse|essa|nesse caso)\b/.test(q) && /comprar|compra|parcelar|parcelado|parcela|\b\d+\s*x\b|vezes|parcelas/.test(`${q} ${normalizeUserText(previous)}`);
  if (purchaseFollowUp) return 'purchase';

  if (/^(e se|se eu|se minha|se eu receber|se eu aumentar|se eu reduzir|simule|simular)\b/.test(q)) return 'simulation';
  if (/diagnost|analise completa|saude financeira|situacao financeira|raio.?x|panorama/.test(q)) return 'diagnosis';
  if (/salario|renda|receit/.test(q) && /janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2}/.test(q)) return 'historical_income';

  const datasetHint = datasetIntentHint(q);
  if (datasetHint && datasetHint !== 'purchase') return datasetHint;

  const save=/guardar|guardo|poupar|poupo|economizar|economizo|juntar|junto|separar|deixar.*conta|deixar.*parado|reserva|caixinha|dinheiro parado/;
  const invest=/investir|invisto|investimento|aplicar|aplico|aplicacao|carteira/;
  const purchase=/comprar|compra|parcelar|parcelado|parcela|celular|tv|notebook|produto|posso gastar.*compra|vale a pena comprar|simule.*compra|\b\d+\s*x\b/;
  if (save.test(q)&&invest.test(q)) return 'save_vs_invest';
  if (save.test(q) && !purchase.test(q) && (/(conta|parado|guardar|poupar|economizar|juntar|separar)/.test(q))) return 'save_vs_invest';
  if (invest.test(q) && !purchase.test(q)) return 'save_vs_invest';

  if (/(quanto|qual|como|quando|prazo|tempo).*(guardar|poupar|economizar|aportar|aporte|meta|objetivo)|quanto falta.*(meta|objetivo)|projec[aã]o|em quanto tempo.*(chego|atingir|alcan[cç]ar)|ate dezembro|até dezembro/.test(q)) return 'goal';
  if (/(meta|objetivo|quero chegar|quero atingir|quero juntar|vou economizar|pretendo guardar|quero guardar|preciso guardar|formar uma reserva)/.test(q)) return 'goal';

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
