// Gráficos do Patrimônio 360 em <canvas>, sem bibliotecas externas.
// Nítidos em telas de alta densidade, com as cores do tema, rótulos que não se sobrepõem
// e dica (tooltip) ao passar o mouse ou tocar.

export const PALETTE = ['#4c8dff', '#8b5cf6', '#22c08a', '#f5a524', '#ef5b6b', '#14b8c4', '#e05ab8', '#7c8cff'];
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = v => brl.format(Number(v || 0));
// Rótulos vêm dos dados do usuário (nomes de categorias): sempre escapados antes de ir para o HTML do tooltip.
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const cssColor = c => /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\)|var\(--[\w-]+\))$/i.test(String(c || '').trim()) ? String(c).trim() : '#6c4cf5';
export function shortMoney(v) {
  const n = Number(v || 0), a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${s}R$ ${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${s}R$ ${Math.round(a)}`;
}

function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
  return { text: v('--text', '#f6f8fa'), muted: v('--muted', '#929ba6'), grid: v('--border', '#2a3138'), bg: v('--card-solid', '#191e23'), font: getComputedStyle(document.body).fontFamily || 'Inter, sans-serif' };
}

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

// ---- Dica (tooltip) compartilhada --------------------------------------------
let tipEl = null;
function tip(html, x, y) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); }
  if (!html) { tipEl.classList.remove('is-on'); return; }
  tipEl.innerHTML = html; tipEl.classList.add('is-on');
  const r = tipEl.getBoundingClientRect(), pad = 10;
  let left = x + 14, top = y - r.height - 12;
  if (left + r.width > innerWidth - pad) left = x - r.width - 14;
  if (top < pad) top = y + 16;
  tipEl.style.left = `${Math.max(pad, left)}px`; tipEl.style.top = `${Math.max(pad, top)}px`;
}
document.addEventListener('scroll', () => tip(null), { passive: true, capture: true });

function interactive(canvas, hit) {
  canvas._hit = hit;
  if (canvas._bound) return;
  canvas._bound = true;
  const move = e => { const r = canvas.getBoundingClientRect(); const html = canvas._hit?.(e.clientX - r.left, e.clientY - r.top); tip(html || null, e.clientX, e.clientY); };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('pointerleave', () => tip(null));
}

function emptyState(ctx, w, h, t, text) {
  ctx.fillStyle = t.muted; ctx.font = `500 13px ${t.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text || 'Sem dados para exibir', w / 2, h / 2);
}

// Eixo X: mostra só os rótulos que cabem (sem sobreposição).
function xLabels(ctx, t, labels, xs, y, maxW) {
  ctx.fillStyle = t.muted; ctx.font = `500 12px ${t.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const widest = Math.max(...labels.map(l => ctx.measureText(l).width)) + 10;
  const step = Math.max(1, Math.ceil(widest / Math.max(1, maxW)));
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1 && (labels.length - 1) % step > step / 2) ctx.fillText(l, xs[i], y); });
}

function yAxis(ctx, t, { left, right, top, bottom, h, max, min = 0, ticks = 4, format = shortMoney }) {
  ctx.font = `500 12px ${t.font}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ticks; i++) {
    const v = min + (max - min) * (i / ticks), y = h - bottom - (h - top - bottom) * (i / ticks);
    ctx.strokeStyle = t.grid; ctx.globalAlpha = i === 0 ? 0.9 : 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(right, Math.round(y) + 0.5); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = t.muted; ctx.fillText(format(v), left - 8, y);
  }
}

