/* Contador anônimo da página de oferta.
   Só avisa o nosso servidor que um passo aconteceu (abriu, viu o preço, rolou 50% e 90%, clicou em comprar) e de qual anúncio veio.
   Sem cookie, sem armazenamento no navegador, sem identificador, sem terceiros. Falha em silêncio: nunca atrapalha a página. */
(function () {
  'use strict';
  var h = location.hostname;
  if (!/\.(web\.app|firebaseapp\.com)$/.test(h)) return;      // só no site de verdade (não em testes locais)
  if (navigator.webdriver) return;                             // robôs e navegadores automatizados não contam
  var ad = '';
  try { ad = (new URLSearchParams(location.search).get('utm_content') || '').toLowerCase(); } catch (e) { /* sem utm */ }
  if (ad === 'teste') return;                                  // simulações do dono (?utm_content=teste) não contam
  if (!/^[a-z0-9_]{1,40}$/.test(ad)) ad = '';

  var URL_API = 'https://patrimonio360-hqka.onrender.com/api/oferta/evento';
  var sent = {};
  function send(e) {
    if (sent[e]) return; sent[e] = 1;
    try {
      fetch(URL_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e: e, c: ad }), keepalive: true, credentials: 'omit', mode: 'cors' }).catch(function () {});
    } catch (err) { /* sem rede: ignora */ }
  }

  send('view');

  var price = document.querySelector('[data-price-anim]');
  if (price && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); send('price'); } }, { threshold: 0.5 });
    io.observe(price);
  }

  var onScroll = function () {
    var d = document.documentElement, max = d.scrollHeight - innerHeight;
    if (max <= 0) return;
    var p = (window.scrollY || d.scrollTop) / max;
    if (p >= 0.5) send('s50');
    if (p >= 0.9) { send('s90'); removeEventListener('scroll', onScroll); }
  };
  addEventListener('scroll', onScroll, { passive: true });

  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('[data-buy]') : null;
    if (a) { delete sent.buy; send('buy'); }
  }, true);
})();
