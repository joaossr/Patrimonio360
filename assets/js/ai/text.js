// P360 Mind — processamento de texto em português (sem dependências).
// Funciona no navegador e no Node: o mesmo código atende o chat do site e o bot do Telegram.

const STOPWORDS = new Set('a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra pro com sem e ou que se me te lhe eu voce vc tu ele ela nos eles elas meu minha meus minhas seu sua seus suas teu tua isso isto esse essa este esta aquele aquela ai la ja tb tambem mais muito muita bem so ate entao ne ta to tah por favor pfv pf'.split(' '));

export function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/r\$\s*/g, ' rs ')
    .replace(/[^a-z0-9%,.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text, { keepStop = false } = {}) {
  return normalize(text).replace(/[,.%]/g, ' ').split(' ')
    .filter(w => w && (keepStop || !STOPWORDS.has(w)));
}

// Características para o classificador: palavras, pares de palavras e n-gramas de caracteres.
// Os n-gramas tornam o modelo tolerante a erros de digitação ("orcamento", "orsamento", "orçamento").
export function features(text) {
  const ws = words(text);
  const out = [];
  ws.forEach((w, i) => {
    if (/^\d+$/.test(w)) { out.push('#num'); return; }
    out.push('w:' + w);
    if (i > 0) out.push('b:' + ws[i - 1] + '_' + w);
    const padded = ` ${w} `;
    for (let n = 3; n <= 4; n++) for (let k = 0; k + n <= padded.length; k++) out.push('c:' + padded.slice(k, k + n));
  });
  return out;
}

// ---- Extração de entidades ------------------------------------------------

const NUM_WORDS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, vinte: 20, trinta: 30, cem: 100, mil: 1000 };

export function parseNumberBR(raw) {
  let s = String(raw).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Valores em reais: "R$ 1.500", "1500 reais", "2 mil", "1,5k", "3500".
export function extractMoney(text) {
  const t = normalize(text);
  const found = [];
  const re = /(?:rs\s*)?(\d+(?:[.,]\d+)*)\s*(mil|k)?(?:\s*(reais|real|conto|contos))?/g;
  let m;
  while ((m = re.exec(t))) {
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (/^\s*(x|vezes|parcela|meses|mes|anos|ano|dias|dia|%)/.test(after)) continue; // é parcela, prazo ou percentual
    const before = t.slice(Math.max(0, m.index - 4), m.index);
    if (/\bdia\s*$/.test(before)) continue;
    let v = parseNumberBR(m[1]);
    if (v == null) continue;
    if (m[2]) v *= 1000;
    const explicit = /rs/.test(m[0]) || m[2] || m[3];
    if (!explicit && v >= 1900 && v <= 2100 && !/\d[.,]/.test(m[1])) continue; // provavelmente um ano
    found.push({ value: v, explicit: Boolean(explicit) });
  }
  const mil = t.match(/\b(um|dois|tres|cinco|dez|vinte|cem)\s+mil\b/);
  if (mil) found.push({ value: NUM_WORDS[mil[1]] * 1000, explicit: true });
  if (!found.length) return null;
  return (found.find(f => f.explicit) || found.sort((a, b) => b.value - a.value)[0]).value;
}

export function extractInstallments(text) {
  const t = normalize(text);
  const m = t.match(/(?:em|de|por|parcelad[oa] em)?\s*(\d{1,2}|duas|tres|quatro|cinco|seis|dez|doze)\s*(?:x\b|vezes|parcelas?)/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
  return n >= 1 && n <= 72 ? n : null;
}

export function extractMonthsSpan(text) {
  const t = normalize(text);
  let m = t.match(/(\d{1,3})\s*(meses|mes)\b/);
  if (m) return Number(m[1]);
  m = t.match(/(\d{1,2})\s*(anos|ano)\b/);
  if (m) return Number(m[1]) * 12;
  m = t.match(/\b(um|dois|tres|cinco|dez)\s+(anos|ano)\b/);
  if (m) return NUM_WORDS[m[1]] * 12;
  return null;
}

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Mês citado na frase, relativo ao mês selecionado: "mês passado", "em março", "mês que vem".
export function extractMonth(text, baseMonth) {
  const t = normalize(text);
  if (/\b(mes passado|ultimo mes|mes anterior)\b/.test(t)) return shiftMonth(baseMonth, -1);
  if (/\b(mes que vem|proximo mes|mes seguinte)\b/.test(t)) return shiftMonth(baseMonth, 1);
  if (/\b(este mes|esse mes|mes atual|neste mes|nesse mes)\b/.test(t)) return baseMonth;
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${MONTHS[i]}\\b`).test(t)) {
      const [y, m] = baseMonth.split('-').map(Number);
      const yearMatch = t.match(/\b(20\d{2})\b/);
      let year = yearMatch ? Number(yearMatch[1]) : y;
      if (!yearMatch && i + 1 > m) year = y - 1; // "em dezembro" falado em março = dezembro passado
      return `${year}-${String(i + 1).padStart(2, '0')}`;
    }
  }
  return null;
}

// Encontra uma categoria do usuário citada na frase (aceita singular/plural e apelidos aprendidos).
export function extractCategory(text, categories = [], aliases = {}) {
  const t = ' ' + normalize(text) + ' ';
  const stem = w => w.replace(/(oes|aes|ais|eis|es|s)$/, '');
  for (const [alias, cat] of Object.entries(aliases || {})) {
    if (t.includes(' ' + alias + ' ')) return cat;
  }
  let best = null;
  for (const cat of categories) {
    const n = normalize(cat);
    if (!n) continue;
    if (t.includes(' ' + n + ' ')) return cat;
    const parts = n.split(' ').filter(p => p.length > 3);
    if (parts.length && parts.every(p => t.includes(' ' + stem(p)))) best = best || cat;
  }
  return best;
}

export function similarity(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}
