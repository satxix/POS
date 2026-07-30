const APP_VERSION = '8.5.3';
const CACHE_NAME = 'villacart-pos-v' + APP_VERSION;
const OFFLINE_ENTRY = './index.html?v=' + APP_VERSION;
const APP_SHELL = [
  OFFLINE_ENTRY,
  './manifest.webmanifest?v=8.5.3',
  './styles.css?v=8.5.3',
  './vendor/tailwind-forms-container.js?v=8.5.3',
  './vendor/fonts/fonts.css?v=8.5.3',
  './vendor/fonts/inter-latin.woff2',
  './vendor/fonts/material-symbols-outlined.woff2',
  './vendor/quagga.min.js?v=8.5.3',
  './vendor/firebase-app-compat.js?v=8.5.3',
  './vendor/firebase-auth-compat.js?v=8.5.3',
  './vendor/firebase-firestore-compat.js?v=8.5.3',
  './utils.js?v=8.5.3',
  './ledger.js?v=8.5.3',
  './receipts.js?v=8.5.3',
  
    './receipt-ui.js?v=8.5.3',
    './scanner.js?v=8.5.3',
    './camera-scanner.js?v=8.5.3',
  
    
    './cart.js?v=8.5.3',
    './payment-ui.js?v=8.5.3',
    './favorites.js?v=8.5.3',
    
    './notifications.js?v=8.5.3',
    
    './stock-ui.js?v=8.5.3',
    './gcash.js?v=8.5.3',
  
    './expenses.js?v=8.5.3',
    './status-ui.js?v=8.5.3',
    './pwa-lifecycle.js?v=8.5.3',
    './insights-base.js?v=8.5.3',
    './reporting-ui.js?v=8.5.3',
    './sync-engine.js?v=8.5.3',
    './app.js?v=8.5.3',
    './item-sales.js?v=8.5.3',
    './ledger-ui.js?v=8.5.3',
    './backup-actions.js?v=8.5.3',
    './business-actions.js?v=8.5.3',
  
    './business-ui.js?v=8.5.3',
    
    './ui-core.js?v=8.5.3',
    './product.js?v=8.5.3',
    './settings.js?v=8.5.3',
    './inventory-actions.js?v=8.5.3',
    './sales-export.js?v=8.5.3',
    './transaction-detail.js?v=8.5.3',
    './diagnostics.js?v=8.5.3',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/villacart-logo.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Never activate a newly named cache if GitHub/CDN briefly returned the
    // previous index.html during deployment propagation.
    const offlinePage = await cache.match(OFFLINE_ENTRY);
    const offlineText = offlinePage ? await offlinePage.clone().text() : '';
    const cachedVersion = htmlAppVersion(offlineText);
    if (cachedVersion !== APP_VERSION) {
      throw new Error('App shell version mismatch: expected ' + APP_VERSION + ', received ' + (cachedVersion || 'unknown'));
    }

  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response && response.ok) {
          const text = await response.clone().text();
          const networkVersion = htmlAppVersion(text);
          // Accept this build or any newer deployment. If an edge cache
          // briefly serves an older page, retain the known-good shell.
          if (networkVersion && compareVersions(networkVersion, APP_VERSION) >= 0) {
            await cache.put(OFFLINE_ENTRY, response.clone());
            return response;
          }
        }
      } catch (error) {
        // Fall through to the versioned offline shell.
      }

      const cached = await cache.match(OFFLINE_ENTRY);
      if (cached) return cached;

      return new Response(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="theme-color" content="#1e3a5f">' +
        '<body style="margin:0;background:#f0f4f8;color:#1e3a5f;font:600 18px system-ui;' +
        'display:grid;place-items:center;min-height:100vh;text-align:center">' +
        '<main><h1>Villacart POS</h1><p>Offline files are not ready yet.</p>' +
        '<p>Connect once, reopen the app, then try again.</p></main></body>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
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

function htmlAppVersion(html) {
  const match = String(html || '').match(/VILLACART_EXPECTED_VERSION\s*=\s*['"]v?(\d+\.\d+\.\d+)['"]/);
  return match ? match[1] : '';
}

function compareVersions(left, right) {
  const a = String(left || '').split('.').map(value => Number(value) || 0);
  const b = String(right || '').split('.').map(value => Number(value) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference;
  }
  return 0;
}


