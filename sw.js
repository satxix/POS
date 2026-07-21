const CACHE_NAME = 'villacart-pos-v8.1.7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=8.1.7',
  './styles.css?v=8.1.7',
  './utils.js?v=8.1.7',
  './credit-utils.js?v=8.1.7',
  './receipts.js?v=8.1.7',
  
    './receipt-ui.js?v=8.1.7',
    './scanner.js?v=8.1.7',
  
    
    './cart.js?v=8.1.7',
    './favorites.js?v=8.1.7',
    
    './notifications.js?v=8.1.7',
    
    './stock-ui.js?v=8.1.7',
    './gcash.js?v=8.1.7',
  
    './expenses.js?v=8.1.7',
    './app.js?v=8.1.7',
  
    './business-ui.js?v=8.1.7',
    
    './ui-core.js?v=8.1.7',
    './product.js?v=8.1.7',
    './settings.js?v=8.1.7',
    './diagnostics.js?v=8.1.7',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/villacart-logo.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then(cached => cached || caches.match('./')))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => {
    if (cached) return cached;
    return fetch(event.request).then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      }
      return response;
    });
  }));
});


self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});