// ---- Barras verticais (uma ou mais séries) -----------------------------------------
export function barChart(canvas, { labels = [], series = [], format = shortMoney, tipFormat = money, empty, stacked = false, tipExtra } = {}) {
  if (!canvas) return;
  if (stacked) return stackedBars(canvas, { labels, series, format, tipFormat, empty, tipExtra });
  const { ctx, w, h } = setup(canvas), t = theme();
  const all = series.flatMap(s => s.values.map(Number));
  if (!labels.length || !all.some(v => v)) return emptyState(ctx, w, h, t, empty);
  const minV = Math.min(0, ...all), maxV = niceMax(Math.max(...all, 0)), minN = minV < 0 ? -niceMax(-minV) : 0;
  ctx.font = `500 12px ${t.font}`;
  const left = Math.max(...[maxV, minN].map(v => ctx.measureText(format(v)).width)) + 16, right = 12, top = 14, bottom = 30;
  yAxis(ctx, t, { left, right: w - right, top, bottom, h, max: maxV, min: minN, format });
  const plotW = w - left - right, slot = plotW / labels.length, groupW = Math.min(slot * 0.68, 26 * series.length + 8), barW = (groupW - (series.length - 1) * 4) / series.length;
  const yOf = v => h - bottom - (h - top - bottom) * ((v - minN) / (maxV - minN || 1));
  const zero = yOf(0), xs = labels.map((_, i) => left + slot * i + slot / 2), rects = [];
  series.forEach((s, si) => s.values.forEach((raw, i) => {
    const v = Number(raw || 0), x = xs[i] - groupW / 2 + si * (barW + 4), y = Math.min(yOf(v), zero), bh = Math.max(v ? 2 : 0, Math.abs(yOf(v) - zero));
    ctx.fillStyle = s.color || PALETTE[si % PALETTE.length]; roundRect(ctx, x, y, barW, bh, Math.min(6, barW / 2)); ctx.fill();
    rects.push({ x, y, w: barW, h: bh, i, si });
  }));
  xLabels(ctx, t, labels, xs, h - bottom + 9, slot);
  interactive(canvas, (mx) => {
    const i = Math.floor((mx - left) / slot); if (i < 0 || i >= labels.length) return null;
    return `<strong>${labels[i]}</strong>${series.map((s, si) => `<span><i style="background:${s.color || PALETTE[si % PALETTE.length]}"></i>${s.name ? s.name + ': ' : ''}${tipFormat(s.values[i])}</span>`).join('')}`;
  });
}

// Barras empilhadas (ex.: valor aplicado + ganho de capital). Valores negativos descem abaixo do zero.
function stackedBars(canvas, { labels, series, format, tipFormat, empty, tipExtra }) {
  const { ctx, w, h } = setup(canvas), t = theme();
  const pos = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, Number(s.values[i] || 0)), 0));
  const neg = labels.map((_, i) => series.reduce((a, s) => a + Math.min(0, Number(s.values[i] || 0)), 0));
  if (!labels.length || !pos.some(v => v) && !neg.some(v => v)) return emptyState(ctx, w, h, t, empty);
  const maxV = niceMax(Math.max(...pos, 0)), minN = Math.min(...neg) < 0 ? -niceMax(-Math.min(...neg)) : 0;
  ctx.font = `500 12px ${t.font}`;
  const left = Math.max(...[maxV, minN].map(v => ctx.measureText(format(v)).width)) + 16, right = 12, top = 14, bottom = 30;
  yAxis(ctx, t, { left, right: w - right, top, bottom, h, max: maxV, min: minN, format });
  const plotW = w - left - right, slot = plotW / labels.length, barW = Math.max(4, Math.min(slot * 0.62, 34));
  const yOf = v => h - bottom - (h - top - bottom) * ((v - minN) / (maxV - minN || 1));
  const xs = labels.map((_, i) => left + slot * i + slot / 2);
  labels.forEach((_, i) => {
    let up = 0, down = 0;
    series.forEach((s, si) => {
      const v = Number(s.values[i] || 0); if (!v) return;
      const from = v > 0 ? up : down, to = from + v; if (v > 0) up = to; else down = to;
      const y1 = yOf(Math.max(from, to)), y2 = yOf(Math.min(from, to)), top1 = v > 0 && si === series.length - 1 || v > 0 && !series.slice(si + 1).some(o => Number(o.values[i] || 0) > 0);
      ctx.fillStyle = s.color || PALETTE[si % PALETTE.length];
      roundRect(ctx, xs[i] - barW / 2, y1, barW, Math.max(1.5, y2 - y1), top1 ? Math.min(6, barW / 2) : 0); ctx.fill();
    });
  });
  xLabels(ctx, t, labels, xs, h - bottom + 9, slot);
  interactive(canvas, mx => {
    const i = Math.floor((mx - left) / slot); if (i < 0 || i >= labels.length) return null;
    return `<strong>${labels[i]}</strong>${tipExtra ? tipExtra(i) : ''}${series.map((s, si) => `<span><i style="background:${s.color || PALETTE[si % PALETTE.length]}"></i>${s.name ? s.name + ': ' : ''}${tipFormat(s.values[i])}</span>`).join('')}`;
  });
}

