/* Medição da página de oferta (Pixel da Meta) com consentimento.
   - Nada é carregado nem enviado antes de a pessoa tocar em "Aceitar".
   - Se ela recusar, a página funciona igual e nenhum dado vai para a Meta.
   - Não enviamos nome, e-mail nem dado pessoal: só eventos (visita, rolagem, preço visto, clique em comprar).
   - A escolha fica guardada neste navegador (chave p360_consent_pixel). */
(function () {
  'use strict';
  var PIXEL_ID = '1577923450756486', KEY = 'p360_consent_pixel';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var read = function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  var write = function (v) { try { localStorage.setItem(KEY, v); } catch (e) { /* sem armazenamento: vale só nesta visita */ } };

  // Qual anúncio trouxe a pessoa (utm_content) vai como parâmetro dos eventos.
  var criativo = '';
  try { criativo = (new URLSearchParams(location.search).get('utm_content') || '').slice(0, 60); } catch (e) { /* sem utm */ }
  var extra = criativo ? { criativo: criativo } : {};

  var started = false;
  function startPixel() {
    if (started) return; started = true;
    /* código-base oficial da Meta */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView', extra);

    // Viu o preço
    var price = $('[data-price-anim]');
    if (price && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); window.fbq('track', 'ViewContent', Object.assign({ content_name: 'Patrimonio 360', value: 29.9, currency: 'BRL' }, extra)); }
      }, { threshold: 0.5 });
      io.observe(price);
    }

    // Rolagem: 50% e 90% da página
    var sent = {};
    var onScroll = function () {
      var h = document.documentElement, max = h.scrollHeight - innerHeight;
      if (max <= 0) return;
      var p = (window.scrollY || h.scrollTop) / max;
      [[0.5, 'Scroll50'], [0.9, 'Scroll90']].forEach(function (x) {
        if (p >= x[0] && !sent[x[1]]) { sent[x[1]] = 1; window.fbq('trackCustom', x[1], extra); }
      });
      if (sent.Scroll50 && sent.Scroll90) removeEventListener('scroll', onScroll);
    };
    addEventListener('scroll', onScroll, { passive: true });

    // Clique em qualquer botão de comprar (vai para o checkout da Kiwify)
    var clicked = false;
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('[data-buy]') : null;
      if (!a || clicked) return; clicked = true;
      window.fbq('track', 'InitiateCheckout', Object.assign({ content_name: 'Patrimonio 360', value: 29.9, currency: 'BRL' }, extra));
      setTimeout(function () { clicked = false; }, 4000);
    }, true);
  }

  function banner() {
    var box = document.createElement('div');
    box.className = 'ck-bar'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Aviso de cookies');
    box.innerHTML = '<p>Usamos o Pixel da Meta (cookies) só para medir se os nossos anúncios funcionam. Você pode recusar e usar a página normalmente. <a href="/privacidade.html#cookies" target="_blank" rel="noopener">Saiba mais</a></p>' +
      '<div class="ck-btns"><button type="button" data-ck="0">Recusar</button><button type="button" data-ck="1">Aceitar</button></div>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ck]'); if (!b) return;
      var yes = b.getAttribute('data-ck') === '1';
      write(yes ? '1' : '0'); box.remove();
      if (yes) startPixel();
    });
    document.body.appendChild(box);
  }

  var c = read();
  if (c === '1') startPixel();
  else if (c !== '0') { if (document.body) banner(); else document.addEventListener('DOMContentLoaded', banner); }
})();
