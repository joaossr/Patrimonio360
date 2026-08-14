/*
 * Patrimônio 360 — linguagem financeira contextual
 * Sem provedor externo: respostas determinísticas baseadas nos dados do usuário.
 * Objetivo: conversar como um consultor, mantendo contexto entre mensagens.
 */

const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const n = v => Number(v || 0);
const monthOf = x => String(x?.date || '').slice(0, 7);
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function parseMoney(text) {
    const raw = String(text || '');
    const matches = [...raw.matchAll(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi)];
    const thousandMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
    const thousandValue = thousandMatch ? Number(String(thousandMatch[1]).replace(',', '.')) * 1000 : 0;
    const values = matches.map(m => ({
        value: Number(String(m[1]).replace(/\./g, '').replace(',', '.')),
        raw: m[0],
        index: m.index || 0
    })).filter(x => Number.isFinite(x.value));
    // Nunca trate o número de parcelas (5x, 10 vezes) como valor da compra.
    const withoutInstallments = values.filter(x => {
        const tail = raw.slice(x.index + x.raw.length, x.index + x.raw.length + 14);
        return !/^\s*(?:x|vezes|parcelas?)/i.test(tail);
    });
    const monetary = withoutInstallments.find(x => /r\$|reais?|valor|gastar|comprar|compra|preço|preco|custar|custa|por\s+\d/i.test(raw.slice(Math.max(0,x.index-24), x.index+40)));
    return monetary?.value || thousandValue || 0;
}

function parseInstallments(text) {
    const m = norm(text).match(/(?:em|de|por)\s*(\d{1,2})\s*(?:x|vezes|parcelas?)/);
    return m ? Math.max(1, Number(m[1])) : 0;
}
function parseDateRef(text, currentMonth) {
    const t = norm(text);
    const [y, m] = String(currentMonth || '').split('-').map(Number);
    if (/proximo mes|mes que vem/.test(t)) return new Date(y, m, 1);
    if (/mes passado/.test(t)) return new Date(y, m - 2, 1);
    if (/este mes|esse mes|agora|hoje/.test(t)) return new Date(y, m - 1, 1);
    const named = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const idx = named.findIndex(x => t.includes(x));
    return idx >= 0 ? new Date(y, idx, 1) : null;
}
function formatMonth(date) {
    return date?.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) || '';
}

function lastUser(memory = {}) {
    return [...(memory.recent || [])].reverse().find(x => x.role === 'user') || null;
}
function conversationContext(question, memory = {}) {
    const previous = lastUser(memory);
    const previousAssistant = [...(memory.recent || [])].reverse().find(x => x.role === 'assistant') || null;
    const q = norm(question);
    const continuation = /^(e|entao|mas|se|nesse caso|e se|quanto|qual|como|onde|isso|ele|ela|esse|essa|aquela|aquele|no caso|e em)\b/.test(q)
        || /^(parcel|em \d+\s*x|e no|e na|e para|e se eu|se eu)/.test(q);
    return { previous, previousAssistant, continuation };
}

function inferTopic(question, memory = {}) {
    const q = norm(question);
    const ctx = conversationContext(question, memory);
    if (/por que|porque|explique|motivo|como chegou|de onde saiu/.test(q)) return 'explain';
    if (ctx.previous && (/^e\s+(?:em|para)\s+\d+\s*x/.test(q) || /^\d+\s*x\b/.test(q) || /^e\s+(?:em|de)\s+\d+\s+(?:vezes|parcelas?)/.test(q))) return 'purchase';
    if (/\b(e se|parcel|vezes|parcela|avista|a vista|entrada)\b/.test(q) && ctx.previous) return 'purchase';
    if (/cartao|cartoes|fatura|limite|disponivel|compras no cartao/.test(q)) return 'card';
    if (/assinatura|recorrencia|streaming/.test(q)) return 'subscriptions';
    if (/reserva|emergencia|sacar da reserva|retirar da reserva|quanto falta.*reserva|chegar.*reserva/.test(q)) return 'reserve';
    if (/meta|objetivo|quanto falta.*meta|aporte.*meta/.test(q)) return 'goals';
    if (/investimento|investimentos|rendimento|rentabilidade|patrimonio investido|aplicacao/.test(q)) return 'investments';
    if (/categoria|onde gasto|onde estou gastando|gastando mais|mais gasto|pesado|gastos por categoria/.test(q)) return 'categories';
    if (/orcamento|limite de gasto|quanto posso gastar|margem|ainda posso gastar/.test(q)) return 'budget';
    if (/pagar|a pagar|pendencia|pendencias|venc|compromisso|compromissos|receber|a receber|proximas semanas|proximos dias/.test(q)) return 'commitments';
    if (/saldo|contas|conta bancaria|caixa/.test(q)) return 'accounts';
    if (/previs|proxim|futuro|30 dias|fluxo/.test(q)) return 'forecast';
    if (/diagnost|situacao financeira|como estou|saude financeira|analise geral|resumo financeiro/.test(q)) return 'diagnosis';
    if (/economizar|economia|cortar|reduzir|melhorar|organizar/.test(q)) return 'optimization';
    if (/receita|recebi|renda|salario|entrada/.test(q)) return 'income';
    if (/despesa|gastei|gasto|saida|paguei/.test(q)) return 'expenses';
    if (/posso|comprar|compra|gastar|vale a pena/.test(q)) return 'purchase';
    if (ctx.continuation && ctx.previous) return inferTopic(ctx.previous.content, {});
    if (/meta|objetivo/.test(q)) return 'goals';
    return 'general';
}

function lastPurchaseUser(memory={}) {
    const items=[...(memory.recent||[])].filter(x=>x.role==='user');
    for(let i=items.length-1;i>=0;i--){
        const text=items[i].content||'';
        if(/comprar|compra|gastar|gasto|violao|violão|produto|preco|preço|r\$|reais/.test(norm(text)) && parseMoney(text)>0) return text;
    }
    return '';
}

