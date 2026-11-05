// Painel do administrador: gera e acompanha as chaves de acesso de uso único.
// A segurança está no servidor (só e-mails de ADMIN_EMAILS, já confirmados, passam). Esta tela só mostra o resultado.
import { auth } from './config/firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { api } from './license.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmt = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const SITE = location.origin;
let user = null, keys = [], filter = 'all', lastGenerated = [];

function toast(msg) {
  const t = $('#admToast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}
const copy = async text => { try { await navigator.clipboard.writeText(text); toast('Copiado.'); } catch { toast('Não foi possível copiar. Selecione e copie manualmente.'); } };
const tokenOf = () => user.getIdToken();
const validity = d => d === 0 ? 'Sem vencimento' : d === 365 ? '1 ano' : d === 180 ? '6 meses' : `${d} dias`;

function renderRows() {
  const list = keys.filter(k => filter === 'all' || (filter === 'free' ? !k.used && !k.revoked : k.used));
  $('#listEmpty').hidden = list.length > 0;
  $('#keyRows').innerHTML = list.map(k => {
    const status = k.revoked ? '<span class="adm-pill off">Cancelada</span>' : k.used ? `<span class="adm-pill used">Usada</span><small>${esc(k.usedEmail)} · ${fmt(k.usedAt)}</small>` : '<span class="adm-pill free">Disponível</span>';
    return `<tr><td data-l="Para">${esc(k.label) || '<i>sem nome</i>'}</td><td data-l="Final"><code>••••${esc(k.hint)}</code></td><td data-l="Validade">${validity(k.days)}</td><td data-l="Criada">${fmt(k.createdAt)}</td><td data-l="Situação">${status}</td><td>${!k.used && !k.revoked ? `<button type="button" class="adm-link danger" data-revoke="${esc(k.id)}">Cancelar</button>` : ''}</td></tr>`;
  }).join('');
}
async function loadKeys() {
  const r = await api('/api/admin/keys', { token: await tokenOf() });
  keys = r.keys || []; renderRows();
}

function message(key) {
  return `Olá! Seu acesso ao Patrimônio 360 está liberado 🎉\n\n1) Abra: ${SITE}/register.html\n2) Crie a sua conta e digite esta chave de acesso:\n\n${key}\n\nA chave vale só para você e só pode ser usada uma vez.`;
}

async function start() {
  try {
    const st = await api('/api/license/status', { token: await tokenOf() });
    if (!st.admin) throw Object.assign(new Error('Esta conta não é administradora. Entre com o e-mail administrador e confirme o endereço de e-mail.'), { status: 403 });
    $('#admStatus').hidden = true; $('#admApp').hidden = false;
    await loadKeys();
  } catch (error) {
    $('#admStatus').textContent = error.message; $('#admStatus').classList.add('adm-error');
  }
}

onAuthStateChanged(auth, u => {
  if (!u) { $('#admStatus').innerHTML = 'Você precisa entrar com a conta administradora. <a href="/login.html">Entrar</a>'; return; }
  user = u; $('#admUser').textContent = u.email || ''; $('#admLogout').hidden = false;
  $('#admStatus').textContent = 'Verificando acesso… (o servidor pode levar até 1 minuto para acordar)';
  start();
});
$('#admLogout').onclick = async () => { await signOut(auth); location.replace('/login.html'); };

$('#genForm').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#genBtn'), err = $('#genError'); err.hidden = true;
  btn.disabled = true; btn.textContent = 'Gerando…';
  try {
    const r = await api('/api/admin/keys', { method: 'POST', token: await tokenOf(), body: { count: Number($('#genCount').value), days: Number($('#genDays').value), label: $('#genLabel').value } });
    lastGenerated = r.keys;
    $('#genList').innerHTML = r.keys.map(k => `<li><code>${esc(k)}</code><button type="button" class="adm-btn ghost sm" data-copy="${esc(k)}">Copiar</button><button type="button" class="adm-btn ghost sm" data-msg="${esc(k)}">Mensagem</button></li>`).join('');
    $('#genResult').hidden = false; $('#genLabel').value = '';
    await loadKeys();
  } catch (error) { err.textContent = error.message; err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'Gerar chave'; }
};
$('#genList').onclick = e => {
  const c = e.target.closest('[data-copy]'), m = e.target.closest('[data-msg]');
  if (c) copy(c.dataset.copy); else if (m) copy(message(m.dataset.msg));
};
$('#copyAll').onclick = () => copy(lastGenerated.join('\n'));
$('#copyMsg').onclick = () => copy(lastGenerated.map(message).join('\n\n———\n\n'));
$('.adm-filter').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; document.querySelectorAll('.adm-filter button').forEach(x => x.classList.toggle('active', x === b)); renderRows(); };
$('#keyRows').onclick = async e => {
  const b = e.target.closest('[data-revoke]'); if (!b) return;
  if (!confirm('Cancelar esta chave? Ela deixará de funcionar.')) return;
  try { await api('/api/admin/keys/revoke', { method: 'POST', token: await tokenOf(), body: { id: b.dataset.revoke } }); toast('Chave cancelada.'); await loadKeys(); }
  catch (error) { toast(error.message); }
};
