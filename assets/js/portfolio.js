// Carteira de investimentos do Patrimônio 360: posições, preço médio, renda fixa,
// evolução mês a mês e rentabilidade ponderada (sem cotações externas).
//
// Cada ativo em state.investments tem:
//   { id, asset, type, institution, entries:[{id,date,kind:'buy'|'sell',qty,price,costs}],
//     price, priceHistory:[{date,price}], proceedsList:[{id,date,value,kind}],
//     indexer, rate, dueDate, dailyLiquidity, manualCurrent, buyFlag }
// e os campos derivados invested / current / proceeds / class (usados no resto do sistema).

export const ASSET_TYPES = ['Ações', 'FIIs', 'ETFs', 'BDRs', 'Stocks', 'Criptomoedas', 'Renda Fixa', 'Tesouro Direto', 'Fundos', 'Outros'];
export const FIXED_TYPES = ['Renda Fixa', 'Tesouro Direto'];
export const TYPE_COLORS = { 'Ações': '#4c8dff', 'FIIs': '#8b5cf6', 'ETFs': '#22c08a', 'BDRs': '#f5a524', 'Stocks': '#14b8c4', 'Criptomoedas': '#e05ab8', 'Renda Fixa': '#37a2da', 'Tesouro Direto': '#7c8cff', 'Fundos': '#ef5b6b', 'Outros': '#94a3b8' };
export const PROCEED_KINDS = ['Dividendo', 'JCP', 'Rendimento', 'Juros', 'Amortização', 'Outro'];

export const isFixed = a => FIXED_TYPES.includes(a?.type);
const n = v => Number(v || 0);
const day = d => String(d || '').slice(0, 10);
const byDate = (x, y) => day(x.date).localeCompare(day(y.date)) || n(x.id) - n(y.id);

// Converte o formato antigo (um aporte com aplicado/atual) para ativo com lançamentos.
export function migrateLegacy(item, { today, makeId }) {
  if (Array.isArray(item.entries)) return item;
  const cls = String(item.class || '').toLowerCase();
  const type = ASSET_TYPES.includes(item.type) ? item.type
    : cls.includes('renda fixa') ? 'Renda Fixa' : cls.includes('fundo') ? 'Fundos' : cls.includes('cripto') ? 'Criptomoedas'
    : cls.includes('vari') ? (/\d{2}$/.test(String(item.asset || '').trim()) ? 'ETFs' : 'Ações') : 'Outros';
  const invested = n(item.invested), current = item.current == null ? invested : n(item.current), date = day(item.date) || today;
  const out = { ...item, type, entries: [{ id: makeId(), date, kind: 'buy', qty: 1, price: invested, costs: 0 }], priceHistory: [], proceedsList: [] };
  if (FIXED_TYPES.includes(type)) { if (String(item.indexer || '').toUpperCase() !== 'CDI' && current !== invested) out.manualCurrent = current; }
  else { out.price = current; if (current !== invested) out.priceHistory = [{ date: today, price: current }]; }
  if (n(item.proceeds) > 0) out.proceedsList = [{ id: makeId(), date: today, value: n(item.proceeds), kind: 'Rendimento' }];
  return out;
}

// Fator de correção da renda fixa entre duas datas (dias úteis).
function fixedFactor(a, from, to, ctx) {
  const du = ctx.businessDays(from, to);
  if (du <= 0) return 1;
  const idx = String(a.indexer || '').toUpperCase(), rate = n(a.rate);
  if (idx === 'CDI') { const daily = Math.pow(1 + ctx.cdi, 1 / 252) - 1; return Math.pow(1 + daily * (rate || 100) / 100, du); }
  if (idx === 'IPCA') return Math.pow((1 + ctx.ipca) * (1 + rate / 100), du / 252);
  if (idx === 'PREFIXADO') return Math.pow(1 + rate / 100, du / 252);
  return 1;
}
const isAccruing = a => ['CDI', 'IPCA', 'PREFIXADO'].includes(String(a.indexer || '').toUpperCase());

