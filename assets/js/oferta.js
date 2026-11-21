// Landing page /oferta: animações, troca de mockup por print real, repasse de UTMs e barra fixa de compra.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const onVisible = (els, cb, threshold = .35) => {
    if (!('IntersectionObserver' in window)) return els.forEach(cb);
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { cb(e.target); io.unobserve(e.target); } }), { threshold });
    els.forEach(e => io.observe(e));
  };

  // ano do rodapé
  const ano = $('#ano'); if (ano) ano.textContent = new Date().getFullYear();

  // 0) Oferta de lançamento sem cronômetro: o preço é sempre R$ 29,90 (R$ 79,90 só aparece riscado, como valor antigo).
  //    Não existe mais compra por R$ 79,90 nesta página: todos os botões levam ao checkout de R$ 29,90.
  const dealOver = false;

  // 1) Parâmetros dos anúncios (utm_*, src, sck) seguem para o checkout da Kiwify: assim as vendas aparecem por campanha.
  try {
    const q = new URLSearchParams(location.search), keep = new URLSearchParams();
    for (const [k, v] of q) if (/^(utm_[a-z_]+|src|sck)$/i.test(k) && v.length <= 200) keep.set(k, v);
    if ([...keep].length) $$('[data-buy]').forEach(a => { const u = new URL(a.href); keep.forEach((v, k) => u.searchParams.set(k, v)); a.href = u.toString(); });
  } catch { /* sem URL API: o link segue sem parâmetros */ }

  // 2) Entrada animada ao rolar
  const reveal = $$('.reveal, .shot, .show-text, .features, .compare');
  if (!('IntersectionObserver' in window)) reveal.forEach(e => e.classList.add('in'));
  else {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .14, rootMargin: '0px 0px -6% 0px' });
    reveal.forEach(e => io.observe(e));
  }

  // 3) Prints reais: se existir assets/images/prints/<nome>.webp|png|jpg, ele entra DENTRO da moldura (notebook, celular ou janela).
  const EXT = ['webp', 'png', 'jpg'];
  const loadPrint = fig => {
    if (fig.dataset.tried) return; fig.dataset.tried = '1';
    const name = fig.dataset.print;
    const next = i => {
      if (i >= EXT.length) return;
      const img = new Image();
      img.decoding = 'async'; img.alt = 'Tela do Patrimônio 360';
      img.onload = () => {
        const mk = $('.mk', fig);
        if (mk) { img.className = 'frame-img'; mk.replaceWith(img); }
        else { img.className = 'print-img'; fig.prepend(img); }
        fig.classList.add('has-print');
      };
      img.onerror = () => next(i + 1);
      img.src = `/assets/images/prints/${name}.${EXT[i]}`;
    };
    next(0);
  };
  const figs = $$('[data-print]');
  if ('IntersectionObserver' in window) {
    const pio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { loadPrint(e.target); pio.unobserve(e.target); } }), { rootMargin: '400px 900px' });
    figs.forEach(f => pio.observe(f));
  } else figs.forEach(loadPrint);
  // a galeria de celulares rola na horizontal (o que está fora dela não "aparece" para o observador): carrega tudo ao chegar perto
  const gal = $('.gallery');
  if (gal && 'IntersectionObserver' in window) {
    const gio = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { $$('[data-print]', gal).forEach(loadPrint); gio.disconnect(); } }, { rootMargin: '600px 0px' });
    gio.observe(gal);
  }

  // 3b) Fotos de pessoas ("Para quem é"): se existir assets/images/pessoas/<nome>.webp|jpg|jpeg|png, ela substitui o fundo colorido.
  const PEXT = ['webp', 'jpg', 'jpeg', 'png'];
  const loadPhoto = fig => {
    if (fig.dataset.tried) return; fig.dataset.tried = '1';
    const name = fig.dataset.photo;
    const next = i => {
      if (i >= PEXT.length) return;
      const img = new Image(); img.decoding = 'async'; img.alt = '';
      img.onload = () => { img.className = 'who-img'; fig.prepend(img); fig.classList.add('has-photo'); };
      img.onerror = () => next(i + 1);
      img.src = `/assets/images/pessoas/${name}.${PEXT[i]}`;
    };
    next(0);
  };
  const photos = $$('[data-photo]');
  if ('IntersectionObserver' in window) {
    const phio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { loadPhoto(e.target); phio.unobserve(e.target); } }), { rootMargin: '500px 0px' });
    photos.forEach(f => phio.observe(f));
    // no celular os cartões rolam na horizontal (o observador não vê o que está fora): carrega todas ao chegar perto
    const wg = $('.who-grid');
    if (wg) { const wio = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { photos.forEach(loadPhoto); wio.disconnect(); } }, { rootMargin: '600px 0px' }); wio.observe(wg); }
  } else photos.forEach(loadPhoto);

  // 4) Barra de progresso da rolagem
  const bar = $('.scroll-progress i');
  const onScroll = (() => {
    let tick = false;
    return () => {
      if (tick) return; tick = true;
      requestAnimationFrame(() => {
        const h = document.documentElement.scrollHeight - innerHeight;
        if (bar) bar.style.setProperty('--p', h > 0 ? Math.min(1, scrollY / h).toFixed(4) : 0);
        tick = false;
      });
    };
  })();
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // 5) Barra fixa de compra no celular: aparece depois do topo e some quando a oferta já está na tela
  const sticky = $('.sticky-cta');
  if (sticky) {
    const hide = new Set();
    const upd = () => sticky.classList.toggle('show-it', scrollY > 520 && !hide.size);
    addEventListener('scroll', upd, { passive: true }); upd();
    if ('IntersectionObserver' in window) {
      const sio = new IntersectionObserver(es => { es.forEach(e => e.isIntersecting ? hide.add(e.target) : hide.delete(e.target)); upd(); }, { threshold: .25 });
      ['#oferta', '.final'].forEach(s => { const el = $(s); if (el) sio.observe(el); });
    }
  }

  // 6) FAQ: abre um por vez
  const fq = $$('.faq details');
  fq.forEach(d => d.addEventListener('toggle', () => { if (d.open) fq.forEach(o => { if (o !== d) o.open = false; }); }));

  // Com "reduzir animações" ligado no aparelho ficam de fora só os efeitos de deslocamento grande (partículas, 3D e ímã).

  // 7) Preço: o valor antigo (R$ 79,90) cai até R$ 29,90 quando aparece
  const fmt = v => { const c = Math.round(v * 100); return [String(Math.floor(c / 100)), ',' + String(c % 100).padStart(2, '0')]; };
  const priceEls = $$('[data-price-anim]');
  const setPrice = (el, v) => { const [i, d] = fmt(v); $('b', el).textContent = i; $('.cents', el).textContent = d; };
  priceEls.forEach(el => setPrice(el, 79.9));
  onVisible(priceEls, el => {
    if (dealOver) return;
    const b = $('b', el), c = $('.cents', el), t0 = performance.now(), D = 1900, from = 79.9, to = 29.9;
    const step = now => {
      const k = Math.min(1, (now - t0) / D), v = from + (to - from) * ease(k);
      const [i, d] = fmt(k < 1 ? v : to); b.textContent = i; c.textContent = d;
      if (k < 1) requestAnimationFrame(step); else { el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 900); }
    };
    setTimeout(() => requestAnimationFrame(step), 450);
  }, .6);

  // 8) Números que sobem
  onVisible($$('[data-count]'), el => {
    const to = Number(el.dataset.count), from = Number(el.dataset.from ?? (to === 0 ? 29 : 0)), t0 = performance.now(), D = 1400;
    const step = now => {
      const k = Math.min(1, (now - t0) / D); el.textContent = Math.round(from + (to - from) * ease(k));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, .6);

  // 9) Partículas do hero
  const pc = $('.particles');
  if (pc && !reduce) {
    const colors = ['rgba(63,140,255,.9)', 'rgba(140,88,232,.9)', 'rgba(224,74,151,.85)', 'rgba(25,184,201,.9)'];
    const n = innerWidth < 700 ? 9 : 20, rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.cssText = `--x:${rnd(2, 98).toFixed(1)}%;--s:${rnd(3, 9).toFixed(1)}px;--d:${rnd(10, 19).toFixed(1)}s;--dl:-${rnd(0, 18).toFixed(1)}s;--dx:${rnd(-70, 70).toFixed(0)}px;--c:${colors[i % colors.length]}`;
      pc.appendChild(p);
    }
  }

  // 10) Hero em 3D que acompanha o mouse
  const hero = $('.hero'), vis = $('.hero-visual');
  if (finePointer && !reduce && hero && vis) {
    let raf = 0, tx = 0, ty = 0;
    hero.addEventListener('pointermove', e => {
      if (innerWidth <= 1020) return;
      tx = (e.clientX / innerWidth - .5) * 9; ty = (e.clientY / innerHeight - .5) * -6;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; vis.style.setProperty('--ry', tx.toFixed(2) + 'deg'); vis.style.setProperty('--rx', ty.toFixed(2) + 'deg'); });
    });
    hero.addEventListener('pointerleave', () => { vis.style.setProperty('--ry', '0deg'); vis.style.setProperty('--rx', '0deg'); });
  }

  // 11) Botões "ímã" e luz que segue o mouse nos cartões
  if (finePointer && !reduce) {
    $$('.btn').forEach(b => {
      b.addEventListener('pointermove', e => {
        const r = b.getBoundingClientRect();
        b.style.setProperty('--tx', Math.max(-8, Math.min(8, (e.clientX - r.left - r.width / 2) * .14)).toFixed(1) + 'px');
        b.style.setProperty('--ty', Math.max(-6, Math.min(6, (e.clientY - r.top - r.height / 2) * .18)).toFixed(1) + 'px');
      });
      b.addEventListener('pointerleave', () => { b.style.setProperty('--tx', '0px'); b.style.setProperty('--ty', '0px'); });
    });
    $$('.feat').forEach(c => c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }));
  }

  // 12) Avaliações: faixa que corre sozinha (duplica os cartões para o laço ficar contínuo)
  const track = $('#reviewsTrack');
  if (track && track.children.length) {
    [...track.children].forEach(c => { const k = c.cloneNode(true); k.setAttribute('aria-hidden', 'true'); k.classList.remove('reveal', 'd1', 'd2'); track.appendChild(k); });
    track.classList.add('is-marquee');
  }
})();
