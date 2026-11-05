/* Service worker do Patrimônio 360.
   - Páginas, scripts e estilos: rede primeiro (sempre a versão nova quando há internet), cache se estiver offline.
   - Imagens, fontes e bibliotecas versionadas: cache primeiro, atualizando em segundo plano.
   - Nunca guarda nem intercepta Firebase/Firestore/Auth nem a API do backend (dados e login sempre ao vivo).
   Para forçar atualização do cache em todos os aparelhos, mude VERSION. */
const VERSION = 'p360-v57';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ['./', 'index.html', 'offline.html', 'manifest.webmanifest', 'favicon.svg', 'assets/images/icon-192.png'];
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Um arquivo que falhe não impede a instalação.
    await Promise.all(PRECACHE.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS]);
    for (const key of await caches.keys()) if (key.startsWith('p360-') && !keep.has(key)) await caches.delete(key);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const LIVE = /(^|\.)(firestore|identitytoolkit|securetoken|firebaseinstallations|firebaseappcheck)\.googleapis\.com$|(^|\.)firebaseio\.com$|(^|\.)onrender\.com$|(^|\.)apis\.google\.com$/;

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)); }

async function networkFirst(request, cacheName, fallbackUrl, preload) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await Promise.race([preload ? Promise.resolve(preload).then(r => r || fetch(request)) : fetch(request), timeout(NETWORK_TIMEOUT)]);
    if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl, { ignoreSearch: true });
      if (shell) return shell;
    }
    // Rede lenta (e não offline de verdade): tenta mais uma vez sem limite de tempo.
    try { return await fetch(request); } catch { return null; }
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const update = fetch(request).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {}); return res; }).catch(() => null);
  return hit || (await update) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol) || LIVE.test(url.hostname)) return;

  // Navegação (abrir/recarregar o app)
  if (request.mode === 'navigate') {
    const isApp = url.origin === self.location.origin && /(^|\/)(index\.html)?$/.test(url.pathname);
    event.respondWith((async () => {
      // O app (SPA) responde sempre pelo index.html; login/cadastro e outras páginas pelo próprio endereço.
      const res = isApp
        ? await networkFirst(new Request('index.html'), SHELL, 'index.html', event.preloadResponse)
        : await networkFirst(request, SHELL);
      return res || (await caches.match('offline.html')) || Response.error();
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    if (/\.(js|css|webmanifest|json)$/i.test(url.pathname)) {
      event.respondWith((async () => (await networkFirst(request, SHELL)) || Response.error())());
    } else {
      event.respondWith(staleWhileRevalidate(request, ASSETS));
    }
    return;
  }

  // Fontes e SDK do Firebase (arquivos versionados)
  if (/(^|\.)(gstatic\.com|fonts\.googleapis\.com)$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, ASSETS));
  }
});

// Abrir o app ao tocar numa notificação (preparado para avisos futuros)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