// Posição de um ativo até uma data (inclusive).
export function positionAt(a, date, ctx) {
  const until = day(date), entries = (a.entries || []).filter(e => day(e.date) <= until).sort(byDate);
  let qty = 0, cost = 0, realized = 0, bought = 0, sold = 0;
  if (isFixed(a)) {
    // Renda fixa: saldo corrigido dia a dia; vendas (resgates) abatem do saldo e do custo proporcionalmente.
    let bal = 0, last = null;
    for (const e of entries) {
      if (last && isAccruing(a)) bal *= fixedFactor(a, last, day(e.date), ctx);
      const v = n(e.qty || 1) * n(e.price) + (e.kind === 'buy' ? n(e.costs) : -n(e.costs));
      if (e.kind === 'buy') { bal += v; cost += v; bought += v; }
      else { const share = bal > 0 ? Math.min(1, v / bal) : 1; realized += v - cost * share; cost -= cost * share; bal = Math.max(0, bal - v); sold += v; }
      last = day(e.date);
    }
    if (last && isAccruing(a)) bal *= fixedFactor(a, last, until, ctx);
    let value = bal;
    if (!isAccruing(a) && a.manualCurrent != null && until >= ctx.today) value = n(a.manualCurrent);
    return { qty: cost > 0.005 ? 1 : 0, cost, avg: cost, value, realized, bought, sold, price: value };
  }
  let lastPrice = 0;
  for (const e of entries) {
    const q = n(e.qty), p = n(e.price);
    if (e.kind === 'buy') { cost += q * p + n(e.costs); qty += q; bought += q * p + n(e.costs); }
    else if (qty > 0) { const avg = cost / qty, qq = Math.min(q, qty); realized += qq * (p - avg) - n(e.costs); cost -= qq * avg; qty -= qq; sold += qq * p - n(e.costs); }
    lastPrice = p || lastPrice;
  }
  if (qty < 1e-9) { qty = 0; cost = 0; }
  const hist = (a.priceHistory || []).filter(h => day(h.date) <= until).sort(byDate);
  let price = hist.length ? n(hist[hist.length - 1].price) : lastPrice;
  if (until >= ctx.today && n(a.price)) price = n(a.price);
  return { qty, cost, avg: qty ? cost / qty : 0, value: qty * price, realized, bought, sold, price };
}

export function proceedsBetween(a, from, to) {
  return (a.proceedsList || []).filter(p => day(p.date) > day(from) && day(p.date) <= day(to)).reduce((s, p) => s + n(p.value), 0);
}
export const totalProceeds = a => (a.proceedsList || []).reduce((s, p) => s + n(p.value), 0);

// Resumo de um ativo hoje.
export function assetSummary(a, ctx) {
  const pos = positionAt(a, ctx.today, ctx), prov = totalProceeds(a);
  const gain = pos.value - pos.cost;
  return { ...pos, proceeds: prov, gain, variation: pos.cost ? gain / pos.cost : 0, profitability: pos.cost ? (gain + prov) / pos.cost : 0, open: pos.qty > 0 };
}

// Atualiza os campos usados pelo resto do sistema (dashboard, IA, relatórios).
export function deriveAsset(a, ctx) {
  const s = assetSummary(a, ctx);
  a.class = a.type; a.invested = Math.round(s.cost * 100) / 100; a.current = Math.round(s.value * 100) / 100; a.proceeds = Math.round(s.proceeds * 100) / 100;
  return a;
}

const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).toLocaleDateString('en-CA'); };
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export function firstMonth(list) {
  const dates = list.flatMap(a => (a.entries || []).map(e => day(e.date))).filter(Boolean).sort();
  return dates.length ? dates[0].slice(0, 7) : null;
}

