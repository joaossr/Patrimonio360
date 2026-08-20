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
  const cash=/a pagar|a receber|o que (?:vou )?(?:pagar|receber)|tenho (?:para|a) (?:pagar|receber)|vencimento|compromiss?|fluxo|proximo mes|proximos dias|este mes/;
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

  if (/corrig|esta errado|nao e|n[aã]o [eé]|interpretei|quis dizer|nao foi isso|n[aã]o foi isso|minha prioridade/.test(q)) return 'feedback';
  if (/\b(?:voce|vc)\b.*\b(?:lembra|lembrar|recorda|recordar)\b|\b(?:lembra|lembrar|recorda|recordar)\b.*\b(?:minha|meu|sobre|da|do)\b|\b(?:o que|qual)\b.*\b(?:voce|vc)\b.*\b(?:lembra|recorda)\b|\bmemoria\b|\blembra\b|\besqueceu\b/.test(q)) return 'memory';
  if (/(?:quanto|qual).*\b(?:ganhei|recebi|minha renda|sal[aá]rio|receita)\b.*\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2})\b|\b(?:ganhei|recebi|minha renda|sal[aá]rio|receita)\b.*\b(?:em|no|na)\b.*\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*\b20\d{2}\b/.test(q)) return 'historical_income';
  if (/\b(?:deixo|deixar|mantenho|manter)\b.*\b(?:conta|banco|parado)\b.*\b(?:ou|versus|vs)\b.*\b(?:aplicar|inv?estir|investimento|rendimento|render)\b/.test(q)) return 'save_vs_invest';
  if (/\b(?:aplicar|investir|investimento|rendimento|render)\b.*\b(?:ou|versus|vs)\b.*\b(?:guardar|poupar|deixar|manter)\b/.test(q)) return 'save_vs_invest';
  if (/analise.*cart(?:ao|oes)|analis[ae].*cart(?:ao|oes)|fatura.*cart(?:ao|oes)|limite.*cart(?:ao|oes)|cart(?:ao|oes).*credito|cart(?:ao|oes).*fatura|como.*cart(?:ao|oes)|qual.*fatura|quanto.*fatura|quando.*fatura|quanto.*(?:disponivel).*cart(?:ao|oes)/.test(q)) return 'cards';
  if (/quanto gastei|quanto.*gastei.*(?:mes|m[eê]s)|analise.*(?:gastos|despesas)|analisar.*(?:gastos|despesas)|meus gastos|minhas despesas|quais (?:sao|são) meus (?:maiores )?gastos|onde gasto|cortar gastos|estou gastando demais|onde posso economizar|meus gastos estao altos/.test(q)) return 'expenses';
  if (/como posso melhorar.*orcamento|melhorar.*orcamento|organizar.*orcamento|como.*orcamento|qual (?:e|é|meu|o meu)\s*orcamento|quanto (?:posso|ainda posso) gastar|qual minha margem|quanto sobra no orcamento|tenho margem para uma compra|tenho espaco no orcamento|meu orcamento aguenta|quanto posso comprometer|como esta meu orcamento/.test(q)) return 'budget';
  if (/o que (?:tenho|vou|irei)?\s*(?:para|a)?\s*(?:pagar|receber)|o que (?:recebo|pago|vou receber|vou pagar)\b|a pagar|a receber|proximas semanas|proximos dias|proximo mes|este mes|compromissos?|vencimentos?|quais contas vencem|quanto vou pagar.*(?:proximos|meses)|o que vence este mes|o que recebo este mes|quanto tenho a pagar|quanto tenho a receber/.test(q)) return 'cashflow';
  if (/quanto tenho.*(?:conta|contas|banco)|saldo.*(?:conta|contas|banco)|dinheiro disponivel|saldo das contas|quanto tenho no banco|quanto tenho nas contas|qual meu saldo|quanto dinheiro tenho|quanto tenho disponivel/.test(q)) return 'accounts';
  if (/fa[çc]a um diagn[oó]stico|diagnostico|analise completa|analise.*situacao|analise.*saude|saude financeira|situacao financeira|raio.?x|panorama|como esta minha situacao financeira|como voce avalia minhas financas/.test(q)) return 'diagnosis';
  if (/quanto tenho na reserva|como esta minha reserva|minha reserva esta boa|quanto falta para minha reserva|quero montar uma reserva|quero formar reserva|como construir minha reserva|quanto devo deixar na reserva|devo priorizar a reserva/.test(q)) return 'reserve';
  const purchaseFollowUp = hasHistory && /^(e se|se eu|e|entao|mas|quanto|qual|como|isso|esse|essa|nesse caso)\b/.test(q) && /comprar|compra|parcelar|parcelado|parcela|\b\d+\s*x\b|vezes|parcelas/.test(`${q} ${normalizeUserText(previous)}`);
  if (purchaseFollowUp) return 'purchase';
  if (/^e se\b.*\bfizer\b.*\b\d+\s*(?:parcelas?|vezes)\b/.test(q)) return 'purchase';
  if (hasHistory) {
    const prev = normalizeUserText(previous);
    if (/meta|objetivo|chegar|atingir|juntar|guardar|economizar|aportar|ate dezembro|até dezembro/.test(prev) && /^(quanto falta|quanto|qual|quando|em quanto tempo|e por mes|e por mês|por mes|por mês)\b/.test(q)) return 'goal';
    if (/reserva|emergencia|caixinha/.test(prev) && /^(quanto|qual|como|devo|preciso)\b/.test(q)) return 'reserve';
    if (/comprar|compra|parcelar|parcelado|parcela|celular|tv|notebook|produto/.test(prev) && /^(quanto|qual|como|posso|e se|em \d+\s*x\??|em \d+\s*vezes\??|essa|isso|esse)\b/.test(q)) return 'purchase';
    if (/gastei|gastos?|despesas?|gastando|paguei/.test(prev) && /^(onde|quanto|qual|como)\b/.test(q)) return 'expenses';
    if (/orcamento|margem|folga|quanto posso gastar|quanto ainda posso/.test(prev) && /^(quanto|qual|como|tenho)\b/.test(q)) return 'budget';
    if (/cartao|fatura|limite/.test(prev) && /^(quanto|qual|como|quando|tenho)\b/.test(q)) return 'cards';
    if (/a pagar|a receber|vencimento|compromiss|fluxo/.test(prev) && /^(quanto|qual|como|o que|quando)\b/.test(q)) return 'cashflow';
    if (/saldo|conta|banco|dinheiro disponivel|quanto dinheiro/.test(prev) && /^(quanto|qual|como)\b/.test(q)) return 'accounts';
  }
  if (/^(e se|se eu|se minha|se eu receber|se eu aumentar|se eu reduzir|simule|simular)\b/.test(q)) return 'simulation';
  // Current receipt statements should be treated as account updates. Historical income
  // is reserved for explicitly time-qualified income questions.
  const currentReceipt=/\b(?:recebi|ganhei|me pagaram|entrou|caiu)\b.*\b(?:sal[aá]rio|renda|dinheiro|grana|bico|freela|freelance|pix|pagamento|trabalho|venda|vendas|cliente|clientes)\b.*\b(?:hoje|agora|ontem|essa semana|este mes|neste mes)\b/;
  if (currentReceipt.test(q)) return 'accounts';
  const informalIncome=/\b(?:recebi|ganhei|me pagaram|entrou|caiu)\b.*\b(?:sal[aá]rio|renda|dinheiro|grana|bico|freela|freelance|pix|pagamento|trabalho|venda|vendas|cliente|clientes)\b/;
  if (informalIncome.test(q)) return 'historical_income';
  if (/salario|renda|receit/.test(q) && /janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2}/.test(q)) return 'historical_income';
  const save=/guardar|guardo|poupar|poupo|economizar|economizo|juntar|junto|separar|deixar.*conta|deixar.*parado|reserva|caixinha|dinheiro parado/;
  const invest=/investir|invisto|investimento|aplicar|aplico|aplicacao|carteira/;
  const purchase=/comprar|compra|parcelar|parcelado|parcela|celular|tv|notebook|produto|posso gastar.*compra|vale a pena comprar|simule.*compra|\b\d+\s*x\b/;
  const goalProjection=/(quanto|qual|como|quando|prazo|tempo).*(guardar|poupar|economizar|aportar|aporte|meta|objetivo)|quanto falta.*(meta|objetivo)|projec[aã]o|em quanto tempo.*(chego|atingir|alcan[cç]ar)|ate dezembro|até dezembro/;
  const goalCreation=/(meta|objetivo|preciso ter|quero ter|quero chegar|quero atingir|quero juntar|vou economizar|pretendo atingir|pretendo guardar|quero guardar|preciso guardar|formar uma reserva)/;
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
  if (/a pagar|a receber|vencimento|compromiss|fluxo|proximo mes|proximos dias|o que tenho para pagar|o que tenho para receber|o que recebo|o que pago/.test(q)) return 'cashflow';
  if (/reserva|emergencia/.test(q)) return 'reserve';
  if (/gastei|gastos?|despesas?|categoria|onde gasto|cortar|gastando demais|gasto mais|torrei|paguei/.test(q)) return 'expenses';
  if (/saldo|contas bancarias|dinheiro disponivel|quanto dinheiro|quanto tenho no banco|quanto tenho nas contas|quanto tenho em conta/.test(q)) return 'accounts';
  if (/memoria|lembra|esqueceu/.test(q)) return 'memory';
  if (hasHistory && /^(e|entao|mas|se|quanto|qual|como|isso|esse|essa|ele|ela|nesse caso|e se)\b/.test(q)) return 'continuation';
  return classifyFallback(q)||'general';
}
