const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function detectIntent(question, memory = {}) {
  const q = norm(question);
  const previous = [...(memory.recent || [])].reverse().find(x => x.role === 'user')?.content || '';
  const hasHistory = Boolean(previous);

  if (/diagnost|analise completa|saude financeira|situacao financeira|raio.?x/.test(q)) return 'diagnosis';
  if (/sal[aá]rio|renda|receit/.test(q) && /janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2}/.test(q)) return 'historical_income';
  if (/guardar|poupar|economizar/.test(q) && /investir|investimento|aplicar|aplicacao|carteira/.test(q)) return 'save_vs_invest';

  // Goal language must win over generic expense intent. This covers goal
  // creation, contribution planning and projection questions.
  if (/quero chegar|quero atingir|quero juntar|vou economizar|pretendo guardar|quero guardar|preciso guardar|quanto .*guardar|quanto .*poupar|quanto .*economizar|quanto falta.*meta|quanto falta.*objetivo|quando.*(chegar|atingir|alcan[cç]ar).*meta|projec[aã]o.*meta|projetar.*meta|em quanto tempo.*meta|quanto tempo.*meta|meta.*dezembro|objetivo.*dezembro|meta|objetivo/.test(q)) return 'goal';
  if (/posso comprar|vale a pena comprar|comprar|compra|posso gastar|simule uma compra|celular|viol[aã]o|produto/.test(q)) return 'purchase';
  if (/\b\d+\s*x\b|\d+\s*(?:vezes|parcelas?)|parcelado/.test(q)) return 'purchase';
  if (/cart[aã]o|fatura|limite/.test(q)) return 'cards';
  if (/or[cç]amento|quanto posso gastar|margem|limite/.test(q)) return 'budget';
  if (/compromisso|a pagar|a receber|pr[oó]xim|vencimento|fluxo futuro/.test(q)) return 'cashflow';
  if (/reserva|emerg[eê]ncia/.test(q)) return 'reserve';
  if (/gastei|gastos|despesas|categoria|onde gasto|cortar/.test(q)) return 'expenses';
  if (/saldo|contas banc[aá]rias|dinheiro dispon[ií]vel/.test(q)) return 'accounts';
  if (/corrig|est[aá] errado|nao e|não é|interpretei|quis dizer|nao foi isso|não foi isso|minha prioridade/.test(q)) return 'feedback';
  if (/mem[oó]ria|lembra|esqueceu/.test(q)) return 'memory';
  if (hasHistory && /^(e|ent[aã]o|mas|se|quanto|qual|como|isso|esse|essa|ele|ela|nesse caso|e se)\b/.test(q)) return 'continuation';
  return 'general';
}
