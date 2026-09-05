// Service worker pro Minileague Squad Check.
//
// Záměrně cachuje jen skořápku aplikace — HTML, manifest, ikony, značky klubů.
// Odpovědi z /api/fpl se nikdy neukládají: zastaralá tabulka miniligy nebo
// stará sestava vypadají jako pravda, a to je horší než čestná chyba.
// Pro čerstvost dat máme edge cache na serveru.
//
// Výjimka jsou odznaky klubů z /api/badge. Ty se mění jednou za sezónu
// (postup a sestup), takže je držíme natrvalo — u obrázku zastaralost
// nehrozí a šetří to desítky requestů při každém otevření.

const SHELL = 'squadcheck-shell-v31';
const BADGES = 'squadcheck-badges-v1';

/* Otisk verze statiky. MUSÍ sedět s ?v= v index.html.

   Když se rozejdou, service worker předcachuje jiné URL, než jaké
   stránka požaduje — offline by pak byla skořápka bez skriptů, tedy
   prázdná stránka. Že to sedí, hlídá test. */
const V = '31';
const s = (p) => p + '?v=' + V;

const FILES = ['/', '/index.html', '/manifest.webmanifest',
               '/icon.svg', '/favicon.svg', '/club-marks.svg',
               // Styly a skripty jsou od rozdělení index.html samostatné
               // soubory. Bez nich by se offline načetla prázdná skořápka:
               // HTML by bylo z cache, ale appka by neměla čím naběhnout.
               s('/css/app.css'), s('/css/narrow.css'), s('/css/small.css'),
               s('/css/mobile.css'),
               /* Pořadí odpovídá index.html. Skupina tabs*.js vznikla
                  rozdělením jednoho souboru o 4 200 řádcích. */
               s('/js/core.js'),
               s('/js/tabs.js'), s('/js/tabs-players.js'), s('/js/tabs-hub.js'),
               s('/js/tabs-prices.js'), s('/js/tabs-league.js'),
               s('/js/status.js'), s('/js/squad.js'), s('/js/h2h.js'),
               s('/js/advisor.js'), s('/js/news.js'), s('/js/ui.js'),
               s('/js/planner.js'), s('/js/histcache.js'), s('/js/sync.js'),
               s('/js/topbar.js'), s('/js/mobile.js'), s('/js/boot.js'),
               s('/js/firebase.js'),
               /* Plakát a loga: velké, neměnné, a bez nich vypadá vstup
                  rozbitě. `logo.webp` tu bylo taky — jenže na něj nikde
                  nevede odkaz, takže se 19 kB stahovalo a drželo offline
                  pro obrázek, který se nikdy nezobrazí. */
               '/assets/headline.webp', '/assets/logo-transp.webp',
               '/assets/mark.webp'];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(SHELL)
      // addAll je all-or-nothing: jeden chybějící soubor by shodil celou
      // instalaci a appka by zůstala bez service workeru. Radši po jednom.
      .then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k !== BADGES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);

  if(ev.request.method !== 'GET') return;
  if(url.origin !== location.origin) return;

  // Odznaky: cache first. Obrázek klubu se během sezóny nemění.
  if(url.pathname === '/api/badge'){
    ev.respondWith(
      caches.open(BADGES).then(c =>
        c.match(ev.request).then(hit => hit || fetch(ev.request).then(res => {
          if(res.ok) c.put(ev.request, res.clone());
          return res;
        }).catch(() => hit)))
    );
    return;
  }

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
