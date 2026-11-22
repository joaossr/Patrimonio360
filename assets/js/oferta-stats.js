/* Contador anônimo da página de oferta.
   Só avisa o nosso servidor que um passo aconteceu (abriu, viu o preço, rolou 50% e 90%, quais seções viu, qual botão de comprar clicou, qual dúvida abriu) e de qual anúncio veio.
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

  // Qual botão de comprar foi clicado (cada botão da página tem um nome em data-buy) e o total de cliques.
  var BTNS = { barra: 1, topo: 1, hero: 1, preco: 1, oferta: 1, final: 1, fixo: 1 };
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('[data-buy]') : null;
    if (!a) return;
    delete sent.buy; send('buy');
    var n = a.getAttribute('data-buy');
    if (BTNS[n]) { delete sent['b_' + n]; send('b_' + n); }
  }, true);

  // Até que parte da página a pessoa chega: avisa uma vez quando cada seção aparece na tela.
  var SECS = ['preco-pratica', 'funcoes', 'sistema', 'celular', 'como-funciona', 'oferta', 'para-quem', 'avaliacoes', 'duvidas'];
  if ('IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (x) {
        if (!x.isIntersecting) return;
        so.unobserve(x.target);
        send('sec_' + x.target.id.replace(/-/g, '_'));
      });
    }, { threshold: 0, rootMargin: '0px 0px -30% 0px' }); // conta quando o começo da seção entra nos 70% de cima da tela (seções muito altas nunca chegam a 25% visíveis)
    SECS.forEach(function (id) { var el = document.getElementById(id); if (el) so.observe(el); });
  }

  // Quais dúvidas abrem (a ordem das perguntas na página, de 1 a 7). O evento "toggle" não sobe, por isso a captura.
  document.addEventListener('toggle', function (ev) {
    var d = ev.target;
    if (!d || d.tagName !== 'DETAILS' || !d.open) return;
    var all = document.querySelectorAll('#duvidas details'), i = Array.prototype.indexOf.call(all, d) + 1;
    if (i >= 1 && i <= 7) send('faq_' + i);
  }, true);
})();
