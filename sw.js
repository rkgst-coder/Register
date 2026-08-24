/* Register service worker — caches the app shell so it opens instantly and
   works with no network. Data itself lives in localStorage (encrypted) and
   syncs to the Sheet when a connection is available.
   Bump CACHE when you deploy a new index.html. */
const CACHE = 'register-v23';
const SHELL = [
  './', './index.html', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-180.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(SHELL)).then(()=> self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  // Never cache the data API or the AI endpoint — always go to network.
  if(url.hostname.includes('script.google.com') || url.hostname.includes('api.anthropic.com')){
    return;
  }
  if(e.request.method !== 'GET') return;

  // App shell: cache first, refresh in background.
  e.respondWith(
    caches.match(e.request).then(hit=>{
      const net = fetch(e.request).then(res=>{
        if(res && res.status===200 && res.type==='basic'){
          const copy = res.clone();
          caches.open(CACHE).then(c=> c.put(e.request, copy));
        }
        return res;
      }).catch(()=> hit);
      return hit || net;
    })
  );
});
