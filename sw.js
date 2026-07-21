const CACHE_NAME = 'villacart-pos-v8.2.6';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=8.2.6',
  './styles.css?v=8.2.6',
  './utils.js?v=8.2.6',
  './credit-utils.js?v=8.2.6',
  './receipts.js?v=8.2.6',
  
    './receipt-ui.js?v=8.2.6',
    './scanner.js?v=8.2.6',
    './camera-scanner.js?v=8.2.6',
  
    
    './cart.js?v=8.2.6',
    './favorites.js?v=8.2.6',
    
    './notifications.js?v=8.2.6',
    
    './stock-ui.js?v=8.2.6',
    './gcash.js?v=8.2.6',
  
    './expenses.js?v=8.2.6',
    './status-ui.js?v=8.2.6',
    './pwa-lifecycle.js?v=8.2.6',
    './app.js?v=8.2.6',
  
    './business-ui.js?v=8.2.6',
    
    './ui-core.js?v=8.2.6',
    './product.js?v=8.2.6',
    './settings.js?v=8.2.6',
    './inventory-actions.js?v=8.2.6',
    './sales-export.js?v=8.2.6',
    './transaction-detail.js?v=8.2.6',
    './diagnostics.js?v=8.2.6',
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


