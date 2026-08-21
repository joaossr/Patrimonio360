import { normalizeUserText } from './text-normalizer.js';
import { datasetIntentHint } from './dataset-v2-knowledge.js';

function hasAny(q, patterns){ return patterns.some(p => p.test(q)); }

function classifyFallback(q){
  const money=/r\$|\b\d{2,}\b|\b\d+[.,]\d{2}\b|\b\d+\s*mil\b/;
  const save=/guardar|guardo|poupar|poupo|economizar|economizo|juntar|junto|separar|guardar dinheiro|deixar.*conta|deixar.*parado/;
  const invest=/investir|invisto|investimento|aplicar|aplico|aplicacao|carteira/;
  const reserve=/reserva|emergencia|caixinha/;
  const expense=/gastei|gastos?|despesas?|torrei|paguei|gastando|gasto/;
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

function isGreetingOnly(q){
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|e aí|fala|tudo bem|tudo certo|como voce esta|como você está|como voce vai|como você vai|como esta voce|como está você|oi tudo certo|oi tudo bem|ola tudo bem|olá tudo bem)[!?. ,]*$/.test(q);
}

function greetingPrefix(q){
  return /^(?:oi|ola|olá|bom dia|boa tarde|boa noite|e ai|e aí|fala|tudo bem|tudo certo|como voce esta|como você está|como voce vai|como você vai|como esta voce|como está você)(?:\s*[!?.:,;-]+\s*|\s+)/.test(q);
}

function isCapabilities(q){
  return /^(?:o que voce consegue fazer|o que você consegue fazer|o que voce pode fazer|o que você pode fazer|o que voce faz|o que você faz|como voce pode me ajudar|como você pode me ajudar|quais sao suas funcoes|quais são suas funções|quais suas funcoes|quais suas funções|como voce funciona|como você funciona|no que voce pode ajudar|no que você pode ajudar|me explica(?:\s+rapidamente)?(?:\s+suas)?\s+(?:principais\s+)?funcoes|me explique(?:\s+rapidamente)?(?:\s+suas)?\s+(?:principais\s+)?funcoes|pra que voce serve|para que voce serve|pra que você serve|para que você serve|o que da pra fazer aqui|o que da para fazer aqui)[!?. ,]*$/.test(q);
}

function isFinancialQuestion(q){
  return /quanto|qto|qnto|gastei|gasto|despesa|despesas|receita|recebi|ganhei|saldo|conta|cartao|fatura|limite|meta|reserva|investir|investimento|comprar|compra|parcel|orcamento|orçamento|fluxo|diagnostico|diagnóstico|situacao|situação|onde gasto|onde estou gastando|posso|vale a pena|como|por que|porque|qual|quando/.test(q);
}

