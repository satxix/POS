const APP_VERSION = '8.4.5';
const CACHE_NAME = 'villacart-pos-v' + APP_VERSION;
const OFFLINE_ENTRY = './index.html?v=' + APP_VERSION;
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
  OFFLINE_ENTRY,
  './manifest.webmanifest?v=8.4.5',
  './styles.css?v=8.4.5',
  './utils.js?v=8.4.5',
  './ledger.js?v=8.4.5',
  './receipts.js?v=8.4.5',
  
    './receipt-ui.js?v=8.4.5',
    './scanner.js?v=8.4.5',
    './camera-scanner.js?v=8.4.5',
  
    
    './cart.js?v=8.4.5',
    './payment-ui.js?v=8.4.5',
    './favorites.js?v=8.4.5',
    
    './notifications.js?v=8.4.5',
    
    './stock-ui.js?v=8.4.5',
    './gcash.js?v=8.4.5',
  
    './expenses.js?v=8.4.5',
    './status-ui.js?v=8.4.5',
    './pwa-lifecycle.js?v=8.4.5',
    './insights-base.js?v=8.4.5',
    './reporting-ui.js?v=8.4.5',
    './sync-engine.js?v=8.4.5',
    './app.js?v=8.4.5',
    './ledger-ui.js?v=8.4.5',
    './backup-actions.js?v=8.4.5',
    './business-actions.js?v=8.4.5',
  
    './business-ui.js?v=8.4.5',
    
    './ui-core.js?v=8.4.5',
    './product.js?v=8.4.5',
    './settings.js?v=8.4.5',
    './inventory-actions.js?v=8.4.5',
    './sales-export.js?v=8.4.5',
    './transaction-detail.js?v=8.4.5',
    './diagnostics.js?v=8.4.5',
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

    // Cross-origin startup libraries cannot safely participate in the atomic
    // addAll() above. Cache each one independently so a font/CDN outage does
    // not prevent the core offline shell from installing.
    await Promise.allSettled(EXTERNAL_STARTUP_ASSETS.map(async url => {
      const request = new Request(url, { mode: 'no-cors', credentials: 'omit' });
      const response = await fetch(request);
      await cache.put(request, response);
    }));
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


