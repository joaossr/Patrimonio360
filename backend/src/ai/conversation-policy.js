import { parseFinancialValue } from './value-parser.js';
import { transactionsForMonth } from './context-engine.js';
import { evaluatePurchase, explainPurchase } from './decision-engine.js';
import { simulatePurchase } from './simulation-engine.js';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const money = v => Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'não disponível';

function usersOnly(memory = {}) {
  return (memory.recent || []).filter(x => x?.role === 'user');
}

function lastMatchingUser(memory, pattern) {
  return [...usersOnly(memory)].reverse().find(x => pattern.test(norm(x.content || '')))?.content || '';
}

function recentPurchase(memory = {}) {
  const users = usersOnly(memory);
  for (const item of [...users].reverse()) {
    const text = item.content || '';
    const q = norm(text);
    if (!/compr|celular|notebook|televis|\btv\b|produto|compra|parcel/.test(q)) continue;
    const parsed = parseFinancialValue(text);
    if (parsed.total > 0) return { text, parsed };
  }
  return null;
}

function activeGoal(state = {}, memory = {}) {
  const goals = Array.isArray(state.goals) ? state.goals : [];
  const preferred = memory.preferences?.find(p => p.key === 'activeFinancialGoal')?.value;
  const byId = goals.find(g => String(g.id) === String(preferred));
  if (byId) return byId;
  const targetPref = memory.preferences?.find(p => p.key === 'activeFinancialGoalTarget')?.value;
  const target = Number(String(targetPref || '').split('|')[0].replace(/\./g, '').replace(',', '.'));
  if (target) {
    const byTarget = goals.find(g => Math.abs(Number(g.target || 0) - target) < 0.01);
    if (byTarget) return byTarget;
  }
  return goals[0] || null;
}

function greeting(q) {
  if (/^bom dia(?:[!, .]|$)/.test(q)) return 'Bom dia! 😊 Como posso ajudar você hoje?';
  if (/^boa tarde(?:[!, .]|$)/.test(q)) return 'Boa tarde! 😊 Como posso ajudar você hoje?';
  if (/^boa noite(?:[!, .]|$)/.test(q)) return 'Boa noite! 😊 Como posso ajudar você hoje?';
  if (/^(fala|e ai|eai)(?:[!, .]|$)/.test(q)) return 'Fala! 😄 O que você precisa resolver hoje?';
  return 'Olá! Tudo bem? 😊 Como posso ajudar você hoje?';
}

function isGreetingOnly(q) {
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|tudo bem|tudo certo|como voce esta|como voce vai|como esta voce|e ai|eai|fala)(?:[!,?. ]*)$/i.test(q);
}

function isCapabilities(q) {
  return /^(?:o que voce consegue fazer|o que voce pode fazer|o que voce faz|como voce pode me ajudar|quais sao suas funcoes|quais suas funcoes|como voce funciona|no que voce pode ajudar|me explica.*(?:suas )?principais funcoes|me explica.*o que voce consegue|quais.*recursos voce tem|o que da pra fazer aqui)(?:[!?., ]*)$/.test(q);
}

function isOrganizationQuestion(q) {
  return /(?:quero|preciso|vou|pretendo).*(?:organizar|organizar minha vida financeira|colocar.*financas.*em ordem|arrumar.*financas|sair.*bagun[cç]a financeira)/.test(q) || /por onde comeco.*(?:finance|dinheiro|financas)/.test(q);
}

function organizationAnswer(analysis) {
  const income = Number(analysis?.income?.total || 0);
  const expenses = Number(analysis?.expenses?.total || 0);
  const margin = income - expenses;
  if (income || expenses) {
    return `Eu começaria pelo básico, sem complicar: **1)** levantar sua renda e despesas fixas, **2)** cortar ou ajustar os gastos que estão pesando, **3)** formar uma reserva de emergência e **4)** definir uma meta financeira concreta.\n\nHoje, pelos dados disponíveis, entram ${money(income)} e saem ${money(expenses)}, deixando uma folga de ${money(margin)} no período. Se quiser, posso partir daqui e montar um diagnóstico em ordem de prioridade.`;
  }
  return 'Eu começaria pelo básico: mapear renda e despesas, separar gastos fixos dos variáveis, montar uma reserva de emergência e definir uma meta. Se você me disser sua renda e principais despesas, eu organizo isso com você.';
}

function expenseSummary(state, month) {
  const expenses = transactionsForMonth(state, month).filter(t => t.type === 'expense');
  if (!expenses.length) return `Não encontrei despesas cadastradas em ${month}. Não vou substituir esse período pelos dados de outro mês.`;
  const total = expenses.reduce((sum, t) => sum + Number(t.value || 0), 0);
  return `Até agora, em ${month}, você gastou **${money(total)}** em ${expenses.length} despesa(s).`;
}

