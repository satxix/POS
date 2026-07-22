const CACHE_NAME = 'villacart-pos-v8.3.4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=8.3.4',
  './styles.css?v=8.3.4',
  './utils.js?v=8.3.4',
  './ledger.js?v=8.3.4',
  './receipts.js?v=8.3.4',
  
    './receipt-ui.js?v=8.3.4',
    './scanner.js?v=8.3.4',
    './camera-scanner.js?v=8.3.4',
  
    
    './cart.js?v=8.3.4',
    './payment-ui.js?v=8.3.4',
    './favorites.js?v=8.3.4',
    
    './notifications.js?v=8.3.4',
    
    './stock-ui.js?v=8.3.4',
    './gcash.js?v=8.3.4',
  
    './expenses.js?v=8.3.4',
    './status-ui.js?v=8.3.4',
    './pwa-lifecycle.js?v=8.3.4',
    './insights-base.js?v=8.3.4',
    './reporting-ui.js?v=8.3.4',
    './app.js?v=8.3.4',
    './backup-actions.js?v=8.3.4',
    './business-actions.js?v=8.3.4',
  
    './business-ui.js?v=8.3.4',
    
    './ui-core.js?v=8.3.4',
    './product.js?v=8.3.4',
    './settings.js?v=8.3.4',
    './inventory-actions.js?v=8.3.4',
    './sales-export.js?v=8.3.4',
    './transaction-detail.js?v=8.3.4',
    './diagnostics.js?v=8.3.4',
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


