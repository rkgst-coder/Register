/* Register service worker — app shell offline.
   The page itself is fetched network-first (so a new version shows on the
   next launch, not the one after). index.html loads app.js?v=<version>, so
   each page version asks for its own app.js and the two can never mix; that
   versioned app.js, icons and the files in vendor/ are cache-first and are
   all fetched at install, so PDFs and the Excel export work offline from the
   first day. The Apps Script API is never cached.
   With every deploy: bump VERSION here and APP_VERSION in app.js, and the
   ?v= on the app.js script tag and the app-version meta in index.html. */
const VERSION = '2.25.0';
const CACHE = 'register-v' + VERSION;
const SHELL = ['./', './index.html', './app.js?v=' + VERSION, './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png', './icon-512-maskable.png',
  './vendor/pdf-3.11.174.min.js', './vendor/pdf.worker-3.11.174.min.js', './vendor/pdf-lib-1.17.1.min.js', './vendor/xlsx.full-0.18.5.min.js'];

// v2.24: the new version takes over only when the page, app.js and the PDF / Excel tools all downloaded.
// If one fails (a flaky network, GitHub still publishing), this install fails, the working old version
// stays in charge, and the browser tries again on a later launch. Icons and the manifest are optional.
const MUST = ['./index.html', './app.js?v=' + VERSION, './vendor/pdf-3.11.174.min.js', './vendor/pdf.worker-3.11.174.min.js', './vendor/pdf-lib-1.17.1.min.js', './vendor/xlsx.full-0.18.5.min.js'];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const tmp = await caches.open(CACHE + '-new');
    try {
      await Promise.all(MUST.map(async u => { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(u + ' ' + r.status); await tmp.put(u, r); }));
      await Promise.all(SHELL.filter(u => !MUST.includes(u)).map(u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? tmp.put(u, r) : null).catch(() => null)));
      const c = await caches.open(CACHE);
      for (const req of await tmp.keys()) await c.put(req, await tmp.match(req));
    } finally { await caches.delete(CACHE + '-new'); }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CACHE + '-new').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // script.google.com etc. go straight to the network
  // only the app page itself is the "page": another address that happens to answer 200 must never replace the cached app
  const isPage = url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isPage) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
        const res = await fetch(req, { signal: ctl.signal, cache: 'no-cache' }); clearTimeout(t);
        if (res.ok) { cache.put('./index.html', res.clone()); return res; }
        return (await cache.match('./index.html')) || res;           // 404/500 while GitHub deploys: keep the working app
      } catch (err) {
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