function expenseByCategory(state, month) {
  const expenses = transactionsForMonth(state, month).filter(t => t.type === 'expense');
  if (!expenses.length) return `Não encontrei despesas cadastradas em ${month}.`;
  const groups = new Map();
  for (const t of expenses) {
    const category = String(t.category || t.description || 'Sem categoria').trim() || 'Sem categoria';
    groups.set(category, (groups.get(category) || 0) + Number(t.value || 0));
  }
  const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  return `Neste período, suas maiores despesas foram:\n\n${rows.slice(0, 5).map(([category, value], i) => `${i + 1}. **${category}** — ${money(value)} (${total ? ((value / total) * 100).toFixed(1).replace('.', ',') : '0'}%)`).join('\n')}\n\nTotal gasto: **${money(total)}**.`;
}

function explicitCategoryQuestion(q) {
  return /onde estou gastando mais|onde gasto mais|maiores gastos|maior gasto|categorias.*gasto|gasto.*categoria|despesas.*categoria/.test(q);
}

function purchaseStatement(q, memory) {
  if (!/^(?:eu\s+)?comprei\b/.test(q)) return null;
  const parsed = parseFinancialValue(q);
  if (!parsed.total) return 'Entendi que você fez uma compra. Se quiser que eu analise o impacto dela, me diga o valor e, se houver, em quantas parcelas.';
  const installment = parsed.installments > 1 ? ` em ${parsed.installments}x de ${money(parsed.installmentValue)}` : ' à vista';
  return `Entendi: uma compra de **${money(parsed.total)}**${installment}. Se quiser, posso avaliar o impacto dessa compra no seu orçamento e nas suas metas.`;
}

function purchaseFollowUp(q, state, memory, analysis) {
  const purchase = recentPurchase(memory);
  if (!purchase) return null;
  const goal = activeGoal(state, memory);
  if (/por que voce nao recomenda|porque voce nao recomenda|por que nao recomenda|por que voce recomenda|por que evitar|por que evitaria/.test(q)) {
    const decision = evaluatePurchase(purchase.text, {
      analysis,
      financialModel: null,
      goals: state.goals || [],
      budget: analysis?.budget || null,
      risk: analysis?.risk || null
    }, memory);
    return explainPurchase(decision);
  }
  if (/(quanto|como).*(atras|adiar|impactar|afetar).*(meta|objetivo)|quanto.*(atrasaria|vai atrasar).*meta/.test(q)) {
    const sim = simulatePurchase({ analysis, goal, purchase: purchase.parsed });
    if (goal && sim.goal) {
      const before = Number(goal.current || 0);
      const remaining = Math.max(0, Number(goal.target || 0) - before);
      const monthlyBefore = sim.goal.baselineMonthly;
      const monthlyAfter = sim.goal.projectedMonthly;
      return `Se você fizer essa compra, ela não muda a meta oficialmente, mas pode reduzir sua capacidade de aporte.\n\nCompra: **${money(purchase.parsed.total)}** em ${purchase.parsed.installments}x de **${money(purchase.parsed.installmentValue)}**.\nMeta: **${goal.name}** — faltam **${money(remaining)}**.\n${monthlyBefore != null && monthlyAfter != null ? `A necessidade mensal estimada passaria de **${money(monthlyBefore)}** para **${money(monthlyAfter)}**.` : `O impacto mensal estimado é de **${money(sim.monthly)}**.`}\n\nIsso é uma simulação; nenhum dado real foi alterado.`;
    }
    return `Posso simular o impacto dessa compra, mas não encontrei uma meta ativa com prazo suficiente para calcular quanto ela atrasaria.`;
  }
  if (/^(e se|se eu|e|entao|mas|essa compra|essa|isso)\b/.test(q) && /meta|objetivo|compra|celular|parcel/.test(q)) {
    const sim = simulatePurchase({ analysis, goal, purchase: purchase.parsed });
    return `Simulei a compra de **${money(purchase.parsed.total)}** em ${purchase.parsed.installments}x de **${money(purchase.parsed.installmentValue)}**. A margem estimada após a compra seria **${money(sim.simulatedMargin)}**. ${goal ? `A meta **${goal.name}** continua sendo considerada.` : 'Não há uma meta ativa suficiente para calcular o efeito sobre uma meta.'} Não alterei seus dados.`;
  }
  return null;
}

export function applyConversationPolicy({ question, state, month, memory, analysis }) {
  const q = norm(question);
  if (isGreetingOnly(q)) return { answer: greeting(q), intent: 'greeting' };
  if (isCapabilities(q)) return { answer: 'Posso controlar receitas e despesas, analisar compras e parcelas, acompanhar metas e reserva, analisar fluxo de caixa, cartões e orçamento, fazer simulações, identificar riscos e usar seu histórico financeiro para personalizar as recomendações.', intent: 'capabilities' };
  if (isOrganizationQuestion(q)) return { answer: organizationAnswer(analysis), intent: 'financial_organization' };
  if (/quanto|qto|qnto|total|soma|gastei/.test(q) && /gastei|gasto|despesas?|gastos?/.test(q) && !/em (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?20\d{2}/.test(q)) return { answer: expenseSummary(state, month), intent: 'expenses' };
  if (explicitCategoryQuestion(q)) return { answer: expenseByCategory(state, month), intent: 'expenses' };
  const statement = purchaseStatement(q, memory);
  if (statement) return { answer: statement, intent: 'purchase' };
  const followUp = purchaseFollowUp(q, state, memory, analysis);
  if (followUp) return { answer: followUp, intent: 'purchase' };
  return null;
}