export function detectIntent(question, memory = {}) {
  const q = normalizeUserText(question);
  const previous = [...(memory.recent || [])].reverse().find(x => x.role === 'user')?.content || '';
  const hasHistory = Boolean(previous);

  // A pure greeting must stay short. If a greeting is followed by a real question,
  // discard the social prefix and route the actual task instead.
  if (isGreetingOnly(q)) return 'greeting';
  if (greetingPrefix(q) && !isFinancialQuestion(q.replace(/^(?:oi|ola|olá|bom dia|boa tarde|boa noite|e ai|e aí|fala|tudo bem|tudo certo|como voce esta|como você está|como voce vai|como você vai)\s*[!?.:,;-]*\s*/,'').trim())) return 'greeting';
  if (isCapabilities(q)) return 'capabilities';

  if (/corrig|esta errado|está errado|nao e|não é|interpretei|quis dizer|nao foi isso|não foi isso|minha prioridade/.test(q)) return 'feedback';
  if (/\b(?:voce|vc)\b.*\b(?:lembra|lembrar|recorda|recordar)\b|\b(?:lembra|lembrar|recorda|recordar)\b.*\b(?:minha|meu|sobre|da|do)\b|\b(?:o que|qual)\b.*\b(?:voce|vc)\b.*\b(?:lembra|recorda)\b|\bmemoria\b|\blembra\b|\besqueceu\b/.test(q)) return 'memory';

  if (/(quanto|qual|onde).*\b(?:gastei|gasto|despesa|despesas|gastos)\b.*\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2})\b|\b(?:gastei|gasto|despesas?|gastos?)\b.*\b(?:em|no|na)\b.*\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*\b20\d{2}\b/.test(q)) return 'historical_expenses';

  if (/(?:quanto|qual).*\b(?:ganhei|recebi|minha renda|sal[aá]rio|receita)\b.*\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2})\b|\b(?:ganhei|recebi|minha renda|sal[aá]rio|receita)\b.*\b(?:em|no|na)\b.*\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*\b20\d{2}\b/.test(q)) return 'historical_income';
  if (/\b(?:deixo|deixar|mantenho|manter)\b.*\b(?:conta|banco|parado)\b.*\b(?:ou|versus|vs)\b.*\b(?:aplicar|inv?estir|investimento|rendimento|render)\b/.test(q)) return 'save_vs_invest';
  if (/\b(?:aplicar|investir|investimento|rendimento|render)\b.*\b(?:ou|versus|vs)\b.*\b(?:guardar|poupar|deixar|manter)\b/.test(q)) return 'save_vs_invest';
  if (/analise.*cart(?:ao|oes)|analis[ae].*cart(?:ao|oes)|fatura.*cart(?:ao|oes)|limite.*cart(?:ao|oes)|cart(?:ao|oes).*credito|cart(?:ao|oes).*fatura|como.*cart(?:ao|oes)|qual.*fatura|quanto.*fatura|quando.*fatura|quanto.*(?:disponivel).*cart(?:ao|oes)/.test(q)) return 'cards';
  if (/quanto gastei|quanto.*gastei.*(?:mes|m[eê]s)|qto.*gastei|qnto.*gastei|analise.*(?:gastos|despesas)|analisar.*(?:gastos|despesas)|meus gastos|minhas despesas|quais (?:sao|são) meus (?:maiores )?gastos|onde gasto|onde estou gastando|cortar gastos|estou gastando demais|onde posso economizar|meus gastos estao altos|meus gastos estão altos/.test(q)) return 'expenses';
  if (/como posso melhorar.*orcamento|como posso melhorar.*orçamento|melhorar.*orcamento|melhorar.*orçamento|organizar.*orcamento|organizar.*orçamento|organizar minha vida financeira|organizar minha vida financeira|por onde comeco|por onde começo|como.*orcamento|como.*orçamento|qual (?:e|é|meu|o meu)\s*orcamento|qual (?:é|e) meu orçamento|quanto (?:posso|ainda posso) gastar|qual minha margem|quanto sobra no orcamento|quanto sobra no orçamento|tenho margem para uma compra|tenho espaco no orcamento|tenho espaço no orçamento|meu orcamento aguenta|meu orçamento aguenta|quanto posso comprometer|como esta meu orcamento|como está meu orçamento/.test(q)) return 'budget';
  if (/o que (?:tenho|vou|irei)?\s*(?:para|a)?\s*(?:pagar|receber)|o que (?:recebo|pago|vou receber|vou pagar)\b|a pagar|a receber|proximas semanas|próximas semanas|proximos dias|próximos dias|proximo mes|próximo mês|este mes|este mês|compromissos?|vencimentos?|quais contas vencem|quanto vou pagar.*(?:proximos|meses)|o que vence este mes|o que recebo este mes|quanto tenho a pagar|quanto tenho a receber/.test(q)) return 'cashflow';
  if (/quanto tenho.*(?:conta|contas|banco)|saldo.*(?:conta|contas|banco)|dinheiro disponivel|dinheiro disponível|saldo das contas|quanto tenho no banco|quanto tenho nas contas|qual meu saldo|quanto dinheiro tenho|quanto tenho disponivel|quanto tenho disponível/.test(q)) return 'accounts';
  if (/fa[çc]a um diagn[oó]stico|diagnostico|diagnóstico|analise completa|análise completa|analise.*situacao|análise.*situação|analise.*saude|análise.*saúde|saude financeira|saúde financeira|situacao financeira|situação financeira|raio.?x|panorama|como esta minha situacao financeira|como está minha situação financeira|como voce avalia minhas financas|como você avalia minhas finanças/.test(q)) return 'diagnosis';
  if (/quanto tenho na reserva|como esta minha reserva|como está minha reserva|minha reserva esta boa|minha reserva está boa|quanto falta para minha reserva|quero montar uma reserva|quero formar reserva|como construir minha reserva|quanto devo deixar na reserva|devo priorizar a reserva/.test(q)) return 'reserve';

  const purchaseFollowUp = hasHistory && /^(e se|se eu|e|entao|então|mas|quanto|qual|como|isso|esse|essa|nesse caso)\b/.test(q) && /comprar|compra|parcelar|parcelado|parcela|\b\d+\s*x\b|vezes|parcelas/.test(`${q} ${normalizeUserText(previous)}`);
  if (purchaseFollowUp) return 'purchase';
  if (/^e se\b.*\bfizer\b.*\b\d+\s*(?:parcelas?|vezes)\b/.test(q)) return 'purchase';

  if (hasHistory) {
    const prev = normalizeUserText(previous);
    if (/meta|objetivo|chegar|atingir|juntar|guardar|economizar|aportar|ate dezembro|até dezembro/.test(prev) && /^(quanto falta|quanto|qual|quando|em quanto tempo|e por mes|e por mês|por mes|por mês)\b/.test(q)) return 'goal';
    if (/reserva|emergencia|caixinha/.test(prev) && /^(quanto|qual|como|devo|preciso)\b/.test(q)) return 'reserve';
    if (/comprar|compra|parcelar|parcelado|parcela|celular|tv|notebook|produto/.test(prev) && /^(quanto|qual|como|posso|e se|em \d+\s*x\??|em \d+\s*vezes\??|essa|isso|esse|ele|ela)\b/.test(q)) return 'purchase';
    if (/gastei|gastos?|despesas?|gastando|paguei/.test(prev) && /^(onde|quanto|qual|como|qto|qnto)\b/.test(q)) return 'expenses';
    if (/orcamento|orçamento|margem|folga|quanto posso gastar|quanto ainda posso/.test(prev) && /^(quanto|qual|como|tenho)\b/.test(q)) return 'budget';
    if (/cartao|cartão|fatura|limite/.test(prev) && /^(quanto|qual|como|quando|tenho)\b/.test(q)) return 'cards';
    if (/a pagar|a receber|vencimento|compromiss|fluxo/.test(prev) && /^(quanto|qual|como|o que|quando)\b/.test(q)) return 'cashflow';
    if (/saldo|conta|banco|dinheiro disponivel|dinheiro disponível|quanto dinheiro/.test(prev) && /^(quanto|qual|como)\b/.test(q)) return 'accounts';
  }

  if (/^(e se|se eu|se minha|se eu receber|se eu aumentar|se eu reduzir|simule|simular)\b/.test(q)) return 'simulation';
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
  if (/cartao|cartão|fatura|limite/.test(q)) return 'cards';
  if (/orcamento|orçamento|quanto posso gastar|margem|folga|quanto ainda posso|quanto sobra/.test(q)) return 'budget';
  if (/a pagar|a receber|vencimento|compromiss|fluxo|proximo mes|próximo mês|proximos dias|próximos dias|o que tenho para pagar|o que tenho para receber|o que recebo|o que pago/.test(q)) return 'cashflow';
  if (/reserva|emergencia|emergência/.test(q)) return 'reserve';
  if (/gastei|gastos?|despesas?|categoria|onde gasto|onde estou gastando|cortar|gastando demais|gasto mais|torrei|paguei|gasto/.test(q)) return 'expenses';
  if (/saldo|contas bancarias|contas bancárias|dinheiro disponivel|dinheiro disponível|quanto dinheiro|quanto tenho no banco|quanto tenho nas contas|quanto tenho em conta/.test(q)) return 'accounts';
  if (/memoria|memória|lembra|esqueceu/.test(q)) return 'memory';
  if (hasHistory && /^(e|entao|então|mas|se|quanto|qual|como|isso|esse|essa|ele|ela|nesse caso|e se)\b/.test(q)) return 'continuation';
  return classifyFallback(q)||'general';
}
