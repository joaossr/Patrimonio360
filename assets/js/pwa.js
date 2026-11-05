/* Patrimônio 360 como app: registra o service worker, oferece "Instalar", avisa de atualização e de falta de internet.
   Script externo (a CSP do site não permite scripts inline). Expõe window.p360PWA para a tela de Configurações. */
(() => {
  const standaloneQuery = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)');
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => standaloneQuery.matches || window.navigator.standalone === true;
  let deferredPrompt = null;
  let waitingWorker = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(api); } catch {} });

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const api = {
    isStandalone,
    isIOS: () => isIOS,
    canInstall: () => Boolean(deferredPrompt) && !isStandalone(),
    updateReady: () => Boolean(waitingWorker),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async install() {
      if (!deferredPrompt) return 'unavailable';
      const prompt = deferredPrompt;
      deferredPrompt = null;
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      emit();
      return choice.outcome;
    },
    applyUpdate() {
      if (waitingWorker) waitingWorker.postMessage('SKIP_WAITING');
    },
  };
  window.p360PWA = api;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    emit();
    scheduleInstallBanner();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    store.set('p360.installed', '1');
    document.querySelector('.pwa-toast[data-kind="install"]')?.remove();
    emit();
  });
  standaloneQuery.addEventListener?.('change', emit);

  // ---- Avisos na tela ----
  function toast(kind, html, actionLabel, onAction, onClose) {
    document.querySelector(`.pwa-toast[data-kind="${kind}"]`)?.remove();
    const el = document.createElement('div');
    el.className = 'pwa-toast';
    el.dataset.kind = kind;
    el.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.style.flex = '1';
    text.innerHTML = html;
    el.appendChild(text);
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.addEventListener('click', () => { onAction?.(); el.remove(); });
      el.appendChild(b);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Fechar');
    x.textContent = '×';
    x.style.cssText = 'background:transparent;color:inherit;font-size:1.3rem;padding:2px 8px;opacity:.7';
    x.addEventListener('click', () => { onClose?.(); el.remove(); });
    el.appendChild(x);
    document.body.appendChild(el);
    return el;
  }

  let bannerTimer = null;
  function scheduleInstallBanner() {
    if (isStandalone() || store.get('p360.installed') === '1') return;
    const dismissed = Number(store.get('p360.installDismissed') || 0);
    if (Date.now() - dismissed < 14 * 864e5) return;
    if (!window.matchMedia('(max-width: 960px)').matches) return; // no computador, a opção fica em Configurações
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      if (isStandalone()) return;
      const close = () => store.set('p360.installDismissed', String(Date.now()));
      if (deferredPrompt) {
        toast('install', '<b>Instale o Patrimônio 360</b><br><small>Abre em tela cheia, como um app.</small>', 'Instalar', () => api.install(), close);
      } else if (isIOS) {
        toast('install', '<b>Instale no iPhone</b><br><small>Toque em Compartilhar e depois em “Adicionar à Tela de Início”.</small>', '', null, close);
      }
    }, 9000);
  }
  if (isIOS) scheduleInstallBanner();

  // ---- Sem internet ----
  function syncOnline() {
    document.querySelector('.offline-pill')?.remove();
    if (navigator.onLine) return;
    const pill = document.createElement('div');
    pill.className = 'offline-pill';
    pill.setAttribute('role', 'status');
    pill.textContent = 'Sem internet — alterações podem não sincronizar';
    document.body.appendChild(pill);
  }
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  if (document.body) syncOnline(); else document.addEventListener('DOMContentLoaded', syncOnline);

  // ---- Service worker ----
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
        const watch = worker => {
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorker = worker;
              emit();
              toast('update', '<b>Nova versão disponível</b>', 'Atualizar', () => api.applyUpdate());
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) { waitingWorker = reg.waiting; toast('update', '<b>Nova versão disponível</b>', 'Atualizar', () => api.applyUpdate()); }
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
        // Procura versão nova ao voltar para o app (celular costuma deixá-lo aberto por dias).
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded || !waitingWorker) return; // primeiro controle não recarrega
          reloaded = true;
          location.reload();
        });
      } catch (e) {
        console.warn('P360: service worker não registrado:', e?.message);
      }
    });
  }
})();
