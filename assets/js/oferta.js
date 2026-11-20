// Landing page /oferta: animações de entrada, troca de mockup por print real, repasse de UTMs e barra fixa de compra.
(() => {
  'use strict';
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ano do rodapé
  const ano = document.getElementById('ano'); if (ano) ano.textContent = new Date().getFullYear();

  // 1) Parâmetros dos anúncios (utm_*, src, sck) seguem para o checkout da Kiwify: assim as vendas aparecem por campanha.
  try {
    const q = new URLSearchParams(location.search), keep = new URLSearchParams();
    for (const [k, v] of q) if (/^(utm_[a-z_]+|src|sck)$/i.test(k) && v.length <= 200) keep.set(k, v);
    if ([...keep].length) $$('[data-buy]').forEach(a => { const u = new URL(a.href); keep.forEach((v, k) => u.searchParams.set(k, v)); a.href = u.toString(); });
  } catch { /* sem URL API: o link segue sem parâmetros */ }

  // 2) Animação ao rolar
  const reveal = $$('.reveal, .shot, .show-text, .features, .compare');
  if (reduce || !('IntersectionObserver' in window)) { reveal.forEach(e => e.classList.add('in')); }
  else {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .14, rootMargin: '0px 0px -6% 0px' });
    reveal.forEach(e => io.observe(e));
  }

  // 3) Prints reais: se existir assets/images/prints/<nome>.png|jpg|webp, ele substitui o desenho (mockup).
  const EXT = ['png', 'jpg', 'webp'];
  const loadPrint = fig => {
    if (fig.dataset.tried) return; fig.dataset.tried = '1';
    const name = fig.dataset.print;
    const next = i => {
      if (i >= EXT.length) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { img.className = 'print-img'; img.alt = 'Tela do Patrimônio 360'; fig.classList.add('has-print'); fig.prepend(img); };
      img.onerror = () => next(i + 1);
      img.src = `/assets/images/prints/${name}.${EXT[i]}`;
    };
    next(0);
  };
  const figs = $$('[data-print]');
  if ('IntersectionObserver' in window) {
    const pio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { loadPrint(e.target); pio.unobserve(e.target); } }), { rootMargin: '300px 0px' });
    figs.forEach(f => pio.observe(f));
  } else figs.forEach(loadPrint);

  // 4) Barra fixa de compra no celular: aparece depois do topo e some quando a oferta já está na tela.
  const sticky = document.querySelector('.sticky-cta');
  if (sticky) {
    const hide = new Set();
    const onScroll = () => sticky.classList.toggle('show-it', scrollY > 520 && !hide.size);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    if ('IntersectionObserver' in window) {
      const sio = new IntersectionObserver(es => { es.forEach(e => e.isIntersecting ? hide.add(e.target) : hide.delete(e.target)); onScroll(); }, { threshold: .25 });
      ['#oferta', '.final'].forEach(s => { const el = document.querySelector(s); if (el) sio.observe(el); });
    }
  }

  // 5) FAQ: abre um por vez (mais limpo no celular)
  const fq = $$('.faq details');
  fq.forEach(d => d.addEventListener('toggle', () => { if (d.open) fq.forEach(o => { if (o !== d) o.open = false; }); }));
})();