// Mini linha (sparkline) sem eixos, para os cards.
export function sparkline(canvas, { values = [], color = '#22c08a' } = {}) {
  if (!canvas) return;
  const { ctx, w, h } = setup(canvas);
  if (values.length < 2) { ctx.strokeStyle = color; ctx.globalAlpha = .5; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(2, h / 2); ctx.lineTo(w - 2, h / 2); ctx.stroke(); ctx.globalAlpha = 1; return; }
  const min = Math.min(...values), max = Math.max(...values), pad = 4;
  const xy = values.map((v, i) => [pad + (w - pad * 2) * i / (values.length - 1), h - pad - (h - pad * 2) * ((v - min) / (max - min || 1))]);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
  ctx.beginPath(); xy.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.lineTo(xy[xy.length - 1][0], h); ctx.lineTo(xy[0][0], h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); xy.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
}

// ---- Linhas / área ---------------------------------------------------------------
export function lineChart(canvas, { labels = [], series = [], area = true, format = shortMoney, tipFormat = money, empty } = {}) {
  if (!canvas) return;
  const { ctx, w, h } = setup(canvas), t = theme();
  const all = series.flatMap(s => s.values.map(Number));
  if (!labels.length || !all.some(v => v)) return emptyState(ctx, w, h, t, empty);
  const minV = Math.min(0, ...all), maxV = niceMax(Math.max(...all, 0)), minN = minV < 0 ? -niceMax(-minV) : 0;
  ctx.font = `500 12px ${t.font}`;
  const left = Math.max(...[maxV, minN].map(v => ctx.measureText(format(v)).width)) + 16, right = 18, top = 14, bottom = 30;
  yAxis(ctx, t, { left, right: w - right, top, bottom, h, max: maxV, min: minN, format });
  const n = labels.length, xs = labels.map((_, i) => n === 1 ? (left + w - right) / 2 : left + (w - left - right) * (i / (n - 1)));
  const yOf = v => h - bottom - (h - top - bottom) * ((Number(v || 0) - minN) / (maxV - minN || 1));
  series.forEach((s, si) => {
    const color = s.color || PALETTE[si % PALETTE.length], pts = s.values.map((v, i) => [xs[i], yOf(v)]);
    if (area) {
      const g = ctx.createLinearGradient(0, top, 0, h - bottom); g.addColorStop(0, color + '44'); g.addColorStop(1, color + '00');
      ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.lineTo(pts[pts.length - 1][0], yOf(Math.max(0, minN))); ctx.lineTo(pts[0][0], yOf(Math.max(0, minN))); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    }
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = t.bg; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); });
  });
  xLabels(ctx, t, labels, xs, h - bottom + 9, (w - left - right) / Math.max(1, n - 1));
  interactive(canvas, mx => {
    let i = 0, best = Infinity; xs.forEach((x, k) => { const d = Math.abs(mx - x); if (d < best) { best = d; i = k; } });
    return `<strong>${labels[i]}</strong>${series.map((s, si) => `<span><i style="background:${s.color || PALETTE[si % PALETTE.length]}"></i>${s.name ? s.name + ': ' : ''}${tipFormat(s.values[i])}</span>`).join('')}`;
  });
}

