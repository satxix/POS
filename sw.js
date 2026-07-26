const CACHE_NAME = 'villacart-pos-v8.3.17';
const OFFLINE_ENTRY = './index.html';
const EXTERNAL_STARTUP_ASSETS = [
  'https://cdn.tailwindcss.com?plugins=forms,container-queries',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
];
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=8.3.17',
  './styles.css?v=8.3.17',
  './utils.js?v=8.3.17',
  './ledger.js?v=8.3.17',
  './receipts.js?v=8.3.17',
  
    './receipt-ui.js?v=8.3.17',
    './scanner.js?v=8.3.17',
    './camera-scanner.js?v=8.3.17',
  
    
    './cart.js?v=8.3.17',
    './payment-ui.js?v=8.3.17',
    './favorites.js?v=8.3.17',
    
    './notifications.js?v=8.3.17',
    
    './stock-ui.js?v=8.3.17',
    './gcash.js?v=8.3.17',
  
    './expenses.js?v=8.3.17',
    './status-ui.js?v=8.3.17',
    './pwa-lifecycle.js?v=8.3.17',
    './insights-base.js?v=8.3.17',
    './reporting-ui.js?v=8.3.17',
    './sync-engine.js?v=8.3.17',
    './app.js?v=8.3.17',
    './ledger-ui.js?v=8.3.17',
    './backup-actions.js?v=8.3.17',
    './business-actions.js?v=8.3.17',
  
    './business-ui.js?v=8.3.17',
    
    './ui-core.js?v=8.3.17',
    './product.js?v=8.3.17',
    './settings.js?v=8.3.17',
    './inventory-actions.js?v=8.3.17',
    './sales-export.js?v=8.3.17',
    './transaction-detail.js?v=8.3.17',
    './diagnostics.js?v=8.3.17',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/villacart-logo.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Cross-origin startup libraries cannot safely participate in the atomic
    // addAll() above. Cache each one independently so a font/CDN outage does
    // not prevent the core offline shell from installing.
    await Promise.allSettled(EXTERNAL_STARTUP_ASSETS.map(async url => {
      const request = new Request(url, { mode: 'no-cors', credentials: 'omit' });
      const response = await fetch(request);
      await cache.put(request, response);
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    const networkUpdate = fetch(event.request, { cache: 'no-store' })
      .then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(OFFLINE_ENTRY, response.clone());
        }
        return response;
      });

    event.waitUntil(networkUpdate.catch(() => undefined));
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(OFFLINE_ENTRY, { ignoreSearch: true })
        || await cache.match('./', { ignoreSearch: true });
      if (cached) return cached;

      try {
        return await networkUpdate;
      } catch (error) {
        return new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<meta name="theme-color" content="#1e3a5f">' +
          '<body style="margin:0;background:#f0f4f8;color:#1e3a5f;font:600 18px system-ui;' +
          'display:grid;place-items:center;min-height:100vh;text-align:center">' +
          '<main><h1>Villacart POS</h1><p>Offline files are not ready yet.</p>' +
          '<p>Connect once, reopen the app, then try again.</p></main></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
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


