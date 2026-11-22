// Painel do administrador: acompanha compras e contas, libera e cancela acessos por e-mail.
// A segurança está no servidor (só e-mails de ADMIN_EMAILS, já confirmados, passam). Esta tela só mostra o resultado.
import { auth } from './config/firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { api } from './license.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmt = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
let user = null, purchases = [], users = [], filter = 'all';

function toast(msg) {
  const t = $('#admToast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}
const tokenOf = () => user.getIdToken();
// PIN de administrador (opcional no servidor): guardado só nesta aba, nunca em disco.
let pin = '';
try { pin = sessionStorage.getItem('p360AdmPin') || ''; } catch { /* sem sessionStorage */ }
const aapi = (path, opts = {}) => api(path, { ...opts, headers: { ...(opts.headers || {}), ...(pin ? { 'X-Admin-Pin': pin } : {}) } });

const SOURCE = { kiwify: 'Kiwify', admin: 'Manual' };
function renderPurchases() {
  const list = purchases.filter(p => filter === 'all' || p.status === filter);
  $('#listEmpty').hidden = list.length > 0;
  $('#keyRows').innerHTML = list.map(p => {
    const paid = p.status === 'paid';
    const status = paid ? '<span class="adm-pill free">Paga</span>' : '<span class="adm-pill off">Reembolsada</span>';
    const action = paid
      ? `<button type="button" class="adm-link" data-revoke="${esc(p.email)}">Cancelar acesso</button>`
      : `<button type="button" class="adm-link" data-grant="${esc(p.email)}">Liberar de novo</button>`;
    return `<tr><td data-l="E-mail">${esc(p.email)}</td><td data-l="Origem">${esc(SOURCE[p.source] || p.source)}</td><td data-l="Atualizada">${fmt(p.updatedAt)}</td><td data-l="Situação">${status}</td><td>${action}</td></tr>`;
  }).join('');
}
const STATUS = { admin: ['Administrador', 'used'], ativa: ['Ativa', 'free'], vitalicia: ['Vitalício', 'free'], antiga: ['Conta antiga', 'free'], vencida: ['Vencida', 'off'], 'sem-acesso': ['Sem acesso', 'off'] };
function renderUsers() {
  $('#usersEmpty').hidden = users.length > 0;
  $('#userRows').innerHTML = users.map(u => {
    const [label, cls] = STATUS[u.status] || [u.status, 'off'];
    return `<tr><td data-l="Pessoa">${esc(u.name) || '<i>sem nome</i>'}<small>${esc(u.email)}${u.verified ? '' : ' · e-mail não confirmado'}</small></td><td data-l="Cadastro">${fmt(u.createdAt)}</td><td data-l="Último acesso">${fmt(u.lastLogin)}</td><td data-l="Situação"><span class="adm-pill ${cls}">${label}</span></td></tr>`;
  }).join('');
}
function renderStats() {
  const have = new Set(users.map(u => String(u.email).toLowerCase()));
  const paid = purchases.filter(p => p.status === 'paid');
  $('#stUsers').textContent = users.filter(u => u.status !== 'admin').length;
  $('#stActive').textContent = users.filter(u => ['ativa', 'vitalicia', 'antiga'].includes(u.status)).length;
  $('#stPaid').textContent = paid.length;
  $('#stWaiting').textContent = paid.filter(p => !have.has(String(p.email).toLowerCase())).length;
  $('#stRefund').textContent = purchases.filter(p => p.status === 'refunded').length;
}
async function loadAll() {
  const r = await aapi('/api/admin/users', { token: await tokenOf() });
  users = r.users || []; purchases = r.purchases || [];
  renderPurchases(); renderUsers(); renderStats();
  loadOferta();
}

const OF_COLS = ['view', 'price', 's50', 's90', 'buy'];
const OF_BTNS = [['b_barra', 'Faixa do topo (Garantir agora)'], ['b_topo', 'Botão do cabeçalho'], ['b_hero', 'Botão da primeira tela'], ['b_preco', 'Botão do preço na prática'], ['b_oferta', 'Botão da seção de oferta'], ['b_final', 'Botão do final da página'], ['b_fixo', 'Barra fixa de baixo (celular)']];
const OF_SECS = [['sec_preco_pratica', 'Preço na prática'], ['sec_funcoes', 'Funções'], ['sec_sistema', 'O sistema'], ['sec_celular', 'No celular'], ['sec_como_funciona', 'Como funciona'], ['sec_oferta', 'Oferta'], ['sec_para_quem', 'Para quem é'], ['sec_avaliacoes', 'Avaliações'], ['sec_duvidas', 'Dúvidas']];
const OF_FAQS = [['faq_1', 'É assinatura?'], ['faq_2', 'Como recebo o acesso?'], ['faq_3', 'iPhone e Android?'], ['faq_4', 'Dados seguros?'], ['faq_5', 'Como funciona a IA?'], ['faq_6', 'Formas de pagamento'], ['faq_7', 'E se eu não gostar?']];
function renderOferta(days) {
  const by = {}, perDay = [];
  for (const d of days) {
    let tot = 0;
    for (const [ad, ev] of Object.entries(d.ads || {})) {
      const row = by[ad] || (by[ad] = { view: 0, price: 0, s50: 0, s90: 0, buy: 0 });
      for (const k of OF_COLS) row[k] += Number(ev?.[k]) || 0;
      tot += Number(ev?.view) || 0;
    }
    perDay.push(`${d.day.slice(8, 10)}/${d.day.slice(5, 7)}: ${tot}`);
  }
  const rows = Object.entries(by).sort((a, b) => b[1].view - a[1].view);
  $('#ofEmpty').hidden = rows.length > 0;
  // Detalhe somando todos os anúncios: botões clicados, seções vistas e dúvidas abertas.
  const sum = {}; let views = 0;
  for (const d of days) for (const ev of Object.values(d.ads || {})) { views += Number(ev?.view) || 0; for (const [k, v] of Object.entries(ev || {})) sum[k] = (sum[k] || 0) + (Number(v) || 0); }
  const pct = n => views ? Math.round(n / views * 100) + '%' : '—';
  const group = (titulo, itens) => `<tr class="adm-group"><td colspan="3"><b>${titulo}</b></td></tr>` + itens.map(([k, nome]) => `<tr><td data-l="O quê">${esc(nome)}</td><td data-l="Pessoas">${sum[k] || 0}</td><td data-l="% de quem abriu">${pct(sum[k] || 0)}</td></tr>`).join('');
  $('#ofDetail').innerHTML = views ? group('Botão de comprar clicado', OF_BTNS) + group('Seção que apareceu na tela', OF_SECS) + group('Dúvida aberta', OF_FAQS) : '';
  $('#ofRows').innerHTML = rows.map(([ad, r]) => {
    const pct = r.view ? Math.round(r.buy / r.view * 100) + '%' : '—';
    return `<tr><td data-l="Anúncio">${esc(ad)}</td><td data-l="Abriram">${r.view}</td><td data-l="Viram o preço">${r.price}</td><td data-l="Rolaram 50%">${r.s50}</td><td data-l="Rolaram 90%">${r.s90}</td><td data-l="Clicaram em comprar">${r.buy}</td><td data-l="Cliques ÷ abriram">${pct}</td></tr>`;
  }).join('');
  $('#ofDays').hidden = !perDay.length; $('#ofDays').textContent = 'Aberturas por dia: ' + perDay.join(' · ');
}
async function loadOferta() {
  try { const r = await aapi('/api/admin/oferta', { token: await tokenOf() }); renderOferta(r.days || []); }
  catch (e) { console.error('Contador da oferta:', e); $('#ofEmpty').textContent = 'Não foi possível carregar os números agora.'; $('#ofEmpty').hidden = false; }
}

async function start() {
  try {
    // O Firebase guarda o token por até 1 hora. Se o e-mail foi confirmado depois do último login, o token antigo
    // ainda diz "e-mail não confirmado" e o servidor recusa o painel. Recarrega a conta e força um token novo.
    try { await user.reload(); } catch { /* sem conexão: segue com o token atual */ }
    const st = await api('/api/license/status', { token: await user.getIdToken(true) });
    if (!st.admin) throw Object.assign(new Error('Esta conta não é administradora. Entre com o e-mail administrador e confirme o endereço de e-mail.'), { status: 403 });
    $('#admStatus').hidden = true; $('#admApp').hidden = false;
    await loadAll();
  } catch (error) {
    console.error('Painel de acessos:', error);
    if (error.data?.pinRequired) { $('#admStatus').hidden = true; $('#pinForm').hidden = false; $('#pinInput').focus(); if (pin) { $('#pinError').textContent = 'PIN incorreto.'; $('#pinError').hidden = false; } return; }
    if (error.data?.reauth) { $('#admStatus').innerHTML = 'Por segurança, a sessão de administrador expirou. <a href="/login.html" id="reauth">Entrar novamente</a>'; $('#reauth').onclick = async e => { e.preventDefault(); await signOut(auth); location.replace('/login.html'); }; return; }
    $('#admStatus').textContent = error.message + (error.status ? ` (código ${error.status})` : ''); $('#admStatus').classList.add('adm-error');
  }
}

onAuthStateChanged(auth, u => {
  if (!u) { $('#admStatus').innerHTML = 'Você precisa entrar com a conta administradora. <a href="/login.html">Entrar</a>'; return; }
  user = u; $('#admUser').textContent = u.email || ''; $('#admLogout').hidden = false;
  $('#admStatus').textContent = 'Verificando acesso… (o servidor pode levar até 1 minuto para acordar)';
  start();
});
$('#pinForm').onsubmit = e => {
  e.preventDefault();
  pin = $('#pinInput').value;
  try { sessionStorage.setItem('p360AdmPin', pin); } catch { /* ok */ }
  $('#pinForm').hidden = true; $('#admStatus').hidden = false; $('#admStatus').textContent = 'Verificando…';
  start();
};
$('#admLogout').onclick = async () => { await signOut(auth); location.replace('/login.html'); };

async function grant(email) {
  const r = await aapi('/api/admin/grant', { method: 'POST', token: await tokenOf(), body: { email } });
  toast(r.granted ? 'Acesso liberado.' : r.verifyPending ? 'Registrado. Falta a pessoa confirmar o e-mail.' : 'Registrado. O acesso sai quando a pessoa criar a conta.');
  await loadAll();
}
$('#genForm').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#genBtn'), err = $('#genError'); err.hidden = true;
  btn.disabled = true; btn.textContent = 'Liberando…';
  try { await grant($('#genEmail').value.trim().toLowerCase()); $('#genEmail').value = ''; }
  catch (error) { console.error('Liberar acesso:', error); err.textContent = error.message + (error.status ? ` (código ${error.status})` : ''); err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'Liberar acesso'; }
};
$('#reloadOferta').onclick = async () => { await loadOferta(); toast('Atualizado.'); };
$('#reloadAll').onclick = async () => { try { await loadAll(); toast('Atualizado.'); } catch (e) { toast(e.message); } };
$('.adm-filter').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; document.querySelectorAll('.adm-filter button').forEach(x => x.classList.toggle('active', x === b)); renderPurchases(); };
$('#keyRows').onclick = async e => {
  const r = e.target.closest('[data-revoke]'), g = e.target.closest('[data-grant]');
  try {
    if (r) {
      if (!confirm(`Cancelar o acesso de ${r.dataset.revoke}? A pessoa perde o acesso agora.`)) return;
      await aapi('/api/admin/revoke', { method: 'POST', token: await tokenOf(), body: { email: r.dataset.revoke } });
      toast('Acesso cancelado.'); await loadAll();
    } else if (g) await grant(g.dataset.grant);
  } catch (error) { toast(error.message); }
};