// ---- Rosca ---------------------------------------------------------------------------
export function donutChart(canvas, { items = [], center, centerLabel = 'Total', empty, tooltip = true } = {}) {
  if (!canvas) return [];
  const { ctx, w, h } = setup(canvas), t = theme();
  const total = items.reduce((a, x) => a + Math.max(0, Number(x.value || 0)), 0);
  if (!total) { emptyState(ctx, w, h, t, empty || 'Sem gastos'); canvas._segments = []; return []; }
  if (Math.min(w, h) < 48) { canvas._segments = []; return []; } // escondido ou pequeno demais para desenhar
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6, thick = Math.max(14, r * 0.3), segs = [];
  let a = -Math.PI / 2;
  items.forEach((x, i) => {
    const v = Math.max(0, Number(x.value || 0)), ang = v / total * Math.PI * 2, color = x.color || PALETTE[i % PALETTE.length];
    ctx.beginPath(); ctx.arc(cx, cy, r - thick / 2, a + 0.012, a + ang - 0.012); ctx.strokeStyle = color; ctx.lineWidth = thick; ctx.lineCap = 'butt'; ctx.stroke();
    segs.push({ ...x, color, start: a, end: a + ang, cx, cy, inner: r - thick, outer: r }); a += ang;
  });
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = t.muted; ctx.font = `500 12px ${t.font}`; ctx.fillText(centerLabel, cx, cy - 11);
  ctx.fillStyle = t.text; ctx.font = `800 ${Math.max(13, Math.min(18, r / 5))}px ${t.font}`; ctx.fillText(center ?? shortMoney(total), cx, cy + 9);
  canvas._segments = segs;
  if (tooltip) interactive(canvas, (mx, my) => {
    const s = segmentAt(canvas, mx, my); return s ? `<strong>${esc(s.label)}</strong><span><i style="background:${cssColor(s.color)}"></i>${money(s.value)} · ${(s.value / total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>` : null;
  });
  return segs;
}
export function segmentAt(canvas, mx, my) {
  return (canvas._segments || []).find(s => {
    const dx = mx - s.cx, dy = my - s.cy, d = Math.hypot(dx, dy);
    if (d < s.inner || d > s.outer) return false;
    let ang = Math.atan2(dy, dx); while (ang < s.start) ang += Math.PI * 2;
    return ang <= s.end;
  });
}

// ---- Barras horizontais com limite (orçamento) ----------------------------------------
export function progressBars(canvas, { items = [], empty } = {}) {
  if (!canvas) return;
  const { ctx, w, h } = setup(canvas), t = theme();
  if (!items.length) return emptyState(ctx, w, h, t, empty);
  ctx.font = `600 12px ${t.font}`;
  const labelW = Math.min(140, Math.max(...items.map(i => ctx.measureText(i.label).width)) + 12), valueW = 92, rowH = (h - 8) / items.length, barH = Math.min(12, rowH * 0.42);
  const max = Math.max(1, ...items.map(i => Math.max(Number(i.value || 0), Number(i.limit || 0))));
  items.forEach((it, k) => {
    const y = 4 + rowH * k + rowH / 2, x0 = labelW, bw = w - labelW - valueW - 8;
    ctx.fillStyle = t.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `600 12px ${t.font}`;
    let label = it.label; while (ctx.measureText(label).width > labelW - 10 && label.length > 3) label = label.slice(0, -2) + '…';
    ctx.fillText(label, 0, y);
    ctx.fillStyle = t.grid; roundRect(ctx, x0, y - barH / 2, bw, barH, barH / 2); ctx.fill();
    const over = it.limit && it.value > it.limit, color = it.color || (over ? '#ef5b6b' : it.limit && it.value / it.limit >= 0.85 ? '#f5a524' : '#4c8dff');
    ctx.fillStyle = color; roundRect(ctx, x0, y - barH / 2, Math.max(barH, bw * Math.min(1, Number(it.value || 0) / max)), barH, barH / 2); ctx.fill();
    if (it.limit) { const lx = x0 + bw * Math.min(1, it.limit / max); ctx.strokeStyle = t.text; ctx.globalAlpha = 0.7; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx, y - barH); ctx.lineTo(lx, y + barH); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = over ? '#ef5b6b' : t.muted; ctx.textAlign = 'right'; ctx.font = `600 12px ${t.font}`; ctx.fillText(shortMoney(it.value), w, y);
  });
  interactive(canvas, (mx, my) => {
    const k = Math.floor((my - 4) / ((h - 8) / items.length)), it = items[k];
    return it ? `<strong>${esc(it.label)}</strong><span>Gasto: ${money(it.value)}</span>${it.limit ? `<span>Limite: ${money(it.limit)} (${Math.round(it.value / it.limit * 100)}%)</span>` : '<span>Sem limite definido</span>'}` : null;
  });
}
