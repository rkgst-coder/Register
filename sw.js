/* Register service worker — app shell offline.
   The page itself is fetched network-first (so a new version shows on the
   next launch, not the one after); icons are cache-first. The Apps Script
   API is never cached. Bump CACHE with every deploy. */
const CACHE = 'register-v2.0.3';
const SHELL = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png', './icon-512-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // script.google.com etc. go straight to the network
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isPage) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
        const res = await fetch(req, { signal: ctl.signal, cache: 'no-cache' }); clearTimeout(t);
        if (res.ok) cache.put('./index.html', res.clone());
        return res;
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
