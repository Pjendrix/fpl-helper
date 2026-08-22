// Service worker pro Squadcheck.
//
// Záměrně cachuje jen skořápku aplikace — HTML, manifest, ikonu.
// Odpovědi z /api/* se nikdy neukládají: zastaralá tabulka miniligy nebo
// stará sestava vypadají jako pravda, a to je horší než čestná chyba.
// Pro čerstvost dat máme edge cache na serveru.

const SHELL = 'squadcheck-shell-v1';
const FILES = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);

  if(ev.request.method !== 'GET') return;
  if(url.origin !== location.origin) return;
  if(url.pathname.startsWith('/api/')) return;   // data vždy ze sítě

  // Skořápka: nejdřív síť, cache je záložní plán pro offline.
  ev.respondWith(
    fetch(ev.request)
      .then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(ev.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(ev.request).then(hit => hit || caches.match('/')))
  );
});