// Série mensal da carteira: valor, aplicado, fluxos, proventos e rentabilidade encadeada.
export function monthlySeries(list, ctx, { months = null, type = null } = {}) {
  const assets = type ? list.filter(a => a.type === type) : list;
  const start = firstMonth(assets), cur = ctx.today.slice(0, 7);
  if (!start) return [];
  const all = []; for (let m = start; m <= cur; m = addMonths(m, 1)) all.push(m);
  const rows = []; let prevValue = 0, prevEnd = addMonths(start, -1) + '-31', cum = 1;
  for (const m of all) {
    const end = m === cur ? ctx.today : monthEnd(m);
    let value = 0, cost = 0, flows = 0, prov = 0;
    for (const a of assets) {
      const p = positionAt(a, end, ctx); value += p.value; cost += p.cost; prov += proceedsBetween(a, prevEnd, end);
      for (const e of a.entries || []) if (day(e.date) > day(prevEnd) && day(e.date) <= end) {
        const v = n(e.qty || 1) * n(e.price); flows += e.kind === 'buy' ? v + n(e.costs) : -(v - n(e.costs));
      }
    }
    const base = prevValue + flows * 0.5, ret = base > 0.005 ? (value - prevValue - flows + prov) / base : 0;
    cum *= 1 + ret;
    rows.push({ month: m, value, cost, gain: value - cost, flows, proceeds: prov, ret, cumulative: cum - 1 });
    prevValue = value; prevEnd = end;
  }
  return months ? rows.slice(-months) : rows;
}

// Rentabilidade encadeada de um trecho da série (ex.: últimos 12 meses).
export function chainedReturn(rows) { return rows.reduce((acc, r) => acc * (1 + r.ret), 1) - 1; }

// Visão geral para os cards do topo.
export function portfolioOverview(list, ctx) {
  const sums = list.map(a => ({ a, s: assetSummary(a, ctx) }));
  const value = sums.reduce((t, x) => t + x.s.value, 0), cost = sums.reduce((t, x) => t + x.s.cost, 0);
  const realized = sums.reduce((t, x) => t + x.s.realized, 0), proceeds = sums.reduce((t, x) => t + x.s.proceeds, 0);
  const from12 = new Date(ctx.today + 'T12:00:00'); from12.setFullYear(from12.getFullYear() - 1);
  const p12 = list.reduce((t, a) => t + proceedsBetween(a, from12.toLocaleDateString('en-CA'), ctx.today), 0);
  const series = monthlySeries(list, ctx), last12 = series.slice(-12);
  const open = sums.filter(x => x.s.open);
  const ranked = open.filter(x => !isFixed(x.a) || isAccruing(x.a) || x.a.manualCurrent != null).sort((x, y) => y.s.profitability - x.s.profitability);
  const monthsWithData = Math.max(1, Math.min(12, series.length));
  return {
    value, cost, capitalGain: value - cost + realized, realized, proceeds, profit: value - cost + realized + proceeds,
    variation: cost ? (value - cost) / cost : 0, proceeds12: p12, proceedsAvg: p12 / monthsWithData,
    ret12: chainedReturn(last12), retTotal: chainedReturn(series), spark12: (() => { const base = last12[0] ? (1 + last12[0].cumulative) / (1 + last12[0].ret) : 1; return last12.map(r => (1 + r.cumulative) / base - 1); })(), sparkTotal: series.map(r => r.cumulative),
    best: ranked[0] || null, worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    inProfit: open.filter(x => x.s.gain + x.s.proceeds > 0.005).length, openCount: open.length,
    opportunities: open.filter(x => x.a.buyFlag && !isFixed(x.a) && x.s.price > 0 && x.s.price < x.s.avg),
    sums
  };
}

// Agrupa por tipo de ativo (com o % ideal configurado).
export function groupsByType(list, ctx, ideal = {}) {
  const total = list.reduce((t, a) => t + assetSummary(a, ctx).value, 0);
  const types = ASSET_TYPES.filter(t => list.some(a => a.type === t) || n(ideal[t]) > 0);
  return types.map(type => {
    const items = list.filter(a => a.type === type).map(a => ({ a, s: assetSummary(a, ctx) }));
    const value = items.reduce((t, x) => t + x.s.value, 0), cost = items.reduce((t, x) => t + x.s.cost, 0), prov = items.reduce((t, x) => t + x.s.proceeds, 0);
    return { type, items, count: items.filter(x => x.s.open).length, value, cost, variation: cost ? (value - cost) / cost : 0, profitability: cost ? (value - cost + prov) / cost : 0, share: total ? value / total : 0, ideal: n(ideal[type]) / 100 };
  });
}
