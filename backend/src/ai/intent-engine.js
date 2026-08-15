import { normalizeUserText } from './text-normalizer.js';

function classifyFallback(q){
  const hasMoney=/r\$|\b\d{3,}\b|\b\d+[.,]\d{2}\b|\b\d+\s*mil\b|\b(um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte)\s+mil\b/.test(q);
  if(/guardar|poupar|economizar|juntar|aportar|meta|objetivo|5 mil|5k/.test(q)) return 'goal';
  if(/investir|investimento|aplicar|aplicacao|carteira/.test(q)) return 'save_vs_invest';
  if(/reserva|emergencia|caixinha/.test(q)) return 'reserve';
  if(/gasto|gastei|despesa|torrei|paguei/.test(q)) return 'expenses';
  if(/orcamento|margem|folga|quanto posso gastar|quanto ainda posso|quanto sobra/.test(q)) return 'budget';
  if(/pagar|receber|vencimento|compromisso|fluxo|proximo mes/.test(q)) return 'cashflow';
  if(/saldo|conta|banco|dinheiro disponivel/.test(q)) return 'accounts';
  if(/cartao|fatura|limite/.test(q)) return 'cards';
  if(/comprar|compra|parcelar|parcela|celular|tv|notebook|produto/.test(q)||/\b\d+\s*x\b/.test(q)) return 'purchase';
  if(/diagnostico|saude financeira|raio x|analise completa|panorama/.test(q)) return 'diagnosis';
  if(hasMoney&&/recebi|renda|salario|entrou|ganhei|sobrou|tenho|coloquei|aportei/.test(q)) return 'accounts';
  return null;
}

export function detectIntent(question, memory = {}) {
  const q = normalizeUserText(question);
  const previous = [...(memory.recent || [])].reverse().find(x => x.role === 'user')?.content || '';
  const hasHistory = Boolean(previous);
  if(/diagnost|analise completa|saude financeira|situacao financeira|raio.?x/.test(q)) return 'diagnosis';
  if(/salario|renda|receit/.test(q) && /janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2}/.test(q)) return 'historical_income';
  const saveWords=/guardar|guardo|poupar|poupo|economizar|economizo|juntar|junto|deixar.*conta|deixar.*parado|reserva|caixinha|dinheiro parado/;
  const investWords=/investir|invisto|investimento|aplicar|aplico|aplicacao|carteira/;
  if((saveWords.test(q)&&investWords.test(q))||/guardo.*invisto|invisto.*guardo|poupo.*aplico|aplico.*poupo|guardar.*investir|investir.*guardar/.test(q)) return 'save_vs_invest';
  const goalWords=/preciso ter|quero ter|pretendo atingir|quero formar|meu objetivo|objetivo de|minha meta|meta de|quero chegar|quero atingir|quero juntar|vou economizar|pretendo guardar|quero guardar|preciso guardar|formar uma reserva|juntar dinheiro|chegar nos?\s*\d|atingir\s*r?\$?\s*\d/;
  const projectionWords=/quanto.*(guardar|poupar|economizar|aportar)|qual.*aporte|quanto falta.*(meta|objetivo)|quando.*(chegar|atingir|alcan[cç]ar).*meta|projec[aã]o|projetar.*meta|em quanto tempo.*(chego|chegar|atingir)|quanto.*ate dezembro|quanto.*até dezembro|aporte.*preciso|preciso.*aporte|prazo.*meta/;
  if(projectionWords.test(q)||(hasHistory&&/meta|objetivo|aporte|guardar|poupar/.test(q))) return 'goal';
  if(goalWords.test(q)) return 'goal';
  if(/posso comprar|vale a pena comprar|comprar|compra|posso gastar|simule uma compra|celular|violao|produto|posso parcelar|parcelar|parcelado|fazer em \d+|em \d+x|\d+\s*(?:x|vezes|parcelas?)/.test(q)) return 'purchase';
  if(/cartao|fatura|limite/.test(q)) return 'cards';
  if(/orcamento|quanto posso gastar|margem|quanto ainda posso|quanto sobra/.test(q)) return 'budget';
  if(/compromisso|a pagar|a receber|proxim|vencimento|fluxo futuro|o que tenho para pagar|o que tenho para receber/.test(q)) return 'cashflow';
  if(/reserva|emergencia/.test(q)) return 'reserve';
  if(/gastei|gastos|despesas|categoria|onde gasto|cortar|gastando demais|gasto mais/.test(q)) return 'expenses';
  if(/saldo|contas bancarias|dinheiro disponivel|quanto dinheiro|quanto tenho no banco|quanto tenho nas contas|quanto tenho em conta/.test(q)) return 'accounts';
  if(/corrig|esta errado|nao e|interpretei|quis dizer|nao foi isso|minha prioridade/.test(q)) return 'feedback';
  if(/memoria|lembra|esqueceu/.test(q)) return 'memory';
  if(hasHistory&&/^(e|entao|mas|se|quanto|qual|como|isso|esse|essa|ele|ela|nesse caso|e se)\b/.test(q)) return 'continuation';
  return classifyFallback(q)||'general';
}
