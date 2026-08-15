const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function detectIntent(question, memory = {}) {
  const q = norm(question);
  const recent = Array.isArray(memory.recent) ? memory.recent : [];
  const previous = [...recent].reverse().find(x => x.role === 'user')?.content || '';
  const hasHistory = Boolean(previous);

  // Comparative language wins before goal/purchase keywords so numbers in a comparison
  // can never be mistaken for a new goal or transaction.
  if (/\b(e melhor|vale mais a pena|qual (?:opcao|opção|escolha) e melhor|qual e melhor|qual opção é melhor|compensa|comparar|compare|diferen[cç]a entre|ou)\b/.test(q)) return 'comparison';
  if (/voce entendeu errado|você entendeu errado|est[aá] errado|quis dizer|corrigindo|nao foi isso|não foi isso|eu estava perguntando/.test(q)) return 'feedback';
  if (/^(e se|se eu|e quanto|quanto fica|quanto seria|em \d+\s*(?:x|vezes|parcelas?))\b/.test(q) && hasHistory) return 'simulation';
  if (/diagnost|analise completa|saude financeira|situacao financeira|raio.?x/.test(q)) return 'diagnosis';
  if (/qual foi meu|sal[aá]rio|renda|receita/.test(q) && /janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|20\d{2}|\d{4}[-/]\d{1,2}/.test(q)) return 'historical_income';
  if (/estou gastando demais|pior habito|pior hábito|desperdic|desperd[ií]cio|meu comportamento|comportamento|o que devo mudar primeiro|mudar primeiro/.test(q)) return 'behavior';
  if (/quanto vou ter disponivel|quanto vou ter disponível|proximo mes|pr[oó]ximo m[eê]s|mes que vem|fluxo de caixa|disponibilidade projetada/.test(q)) return 'cashflow';
  if (/quanto falta|quanto preciso guardar|acompanhar meta|meta|objetivo|quero chegar|quero atingir|quero juntar/.test(q)) return 'goal';
  if (/posso comprar|vale a pena comprar|comprar|compra|posso gastar|simule uma compra|celular|viol[aã]o|produto/.test(q)) return 'purchase';
  if (/\b\d+\s*x\b|\d+\s*(?:vezes|parcelas?)|parcelado/.test(q)) return 'purchase';
  if (/investiment|carteira|ativo|aplica[cç][aã]o/.test(q)) return 'investments';
  if (/cart[aã]o|fatura|limite/.test(q)) return 'cards';
  if (/or[cç]amento|quanto posso gastar|margem|limite/.test(q)) return 'budget';
  if (/compromisso|a pagar|a receber|vencimento|fluxo futuro/.test(q)) return 'cashflow';
  if (/reserva|emerg[eê]ncia/.test(q)) return 'reserve';
  if (/gastei|gastos|despesas|categoria|onde gasto|economizar|cortar/.test(q)) return 'expenses';
  if (/saldo|contas banc[aá]rias|dinheiro dispon[ií]vel/.test(q)) return 'accounts';
  if (/mem[oó]ria|lembra|esqueceu/.test(q)) return 'memory';
  if (hasHistory && /^(e|ent[aã]o|mas|se|quanto|qual|como|isso|esse|essa|ele|ela|nesse caso|e se)\b/.test(q)) return 'continuation';
  return 'general';
}
