const APP_VERSION = '8.8.7.2';
const CACHE_NAME = 'villacart-pos-v' + APP_VERSION;
const OFFLINE_ENTRY = './index.html?v=' + APP_VERSION;
const APP_SHELL = [
  OFFLINE_ENTRY,
  './manifest.webmanifest?v=8.8.7.2',
  './styles.css?v=8.8.7.2',
  './vendor/tailwind-forms-container.js?v=8.8.7.2',
  './vendor/fonts/fonts.css?v=8.8.7.2',
  './vendor/fonts/inter-latin.woff2',
  './vendor/fonts/material-symbols-outlined.woff2',
  './vendor/quagga.min.js?v=8.8.7.2',
  './vendor/firebase-app-compat.js?v=8.8.7.2',
  './vendor/firebase-auth-compat.js?v=8.8.7.2',
  './vendor/firebase-firestore-compat.js?v=8.8.7.2',
  './utils.js?v=8.8.7.2',
  './ledger.js?v=8.8.7.2',
  './receipts.js?v=8.8.7.2',
  
    './receipt-ui.js?v=8.8.7.2',
    './scanner.js?v=8.8.7.2',
    './camera-scanner.js?v=8.8.7.2',
  
    
    './cart.js?v=8.8.7.2',
    './payment-ui.js?v=8.8.7.2',
    './favorites.js?v=8.8.7.2',
    
    './notifications.js?v=8.8.7.2',
    
    './stock-ui.js?v=8.8.7.2',
    './gcash.js?v=8.8.7.2',
  
    './expenses.js?v=8.8.7.2',
    './status-ui.js?v=8.8.7.2',
    './pwa-lifecycle.js?v=8.8.7.2',
    './insights-base.js?v=8.8.7.2',
    './reporting-ui.js?v=8.8.7.2',
    './storage-db.js?v=8.8.7.2',
    './sync-engine.js?v=8.8.7.2',
    './app.js?v=8.8.7.2',
    './item-sales.js?v=8.8.7.2',
    './ledger-ui.js?v=8.8.7.2',
    './backup-actions.js?v=8.8.7.2',
    './business-actions.js?v=8.8.7.2',
  
    './business-ui.js?v=8.8.7.2',
    
    './ui-core.js?v=8.8.7.2',
    './product.js?v=8.8.7.2',
    './settings.js?v=8.8.7.2',
    './inventory-actions.js?v=8.8.7.2',
    './sales-export.js?v=8.8.7.2',
    './transaction-detail.js?v=8.8.7.2',
    './diagnostics.js?v=8.8.7.2',
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
  const source = String(html || '');
  const pattern = /VILLACART_EXPECTED_VERSION\s*=\s*['"]v?(\d+(?:\.\d+){2,}(?:[-+][0-9A-Za-z.-]+)?)['"]/g;
  let version = '';
  let match;
  // Use the final assignment. The page may include an earlier compatibility
  // marker so older three-part workers can safely hand over to this build.
  while ((match = pattern.exec(source))) version = match[1];
  return version;
}

function compareVersions(left, right) {
  const numericParts = value => String(value || '')
    .replace(/^v/i, '')
    .split(/[+-]/, 1)[0]
    .split('.')
    .map(part => Number(part) || 0);
  const a = numericParts(left);
  const b = numericParts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference;
  }
  return 0;
}