function resolvePurchase(question, memory = {}) {
    const ctx = conversationContext(question, memory);
    const prev = lastPurchaseUser(memory) || ctx.previous?.content || '';
    const q = norm(question);
    let value = /r\$|reais?|valor|gastar|comprar|compra/.test(q) ? parseMoney(question) : 0;
    let installments = parseInstallments(question);
    if (!value && ctx.continuation) value = parseMoney(prev);
    if (!installments && ctx.continuation) installments = parseInstallments(prev);
    if (/avista|a vista/.test(q)) installments = 1;
    if (/parcel/.test(q) && !installments) installments = 1;
    if (installments > 1 && !value) {
        const prior = parseMoney(prev);
        value = prior;
    }
    return { value, installments: installments || 1, installmentValue: value ? value / (installments || 1) : 0, previous: prev };
}

function txByMonth(state, month) { return (state.transactions || []).filter(t => monthOf(t) === month); }
function settled(t) {
    const s = norm(t.status);
    return ['pago','paga','recebido','recebida','confirmado','confirmada'].includes(s);
}
function accountBalance(state) {
    return (state.accounts || []).reduce((s, a) => s + n(a.balance ?? a.saldo ?? a.current), 0);
}
function reserveValue(state) { return n(state.reserve?.current ?? state.reserve?.amount); }
function categoryRows(state, month) {
    const map = {};
    txByMonth(state, month).filter(t => t.type === 'expense').forEach(t => {
        const key = t.category || 'Sem categoria';
        map[key] = (map[key] || 0) + n(t.value);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a,b) => b.value-a.value);
}
function categoryBudget(state, month, category) {
    const b = (state.budgets || []).find(x => x.month === month && norm(x.category) === norm(category));
    return b ? n(b.limit ?? b.value) : 0;
}
function extractCategory(question, state, month) {
    const q = norm(question);
    const names = new Set([
        ...(state.categories || []).map(c => c.name),
        ...(state.budgets || []).filter(b => !b.month || b.month === month).map(b => b.category),
        ...categoryRows(state, month).map(x => x.name)
    ].filter(Boolean));
    return [...names].sort((a,b)=>String(b).length-String(a).length).find(name => q.includes(norm(name))) || null;
}
function upcomingWindow(state, days=30) {
    const today = new Date(); today.setHours(0,0,0,0);
    const end = new Date(today); end.setDate(end.getDate()+days); end.setHours(23,59,59,999);
    return (state.transactions || []).filter(t => {
        if (settled(t)) return false;
        const d = new Date(String(t.date || '')+'T12:00:00');
        return Number.isFinite(d.getTime()) && d >= today && d <= end;
    }).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
function parseTargetAmount(question) {
    const q = norm(question);
    if (!/(chegar|atingir|meta|objetivo|faltam|falta).*?(r\$|reais|mil|k|\d)/.test(q)) return 0;
    const value = parseMoney(question);
    if (!value) return 0;
    if (/\bmil\b/.test(q) && value < 1000) return value * 1000;
    return value;
}
function commitments(state, month) {
    const tx = txByMonth(state, month);
    return tx.filter(t => !settled(t)).sort((a,b) => String(a.date).localeCompare(String(b.date)));
}
function cardRows(state, month) {
    return (state.cards || []).map(card => {
        const purchases = txByMonth(state, month).filter(t => t.type === 'expense' && (t.payment === 'cartao' || t.payment === 'Cartão de crédito') && String(t.cardId) === String(card.id));
        const invoice = purchases.reduce((s,t)=>s+n(t.value),0);
        const paid = (state.cardPayments || []).filter(p => String(p.cardId) === String(card.id) && p.month === month).reduce((s,p)=>s+n(p.value),0);
        const open = Math.max(0, invoice - paid);
        const limit = n(card.limit ?? card.limite);
        const available = limit ? Math.max(0, limit - open) : null;
        return { card, purchases, invoice, paid, open, limit, available, utilization: limit ? open/limit : 0 };
    });
}
function goalRows(state) {
    return (state.goals || []).map(g => ({
        ...g,
        current: n(g.current ?? g.saved ?? g.value),
        target: n(g.target ?? g.goal ?? g.total),
        remaining: Math.max(0, n(g.target ?? g.goal ?? g.total) - n(g.current ?? g.saved ?? g.value))
    })).sort((a,b)=>b.remaining-a.remaining);
}
function investmentRows(state) {
    return (state.investments || []).map(i => ({...i, invested:n(i.invested), current:n(i.current ?? i.invested), proceeds:n(i.proceeds)}));
}
function budgetTotal(state, month) {
    const budgets=(state.budgets||[]).filter(b=>b.month===month);
    const explicit=budgets.reduce((s,b)=>s+n(b.limit ?? b.value),0);
    const names=new Set(budgets.map(b=>norm(b.category)));
    const dist=distributionPlanFor(state,month);
    return explicit + (names.has('investimentos')?0:dist.investment) + (names.has('lazer')?0:dist.leisure);
}
function incomeExpense(state, month) {
    const tx=txByMonth(state,month), incomes=tx.filter(t=>t.type==='income'), expenses=tx.filter(t=>t.type==='expense');
    const income=incomes.reduce((s,t)=>s+n(t.value),0), expense=expenses.reduce((s,t)=>s+n(t.value),0);
    const received=incomes.filter(settled).reduce((s,t)=>s+n(t.value),0), paid=expenses.filter(settled).reduce((s,t)=>s+n(t.value),0);
    return { income, expense, received, paid, pendingIncome:Math.max(0,income-received), pendingExpense:Math.max(0,expense-paid), planned:income-expense, realized:received-paid };
}

function riskText(risk) { return risk?.level === 'alto' ? 'alto' : risk?.level === 'moderado' ? 'moderado' : 'baixo'; }
function opener() { return ['Olhei seus números e','Cruzei seus lançamentos e','Fazendo as contas com o mês atual,','Pelos dados que você cadastrou,','Aqui a conta fica assim:'][Math.floor(Math.random()*5)]; }
function percent(v) { return `${n(v).toFixed(1).replace('.', ',')}%`; }
function list(items, limit=5) { return items.slice(0,limit).map(x => `• ${x}`).join('\n'); }

function parseMonthsUntilTarget(question, currentMonth) {
    const q=norm(question);
    const m=q.match(/(?:em|ate|até|no fim de|ate o fim de)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/);
    if(!m) return 0;
    const names=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const target=names.indexOf(m[1]);
    const [y,cm]=String(currentMonth||'').split('-').map(Number);
    if(!target || !cm) return 0;
    let diff=target-(cm-1);
    if(diff<0) diff+=12;
    return diff+1;
}

function monthlyContributionPlan(question, ctx) {
    const target=parseTargetAmount(question);
    if(!target) return null;
    const current=reserveValue(ctx.state);
    const months=parseMonthsUntilTarget(question, ctx.month);
    if(!months) return {target,current,months:0};
    const remaining=Math.max(0,target-current);
    const perMonth=remaining/months;
    const nextMonths=Math.max(0,months-1);
    const nextMonthAmount=nextMonths?remaining/nextMonths:remaining;
    return {target,current,months,remaining,perMonth,nextMonths,nextMonthAmount};
}

function contributionPlanResponse(question,ctx){
    const plan=monthlyContributionPlan(question,ctx);
    if(!plan) return null;
    if(!plan.months) return `Para calcular o aporte mensal, preciso do mês-alvo. Por exemplo: “quanto devo aportar por mês para chegar em R$ 5.000 em dezembro?”`;
    if(plan.remaining<=0) return `Você já está com ${money(plan.current)}, acima da meta de ${money(plan.target)}. Não há aporte obrigatório para atingir essa meta.`;
    const monthName=formatMonth(new Date(ctx.month+'-01T12:00:00'));
    return `Para sair de ${money(plan.current)} e chegar a ${money(plan.target)} até dezembro, faltam ${money(plan.remaining)}. Considerando ${plan.months} meses de ${monthName} até dezembro, o aporte médio é de **${money(plan.perMonth)} por mês**.

Se você não aportar neste mês e começar no próximo, seriam ${plan.nextMonths} meses e aproximadamente **${money(plan.nextMonthAmount)} por mês**. Esse cálculo não considera rendimento da reserva; se houver rendimento, o aporte necessário pode ser menor.`;
}

function isQuestionLike(text){
    const q=norm(text);
    return /^(posso|devo|vale a pena|e se|quanto|qual|como|onde|por que|porque|o que|me diga|analise|analisa|mostre|quais|quando|tem como|consigo|devo|preciso)/.test(q) || /\?\s*$/.test(String(text).trim());
}


function memoryFacts(memory = {}) {
    return Array.isArray(memory.facts) ? memory.facts : [];
}

function memoryPreferences(memory = {}) {
    const facts = memoryFacts(memory);
    const protectedCategories = new Set();
    const text = facts.map(f => `${f?.label || ''} ${f?.value || ''}`).join(' | ');
    const normalized = norm(text);
    // Só protege uma área quando isso está explicitamente registrado na memória.
    if (/nao abre mao.*saude|nao cortar.*saude|saude.*prioridade|prioridade.*saude/.test(normalized)) protectedCategories.add('saude');
    if (/nao abre mao.*estud|nao cortar.*estud|estud.*prioridade|prioridade.*estud/.test(normalized)) protectedCategories.add('estudos');
    return { protectedCategories, raw: facts };
}

function historyContext(state, month) {
    const months = [...new Set((state.transactions || []).map(t => monthOf(t)).filter(Boolean))].sort();
    const idx = months.indexOf(month);
    const previousMonth = idx > 0 ? months[idx - 1] : null;
    const recentMonths = months.slice(Math.max(0, idx >= 0 ? idx - 3 : months.length - 3), idx >= 0 ? idx : months.length);
    const monthExpense = m => txByMonth(state, m).filter(t => t.type === 'expense').reduce((sum, t) => sum + n(t.value), 0);
    const previousExpense = previousMonth ? monthExpense(previousMonth) : 0;
    const historical = recentMonths.map(m => ({ month: m, expenses: monthExpense(m) }));
    const average = historical.length ? historical.reduce((sum, x) => sum + x.expenses, 0) / historical.length : 0;
    return { previousMonth, previousExpense, historical, averageExpense: average };
}

function upcomingTotals(state, days = 30) {
    const items = upcomingWindow(state, days);
    const pay = items.filter(t => t.type === 'expense').reduce((sum, t) => sum + n(t.value), 0);
    const receive = items.filter(t => t.type === 'income').reduce((sum, t) => sum + n(t.value), 0);
    return { items, pay, receive, net: receive - pay };
}

function distributionPlanFor(state, month) {
    const prefs = state.preferences || {};
    const d = prefs.distribution || { fixed: 60, investment: 35, leisure: 5 };
    const income = incomeExpense(state, month).income;
    return {
        income,
        fixed: income * n(d.fixed) / 100,
        investment: income * n(d.investment) / 100,
        leisure: income * n(d.leisure) / 100,
        percentages: { fixed: n(d.fixed), investment: n(d.investment), leisure: n(d.leisure) }
    };
}

function categoryBudgetSmart(state, month, category) {
    const explicit = categoryBudget(state, month, category);
    if (explicit) return explicit;
    const key = norm(category);
    const dist = distributionPlanFor(state, month);
    if (key === 'investimentos') return dist.investment;
    if (key === 'lazer') return dist.leisure;
    return 0;
}

function goalImpact(state, purchaseValue) {
    const goals = goalRows(state).filter(g => g.target > g.current);
    if (!goals.length || purchaseValue <= 0) return null;
    const goal = goals[0];
    const remaining = goal.remaining;
    const reserve = reserveValue(state);
    return { goal, remaining, reserve, share: remaining ? purchaseValue / remaining : 0 };
}

function financialDecisionContext(question, ctx, purchaseValue = 0) {
    const a = ctx.analysis || {};
    const state = ctx.state || {};
    const month = ctx.month;
    const cash = accountBalance(state);
    const future = upcomingTotals(state, 30);
    const history = historyContext(state, month);
    const categories = categoryRows(state, month);
    const totalCategorySpend = categories.reduce((sum, x) => sum + x.value, 0);
    const totalBudget = budgetTotal(state, month);
    const budgetSpent = a.expenses?.total ?? totalCategorySpend;
    const budgetRemaining = totalBudget ? totalBudget - budgetSpent : null;
    const cards = cardRows(state, month);
    const goals = goalImpact(state, purchaseValue);
    const reserve = reserveValue(state);
    const installmentCommitment = (state.transactions || []).filter(t => {
        if (t.type !== 'expense') return false;
        const installments = n(t.installments);
        return installments > 1 && monthOf(t) === month;
    }).reduce((sum, t) => sum + n(t.value) / Math.max(1, n(t.installments)), 0);
    const prefs = memoryPreferences(ctx.memory);
    return { cash, future, history, categories, totalCategorySpend, totalBudget, budgetSpent, budgetRemaining, cards, goals, reserve, installmentCommitment, prefs };
}

function purchaseCrossAnalysis(question, ctx, purchaseValue, installments) {
    const a = ctx.analysis || {};
    const state = ctx.state || {};
    const c = financialDecisionContext(question, ctx, purchaseValue);
    const monthly = installments > 1 ? purchaseValue / installments : purchaseValue;
    const income = n(a.income?.total);
    const plannedBefore = n(a.cashflow?.planned);
    const plannedAfter = plannedBefore - monthly;
    const futureAfter = c.future.net - monthly;
    const reserveAfter = c.reserve - (installments > 1 ? 0 : purchaseValue);
    const budgetAfter = c.budgetRemaining == null ? null : c.budgetRemaining - monthly;
    const card = c.cards.filter(x => x.limit === 0 || x.available == null || x.available >= purchaseValue)
        .sort((x, y) => (x.utilization - y.utilization) || ((y.available ?? 0) - (x.available ?? 0)))[0];
    const historyDelta = c.history.previousExpense > 0 ? (a.expenses.total - c.history.previousExpense) / c.history.previousExpense : null;
    const reasons = [];
    if (plannedAfter < 0) reasons.push(`a sobra planejada do mês ficaria negativa em ${money(Math.abs(plannedAfter))}`);
    if (c.budgetRemaining != null && budgetAfter < 0) reasons.push(`o orçamento mensal seria ultrapassado em ${money(Math.abs(budgetAfter))}`);
    if (c.future.net < 0) reasons.push(`há ${money(Math.abs(c.future.net))} a mais para pagar do que receber nos próximos 30 dias`);
    if (futureAfter < 0) reasons.push(`considerando essa compra, os compromissos futuros ficariam pressionados em ${money(Math.abs(futureAfter))}`);
    if (c.reserve > 0 && installments === 1 && purchaseValue > c.reserve) reasons.push(`a compra à vista é maior que sua reserva atual de ${money(c.reserve)}`);
    if (c.goals?.goal && purchaseValue > 0) {
        const remaining = c.goals.remaining;
        if (purchaseValue >= remaining * 0.25) reasons.push(`o valor representa ${percent(c.goals.share * 100)} do que falta para a meta ${c.goals.goal.name}`);
    }
    const riskDebt = income > 0 ? (c.installmentCommitment + monthly) / income : 0;
    if (riskDebt > 0.25) reasons.push(`as parcelas/compromissos de crédito chegariam a ${percent(riskDebt * 100)} da renda considerada`);
    const severity = reasons.length >= 3 || plannedAfter < 0 ? 'evitaria agora' : reasons.length === 2 ? 'teria cautela' : 'parece administrável';
    return { ...c, monthly, plannedAfter, futureAfter, reserveAfter, budgetAfter, card, historyDelta, riskDebt, reasons, severity, income };
}

function purchaseResponse(question, ctx) {
    const p = resolvePurchase(question, ctx.memory);
    if (!p.value) return 'Consigo avaliar a compra e cruzar o impacto com orçamento, compromissos, cartões, reserva, metas e histórico. Me diga o valor total — por exemplo, “posso comprar R$ 1.500?” — e, se quiser, a forma de pagamento.';
    const months = p.installments || 1;
    const cross = purchaseCrossAnalysis(question, ctx, p.value, months);
    const mode = months > 1 ? `${months}x de ${money(cross.monthly)}` : `à vista por ${money(p.value)}`;
    const lines = [];
    lines.push(`**${cross.severity === 'evitaria agora' ? 'Eu não faria essa compra agora.' : cross.severity === 'teria cautela' ? 'Eu faria com cautela.' : 'Pelos números registrados, a compra parece administrável.'}**`);
    lines.push('');
    lines.push(`Você está avaliando **${money(p.value)} ${months > 1 ? `em ${months}x` : 'à vista'}**.`);
    lines.push(`• Impacto neste mês: **${money(cross.monthly)}**`);
    lines.push(`• Sobra planejada depois da compra: **${money(cross.plannedAfter)}**`);
    if (cross.budgetRemaining != null) lines.push(`• Orçamento: **${money(cross.budgetRemaining)}** disponíveis antes → **${money(cross.budgetAfter)}** depois`);
    lines.push(`• Renda considerada: **${money(cross.income)}**`);
    lines.push(`• Reserva de emergência: **${money(cross.reserve)}**`);
    lines.push(`• Próximos 30 dias: **${money(cross.future.pay)}** a pagar e **${money(cross.future.receive)}** a receber`);
    if (cross.future.net !== 0) lines.push(`• Saldo líquido desses compromissos: **${money(cross.future.net)}**`);
    if (cross.history.previousExpense > 0 && cross.historyDelta != null) lines.push(`• Gastos vs. mês anterior: **${cross.historyDelta >= 0 ? '+' : ''}${percent(cross.historyDelta * 100)}**`);
    if (cross.goals?.goal) lines.push(`• Meta prioritária: **${cross.goals.goal.name}** — faltam **${money(cross.goals.remaining)}**`);
    if (months > 1) {
        lines.push(`• Compromisso mensal: **${money(cross.monthly)}** por ${months} meses`);
        if (cross.card) lines.push(`• Cartão mais confortável entre os cadastrados: **${cross.card.card.name || 'cartão'}**, com cerca de **${money(cross.card.available)}** disponíveis`);
    }
    if (cross.reasons.length) {
        lines.push('');
        lines.push('**O que pesa contra a compra:**');
        cross.reasons.slice(0, 4).forEach(reason => lines.push(`• ${reason}.`));
    }
    if (cross.goals?.goal && p.value > 0) {
        const goal = cross.goals.goal;
        const ratio = cross.goals.share;
        if (ratio >= 0.25) lines.push(`\nEssa compra não é proibida, mas ela consumiria uma fatia relevante do caminho para **${goal.name}**. Eu só colocaria esse gasto na frente da meta se ele estiver planejado.`);
    }
    if (cross.riskDebt > 0.25) lines.push(`\n**Alerta:** com essa parcela, os compromissos parcelados considerados chegariam a **${percent(cross.riskDebt * 100)} da renda**. É um nível que merece atenção.`);
    if (months > 1) lines.push(`\nParcelar melhora o impacto imediato, mas não muda o custo total: continuam sendo **${money(p.value)}** comprometidos.`);
    return lines.join('\n');
}

export function generateP360Response({question, analysis, risk, neural, memory={}, profile={}, insights=[], state={}}) {
    const a=analysis || {}, month=a.month || state.selectedMonth || new Date().toISOString().slice(0,7);
    const ctx={question,analysis:a,risk,neural,memory,profile,insights,state,month};
    const topic=inferTopic(question,memory);
    const forecast=neural?.available ? money(neural.forecast30d) : null;
    const q=norm(question);
    const prior=lastUser(memory);

    if(topic==='explain' && prior) {
        return `Na mensagem anterior você perguntou “${clean(prior.content).slice(0,140)}”. Minha orientação veio principalmente de três pontos: sobra planejada de ${money(a.cashflow.planned)}, ${money(a.expenses.pending)} ainda pendentes e risco ${riskText(risk)}. Eu separo o que já está registrado do que é projeção; por isso, se um desses dados mudar, a recomendação também muda.`;
    }
    if(topic==='purchase') {
        const plan=contributionPlanResponse(question,ctx);
        return plan || purchaseResponse(question,ctx);
    }

    if(topic==='card') {
        const rows=cardRows(state,month);
        if(!rows.length) return 'Você ainda não cadastrou cartões. Depois de cadastrar, eu consigo acompanhar limite, fatura, disponível, utilização e compras de cada cartão.';
        const lines=rows.map(x=>`${x.card.name||'Cartão'} — fatura aberta ${money(x.open)}${x.limit?`, disponível ${money(x.available)} (${percent(x.utilization*100)} do limite)`:''}`);
        const hottest=rows.slice().sort((x,y)=>y.utilization-x.utilization)[0];
        let out=`${opener()} você tem ${rows.length} ${rows.length===1?'cartão cadastrado':'cartões cadastrados'}.\n${list(lines,8)}`;
        if(hottest?.limit && hottest.open>0) out+=`\n\nO ${hottest.card.name||'cartão'} é o que está mais comprometido, usando ${percent(hottest.utilization*100)} do limite.`;
        const prevText=lastPurchaseUser(memory)||lastUser(memory)?.content||'';
        const purchase=resolvePurchase(prevText,memory);
        if(/melhor|qual cartao|qual cartão/.test(q) && purchase.value){
            const viable=rows.filter(x=>x.available===null || x.available>=purchase.value).sort((a,b)=>(b.available??0)-(a.available??0));
            if(viable.length){
                const best=viable[0];
                out+=`\n\nPara a compra de ${money(purchase.value)} que você mencionou antes, ${best.card.name||'o cartão'} é o que tem mais espaço disponível (${money(best.available)}). A decisão final também deve considerar o fechamento e o vencimento da fatura.`;
            } else {
                out+=`\n\nNenhum dos cartões tem limite disponível suficiente para uma compra de ${money(purchase.value)} neste momento.`;
            }
        }
        return out;
    }

    if(topic==='categories') {
        const rows=categoryRows(state,month);
        if(!rows.length) return 'Ainda não há despesas suficientes neste mês para eu identificar onde o dinheiro está concentrado.';
        const total=rows.reduce((sum,x)=>sum+x.value,0), top=rows[0], topBudget=categoryBudgetSmart(state,month,top.name);
        let out=`${opener()} hoje **${top.name}** é o maior centro de gasto, com **${money(top.value)}**, equivalente a **${percent(total?top.value/total*100:0)}** das despesas do mês.`;
        if(topBudget){const rem=topBudget-top.value;out+=` O limite é **${money(topBudget)}** e ${rem>=0?`restam **${money(rem)}**.`:`o limite já foi excedido em **${money(Math.abs(rem))}**.`}`;}
        out+=`\n\n**Onde o dinheiro está indo:**\n${list(rows.slice(0,6).map(x=>`${x.name}: ${money(x.value)} (${percent(total?x.value/total*100:0)})`),6)}`;
        const hist=historyContext(state,month);
        if(hist.previousExpense>0){const delta=(total-hist.previousExpense)/hist.previousExpense;out+=`\n\nEm relação ao mês anterior, suas despesas estão **${delta>=0?`+${percent(delta*100)}`:percent(delta*100)}**.`;}
        out+='\n\nSe você me disser uma categoria específica, eu cruzo gasto, limite, despesas vinculadas e margem restante.';
        return out;
    }

    if(topic==='budget') {
        const requestedCategory=extractCategory(question,state,month);
        if(requestedCategory){
            const rows=categoryRows(state,month), spent=rows.find(x=>norm(x.name)===norm(requestedCategory))?.value||0, limit=categoryBudgetSmart(state,month,requestedCategory);
            if(!limit){
                return `${opener()} em ${requestedCategory}, você já registrou ${money(spent)} neste mês, mas não existe um limite de orçamento cadastrado para essa categoria. Sem um limite, eu não vou inventar quanto ainda pode gastar.`;
            }
            const remaining=limit-spent, ratio=spent/limit*100;
            let status=ratio>=100?`Você já ultrapassou o limite em ${money(Math.abs(remaining))}.`:ratio>=80?`Você está perto do limite: já usou ${percent(ratio)} e restam ${money(remaining)}.`:`Você está dentro do limite e ainda pode gastar ${money(remaining)}.`;
            const expenses=txByMonth(state,month).filter(t=>t.type==='expense'&&norm(t.category)===norm(requestedCategory)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
            let out=`${opener()} em ${requestedCategory}, o limite é ${money(limit)} e você já gastou ${money(spent)} (${percent(ratio)}). ${status}`;
            if(expenses.length) out+=`\n\nÚltimos lançamentos: ${list(expenses.map(t=>`${t.name||'Despesa'} — ${money(t.value)}`),5)}`;
            return out;
        }
        const total=budgetTotal(state,month) || distributionPlanFor(state,month).income, rows=categoryRows(state,month), spent=rows.reduce((s,x)=>s+x.value,0), remaining=total-spent;
        if(!total) return `Você ainda não definiu um orçamento para ${formatMonth(new Date(month+'-01T12:00:00'))}. Para eu responder “quanto ainda posso gastar”, defina limites por categoria.`;
        const near=rows.map(x=>({x,limit:categoryBudgetSmart(state,month,x.name)})).filter(y=>y.limit).sort((a,b)=>(b.x.value/b.limit)-(a.x.value/a.limit));
        let out=`${opener()} seu orçamento cadastrado para o mês é ${money(total)} e você já comprometeu ${money(spent)}. ${remaining>=0?`Ainda há ${money(remaining)} de margem no conjunto das categorias.`:`Você já ultrapassou o orçamento total em ${money(Math.abs(remaining))}.`}`;
        if(near[0]) out+=` A categoria proporcionalmente mais pressionada é ${near[0].x.name}, em ${percent(near[0].x.value/near[0].limit*100)} do limite.`;
        return out;
    }

    if(topic==='commitments') {
        const upcoming=upcomingWindow(state,30);
        const pending=upcoming.filter(t=>t.type==='expense');
        const inc=upcoming.filter(t=>t.type==='income');
        const pay=pending.reduce((s,t)=>s+n(t.value),0), rec=inc.reduce((s,t)=>s+n(t.value),0);
        if(!pending.length&&!inc.length) return 'Olhei os próximos 30 dias e não encontrei lançamentos pendentes cadastrados. Se existir algum compromisso que ainda não foi lançado no sistema, ele não entra nessa previsão.';
        let out=`${opener()} olhando para os próximos 30 dias, há ${money(pay)} para pagar e ${money(rec)} para receber.`;
        if(pending.length) out+=`\n\n**A pagar:**\n${list(pending.map(t=>`${t.name||t.category||'Despesa'} — ${money(t.value)} em ${t.date}`),8)}`;
        if(inc.length) out+=`\n\n**A receber:**\n${list(inc.map(t=>`${t.name||'Receita'} — ${money(t.value)} em ${t.date}`),8)}`;
        const net=rec-pay;
        out+=`\n\nDepois desses compromissos, o fluxo futuro desses lançamentos fica ${net>=0?'positivo':'negativo'} em ${money(Math.abs(net))}. Isso é diferente do saldo bancário atual.`;
        return out;
    }

    if(topic==='reserve') {
        const current=reserveValue(state), configuredTarget=n(state.reserve?.target), explicitTarget=parseTargetAmount(question);
        const target=explicitTarget||configuredTarget;
        const essential=n(state.reserve?.essential||profile.essentialExpenses);
        if(/sacar|retirar/.test(q)){
            const amount=parseMoney(question);
            if(amount){
                const remaining=current-amount;
                if(amount>current) return `Você tentou simular um saque de ${money(amount)}, mas sua reserva atual é ${money(current)}. O saque ultrapassaria o valor disponível.`;
                return `Se você sacar ${money(amount)}, sua reserva cairá de ${money(current)} para ${money(remaining)}. Se houver uma conta selecionada para receber o saque, esse valor entra como receita no caixa.`;
            }
            return current>0?`Sua reserva está em ${money(current)}. Me diga quanto pretende sacar e eu calculo exatamente quanto sobrará e como isso afeta sua cobertura.`:'Sua reserva está zerada no momento, então não há valor disponível para saque.';
        }
        const coverage=essential?current/essential:0;
        let out=`${opener()} sua reserva está em ${money(current)}.`;
        if(target){
            const remaining=Math.max(0,target-current);
            out+=` Para chegar a ${money(target)}, faltam ${money(remaining)}.`;
            if(explicitTarget && explicitTarget!==configuredTarget) out+=` Estou usando os ${money(explicitTarget)} que você informou agora, em vez da meta configurada.`;
        }
        if(essential) out+=` Isso representa aproximadamente ${coverage.toFixed(1).replace('.',',')} mês(es) de despesas essenciais.`;
        if(target && target>current) out+=coverage<3?' Sua prioridade deveria ser aumentar a reserva com constância antes de assumir compromissos grandes.':' A meta ainda exige novos aportes, mas sua cobertura atual já dá uma base de segurança.';
        return out;
    }

    if(topic==='goals') {
        const goals=goalRows(state);
        if(!goals.length) return 'Você ainda não cadastrou metas. Cadastre uma meta com valor e prazo e eu consigo calcular o aporte mensal necessário e acompanhar se o ritmo está suficiente.';
        const rows=goals.slice(0,6).map(g=>{const pctg=g.target?Math.min(100,g.current/g.target*100):0;return `${g.name||'Meta'} — ${money(g.current)} de ${money(g.target)} (${percent(pctg)})${g.remaining?`, faltam ${money(g.remaining)}`:''}`});
        let out=`${opener()} estas são as metas que consigo acompanhar:\n${list(rows,6)}`;
        const g=goals.find(x=>/meta|objetivo/.test(q) && norm(q).includes(norm(String(x.name||''))));
        if(g) out+=`\n\nPara ${g.name}, ainda faltam ${money(g.remaining)}. Se você me disser o prazo desejado, calculo um aporte mensal aproximado.`;
        return out;
    }

    if(topic==='investments') {
        const items=investmentRows(state), total=items.reduce((s,x)=>s+x.current,0), applied=items.reduce((s,x)=>s+x.invested,0), result=total-applied;
        if(!items.length) return 'Ainda não há investimentos cadastrados para eu analisar. Depois que você registrar os ativos, consigo comparar patrimônio investido, resultado, concentração e liquidez.';
        const top=items.slice().sort((a,b)=>b.current-a.current)[0];
        return `${opener()} você tem ${money(total)} investidos, com ${money(result)} de resultado em relação ao valor aplicado. A maior posição é ${top.asset||top.titleType||top.class||'um ativo'} (${money(top.current)}). Para decidir novos aportes, eu olharia primeiro para concentração, liquidez e sua reserva de emergência.`;
    }

    if(topic==='subscriptions') {
        const subs=(state.subscriptions||[]).filter(s=>s.active!==false), monthly=subs.reduce((s,x)=>s+n(x.monthly||x.value),0);
        if(!subs.length) return 'Não há assinaturas ativas cadastradas. Se você cadastrar as recorrências, consigo comparar custo mensal, anual e peso na renda.';
        const rows=subs.sort((a,b)=>n(b.monthly||b.value)-n(a.monthly||a.value)).slice(0,6).map(s=>`${s.name||s.title||'Assinatura'} — ${money(s.monthly||s.value)}/mês`);
        return `${opener()} suas ${subs.length} assinaturas ativas custam cerca de ${money(monthly)} por mês, ou ${money(monthly*12)} por ano.\n\n${list(rows,6)}\n\nA melhor candidata para revisão é ${subs[0].name||subs[0].title||'a de maior custo'}, porque é a que mais pesa entre as recorrências cadastradas.`;
    }

    if(topic==='accounts') {
        const accounts=state.accounts||[], balance=accountBalance(state);
        if(!accounts.length) return 'Você ainda não cadastrou contas bancárias. Sem elas, não consigo separar saldo disponível por instituição.';
        return `${opener()} o saldo cadastrado nas suas contas soma ${money(balance)}.\n\n${list(accounts.map(x=>`${x.name||x.bank||'Conta'} — ${money(x.balance??x.saldo??x.current)}`),10)}\n\nEsse valor representa o saldo das contas cadastradas; ele não deve ser confundido com o resultado planejado do mês.`;
    }

    if(topic==='forecast') {
        const pending=a.expenses.pending||0;
        return `${opener()} o P360 estima aproximadamente ${forecast||'um valor ainda indisponível'} em despesas nos próximos 30 dias. Hoje há ${money(pending)} em despesas do mês ainda não confirmadas e o risco está ${riskText(risk)}. A projeção é um sinal de planejamento, não uma promessa de gasto futuro.`;
    }

    if(topic==='diagnosis') {
        const savings=a.income.total?Math.max(0,a.cashflow.planned)/a.income.total:0;
        let out=`${opener()} seu mês tem ${money(a.income.total)} em receitas previstas, ${money(a.expenses.total)} em despesas e ${money(a.cashflow.planned)} de resultado planejado. O realizado está em ${money(a.cashflow.realized)} e o risco calculado está ${riskText(risk)}.`;
        if(a.categories.top) out+=` Seu maior centro de gasto é ${a.categories.top.name}, com ${money(a.categories.top.value)}.`;
        out+=`\n\n${savings>=.2?'O ponto positivo é que existe uma margem de planejamento relevante.':'A margem está apertada; eu evitaria criar novos compromissos fixos até ganhar folga.'}`;
        if(insights?.[0]) out+=` ${insights[0].message}`;
        return out;
    }

    if(topic==='optimization') {
        const rows=categoryRows(state,month), top=rows[0], total=rows.reduce((s,x)=>s+x.value,0), prefs=memoryPreferences(memory);
        if(!total) return 'Ainda faltam despesas cadastradas para eu identificar cortes com segurança. Não vou inventar um padrão de consumo que seus dados não mostram.';
        const discretionary=rows.filter(x=>!['casa','alimentacao','alimentação','transporte','saude','saúde'].includes(norm(x.name)) && !prefs.protectedCategories.has(norm(x.name)));
        const protectedText=prefs.protectedCategories.size?` Vou preservar das heurísticas as áreas que sua memória marcou como prioridade: **${[...prefs.protectedCategories].join(', ')}**.`:'';
        return `${opener()} eu começaria olhando **${top?.name||'as maiores categorias'}**, porque é onde existe mais impacto absoluto. ${top?`${top.name} soma **${money(top.value)}** e representa **${percent(top.value/total*100)}** das despesas.`:''} Antes de sugerir cortes, eu considero as preferências registradas na sua memória e separo o que é essencial, recorrente e discricionário.${protectedText} ${discretionary[0]?`Entre os gastos mais flexíveis, **${discretionary[0].name}** aparece com **${money(discretionary[0].value)}**.`:'Não encontrei uma categoria claramente flexível o suficiente para recomendar um corte específico sem mais contexto.'}`;
    }

    if(topic==='income') {
        return `${opener()} neste mês você tem ${money(a.income.total)} em receitas previstas, sendo ${money(a.income.received)} já recebidas e ${money(a.income.pending)} ainda não recebidas. O ideal é não tratar uma receita futura como dinheiro disponível antes de ela entrar na conta.`;
    }
    if(topic==='expenses') {
        const requestedCategory=extractCategory(question,state,month);
        if(requestedCategory){
            const rows=categoryRows(state,month), row=rows.find(x=>norm(x.name)===norm(requestedCategory)), spent=row?.value||0, limit=categoryBudgetSmart(state,month,requestedCategory);
            const expenses=txByMonth(state,month).filter(t=>t.type==='expense'&&norm(t.category)===norm(requestedCategory)).sort((x,y)=>String(y.date).localeCompare(String(x.date)));
            let out=`${opener()} em **${requestedCategory}**, você já gastou **${money(spent)}** neste mês.`;
            if(limit) out+=` O limite é **${money(limit)}** e a utilização está em **${percent(spent/limit*100)}**.`;
            if(expenses.length) out+=`\n\n**Lançamentos:**\n${list(expenses.map(t=>`${t.name||'Despesa'} — ${t.date} — ${money(t.value)}`),6)}`;
            return out;
        }
        return `${opener()} suas despesas do mês somam **${money(a.expenses.total)}**. Deste total, **${money(a.expenses.paid)}** já estão confirmadas como pagas e **${money(a.expenses.pending)}** ainda estão pendentes. ${a.categories.top?`A maior categoria é **${a.categories.top.name}**, com **${money(a.categories.top.value)}**.`:''}`;
    }

    // Continuações sem palavra-chave: resolvemos o assunto anterior antes do fallback genérico.
    if(prior && conversationContext(question,memory).continuation) {
        const prevTopic=inferTopic(prior.content,{});
        if(prevTopic==='purchase') return purchaseResponse(question,ctx);
        if(prevTopic==='card') return generateP360Response({...ctx,question:`analise meus cartões ${question}`,memory});
        if(prevTopic==='categories' || prevTopic==='budget') return generateP360Response({...ctx,question:`quanto posso gastar ${question}`,memory});
        if(prevTopic==='reserve') return generateP360Response({...ctx,question:`reserva ${question}`,memory});
        if(prevTopic==='goals') return generateP360Response({...ctx,question:`metas ${question}`,memory});
    }

    // Perguntas de comparação, datas, margem e planejamento que não cabem em um único tópico.
    if(/aporte|aportar|por mes|por mês|todo mes|todos os meses/.test(q) && /chegar|atingir|dezembro|janeiro|meta|mil/.test(q)) {
        const plan=contributionPlanResponse(question,ctx);
        if(plan) return plan;
    }

    if (/o que voce faz|o que você faz|como voce funciona|como você funciona|quem e voce|quem é você/.test(q)) {
        return `Eu sou o P360, a camada de inteligência financeira do Patrimônio 360. Eu cruzo os dados que você cadastrou — **renda, orçamento, despesas, categorias, compromissos futuros, cartões, reserva, metas, investimentos, assinaturas e histórico** — para ajudar você a decidir melhor.\n\nNão olho uma compra isoladamente. Se você perguntar se pode comprar algo, eu verifico o impacto no mês, no orçamento, no caixa futuro, no crédito, na reserva e nas metas antes de responder. Também separo o que está registrado do que é projeção.`;
    }
    if (topic === 'general') {
        const hist=historyContext(state,month), top=a.categories?.top;
        let out=`${opener()} seu mês está com **${money(a.income.total)}** em receitas previstas, **${money(a.expenses.total)}** em despesas e resultado planejado de **${money(a.cashflow.planned)}**.`;
        if(top) out+=` O maior centro de gasto é **${top.name}**, com **${money(top.value)}**.`;
        if(hist.previousExpense>0){const delta=(a.expenses.total-hist.previousExpense)/hist.previousExpense;out+=` Em relação ao mês anterior, os gastos estão **${delta>=0?'+':''}${percent(delta*100)}**.`;}
        if(insights?.length) out+=`\n\n**Ponto que merece atenção:** ${insights[0].message}`;
        return out;
    }
    return `${opener()} neste mês você tem **${money(a.income.total)}** em receitas previstas e **${money(a.expenses.total)}** em despesas. O resultado planejado é **${money(a.cashflow.planned)}** e há **${money(a.expenses.pending)}** em despesas pendentes.`;
}

// Mantidos para compatibilidade com versões anteriores do frontend.
function cardInvoice(card,month,state){return cardRows(state,month).find(x=>String(x.card.id)===String(card.id))?.invoice||0;}
function cardPaid(card,month,state){return cardRows(state,month).find(x=>String(x.card.id)===String(card.id))?.paid||0;}
