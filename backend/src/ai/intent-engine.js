const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function detectIntent(question, memory = {}) {
  const q = norm(question);
  const previous = [...(memory.recent || [])].reverse().find(x => x.role === 'user')?.content || '';
  if (/diagnost|analise completa|an[aá]lise completa|saude financeira|situa[cç][aã]o financeira/.test(q)) return 'diagnosis';
  if (/sal[aá]rio|renda|receit/.test(q) && /janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}-\d{2}/.test(q)) return 'historical_income';
  if (/meta|objetivo|chegar|atingir|juntar|guardar/.test(q)) return 'goal';
  if (/comprar|compra|posso gastar|vale a pena|celular|viol[aã]o|produto/.test(q)) return 'purchase';
  if (/\b\d+\s*x\b|parcel|vezes/.test(q)) return 'purchase';
  if (/investiment|carteira|ativo|aplica[cç][aã]o/.test(q)) return 'investments';
  if (/cart[aã]o|fatura|limite/.test(q)) return 'cards';
  if (/or[cç]amento|quanto posso gastar|margem|limite/.test(q)) return 'budget';
  if (/compromisso|a pagar|a receber|pr[oó]xim|vencimento|fluxo futuro/.test(q)) return 'cashflow';
  if (/reserva|emerg[eê]ncia/.test(q)) return 'reserve';
  if (/gastei|gastos|despesas|categoria|onde gasto|economizar|cortar/.test(q)) return 'expenses';
  if (/saldo|contas banc[aá]rias|dinheiro dispon[ií]vel/.test(q)) return 'accounts';
  if (/corrig|est[aá] errado|n[aã]o [eé]|interpretei|quis dizer/.test(q)) return 'feedback';
  if (/mem[oó]ria|lembra|esqueceu/.test(q)) return 'memory';
  if (/^(e|ent[aã]o|mas|se|quanto|qual|como|isso|esse|essa|e se)\b/.test(q) && previous) return 'continuation';
  return 'general';
}
