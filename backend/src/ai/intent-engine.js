import { normalizeUserText } from './text-normalizer.js';

export function detectIntent(question, memory = {}) {
  const q = normalizeUserText(question);
  const previous = [...(memory.recent || [])].reverse().find(x => x.role === 'user')?.content || '';
  const hasHistory = Boolean(previous);

  if (/diagnost|analise completa|analise geral|saude financeira|situacao financeira|raio.?x|panorama financeiro|como estou financeiramente|como estao minhas financas/.test(q)) return 'diagnosis';
  if (/(salario|renda|receit|ganhei|recebi)/.test(q) && /janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2}/.test(q)) return 'historical_income';

  const saveWords = /guardar|guardo|poupar|poupo|economizar|economizo|juntar|junto|deixar.*conta|deixar.*parado|reserva|caixinha|dinheiro parado/;
  const investWords = /investir|invisto|investimento|aplicar|aplico|aplicacao|carteira/;
  if ((saveWords.test(q) && investWords.test(q)) || /guardo.*invisto|invisto.*guardo|poupo.*aplico|aplico.*poupo|guardar.*investir|investir.*guardar|poupar.*investir|investir.*poupar/.test(q)) return 'save_vs_invest';

  const projectionWords = /quanto.*(?:guardar|poupar|economizar|aportar)|qual.*aporte|quanto falta.*(?:meta|objetivo|5 mil|5000)|quando.*(?:chegar|atingir|alcancar).*meta|projec[aã]o|projetar.*meta|em quanto tempo.*(?:chego|chegar|atingir)|quanto.*ate dezembro|quanto.*guardar.*mes|quanto.*poupar.*mes|aporte.*preciso|preciso.*aporte|prazo.*meta/;
  const goalWords = /preciso ter|quero ter|pretendo atingir|quero formar|meu objetivo|objetivo de|minha meta|meta de|quero chegar|quero atingir|quero juntar|vou economizar|pretendo guardar|quero guardar|preciso guardar|formar uma reserva|juntar dinheiro|chegar nos?\s*\d|atingir\s*r?\$?\s*\d/;
  if (projectionWords.test(q)) return 'goal';
  if (goalWords.test(q)) return 'goal';
  if (hasHistory && /^(e|entao|mas|se|quanto|qual|como|isso|esse|essa|ele|ela|nesse caso|e se)\b/.test(q)) return 'continuation';

  if (/posso comprar|vale a pena comprar|quero comprar|comprar|compra|posso gastar|simule uma compra|celular|violao|produto|posso parcelar|parcelar|parcelado|fazer em \d+|em \d+x|\d+\s*(?:x|vezes|parcelas?)/.test(q)) return 'purchase';
  if (/cartao|fatura|limite|credito/.test(q)) return 'cards';
  if (/quanto posso gastar|qual minha margem|margem para gastar|quanto ainda posso|quanto sobra no orcamento|quanto sobra.*mes|meu orcamento|orcamento|tenho margem|tenho espaco.*orcamento|espaco para gastar|posso comprometer|quanto posso comprometer/.test(q)) return 'budget';
  if (/compromisso|a pagar|a receber|proxim|vencimento|fluxo futuro|fluxo de caixa|o que tenho para pagar|o que tenho para receber|contas.*vencem|vai entrar|vai sair|entradas.*saidas|pagamentos futuros|recebimentos futuros/.test(q)) return 'cashflow';
  if (/reserva|emergencia|fundo de emergencia/.test(q)) return 'reserve';
  if (/gastei|gastos|despesas|categoria|onde gasto|cortar|gastando demais|gasto mais|gasto muito|meus gastos|minhas despesas|reduzir.*gasto/.test(q)) return 'expenses';
  if (/saldo|contas bancarias|dinheiro disponivel|quanto dinheiro|quanto tenho no banco|quanto tenho nas contas|quanto tenho em conta|saldo bancario|saldo atual|dinheiro em conta|tenho disponivel/.test(q)) return 'accounts';
  if (/corrig|esta errado|nao e|interpretei|quis dizer|nao foi isso|minha prioridade/.test(q)) return 'feedback';
  if (/memoria|lembra|esqueceu/.test(q)) return 'memory';
  return 'general';
}
