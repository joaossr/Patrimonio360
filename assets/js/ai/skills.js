// P360 Mind — habilidades: cada intenção vira uma análise feita com os dados reais do usuário
// e com o que o modelo pessoal aprendeu sobre ele. Nenhuma resposta inventa números.
import { brl, forecastMonth, detectAnomalies, healthScore, shiftMonth, financialTx, monthOf, isSettled } from './personal-model.js';
import { INTENT_LABELS } from './nlu.js';

const pct = v => `${(Number(v || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const monthName = (m, opts = { month: 'long', year: 'numeric' }) => new Date(m + '-01T12:00:00').toLocaleDateString('pt-BR', opts);
const dayMonth = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const pick = (list, seed) => list[Math.abs(seed) % list.length];
const val = t => Math.abs(Number(t?.value || 0));
const sumCat = (byCategory) => Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

function learnedNote(ctx) {
  const pm = ctx.pm;
  if (pm.maturity === 'sem histórico') return '\n_Ainda estou conhecendo você: com mais meses de movimentações minhas previsões ficam mais precisas._';
  return '';
}

export const SKILLS = {
  greeting(ctx) {
    const name = ctx.userName ? `, ${ctx.userName}` : '';
    const alerts = detectAnomalies(ctx.state, ctx.pm, ctx.snap).length;
    return `${pick(['Olá', 'Oi', 'Opa'], ctx.seed)}${name}! ${alerts ? `Tenho ${alerts} ponto(s) de atenção em ${monthName(ctx.month, { month: 'long' })}. Quer que eu mostre?` : `Seu mês de ${monthName(ctx.month, { month: 'long' })} está sem alertas por enquanto.`} Pergunte o que quiser sobre seu dinheiro.`;
  },
  thanks(ctx) { return pick(['Por nada! Estou por aqui sempre que precisar.', 'Disponha! Se quiser, posso acompanhar seus gastos e avisar quando algo sair do padrão.', 'Fico feliz em ajudar 😊'], ctx.seed); },
  help() {
    return `### O que eu sei fazer\n• Resumir seu mês e dar sua **nota de saúde financeira**\n• Prever como você vai **fechar o mês**, com base no seu histórico\n• Dizer **quanto ainda pode gastar** por dia\n• Avaliar uma **compra** à vista ou parcelada\n• Mostrar onde você gasta mais e **onde dá para economizar**\n• Detectar **gastos fora do seu padrão** e contas vencidas\n• Acompanhar cartões, orçamento, assinaturas, reserva, metas e investimentos\n• Montar um **plano para juntar dinheiro**\n\nEu aprendo com você: quanto mais movimentações e conversas, mais personalizadas ficam as respostas. Se eu entender errado, toque em 👎 e me ensine.`;
  },

  overview(ctx) {
    const { snap, pm } = ctx, f = forecastMonth(ctx.state, pm, snap, ctx.today), top = sumCat(snap.byCategory).slice(0, 3);
    const h = healthScore(snap, pm), al = detectAnomalies(ctx.state, pm, snap);
    let out = `### Resumo de ${monthName(ctx.month)}\n• Receitas: **${brl(snap.income)}**${snap.pendingIn ? ` (${brl(snap.pendingIn)} ainda a receber)` : ''}\n• Despesas: **${brl(snap.expenses)}**${snap.pendingOut ? ` (${brl(snap.pendingOut)} ainda a pagar)` : ''}\n• Resultado: **${brl(snap.result)}**\n• Saldo em contas: ${brl(snap.balance)}\n• Saúde financeira: **${h.score}/100** (${h.level})`;
    if (top.length) out += `\n• Maiores gastos: ${top.map(([c, v]) => `${c} (${brl(v)})`).join(', ')}`;
    if (f.remaining > 0 && pm.historyMonths) out += `\n• Previsão de fechamento: **${brl(f.projectedResult)}** ${f.projectedResult < 0 ? '⚠️' : ''}`;
    if (al.length && ctx.style !== 'curto') out += `\n\n**Atenção:** ${al.slice(0, 2).map(a => a.text).join(' ')}`;
    out += `\n\n${snap.result < 0 ? 'O mês está no vermelho: vale segurar gastos variáveis até as receitas entrarem.' : snap.income && snap.result / snap.income >= 0.2 ? 'Ótimo ritmo: você está guardando mais de 20% da renda.' : 'Mês positivo, mas com margem pequena. Defina quanto quer guardar antes de gastar o restante.'}`;
    return out + learnedNote(ctx);
  },

  health(ctx) {
    const h = healthScore(ctx.snap, ctx.pm);
    const worst = h.parts.slice().sort((a, b) => a.points / a.max - b.points / b.max)[0];
    return `### Saúde financeira: ${h.score}/100 (${h.level})\n${h.parts.map(p => `• ${p.label}: ${p.points}/${p.max} — ${p.detail}`).join('\n')}\n\nO que mais puxa sua nota para baixo é **${worst.label.toLowerCase()}**. ${({ 'Sobra do mês': 'Tente separar um valor fixo assim que a renda entrar.', 'Reserva de emergência': 'Priorize aportes na reserva até cobrir pelo menos 3 meses de despesas.', 'Uso do cartão': 'Use menos de 30% do limite para não comprometer as próximas faturas.', 'Orçamento': 'Revise as categorias que passaram do limite.', 'Contas em dia': 'Regularize as pendências vencidas primeiro.' })[worst.label]}`;
  },

  balance(ctx) {
    const s = ctx.snap;
    if (!s.accounts.length) return 'Você ainda não cadastrou contas bancárias. Cadastre em **Contas bancárias** para eu acompanhar seu saldo.';
    return `### Saldo atual: ${brl(s.balance)}\n${s.accounts.map(a => `• ${a.name}: ${brl(a.balance)}`).join('\n')}${s.upcoming(7).length ? `\n\nNos próximos 7 dias: ${brl(s.upcoming(7).filter(t => t.type === 'expense').reduce((a, t) => a + val(t), 0))} a pagar e ${brl(s.upcoming(7).filter(t => t.type === 'income').reduce((a, t) => a + val(t), 0))} a receber.` : ''}`;
  },

  spending_top(ctx, ent) {
    const snap = ent.month && ent.month !== ctx.month ? ctx.snapOf(ent.month) : ctx.snap, list = sumCat(snap.byCategory);
    if (!list.length) return `Não encontrei despesas em ${monthName(snap.month)}.`;
    const total = list.reduce((a, [, v]) => a + v, 0);
    const lines = list.slice(0, ctx.style === 'curto' ? 3 : 6).map(([c, v]) => {
      const st = ctx.pm.categories[c], diff = st && st.typical > 0 ? (v - st.typical) / st.typical : null;
      return `• ${c}: **${brl(v)}** (${pct(v / total)})${diff != null && Math.abs(diff) >= 0.15 && snap.month === ctx.month ? ` — ${diff > 0 ? '↑' : '↓'} ${pct(Math.abs(diff))} vs. seu normal` : ''}`;
    });
    return `### Para onde foi seu dinheiro em ${monthName(snap.month)}\nTotal de despesas: **${brl(total)}**\n${lines.join('\n')}${ctx.pm.habits.topMerchants[0] ? `\n\nOnde você mais gasta nos últimos meses: ${ctx.pm.habits.topMerchants.slice(0, 3).map(m => `${m.name} (~${brl(m.perMonth)}/mês)`).join(', ')}.` : ''}`;
  },

  spending_category(ctx, ent) {
    const c = ent.category;
    if (!c) return SKILLS.spending_top(ctx, ent);
    const month = ent.month || ctx.month, snap = month === ctx.month ? ctx.snap : ctx.snapOf(month);
    const spent = snap.byCategory[c] || 0, st = ctx.pm.categories[c], lim = snap.limits[c];
    const items = financialTx(ctx.state).filter(t => t.type === 'expense' && (t.category || 'Sem categoria') === c && monthOf(t) === month).sort((a, b) => val(b) - val(a));
    let out = `### ${c} em ${monthName(month)}\n• Gasto: **${brl(spent)}** em ${items.length} lançamento(s)`;
    if (lim) out += `\n• Limite: ${brl(lim)} (${pct(spent / lim)} usado, ${spent > lim ? `**${brl(spent - lim)} acima**` : `restam ${brl(lim - spent)}`})`;
    if (st && st.months >= 2) out += `\n• Seu normal: ~${brl(st.typical)}/mês${st.trend > 10 ? ' (tendência de alta)' : st.trend < -10 ? ' (tendência de queda)' : ''}`;
    if (items.length) out += `\n• Maiores: ${items.slice(0, 3).map(t => `${t.name} ${brl(val(t))}`).join(', ')}`;
    return out;
  },

  compare(ctx, ent) {
    const a = ent.month || ctx.month, b = shiftMonth(a, -1), A = a === ctx.month ? ctx.snap : ctx.snapOf(a), B = ctx.snapOf(b);
    if (!B.expenses && !B.income) return `Não tenho dados de ${monthName(b)} para comparar.`;
    const d = A.expenses - B.expenses;
    const cats = [...new Set([...Object.keys(A.byCategory), ...Object.keys(B.byCategory)])].map(c => [c, (A.byCategory[c] || 0) - (B.byCategory[c] || 0)]).filter(([, v]) => Math.abs(v) >= 1).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 4);
    return `### ${monthName(a, { month: 'long' })} x ${monthName(b, { month: 'long' })}\n• Despesas: ${brl(A.expenses)} vs ${brl(B.expenses)} (**${d >= 0 ? '+' : ''}${brl(d)}**${B.expenses ? `, ${d >= 0 ? '+' : ''}${pct(d / B.expenses)}` : ''})\n• Receitas: ${brl(A.income)} vs ${brl(B.income)}\n• Resultado: ${brl(A.result)} vs ${brl(B.result)}\n${cats.length ? `\nO que mais mudou:\n${cats.map(([c, v]) => `• ${c}: ${v > 0 ? '+' : ''}${brl(v)}`).join('\n')}` : ''}${ctx.pm.expense.trend > 30 ? `\n\nNos últimos meses seus gastos vêm **subindo** cerca de ${brl(ctx.pm.expense.trend)} por mês.` : ctx.pm.expense.trend < -30 ? `\n\nBoa notícia: seus gastos vêm **caindo** cerca de ${brl(-ctx.pm.expense.trend)} por mês.` : ''}`;
  },

  can_spend(ctx) {
    const { snap, pm } = ctx, f = forecastMonth(ctx.state, pm, snap, ctx.today);
    const goalSave = ctx.memory.facts?.monthlySaving || 0;
    const free = f.projectedIncome - f.projectedExpenses - goalSave;
    const days = Math.max(1, f.daysInMonth - f.elapsed);
    if (!f.projectedIncome) return 'Ainda não vejo receitas neste mês nem no seu histórico. Registre sua renda (ou me diga, por exemplo, "minha renda é 4000") para eu calcular quanto você pode gastar.';
    return `### Quanto você ainda pode gastar\nConsiderando o que já está lançado e o que você costuma gastar até o fim do mês:\n• Receita prevista: ${brl(f.projectedIncome)}\n• Despesas previstas: ${brl(f.projectedExpenses)}${goalSave ? `\n• Reservado para guardar: ${brl(goalSave)}` : ''}\n• **Livre: ${brl(Math.max(0, free))}**${f.remaining > 0 ? ` → cerca de **${brl(Math.max(0, free) / days)} por dia** nos próximos ${days} dias` : ''}\n\n${free < 0 ? 'Pelo seu padrão, o mês deve fechar negativo. Evite gastos não essenciais.' : 'Esse valor já desconta seus gastos habituais que ainda devem acontecer — não é dinheiro "sobrando" de verdade até o mês acabar.'}${learnedNote(ctx)}`;
  },

  forecast(ctx, ent) {
    let month = ent.month || ctx.month;
    const snap = month === ctx.month ? ctx.snap : ctx.snapOf(month), f = forecastMonth(ctx.state, ctx.pm, snap, ctx.today);
    if (!ctx.pm.historyMonths) return `Ainda não tenho meses anteriores para aprender seu padrão. Com o que está lançado, ${monthName(month)} fecha em **${brl(snap.result)}**.`;
    return `### Previsão para ${monthName(month)}\n• Receitas previstas: ${brl(f.projectedIncome)}\n• Despesas previstas: ${brl(f.projectedExpenses)} (lançado até agora: ${brl(snap.expenses)})\n• **Resultado previsto: ${brl(f.projectedResult)}**\n${f.extra.length ? `\nAinda espero gastos em: ${f.extra.slice(0, 4).map(l => `${l.category} (+${brl(l.projected - l.registered)})`).join(', ')}.` : ''}\n\nBaseado em ${ctx.pm.historyMonths} mês(es) do seu histórico; meses recentes pesam mais. ${f.projectedResult < 0 ? '⚠️ Para não fechar no vermelho, corte cerca de ' + brl(-f.projectedResult) + ' nos gastos variáveis.' : ''}`;
  },

  upcoming(ctx) {
    const list = ctx.snap.upcoming(30), od = ctx.snap.overdue;
    if (!list.length && !od.length) return 'Nenhuma conta pendente nos próximos 30 dias. ✓';
    const pay = list.filter(t => t.type === 'expense'), rec = list.filter(t => t.type === 'income');
    const recurringSoon = ctx.pm.recurring.filter(r => !r.isSubscription && r.day >= ctx.today.getDate() && !list.some(t => t.name === r.name)).slice(0, 3);
    return `### Próximos 30 dias\n• A pagar: **${brl(pay.reduce((a, t) => a + val(t), 0))}** (${pay.length})\n• A receber: **${brl(rec.reduce((a, t) => a + val(t), 0))}** (${rec.length})\n${list.slice(0, 7).map(t => `• ${dayMonth(t.date)} — ${t.type === 'income' ? 'receber' : 'pagar'} ${brl(val(t))}: ${t.name}`).join('\n')}${od.length ? `\n\n⚠️ **Vencidos:** ${od.slice(0, 4).map(t => `${t.name} (${dayMonth(t.date)}, ${brl(val(t))})`).join(', ')}` : ''}${recurringSoon.length ? `\n\nPelo seu histórico, também costumam aparecer: ${recurringSoon.map(r => `${r.name} (~${brl(r.avg)}, dia ${r.day})`).join(', ')}.` : ''}`;
  },

  budget(ctx) {
    const s = ctx.snap, rows = Object.entries(s.limits).map(([c, l]) => ({ c, l, used: s.byCategory[c] || 0 })).sort((a, b) => b.used / (b.l || 1) - a.used / (a.l || 1));
    if (!rows.length) return 'Você ainda não definiu limites por categoria. Em **Orçamento mensal** dá para criar limites; eu passo a avisar quando algum estiver perto de estourar.';
    return `### Orçamento de ${monthName(ctx.month)}\n${rows.map(r => `• ${r.c}: ${brl(r.used)} de ${brl(r.l)} (${pct(r.l ? r.used / r.l : 0)})${r.used > r.l ? ' 🔴' : r.l && r.used / r.l >= 0.85 ? ' 🟡' : ''}`).join('\n')}\n\n${rows.some(r => r.used > r.l) ? 'Há categoria estourada: compense reduzindo outra ou ajuste o limite conscientemente.' : 'Tudo dentro dos limites até agora.'}`;
  },

  cards(ctx, ent) {
    const cards = ctx.snap.cards;
    if (!cards.length) return 'Você ainda não cadastrou cartões de crédito.';
    let out = `### Cartões\n${cards.map(c => `• ${c.name}: fatura ${brl(c.invoice)}${c.due ? ` (vence dia ${c.due})` : ''} · disponível ${brl(c.available)} · uso ${pct(c.used)}`).join('\n')}`;
    const value = ent.money;
    const best = cards.filter(c => !value || c.available >= value).sort((a, b) => a.used - b.used)[0];
    if (best) out += `\n\n${value ? `Para uma compra de ${brl(value)}, ` : 'Para a próxima compra, '}eu usaria o **${best.name}**: é o que tem menor uso do limite.`;
    if (ctx.pm.habits.cardShare > 0.6) out += `\n\nVocê paga ${pct(ctx.pm.habits.cardShare)} das despesas no cartão. Isso facilita perder o controle — acompanhe a fatura semanalmente.`;
    return out;
  },

  subscriptions(ctx) {
    const subs = ctx.snap.subscriptions;
    const hidden = ctx.pm.recurring.filter(r => !r.isSubscription && r.avg < 300).slice(0, 4);
    if (!subs.length && !hidden.length) return 'Nenhuma assinatura ativa cadastrada.';
    return `### Assinaturas\n• ${subs.length} ativa(s): **${brl(ctx.snap.subscriptionsMonthly)}/mês** (${brl(ctx.snap.subscriptionsMonthly * 12)}/ano)\n${subs.map(s => `• ${s.name}: ${brl(s.monthly ?? s.value)} — dia ${s.dueDay || '—'}`).join('\n')}${hidden.length ? `\n\nEncontrei cobranças que se repetem e **não estão cadastradas como assinatura**: ${hidden.map(r => `${r.name} (~${brl(r.avg)})`).join(', ')}.` : ''}`;
  },

  recurring(ctx) {
    const r = ctx.pm.recurring;
    if (!r.length) return ctx.pm.historyMonths < 3 ? 'Preciso de pelo menos 3 meses de histórico para identificar gastos que se repetem.' : 'Não encontrei gastos que se repetem com valor parecido nos últimos meses.';
    const total = r.reduce((a, x) => a + x.avg, 0);
    return `### Gastos que se repetem todo mês\nAprendi com seu histórico (mesmo nome, valor parecido em vários meses):\n${r.slice(0, 8).map(x => `• ${x.name}: ~${brl(x.avg)} por volta do dia ${x.day} (${x.months} meses)`).join('\n')}\n\nJuntos somam **~${brl(total)}/mês**${ctx.pm.income.typical ? ` (${pct(total / ctx.pm.income.typical)} da sua renda)` : ''}.`;
  },

  reserve(ctx) {
    const s = ctx.snap, essential = s.essential || ctx.memory.facts?.essential || ctx.pm.expense.typical, months = essential ? s.reserve / essential : 0, target = s.reserveTarget || essential * 6;
    return `### Reserva de emergência\n• Guardado: **${brl(s.reserve)}**\n• Cobre ${essential ? `**${months.toFixed(1).replace('.', ',')} meses**` : '— (defina sua despesa essencial)'}${!s.essential && essential ? ' (estimado pelo seu gasto médio)' : ''}\n• Meta: ${target ? brl(target) : 'não definida'}${target ? ` — faltam ${brl(Math.max(0, target - s.reserve))}` : ''}\n\n${months >= 6 ? 'Reserva completa. O que sobrar pode ir para investimentos de prazo mais longo.' : months >= 3 ? 'Boa base. Continue até 6 meses de despesas.' : 'Prioridade: chegar a 3 meses de despesas essenciais, em aplicação com liquidez diária.'}`;
  },

  investments(ctx) {
    const inv = ctx.state.investments || [];
    if (!inv.length) return 'Você ainda não cadastrou investimentos. ' + (ctx.snap.reserve < (ctx.pm.expense.typical || 0) * 3 ? 'Antes de investir com mais risco, eu priorizaria a reserva de emergência.' : '');
    const applied = inv.reduce((a, i) => a + Number(i.invested || 0), 0), current = ctx.snap.investments, classes = {};
    inv.forEach(i => { classes[i.class || 'Outros'] = (classes[i.class || 'Outros'] || 0) + Number(i.current || i.invested || 0); });
    const top = Object.entries(classes).sort((a, b) => b[1] - a[1])[0];
    return `### Investimentos\n• Valor atual: **${brl(current)}** (aplicado ${brl(applied)})\n• Resultado: ${brl(current - applied)} (${applied ? pct((current - applied) / applied) : '0%'})\n${Object.entries(classes).map(([c, v]) => `• ${c}: ${pct(v / current)}`).join('\n')}\n\n${top && top[1] / current > 0.7 ? `${pct(top[1] / current)} está em ${top[0]}: considere diversificar.` : 'Carteira razoavelmente distribuída.'} _Não é recomendação de investimento: é uma leitura dos seus dados._`;
  },

  goals(ctx) {
    const goals = ctx.snap.goals;
    if (!goals.length) return 'Você ainda não tem metas. Crie uma em **Metas** (ex.: viagem, reserva, carro) e eu acompanho o ritmo para você chegar no prazo.';
    const capacity = Math.max(0, (ctx.pm.income.typical || ctx.snap.income) - (ctx.pm.expense.typical || ctx.snap.expenses));
    return `### Metas\n${goals.map(g => {
      const left = Math.max(0, g.target - g.current);
      const months = g.date ? Math.max(0, (new Date(g.date + 'T12:00:00').getFullYear() - ctx.today.getFullYear()) * 12 + new Date(g.date + 'T12:00:00').getMonth() - ctx.today.getMonth()) : 0;
      const need = months ? left / months : 0;
      return `• **${g.name}**: ${brl(g.current)} de ${brl(g.target)} (${pct(g.target ? g.current / g.target : 0)})${left <= 0 ? ' ✓ concluída' : need ? ` — guarde ${brl(need)}/mês por ${months} meses${capacity && need > capacity ? ' ⚠️ acima da sua sobra média' : ''}` : ''}`;
    }).join('\n')}${capacity ? `\n\nSua sobra média é de ~${brl(capacity)}/mês. Concentre-se nas metas de maior prioridade para não dividir pouco dinheiro entre muitos objetivos.` : ''}`;
  },

  saving_plan(ctx, ent) {
    const target = ent.money, months = ent.monthsSpan || 12;
    if (!target) return 'Quanto você quer juntar e em quanto tempo? Ex.: "quero juntar 10 mil em 12 meses".';
    const per = target / months, capacity = (ctx.pm.income.typical || ctx.snap.income) - (ctx.pm.expense.typical || ctx.snap.expenses);
    const cuts = savingsOpportunities(ctx).slice(0, 3);
    return `### Plano para juntar ${brl(target)} em ${months} meses\n• Você precisa guardar **${brl(per)} por mês**\n• Sua sobra média hoje: ${brl(capacity)}\n${capacity >= per ? `\n✓ Cabe no seu orçamento atual. Dica: programe a transferência para o dia em que a renda entra${ctx.pm.income.payDay ? ` (você costuma receber por volta do dia ${ctx.pm.income.payDay})` : ''}.` : `\nFaltam ~${brl(per - Math.max(0, capacity))}/mês. ${cuts.length ? `Onde dá para tirar: ${cuts.map(c => `${c.category} (−${brl(c.saving)})`).join(', ')}.` : 'Considere um prazo maior.'}\nCom sua sobra atual, levaria ~${capacity > 0 ? Math.ceil(target / capacity) : '∞'} meses.`}`;
  },

  save_tips(ctx) {
    const ops = savingsOpportunities(ctx), h = ctx.pm.habits;
    if (!ops.length && !h.smallPerMonth) return 'Ainda não tenho histórico suficiente para sugerir cortes personalizados. Continue lançando suas despesas por mais um mês.';
    let out = `### Onde você pode economizar\n${ops.slice(0, 4).map(o => `• **${o.category}**: ${o.reason} → economia possível de ~${brl(o.saving)}/mês`).join('\n')}`;
    if (h.smallPerMonth >= 10) out += `\n• Você faz ~${Math.round(h.smallPerMonth)} compras pequenas (< R$ 50) por mês, somando ${brl(h.smallTotalPerMonth)}. Elas passam despercebidas.`;
    if (ctx.snap.subscriptionsMonthly > 0) out += `\n• Assinaturas custam ${brl(ctx.snap.subscriptionsMonthly * 12)} por ano. Revise as que usa pouco.`;
    const total = ops.slice(0, 4).reduce((a, o) => a + o.saving, 0);
    if (total) out += `\n\nSomando, dá **~${brl(total)}/mês** (${brl(total * 12)} em um ano).`;
    return out;
  },

  anomalies(ctx) {
    const al = detectAnomalies(ctx.state, ctx.pm, ctx.snap);
    if (!al.length) return `Nenhum gasto fora do seu padrão em ${monthName(ctx.month)}. ✓` + learnedNote(ctx);
    return `### Pontos de atenção\n${al.slice(0, 6).map(a => `• ${a.level === 'danger' ? '🔴' : '🟡'} ${a.text}`).join('\n')}\n\nComparo cada categoria com o **seu próprio padrão** dos últimos meses, não com uma média genérica.`;
  },

  income(ctx, ent) {
    const month = ent.month || ctx.month, snap = month === ctx.month ? ctx.snap : ctx.snapOf(month), inc = ctx.pm.income;
    const list = financialTx(ctx.state).filter(t => t.type === 'income' && monthOf(t) === month);
    return `### Renda de ${monthName(month)}\n• Total: **${brl(snap.income)}** (${list.length} entrada(s))${snap.pendingIn ? `\n• A receber: ${brl(snap.pendingIn)}` : ''}\n${list.slice(0, 5).map(t => `• ${t.name}: ${brl(val(t))}${isSettled(t) ? '' : ' (pendente)'}`).join('\n')}${inc.mean ? `\n\nSua renda média é ~${brl(inc.typical)} e é **${inc.stability}**${inc.payDay ? `; costuma entrar por volta do dia ${inc.payDay}` : ''}.${inc.stability !== 'estável' ? ' Com renda variável, planeje o mês pela média dos meses mais fracos.' : ''}` : ''}`;
  },

  profile(ctx) {
    const pm = ctx.pm, h = pm.habits, m = ctx.memory, f = m.facts || {};
    const top = Object.entries(pm.categories).sort((a, b) => b[1].typical - a[1].typical).slice(0, 3);
    return `### O que aprendi sobre você\n• Histórico analisado: ${pm.historyMonths} mês(es), ${pm.transactions} movimentações (confiança ${pm.maturity})\n• Renda típica: ${pm.income.typical ? brl(pm.income.typical) + ` (${pm.income.stability})` : 'ainda desconhecida'}\n• Gasto típico: ${pm.expense.typical ? brl(pm.expense.typical) + '/mês' : '—'}${h.savingsRate != null ? `\n• Você costuma guardar ${pct(h.savingsRate)} da renda` : ''}\n• Maiores categorias: ${top.map(([c, s]) => `${c} (~${brl(s.typical)})`).join(', ') || '—'}\n• Uso de cartão: ${pct(h.cardShare)} das despesas · fim de semana: ${pct(h.weekendShare)}\n• Gastos recorrentes identificados: ${pm.recurring.length}\n• Categorias que sei sugerir: aprendi com ${pm.categorizerExamples} lançamentos${m.catStats?.suggested ? ` (acertei ${pct(m.catStats.accepted / m.catStats.suggested)} das sugestões)` : ''}${Object.keys(f).length ? `\n• Você me contou: ${[f.income && `renda ${brl(f.income)}`, f.essential && `gasto essencial ${brl(f.essential)}`, f.priority && `prioridade: ${f.priority}`, f.monthlySaving && `guardar ${brl(f.monthlySaving)}/mês`].filter(Boolean).join(', ')}` : ''}\n• Frases que você me ensinou: ${(m.examples || []).length}\n\nTudo isso fica só na sua conta. Você pode apagar minha memória na página da IA.`;
  },

  purchase(ctx, ent) {
    const value = ent.money;
    if (!value) return { text: 'Qual é o valor da compra? Ex.: "posso comprar um celular de R$ 2.000 em 10x?"', awaiting: 'purchase' };
    const n = ent.installments || 1, parcel = value / n, f = forecastMonth(ctx.state, ctx.pm, ctx.snap, ctx.today);
    const free = f.projectedResult - (ctx.memory.facts?.monthlySaving || 0);
    const capacity = Math.max(0, (ctx.pm.income.typical || ctx.snap.income) - (ctx.pm.expense.typical || ctx.snap.expenses));
    const income = ctx.pm.income.typical || ctx.snap.income;
    const reserve = ctx.snap.reserve;
    const card = ctx.snap.cards.filter(c => c.available >= value).sort((a, b) => a.used - b.used)[0];
    const reasons = [], ok = [];
    if (n === 1) { if (free >= value) ok.push(`a previsão do mês ainda deixa ${brl(free - value)} livres depois da compra`); else reasons.push(`a previsão do mês tem só ${brl(Math.max(0, free))} livres`); }
    else { if (capacity >= parcel * 1.5) ok.push(`a parcela de ${brl(parcel)} usa ${pct(parcel / (capacity || 1))} da sua sobra mensal média`); else reasons.push(`a parcela de ${brl(parcel)} compromete ${capacity ? pct(parcel / capacity) : 'toda'} sua sobra média de ${brl(capacity)}`); }
    if (income && parcel / income > 0.15) reasons.push(`a parcela é ${pct(parcel / income)} da sua renda`);
    if (reserve < (ctx.snap.essential || ctx.pm.expense.typical || 0) * 3) reasons.push('sua reserva de emergência ainda cobre menos de 3 meses');
    if (n > 1 && !card) reasons.push('nenhum cartão tem limite disponível para o valor total');
    if (ctx.snap.overdue.length) reasons.push('há contas vencidas em aberto');
    const verdict = !reasons.length ? '✅ **Cabe no seu orçamento.**' : reasons.length === 1 && ok.length ? '🟡 **Dá, mas com atenção.**' : '🔴 **Eu não faria essa compra agora.**';
    let out = `### Avaliação: ${brl(value)}${n > 1 ? ` em ${n}x de ${brl(parcel)}` : ' à vista'}\n${verdict}\n${ok.map(x => `• ✓ ${x}`).join('\n')}${ok.length ? '\n' : ''}${reasons.map(x => `• ✗ ${x}`).join('\n')}`;
    if (card && n > 1) out += `\n\nSe for parcelar, use o **${card.name}** (menor uso do limite).`;
    if (n === 1 && capacity > 0 && free < value) out += `\n\nJuntando sua sobra média, você teria esse valor em ~${Math.ceil(value / capacity)} mês(es).`;
    const goal = ctx.snap.goals.find(g => g.current < g.target);
    if (goal && reasons.length) out += `\nLembre que essa compra concorre com a meta **${goal.name}**.`;
    return out + learnedNote(ctx);
  },

  set_fact(ctx, ent, raw) {
    const t = raw.toLowerCase(), facts = ctx.memory.facts || (ctx.memory.facts = {});
    if (ent.money && /renda|ganho|salario|recebo/.test(t)) { facts.income = ent.money; return `Anotado: sua renda é ${brl(ent.money)}. Vou usar isso quando faltar renda registrada no mês.`; }
    if (ent.money && /essencial|basico|fixo/.test(t)) { facts.essential = ent.money; return `Anotado: seu gasto essencial é ${brl(ent.money)}/mês. Sua reserva ideal seria ${brl(ent.money * 6)}.`; }
    if (ent.money && /guardar|poupar|economizar/.test(t)) { facts.monthlySaving = ent.money; return `Combinado: vou reservar ${brl(ent.money)}/mês para guardar quando calcular quanto você pode gastar.`; }
    const goal = raw.replace(/^.*?(objetivo|prioridade|meta)\s*(e|é|eh)?\s*/i, '').trim();
    if (/objetivo|prioridade|meta|quero/.test(t) && goal) { facts.priority = goal.slice(0, 80); return `Anotado: sua prioridade é "${facts.priority}". Vou considerar isso nas avaliações de compra e nas dicas.`; }
    return 'O que você quer que eu guarde? Ex.: "minha renda é 4000", "quero guardar 500 por mês", "minha prioridade é a reserva".';
  }
};

