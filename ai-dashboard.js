// Atalho da IA no Dashboard: um chat rápido flutuante que usa a mesma IA própria da página
// "IA Financeira" (window.P360AI, criada pelo app.js). Nada é enviado para servidores externos.
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

function mount() {
  if (document.getElementById('p360DashboardAI')) return;
  const root = document.createElement('div');
  root.id = 'p360DashboardAI';
  root.className = 'p360-dashboard-ai is-minimized';
  root.innerHTML = `<button class="ai-dash-launcher" title="Abrir IA Financeira" aria-label="Abrir IA Financeira" aria-expanded="false">✦</button>
  <div class="ai-dash-panel" role="dialog" aria-label="Assistente Patrimônio 360" hidden>
    <div class="ai-dash-head"><div class="ai-dash-orb" aria-hidden="true">✦</div><div class="ai-dash-title"><strong>Assistente Patrimônio 360</strong><span>IA própria · aprende com você</span></div><button class="ai-dash-icon ai-dash-min" aria-label="Minimizar">−</button></div>
    <div class="ai-dash-messages" aria-live="polite"><div class="ai-dash-msg assistant"><div class="ai-dash-bubble">Olá! Pergunte sobre seu mês, uma compra ou quanto ainda pode gastar.</div></div></div>
    <div class="ai-dash-suggestions"></div>
    <form class="ai-dash-form"><textarea rows="1" maxlength="500" placeholder="Pergunte à IA..." aria-label="Mensagem para a IA" enterkeyhint="send"></textarea><button class="ai-dash-send" type="submit">Enviar</button></form>
  </div>`;
  document.body.appendChild(root);

  const launcher = root.querySelector('.ai-dash-launcher'), panel = root.querySelector('.ai-dash-panel');
  const messages = root.querySelector('.ai-dash-messages'), form = root.querySelector('.ai-dash-form'), input = form.querySelector('textarea');
  const suggestions = root.querySelector('.ai-dash-suggestions');

  const renderSuggestions = list => {
    suggestions.innerHTML = (list || []).map(s => `<button type="button" data-q="${esc(s.text)}">${esc(s.text)}</button>`).join('');
  };
  const open = () => {
    root.classList.remove('is-minimized'); panel.hidden = false; launcher.hidden = true; launcher.setAttribute('aria-expanded', 'true');
    try { renderSuggestions(window.P360AI?.suggestions()); } catch {}
    if (!matchMedia('(pointer:coarse)').matches) input.focus();
  };
  const close = () => { root.classList.add('is-minimized'); panel.hidden = true; launcher.hidden = false; launcher.setAttribute('aria-expanded', 'false'); };

  launcher.onclick = open;
  root.querySelector('.ai-dash-min').onclick = close;
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); launcher.focus(); } });
  suggestions.onclick = e => { const b = e.target.closest('button[data-q]'); if (b) send(b.dataset.q); };
  form.onsubmit = e => { e.preventDefault(); const text = input.value; input.value = ''; send(text); };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); form.requestSubmit(); } };

  async function send(text) {
    text = String(text || '').trim();
    if (!text || !window.P360AI) return;
    open();
    messages.insertAdjacentHTML('beforeend', `<div class="ai-dash-msg user"><div class="ai-dash-bubble">${esc(text)}</div></div><div class="ai-dash-msg assistant" data-typing="1"><div class="ai-dash-bubble">Analisando…</div></div>`);
    messages.scrollTop = messages.scrollHeight;
    await new Promise(r => setTimeout(r, 250));
    const typing = messages.querySelector('[data-typing="1"]');
    try {
      const r = window.P360AI.ask(text);
      typing.removeAttribute('data-typing');
      typing.querySelector('.ai-dash-bubble').innerHTML = window.P360AI.format(r.text) + `<a class="ai-dash-more" href="#/assistente">Continuar na página da IA →</a>`;
      renderSuggestions(r.suggestions);
    } catch (error) {
      console.warn(error);
      typing.querySelector('.ai-dash-bubble').textContent = 'Não consegui analisar agora. Tente novamente.';
    }
    messages.scrollTop = messages.scrollHeight;
  }

  // Disponível em todas as páginas, menos na própria página da IA.
  function syncVisibility() {
    const visible = !!document.querySelector('.app-shell') && !document.querySelector('#aiMessages');
    root.style.display = visible ? '' : 'none';
    if (!visible && !root.classList.contains('is-minimized')) close();
  }
  syncVisibility();
  new MutationObserver(() => setTimeout(syncVisibility, 0)).observe(document.getElementById('app') || document.body, { childList: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
