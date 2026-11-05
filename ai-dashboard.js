// Atalho da IA em todas as páginas: um chat rápido flutuante que usa a mesma IA própria da página
// "IA Financeira" (window.P360AI, criada pelo app.js). Nada é enviado para servidores externos.
import { icon } from '/assets/js/icons.js';

const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const AI_ICON = { overview: 'dashboard', health: 'shield', balance: 'wallet', spending_top: 'budget', compare: 'transfer', purchase: 'card', can_spend: 'target', forecast: 'calendar', upcoming: 'calendar', budget: 'budget', cards: 'card', subscriptions: 'repeat', recurring: 'repeat', reserve: 'shield', investments: 'invest', goals: 'target', saving_plan: 'target', save_tips: 'sparkles', anomalies: 'alert', income: 'income', profile: 'user', help: 'sparkles' };

function mount() {
  if (document.getElementById('p360DashboardAI')) return;
  const root = document.createElement('div');
  root.id = 'p360DashboardAI';
  root.className = 'p360-dashboard-ai is-minimized';
  root.innerHTML = `<button class="ai-dash-launcher" type="button" title="Abrir IA Financeira" aria-label="Abrir IA Financeira" aria-expanded="false">${icon('sparkles', { size: 24 })}</button>
  <div class="ai-dash-panel" role="dialog" aria-label="Assistente Patrimônio 360" hidden>
    <div class="ai-dash-head">
      <div class="ai-dash-orb" aria-hidden="true">${icon('sparkles', { size: 20 })}</div>
      <div class="ai-dash-title"><strong>Assistente Patrimônio 360</strong><span><i class="ai-dash-dot"></i>Privado · roda no seu aparelho</span></div>
      <a class="ai-dash-icon ai-dash-full" href="/assistente" data-p360-go="assistente" aria-label="Abrir a página completa da IA" title="Abrir página completa">${icon('transfer', { size: 17 })}</a>
      <button class="ai-dash-icon ai-dash-min" type="button" aria-label="Minimizar" title="Minimizar">${icon('close', { size: 17 })}</button>
    </div>
    <div class="ai-dash-messages" aria-live="polite"></div>
    <div class="ai-dash-suggestions" aria-label="Sugestões de perguntas"></div>
    <form class="ai-dash-form"><textarea rows="1" maxlength="500" placeholder="Pergunte sobre seu dinheiro…" aria-label="Mensagem para a IA" enterkeyhint="send"></textarea><button class="ai-dash-send" type="submit" aria-label="Enviar" title="Enviar">${icon('send', { size: 19 })}</button></form>
  </div>`;
  document.body.appendChild(root);

  const launcher = root.querySelector('.ai-dash-launcher'), panel = root.querySelector('.ai-dash-panel');
  const messages = root.querySelector('.ai-dash-messages'), form = root.querySelector('.ai-dash-form'), input = form.querySelector('textarea');
  const suggestions = root.querySelector('.ai-dash-suggestions');

  const welcome = () => `<div class="ai-dash-welcome"><b>Como posso ajudar?</b><span>Pergunte sobre o seu mês, uma compra ou quanto ainda pode gastar.</span></div>`;
  messages.innerHTML = welcome();
  let started = false;

  const renderSuggestions = list => {
    suggestions.innerHTML = (list || []).slice(0, 5).map(s => `<button type="button" data-q="${esc(s.text)}">${s.intent && AI_ICON[s.intent] ? icon(AI_ICON[s.intent], { size: 14 }) : ''}<span>${esc(s.text)}</span></button>`).join('');
  };
  const open = () => {
    root.classList.remove('is-minimized'); panel.hidden = false; launcher.hidden = true; launcher.setAttribute('aria-expanded', 'true');
    try { renderSuggestions(window.P360AI?.suggestions()); } catch {}
    if (!matchMedia('(pointer:coarse)').matches) input.focus();
  };
  const close = () => { root.classList.add('is-minimized'); panel.hidden = true; launcher.hidden = false; launcher.setAttribute('aria-expanded', 'false'); };

  launcher.onclick = open;
  root.querySelector('.ai-dash-min').onclick = close;
  root.querySelector('.ai-dash-full').addEventListener('click', () => close());
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); launcher.focus(); } });
  suggestions.onclick = e => { const b = e.target.closest('button[data-q]'); if (b) send(b.dataset.q); };
  form.onsubmit = e => { e.preventDefault(); const text = input.value; input.value = ''; input.style.height = ''; send(text); };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); form.requestSubmit(); } };
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(110, input.scrollHeight) + 'px'; };

  async function send(text) {
    text = String(text || '').trim();
    if (!text || !window.P360AI) return;
    open();
    if (!started) { messages.innerHTML = ''; started = true; }
    messages.insertAdjacentHTML('beforeend', `<div class="ai-dash-msg user"><div class="ai-dash-bubble">${esc(text)}</div></div><div class="ai-dash-msg assistant" data-typing="1"><div class="ai-dash-bubble"><span class="ai-dash-typing"><i></i><i></i><i></i></span></div></div>`);
    messages.scrollTop = messages.scrollHeight;
    await new Promise(r => setTimeout(r, 250));
    const typing = messages.querySelector('[data-typing="1"]');
    try {
      const r = window.P360AI.ask(text);
      typing.removeAttribute('data-typing');
      typing.querySelector('.ai-dash-bubble').innerHTML = window.P360AI.format(r.text) + `<a class="ai-dash-more" href="/assistente" data-p360-go="assistente">Continuar na página da IA →</a>`;
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

// Links internos (ex.: "Continuar na página da IA") navegam sem recarregar a página.
document.addEventListener('click', e => {
  const a = e.target.closest?.('[data-p360-go]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  history.pushState(null, '', '/' + a.dataset.p360Go);
  window.dispatchEvent(new PopStateEvent('popstate'));
});