// Oportunidades de economia aprendidas: categorias acima do próprio normal ou com peso alto e variável.
export function savingsOpportunities(ctx) {
  const fixedish = /moradia|aluguel|condominio|educacao|saude|financiamento|impostos?|investimentos/i;
  return Object.entries(ctx.pm.categories).filter(([c, s]) => s.typical > 30 && !fixedish.test(c)).map(([c, s]) => {
    const cur = ctx.snap.byCategory[c] || 0;
    if (cur > s.typical * 1.15 && cur - s.typical > 40) return { category: c, saving: cur - s.typical, reason: `está ${pct((cur - s.typical) / s.typical)} acima do seu normal` };
    if (s.trend > s.typical * 0.05 && s.trend > 15) return { category: c, saving: s.trend * 3, reason: 'vem subindo mês a mês' };
    if (s.std / (s.mean || 1) > 0.35) return { category: c, saving: s.typical * 0.15, reason: 'varia muito de um mês para outro (gasto por impulso)' };
    return { category: c, saving: s.typical * 0.1, reason: `custa ~${brl(s.typical)}/mês; cortar 10% já ajuda` };
  }).sort((a, b) => b.saving - a.saving);
}

export function fallback(ctx, guesses) {
  const opts = guesses.filter(g => !['greeting', 'thanks', 'set_fact'].includes(g.intent)).slice(0, 3).map(g => INTENT_LABELS[g.intent]).filter(Boolean);
  return `Não tenho certeza do que você quis dizer${opts.length ? `. Você quis saber sobre: ${opts.join(', ')}?` : '.'} Toque numa das sugestões abaixo — assim eu aprendo como você fala.`;
}
