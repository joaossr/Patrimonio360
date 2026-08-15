const MONTHS = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function normalizeMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value ?? '').trim().replace(/\s/g, '').replace(/^r\$/i, '');
  if (!s) return 0;
  // pt-BR: 1.200,50 | 1.200 | 1200,50 | 1200
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(?:,\d{1,2})?$/.test(s)) s = s.replace(',', '.');
  // Do not reinterpret 1.200 as 1.2: a three-digit decimal-looking suffix is thousands in this app.
  else if (/^\d+\.\d{3}$/.test(s)) s = s.replace('.', '');
  else if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function candidates(text) {
  const raw = String(text || ''), out = [];
  const re = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  for (const m of raw.matchAll(re)) {
    const token = m[1], start = m.index ?? 0, end = start + m[0].length;
    const before = raw.slice(Math.max(0, start - 18), start);
    const after = raw.slice(end, end + 20);
    if (/^\s*(?:x|vezes|parcelas?)\b/i.test(after)) continue;
    if (/^\d{4}$/.test(token) && Number(token) >= 1900 && Number(token) <= 2100) continue;
    if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(raw.slice(Math.max(0, start - 5), end + 5))) continue;
    out.push({ value: normalizeMoney(token), raw: token, index: start, before, after });
  }
  return out.filter(x => x.value > 0);
}

export function parseInstallments(text) {
  const raw = norm(text);
  for (const pattern of [
    /(?:em|de|por|parcelado\s+em)\s*(\d{1,3})\s*(?:x|vezes|parcelas?)/,
    /\b(\d{1,3})\s*x\b/,
    /\b(\d{1,3})\s*(?:vezes|parcelas?)\b/
  ]) {
    const m = raw.match(pattern);
    if (m) return Math.max(1, Number(m[1]));
  }
  return 0;
}

export function parseMoney(text) {
  const raw = String(text || '');
  const thousand = raw.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
  if (thousand) {
    const base = normalizeMoney(thousand[1]);
    if (base) return base * 1000;
  }
  const list = candidates(raw);
  if (!list.length) return 0;
  const explicit = list.find(x => /r\$|reais?|real\b/i.test(raw.slice(Math.max(0,x.index-18), x.index+40)));
  const semantic = list.find(x => /compr|gastar|gasto|custa|pre[cç]o|valor|coloc|invest|sal[aá]rio|renda|meta|objetivo|receb|ganh|pag|aporte|chegar|atingir/i.test(raw.slice(Math.max(0,x.index-28), x.index+48)));
  return (explicit || semantic || list[0])?.value || 0;
}

export function parseFinancialValue(text) {
  const total = parseMoney(text);
  const installments = parseInstallments(text) || 1;
  return { total, installments, installmentValue: total && installments > 1 ? total / installments : total, raw: String(text || '') };
}

export function parseGoal(text, currentDate = new Date()) {
  const raw = String(text || ''), normalized = norm(raw);
  if (!(/(quero|pretendo|preciso|meta|objetivo).*(chegar|atingir|guardar|juntar|ter|economizar)/.test(normalized) || /(chegar|atingir|guardar|juntar|economizar).*(meta|r\$|reais|\d)/.test(normalized))) return null;
  const target = parseMoney(raw);
  if (!target) return null;
  const monthIndex = MONTHS.findIndex(m => normalized.includes(m));
  if (monthIndex < 0) return { target, month: null, year: null, deadline: null };
  const explicitYear = normalized.match(/\b(20\d{2})\b/);
  const currentYear = currentDate.getFullYear(), currentMonth = currentDate.getMonth() + 1;
  const year = explicitYear ? Number(explicitYear[1]) : monthIndex + 1 < currentMonth ? currentYear + 1 : currentYear;
  return { target, month: monthIndex + 1, year, deadline: `${year}-${String(monthIndex + 1).padStart(2, '0')}` };
}

export function parseDateMonth(text, currentDate = new Date()) {
  const raw = norm(text);
  const explicit = raw.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de\s*)?(20\d{2})\b/);
  if (explicit) return `${explicit[2]}-${String(MONTHS.indexOf(explicit[1]) + 1).padStart(2, '0')}`;
  const numeric = raw.match(/\b(20\d{2})[-/](\d{1,2})\b/);
  if (numeric) return `${numeric[1]}-${String(Number(numeric[2])).padStart(2, '0')}`;
  const monthOnly = MONTHS.findIndex(m => raw.includes(m));
  if (monthOnly >= 0) return `${currentDate.getFullYear()}-${String(monthOnly + 1).padStart(2, '0')}`;
  if (/mes passado/.test(raw)) { const d = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  if (/proximo mes|mes que vem/.test(raw)) { const d = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  return null;
}
