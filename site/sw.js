// Makes the page installable and keeps it working without a connection. The network always
// goes first, so a new version is there on the next visit; what was fetched is kept, and
// used only when the network does not answer.
const CACHE = 'manillen-1';
const SHELL = ['./', 'style.css', 'manifest.json', 'manille.wasm', 'policy.bin', 'trump.bin', 'fonts/bitter.woff2',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/ui.js', 'js/game.js', 'js/manille.js', 'js/sound.js', 'js/worker.js',
  ...Array.from({ length: 32 }, (_, c) => `cards/${c}.webp`)];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
