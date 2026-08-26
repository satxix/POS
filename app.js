// --- Firebase Configuration ---
    // SECURITY NOTE: Restrict API keys to your GitHub Pages domain in Firebase Console > API restrictions.
    // Normal URL uses live Firestore. Add ?env=test to use the sandbox Firebase project.
    window.VILLACART_APP_VERSION = 'v8.8.7.2';
    window.__villacartScannerDebug = window.__villacartScannerDebug || {
        events: [],
        lastInputValue: '',
        lastBarcodeAttempt: '',
        lastBarcodeResult: '',
        lastHandledAt: null,
        initAt: new Date().toISOString(),
        appVersion: window.VILLACART_APP_VERSION
    };
    window.__villacartStartup = window.__villacartStartup || {
        scriptStartAt: Date.now(),
        navigationStartAt: (performance && performance.timeOrigin) ? Math.round(performance.timeOrigin) : Date.now(),
        marks: []
    };
    function vcStartupMark(name, extra) {
        try {
            const now = Date.now();
            const start = window.__villacartStartup.scriptStartAt || now;
            window.__villacartStartup.marks.push({
                name,
                at: new Date(now).toISOString(),
                msSinceScriptStart: now - start,
                ...(extra || {})
            });
            window.__villacartStartup.lastMark = name;
            window.__villacartStartup.lastMarkAt = new Date(now).toISOString();
        } catch(e) {}
    }
    vcStartupMark('script-start');

    const firebaseConfigs = {
        live: {
            apiKey: "AIzaSyBSRVxGcKllY04Ghoy9e_2ZKId3D1Mx7bM",
            authDomain: "quickpos-fcffc.firebaseapp.com",
            projectId: "quickpos-fcffc",
            storageBucket: "quickpos-fcffc.firebasestorage.app",
            messagingSenderId: "542473883041",
            appId: "1:542473883041:web:3bdc285631819787644fe0"
        },
        test: {
            apiKey: "AIzaSyDBbHK7cI1D3sycOPweqKDcBZDfNU1UArg",
            authDomain: "quickpos-test.firebaseapp.com",
            projectId: "quickpos-test",
            storageBucket: "quickpos-test.firebasestorage.app",
            messagingSenderId: "743128618",
            appId: "1:743128618:web:6557c5735ce47435384d53",
            measurementId: "G-EVXF44P3QD"
        }
    };
    const APP_ENV = new URLSearchParams(window.location.search).get('env') === 'test' ? 'test' : 'live';
    const firebaseConfig = firebaseConfigs[APP_ENV];
    window.VILLACART_ENV = APP_ENV;
    window.VILLACART_FIREBASE_PROJECT = firebaseConfig.projectId;
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth ? firebase.auth() : null;
    window.__villacartAuthStatus = {
        ready: false,
        mode: auth ? 'anonymous' : 'unavailable',
        uid: null,
        error: null,
        projectId: firebaseConfig.projectId
    };
    const authReadyPromise = auth ? auth.signInAnonymously()
        .then(credential => {
            const user = credential && credential.user ? credential.user : auth.currentUser;
            window.__villacartAuthStatus.ready = !!user;
            window.__villacartAuthStatus.uid = user ? user.uid : null;
            window.__villacartAuthStatus.isAnonymous = user ? !!user.isAnonymous : null;
            vcStartupMark('anonymous-auth-ready', { uid: user ? user.uid : null });
            return user;
        })
        .catch(error => {
            window.__villacartAuthStatus.ready = false;
            window.__villacartAuthStatus.error = error && error.message ? error.message : String(error);
            vcStartupMark('anonymous-auth-failed', { error: window.__villacartAuthStatus.error });
            console.warn('Anonymous Firebase Auth failed:', error);
            return null;
        }) : Promise.resolve(null);
    window.villacartAuthReady = authReadyPromise;
    const db = firebase.firestore();

    window.villacartGetDeviceApprovalInfo = async function villacartGetDeviceApprovalInfo() {
        const authStatus = window.__villacartAuthStatus || {};
        const info = {
            ready: false,
            projectId: firebaseConfig.projectId,
            uid: authStatus.uid || null,
            approvalMethod: 'firestore-rules-uid-allowlist',
            error: null
        };
        try {
            const user = await authReadyPromise;
            const currentUser = (auth && auth.currentUser) || user;
            info.uid = currentUser ? currentUser.uid : info.uid;
            info.ready = !!info.uid;
            if (!info.uid) info.error = authStatus.error || 'Anonymous auth is not ready yet.';
        } catch (error) {
            info.error = error && error.message ? error.message : String(error);
        }
        window.__villacartDeviceApproval = info;
        return info;
    };

    // Some networks/proxies allow Firestore reads but stall the realtime write
    // channel. Use the compatible long-polling transport before Firestore is
    // used so writes work reliably across browsers on the same network.
    db.settings({ experimentalForceLongPolling: true, useFetchStreams: false });

    // v5.6.1: Critical Fix - Enable Firestore Offline Persistence explicitly
    db.enablePersistence().catch(err => {
        if (err.code === 'failed-precondition') {
            console.warn("Persistence failed: Multiple tabs open.");
        } else if (err.code === 'unimplemented') {
            console.warn("Persistence failed: Browser doesn't support it.");
        }
    });

    // --- Data Storage ---
    const STORAGE_SUFFIX = APP_ENV === 'test' ? '_test' : '';
    const DB_KEY = 'saph_pos_v5_villacart' + STORAGE_SUFFIX;
    const QUEUE_KEY = 'saph_pos_v5_villacart_queue' + STORAGE_SUFFIX;
    const FAV_KEY = 'villacart_favorites' + STORAGE_SUFFIX;
    const ARCHIVE_KEY = 'villacart_local_archive_v710' + STORAGE_SUFFIX;
    const safeLocalJson = window.VillacartUtils && window.VillacartUtils.safeLocalJson;
    const isFirestoreSyncTable = window.VillacartUtils && window.VillacartUtils.isFirestoreSyncTable;
    const isArchiveOnlyRecord = window.VillacartUtils && window.VillacartUtils.isArchiveOnlyRecord;
    const {
        buildThermalReceiptText,
        isAndroidRuntime,
        gzipBase64String,
        buildOpenEscposIntentHtml
    } = window.VillacartReceipts || {};

    vcStartupMark('before-local-state-load');
    let vc860HasLegacyMain = false;
    let vc860HasLegacyArchive = false;
    let vc860HasLegacyQueue = false;
    try {
        vc860HasLegacyMain = localStorage.getItem(DB_KEY) !== null;
        vc860HasLegacyArchive = localStorage.getItem(ARCHIVE_KEY) !== null;
        vc860HasLegacyQueue = localStorage.getItem(QUEUE_KEY) !== null;
    } catch (storageReadError) {}
    let state = safeLocalJson(DB_KEY, {
        inventory: [],
        transactions: [],
        businessDays: [],
        gcashRecords: [],
        currentBusinessDayId: null,
        cart: [],
        favorites: new Array(8).fill(null)
    }, 'main app state');
    
    if (!state.favorites || !Array.isArray(state.favorites)) {
        state.favorites = new Array(8).fill(null);
    }
    const localArchive = safeLocalJson(ARCHIVE_KEY, {}, 'local archive');
    state.archiveTransactions = Array.isArray(localArchive.transactions) ? localArchive.transactions : (Array.isArray(state.archiveTransactions) ? state.archiveTransactions : []);
    state.archiveBusinessDays = Array.isArray(localArchive.businessDays) ? localArchive.businessDays : (Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays : []);
    state.archiveGcashRecords = Array.isArray(localArchive.gcashRecords) ? localArchive.gcashRecords : (Array.isArray(state.archiveGcashRecords) ? state.archiveGcashRecords : []);
    state.archiveMeta = localArchive.meta && typeof localArchive.meta === 'object' ? localArchive.meta : (state.archiveMeta && typeof state.archiveMeta === 'object' ? state.archiveMeta : {});
    const localFavs = safeLocalJson(FAV_KEY, null, 'favorites');
    if (localFavs && Array.isArray(localFavs)) {
        state.favorites = localFavs;
    }
    state.cartDiscount = Math.max(0, Number(state.cartDiscount) || 0);
    if (!Array.isArray(state.gcashRecords)) state.gcashRecords = [];

    let offlineQueue = safeLocalJson(QUEUE_KEY, [], 'offline queue');
    if (!Array.isArray(offlineQueue)) offlineQueue = [];
    offlineQueue = offlineQueue.filter(task => task && isFirestoreSyncTable(task.table) && task.data && task.data.id && !isArchiveOnlyRecord(task.data));
    let vc860StorageHydrated = false;
    let vc860StorageHydrationPromise = null;

    async function vc860HydrateDurableStorage() {
        if (vc860StorageHydrated) return;
        if (vc860StorageHydrationPromise) return vc860StorageHydrationPromise;
        vc860StorageHydrationPromise = (async () => {
            const storage = window.VillacartStorage;
            if (!storage || typeof storage.hydrate !== 'function') {
                vcStartupMark('indexeddb-storage-unavailable');
                vc860StorageHydrated = true;
                return;
            }
            vcStartupMark('indexeddb-hydrate-start');
            const result = await storage.hydrate({
                main: state,
                archive: {
                    transactions: state.archiveTransactions || [],
                    businessDays: state.archiveBusinessDays || [],
                    gcashRecords: state.archiveGcashRecords || [],
                    meta: state.archiveMeta || {}
                },
                queue: offlineQueue,
                hasLegacyMain: vc860HasLegacyMain,
                hasLegacyArchive: vc860HasLegacyArchive,
                hasLegacyQueue: vc860HasLegacyQueue,
                keys: { main: DB_KEY, archive: ARCHIVE_KEY, queue: QUEUE_KEY }
            });
            state = result && result.main ? result.main : state;
            const archive = result && result.archive ? result.archive : {};
            state.archiveTransactions = Array.isArray(archive.transactions) ? archive.transactions : [];
            state.archiveBusinessDays = Array.isArray(archive.businessDays) ? archive.businessDays : [];
            state.archiveGcashRecords = Array.isArray(archive.gcashRecords) ? archive.gcashRecords : [];
            state.archiveMeta = archive.meta && typeof archive.meta === 'object' ? archive.meta : {};
            offlineQueue = result && Array.isArray(result.queue) ? result.queue : offlineQueue;
            offlineQueue = offlineQueue.filter(task => task && isFirestoreSyncTable(task.table) && task.data && task.data.id && !isArchiveOnlyRecord(task.data));
            if (!Array.isArray(state.inventory)) state.inventory = [];
            if (!Array.isArray(state.transactions)) state.transactions = [];
            if (!Array.isArray(state.businessDays)) state.businessDays = [];
            if (!Array.isArray(state.gcashRecords)) state.gcashRecords = [];
            if (!Array.isArray(state.cart)) state.cart = [];
            if (!Array.isArray(state.favorites)) state.favorites = new Array(8).fill(null);
            if (localFavs && Array.isArray(localFavs)) state.favorites = localFavs;
            state.cartDiscount = Math.max(0, Number(state.cartDiscount) || 0);
            vc860StorageHydrated = true;
            window.__villacartStorageHydration = {
                ready: true,
                source: result && result.source ? result.source : 'unknown',
                at: new Date().toISOString()
            };
            vcStartupMark('indexeddb-hydrate-complete', {
                source: window.__villacartStorageHydration.source,
                transactions: state.transactions.length,
                inventory: state.inventory.length,
                queue: offlineQueue.length
            });
        })().catch(error => {
            vc860StorageHydrated = true;
            window.__villacartStorageHydration = {
                ready: false,
                source: 'legacy-recovery',
                at: new Date().toISOString(),
                error: error && error.message ? error.message : String(error)
            };
            vcStartupMark('indexeddb-hydrate-failed', { error: window.__villacartStorageHydration.error });
            console.error('Villacart IndexedDB hydration failed; retaining legacy state.', error);
        });
        return vc860StorageHydrationPromise;
    }

    window.addEventListener('villacart-storage-error', event => {
        const message = event && event.detail && event.detail.message
            ? event.detail.message
            : 'Local device storage could not be saved.';
        if (typeof showToast === 'function') {
            showToast('Local storage needs attention. Keep this app open and check Diagnostics.', 'error');
        }
        console.error(message);
    });
    // Firestore is authoritative for transaction existence. Older versions
    // stored deleted IDs indefinitely and could hide valid cloud transactions.
    try { localStorage.removeItem('villacart_deleted_transactions'); } catch (e) {}
    let isSyncing = false;
    let syncErrorMsg = null;
    let activeLedgerTab = 'cash';
    let currentPayMode = 'cash';
    let insightPeriod = 'day';
    let pinBuffer = "";
    // PIN is stored as a SHA-256 hash in localStorage for security
    const PIN_KEY = 'villacart_pin_hash';
    const DEFAULT_PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'; // SHA-256 of "1234"
    let STORED_PIN_HASH = localStorage.getItem(PIN_KEY) || DEFAULT_PIN_HASH;

    async function hashPin(pin) {
        const msgBuffer = new TextEncoder().encode(pin);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let lastTransactionId = null;
    let isQuaggaRunning = false;
    let scannerBuffer = "";
    let scannerTimeout = null;
    let favoritesEditMode = false;
    let currentFavSlotIndex = null;
    const FAV_COLOR_KEY = 'villacart_favorite_colors_v1';
    const STOCK_ALERT_HIDE_KEY = 'villacart_stock_alert_hidden_v1' + STORAGE_SUFFIX;
    const favoriteColorPalette = [
        { name: 'White', value: '' },
        { name: 'Cream', value: '#FFF7D6' },
        { name: 'Yellow', value: '#FFF3BF' },
        { name: 'Blue', value: '#EAF3FF' },
        { name: 'Sky', value: '#E0F2FE' },
        { name: 'Mint', value: '#EAFBF1' },
        { name: 'Green', value: '#DCFCE7' },
        { name: 'Peach', value: '#FFF0E6' },
        { name: 'Orange', value: '#FFEDD5' },
        { name: 'Lavender', value: '#F1ECFF' },
        { name: 'Purple', value: '#EDE9FE' },
        { name: 'Rose', value: '#FFEFF4' },
        { name: 'Pink', value: '#FCE7F3' },
        { name: 'Gray', value: '#F4F7FB' },
        { name: 'Warm', value: '#F5F1EA' },
        { name: 'Teal', value: '#CCFBF1' },
        { name: 'Sand', value: '#F1E3BF' },
        { name: 'Wheat', value: '#EED9A6' },
        { name: 'Sage', value: '#CFE3C2' },
        { name: 'Green+', value: '#BFD8B8' },
        { name: 'Dusty Blue', value: '#C9DDF0' },
        { name: 'Steel', value: '#BFD3E6' },
        { name: 'Lilac+', value: '#D8C7EC' },
        { name: 'Mauve', value: '#E2C4D4' },
        { name: 'Clay', value: '#E8C7B5' },
        { name: 'Tan', value: '#E6D1B3' },
        { name: 'Marlboro Red', value: '#B91C1C' },
        { name: 'Marlboro Gold', value: '#D6B45A' },
        { name: 'RGD Red', value: '#56070B', swatch: 'linear-gradient(135deg, #150304 0%, #A40B13 52%, #240405 100%)' },
        { name: 'RGD Light', value: '#D9E2EA', swatch: 'linear-gradient(135deg, #F8FAFC 0%, #CBD5E1 55%, #93A9BC 100%)' },
        { name: 'Modern Black', value: '#0B0C0F', swatch: 'linear-gradient(135deg, #050506 0%, #30343A 52%, #070708 100%)' },
        { name: 'Modern Red', value: '#9D1118', swatch: 'linear-gradient(135deg, #4B060A 0%, #C61A25 55%, #64080E 100%)' },
        { name: 'Texture Red', value: '#C4142E', swatch: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.42) 1px, transparent 1.2px) 0 0 / 4px 4px, linear-gradient(135deg, #E51C3A, #99152A)' },
        { name: 'Texture Charcoal', value: '#23262B', swatch: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.30) 1px, transparent 1.2px) 0 0 / 4px 4px, linear-gradient(135deg, #444952, #15171A)' },
        { name: 'Texture Silver', value: '#B8BEC8', swatch: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.65) 1px, transparent 1.2px) 0 0 / 4px 4px, linear-gradient(135deg, #E2E6EC, #929AA7)' },
        { name: 'Texture Blue', value: '#1758B8', swatch: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.38) 1px, transparent 1.2px) 0 0 / 4px 4px, linear-gradient(135deg, #2875D5, #113E87)' },
        { name: 'Texture Green', value: '#177A50', swatch: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.38) 1px, transparent 1.2px) 0 0 / 4px 4px, linear-gradient(135deg, #219969, #0F583A)' },
        { name: 'Texture Gold', value: '#B48518', swatch: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.48) 1px, transparent 1.2px) 0 0 / 4px 4px, linear-gradient(135deg, #D6A72F, #8A6410)' },
        { name: 'Black', value: '#111827' }
    ];
    let favoriteSlotColors = safeLocalJson(FAV_COLOR_KEY, {}, 'favorite colors');
    if (!favoriteSlotColors || typeof favoriteSlotColors !== 'object' || Array.isArray(favoriteSlotColors)) favoriteSlotColors = {};
    let mutedStockAlertIds = new Set(Array.isArray(safeLocalJson(STOCK_ALERT_HIDE_KEY, [], 'stock alert mutes')) ? safeLocalJson(STOCK_ALERT_HIDE_KEY, [], 'stock alert mutes').map(String) : []);
    let inventoryState = {
        collapsedCategories: {}
    };

    let inventoryUnsubscribe = null;
    let transactionsUnsubscribe = null;
    let businessDaysUnsubscribe = null;

    const {
        titleCase,
        escapeHTML,
        jsArg,
        formatCurrency,
        csvEscape,
        formatPesoFixed,
        isCreditSettlement,
        isRevenueSale,
        firestoreRestValue,
        firestoreRestToValue,
        firestoreWriteWithTimeout,
        loadOptionalScript,
        ensureHtml2CanvasLoaded,
        ensureChartLoaded,
        canvasToPngBlob,
        downloadBlob,
        vc5632lDateCode,
        vc5632lMonthBounds,
        vc5632mTodayBounds,
        vc5632mInDateRange,
        todayDateCode,
        calcGcashFee,
        gcashDrawerEffect,
        gcashRecordDate,
        gcashDailySummary,
        cartSubtotal,
        cartCount,
        cartDiscount,
        cartTotal,
        cartStockIssue,
        inventoryLowStockThresholdValue,
        inventoryIsLowStock,
        inventoryCategoryKeyValue,
        inventoryCategoryNameValue,
        inventoryMatchesSearchValue,
        groupByKey,
        businessMetricsForTransactions,
        transactionTypeCounts,
        todayDateCodeFromDate,
        monthStartDateCode,
        gcashSearchText,
        gcashMatchesSearch
    } = window.VillacartUtils || {};

    // Bluetooth / Physical Scanner Logic
    function vc7227FindProductByBarcode(barcode) {
        const code = vc7227NormalizeBarcode(barcode);
        if (!code) return null;
        return (Array.isArray(state.inventory) ? state.inventory : []).find(p =>
            vc7227NormalizeBarcode(p && p.barcode) === code
        ) || null;
    }

    function vc7227ClearPosSearch() {
        const searchInput = document.getElementById('pos-search');
        if (searchInput) {
            searchInput.value = "";
            searchInput.blur();
        }
        const results = document.getElementById('search-results-container');
        if (results) results.classList.add('hidden');
    }

    window.__villacartScannerDebug.appVersion = window.VILLACART_APP_VERSION || window.__villacartScannerDebug.appVersion || 'unknown';

    let vc7228CaptureBuffer = "";
    let vc7228CaptureTimeout = null;
    document.addEventListener('keydown', (e) => {
        const target = e.target;
        const isInput = target && target.tagName === 'INPUT';
        const targetId = target && target.id ? target.id : '';
        const isScannerEndKey = e.key === 'Enter' || e.key === 'Tab' || e.key === 'NumpadEnter';

        vc7228ScannerDebug('keydown-capture', {
            key: e.key,
            target: targetId || (target && target.tagName) || '',
            value: isInput ? String(target.value || '').slice(0, 80) : '',
            buffer: vc7228CaptureBuffer.slice(0, 80)
        });

        if (isInput) {
            if (!isScannerEndKey) return;
            const typedCode = vc7227NormalizeBarcode(target.value);
            if (vc7226LooksLikeBarcode(typedCode) && !vc7228RecentlyHandled(typedCode)) {
                e.preventDefault();
                e.stopPropagation();
                scannerBuffer = "";
                vc7228CaptureBuffer = "";
                handlePhysicalScan(typedCode);
                if (target.id === 'pos-search') vc7227ClearPosSearch();
            }
            return;
        }

        clearTimeout(vc7228CaptureTimeout);
        vc7228CaptureTimeout = setTimeout(() => { vc7228CaptureBuffer = ""; }, 1000);

        if (isScannerEndKey) {
            const code = vc7227NormalizeBarcode(vc7228CaptureBuffer);
            if (vc7226LooksLikeBarcode(code) && !vc7228RecentlyHandled(code)) {
                e.preventDefault();
                e.stopPropagation();
                scannerBuffer = "";
                vc7228CaptureBuffer = "";
                handlePhysicalScan(code);
            }
        } else if (e.key && e.key.length === 1) {
            vc7228CaptureBuffer += e.key;
        }
    }, true);

    document.addEventListener('input', (e) => {
        const target = e.target;
        if (!target || target.tagName !== 'INPUT') return;
        const targetId = target.id || '';
        const value = String(target.value || '');
        if (window.__villacartScannerDebug) window.__villacartScannerDebug.lastInputValue = value.slice(0, 120);
        if (targetId === 'pos-search' || targetId === 'p-barcode') {
            vc7228ScannerDebug('input', { target: targetId, value: value.slice(0, 120) });
        }
    }, true);

    document.addEventListener('paste', (e) => {
        const text = e.clipboardData ? e.clipboardData.getData('text') : '';
        vc7228ScannerDebug('paste', { target: e.target && e.target.id ? e.target.id : '', value: String(text || '').slice(0, 120) });
    }, true);

    // v8.3.0: The older fallback keydown listener was removed.
    // The capture-phase scanner listener above now handles focused inputs,
    // unfocused physical scans, Enter/Tab suffixes, and duplicate protection.

    function vc7248IsInventoryScreenActive() {
        const inventoryScreen = document.getElementById('screen-inventory');
        return !!(inventoryScreen && !inventoryScreen.classList.contains('hidden'));
    }

    function vc7248ShowStockBarcodeSearch(cleanBarcode) {
        const code = vc7227NormalizeBarcode(cleanBarcode);
        if (!code) return false;
        const stockSearch = document.getElementById('stock-search') || document.querySelector('#screen-inventory input[type="text"]');
        if (stockSearch) stockSearch.value = code;
        if (typeof renderInventory === 'function') renderInventory(code);
        if (typeof vc8046UpdateStockSearchClear === 'function') vc8046UpdateStockSearchClear();
        const product = vc7227FindProductByBarcode(code);
        if (typeof vc7228MarkHandled === 'function') vc7228MarkHandled(code, product ? 'stock-search:' + product.id : 'stock-search:not-found');
        if (product) showToast('Found in stock: ' + product.name, 'success');
        else showToast('No stock item found: ' + code, 'error');
        return true;
    }

    function vc7258RouteBarcodeScan(barcode, options = {}) {
        const cleanBarcode = vc7227NormalizeBarcode(barcode);
        if (!vc7226LooksLikeBarcode(cleanBarcode)) return false;
        if (!options.force && vc7228RecentlyHandled(cleanBarcode)) {
            vc7228ScannerDebug('ignored-duplicate', { code: cleanBarcode, source: options.source || 'unknown' });
            return true;
        }

        const productModal = document.getElementById('product-modal');
        if (productModal && !productModal.classList.contains('hidden')) {
            const barcodeField = document.getElementById('p-barcode');
            if (barcodeField) {
                barcodeField.value = cleanBarcode;
                if (typeof vc7228MarkHandled === 'function') vc7228MarkHandled(cleanBarcode, 'product-modal');
                showToast("Barcode detected", "success");
                return true;
            }
        }

        if (vc7248IsInventoryScreenActive()) {
            return vc7248ShowStockBarcodeSearch(cleanBarcode);
        }

        const product = vc7227FindProductByBarcode(cleanBarcode);
        if (product) {
            if (typeof vc7228MarkHandled === 'function') vc7228MarkHandled(cleanBarcode, 'matched:' + product.id);
            const hasPack = product.packPrice && product.packPrice > 0;
            if (hasPack) {
                switchScreen('pos');
                openScanChoiceModal(product);
            } else {
                addToCart(product.id, 'piece');
                switchScreen('pos');
                showToast(`Added: ${product.name}`, "success");
            }
            vc7227ClearPosSearch();
            return true;
        }

        if (typeof vc7228MarkHandled === 'function') vc7228MarkHandled(cleanBarcode, 'not-found');
        showToast(`Product not found: ${cleanBarcode}`, "error");
        return false;
    }

    function handlePhysicalScan(barcode) {
        return vc7258RouteBarcodeScan(barcode, { source: 'physical' });
    }

    function openScanChoiceModal(product) {
        const modal = document.getElementById('scan-choice-modal');
        const nameDisplay = document.getElementById('scan-choice-name');
        const pieceBtn = document.getElementById('scan-choice-piece-btn');
        const piecePrice = document.getElementById('scan-choice-piece-price');
        const packBtn = document.getElementById('scan-choice-pack-btn');
        const packPrice = document.getElementById('scan-choice-pack-price');
        const packLabel = document.getElementById('scan-choice-pack-label');
        nameDisplay.innerText = product.name;
        piecePrice.innerText = `₱${product.price.toLocaleString()}`;
        packPrice.innerText = `₱${(product.packPrice || 0).toLocaleString()}`;
        packLabel.innerText = `Wholesale (${product.packSize || 0} pcs)`;
        pieceBtn.onclick = () => { addToCart(product.id, 'piece'); closeModal('scan-choice-modal'); };
        packBtn.onclick = () => { addToCart(product.id, 'pack'); closeModal('scan-choice-modal'); };
        modal.classList.replace('hidden', 'flex');
    }

function switchScreen(id) {
        const previousScreen = Array.from(document.querySelectorAll('.screen-transition[id^="screen-"]')).find(s => !s.classList.contains('hidden'));
        const previousId = previousScreen && previousScreen.id ? previousScreen.id.replace('screen-', '') : null;
        if (previousId === 'gcash' && id !== 'gcash' && typeof resetGcashForm === 'function') resetGcashForm(false);
        document.querySelectorAll('.screen-transition').forEach(s => s.classList.add('hidden'));
        const targetScreen = document.getElementById('screen-' + id);
        if (targetScreen) targetScreen.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(n => {
            const isActive = n.dataset.screen === id;
            n.classList.toggle('text-primary', isActive);
            n.classList.toggle('text-on-surface-variant', !isActive);
        });
        if (id === 'inventory') renderInventory();
        if (id === 'history') {
            const renderHistory = () => switchLedgerTab(activeLedgerTab);
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(renderHistory, 0));
            else setTimeout(renderHistory, 0);
        }
        if (id === 'insights') renderInsights();
        if (id === 'business' && typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
        if (id === 'gcash' && typeof renderGcashScreen === 'function') renderGcashScreen();
        if (id === 'pos') {
            renderFavorites();
            if (typeof updateTerminalTodaySales === 'function') updateTerminalTodaySales();
        }
    }

    function confirmDeleteTransaction() { if (document.activeElement) document.activeElement.blur(); if (!lastTransactionId) return; openPinModal({ action: 'delete', id: lastTransactionId }); }

    // --- Inventory Export ---

    // v5.6.1 Inventory PIN navigation polish
    let pendingNavScreen = null;

    document.addEventListener('click', (event) => {
        const invBtn = event.target.closest('.nav-item[data-screen="inventory"]');
        if (invBtn) {
            pendingNavScreen = 'inventory';
            // Keep the previous active tab while PIN is still required.
            setTimeout(refreshActiveNavigationFromDOM, 120);
        }
    });

    const vcOriginalSwitchScreen = typeof switchScreen === 'function' ? switchScreen : null;
    if (vcOriginalSwitchScreen && !window.__vcSwitchScreenPatched) {
        window.__vcSwitchScreenPatched = true;
        switchScreen = function(screen) {
            vcOriginalSwitchScreen(screen);
            pendingNavScreen = null;
            updateActiveNavigation(screen);
            setTimeout(refreshActiveNavigationFromDOM, 50);
        };
    }

    const vcOriginalCloseModal = typeof closeModal === 'function' ? closeModal : null;
    if (vcOriginalCloseModal && !window.__vcCloseModalPatched) {
        window.__vcCloseModalPatched = true;
        closeModal = function(id) {
            vcOriginalCloseModal(id);
            if (id === 'pin-modal') {
                pendingNavScreen = null;
                setTimeout(refreshActiveNavigationFromDOM, 50);
            }
        };
    }
    // v5.6.1 Core Business Day Attachment + Reporting Repair
    function ensureBusinessDayForTransaction(transaction) {
        if (!transaction || transaction.businessDayId) return transaction;

        if (typeof ensureBusinessDayArrays === 'function') ensureBusinessDayArrays();
        if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];

        let bd = null;
        let createdBusinessDay = false;
        if (typeof getCurrentBusinessDay === 'function') bd = getCurrentBusinessDay();

        const txDate = transaction.timestamp ? new Date(transaction.timestamp) : new Date();
        const dateCode = typeof localDateCode === 'function'
            ? localDateCode(txDate)
            : txDate.toISOString().slice(0, 10);
        const baseId = `BD-${dateCode.replaceAll('-', '')}`;

        if (!bd) {
            bd = state.businessDays.find(x => x.id === baseId && x.status === 'OPEN');

            if (!bd) {
                bd = {
                    id: baseId,
                    businessDayId: baseId,
                    date: dateCode,
                    status: 'OPEN',
                    openedAt: transaction.timestamp || new Date().toISOString(),
                    closedAt: null,
                    terminal: 'Counter 1',
                    autoStarted: true
                };
                state.businessDays.push(bd);
                createdBusinessDay = true;
            }

            state.currentBusinessDayId = bd.id;
        }

        transaction.businessDayId = bd.id;
        transaction.businessDate = bd.date;

        try {
            localStorage.setItem('villacart_business_days', JSON.stringify(state.businessDays));
        } catch(e) {}

        // Persist only a newly-created business day. Rewriting it for every
        // sale is unnecessary and was inflating Firestore write usage.
        if (createdBusinessDay && typeof queueAction === 'function') queueAction('update', 'businessDays', bd);

        return transaction;
    }

    // v8.3.22: Removed the superseded base delete function and early
    // modal wrapper. vc532DeleteTransaction owns deletion and modal cleanup.
    // v5.6.1 Business Day Manager - core architecture
    const VILLA_BUSINESS_DAY_STORAGE = 'villacart_business_days_v520';

    function v52DateCode(date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function v52BusinessDayId(date = new Date()) {
        return `BD-${v52DateCode(date).replaceAll('-', '')}`;
    }

    function v52EnsureArrays() {
        if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];
        if (!state.currentBusinessDayId) {
            const open = state.businessDays
                .filter(bd => bd && bd.status === 'OPEN')
                .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))[0];
            state.currentBusinessDayId = open ? open.id : null;
        }
    }

    function v52GetOpenBusinessDay() {
        v52EnsureArrays();
        return state.businessDays.find(bd => bd.id === state.currentBusinessDayId && bd.status === 'OPEN')
            || state.businessDays.filter(bd => bd.status === 'OPEN').sort((a,b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))[0]
            || null;
    }

    function v52OpenBusinessDayForTransaction(transaction) {
        v52EnsureArrays();

        const txDate = transaction && transaction.timestamp ? new Date(transaction.timestamp) : new Date();
        const dateCode = v52DateCode(txDate);
        const baseId = v52BusinessDayId(txDate);

        let bd = v52GetOpenBusinessDay();

        // If there is no active day, open today's business day automatically.
        if (!bd) {
            bd = state.businessDays.find(x => x.id === baseId && x.status === 'OPEN');

            if (!bd) {
                // If same day already closed and a new real sale happens, create a continuation.
                const closedSameDay = state.businessDays.find(x => x.id === baseId && x.status === 'CLOSED');
                let id = baseId;
                if (closedSameDay) {
                    const count = state.businessDays.filter(x => x.id && x.id.startsWith(baseId)).length + 1;
                    id = `${baseId}-${String(count).padStart(2, '0')}`;
                }

                bd = {
                    id,
                    businessDayId: id,
                    date: dateCode,
                    status: 'OPEN',
                    openedAt: transaction?.timestamp || new Date().toISOString(),
                    closedAt: null,
                    terminal: 'Counter 1',
                    autoStarted: true,
                    createdAt: new Date().toISOString(),
                    version: 'v5.6.1'
                };
                state.businessDays.push(bd);
            }

            state.currentBusinessDayId = bd.id;
        }

        return bd;
    }

    function v52AttachBusinessDay(transaction) {
        if (!transaction || !transaction.id) return transaction;

        // Only attach to operational records, not inventory docs.
        const operationalTypes = ['SA', 'CR', 'EX'];
        if (!operationalTypes.includes(transaction.type) && !(transaction.notes && transaction.notes.includes('CR-'))) return transaction;

        if (!transaction.businessDayId || !transaction.businessDate) {
            const bd = v52OpenBusinessDayForTransaction(transaction);
            transaction.businessDayId = bd.id;
            transaction.businessDate = bd.date;

            try {
                localStorage.setItem(VILLA_BUSINESS_DAY_STORAGE, JSON.stringify(state.businessDays));
                localStorage.setItem('villacart_business_days', JSON.stringify(state.businessDays));
            } catch(e) {}

            bd._offline = true;
            if (typeof queueAction === 'function') queueAction('update', 'businessDays', bd);
        }

        return transaction;
    }

    // Patch directSync itself so cloud writes to transactions always carry business day fields.
    const vcOriginalDirectSync520 = typeof directSync === 'function' ? directSync : null;
    if (vcOriginalDirectSync520 && !window.__vcDirectSync520Patched) {
        window.__vcDirectSync520Patched = true;
        directSync = async function(table, data) {
            if (table === 'transactions' && data) {
                v52AttachBusinessDay(data);
            }
            if (table === 'businessDays' && data) {
                v52EnsureArrays();
                const idx = state.businessDays.findIndex(bd => bd.id === data.id);
                if (idx >= 0) state.businessDays[idx] = { ...state.businessDays[idx], ...data };
                else state.businessDays.push(data);
                if (data.status === 'OPEN') state.currentBusinessDayId = data.id;
            }
            const result = await vcOriginalDirectSync520(table, data);
            v52RefreshBusinessDayUI();
            return result;
        };
    }

    // Patch queueAction so offline transaction writes also carry business day fields.
    const vcOriginalQueueAction520 = typeof queueAction === 'function' ? queueAction : null;
    if (vcOriginalQueueAction520 && !window.__vcQueueAction520Patched) {
        window.__vcQueueAction520Patched = true;
        queueAction = function(type, table, data) {
            if (table === 'transactions' && data) {
                v52AttachBusinessDay(data);
            }
            return vcOriginalQueueAction520(type, table, data);
        };
    }

    // Patch queueTransaction as a second layer before local insert.
    const vcOriginalQueueTransaction520 = typeof queueTransaction === 'function' ? queueTransaction : null;
    if (vcOriginalQueueTransaction520 && !window.__vcQueueTransaction520Patched) {
        window.__vcQueueTransaction520Patched = true;
        queueTransaction = function(transaction) {
            v52AttachBusinessDay(transaction);
            const result = vcOriginalQueueTransaction520(transaction);
            v52RefreshBusinessDayUI();
            return result;
        };
    }

    function v52BusinessDayTransactions(bdId) {
        return (state.transactions || []).filter(t => t.businessDayId === bdId);
    }

    function v52ComputeMetrics(transactions) {
        const tx = transactions || [];
        const isSettle = t => (typeof isCreditSettlement === 'function') ? isCreditSettlement(t) : !!(t.notes && t.notes.includes('CR-'));
        const revenue = tx.filter(t => (t.type === 'SA' || t.type === 'CR') && !isSettle(t));
        const cashSales = revenue.filter(t => t.type === 'SA').reduce((s,t)=>s+(Number(t.total)||0),0);
        const creditSales = revenue.filter(t => t.type === 'CR').reduce((s,t)=>s+(Number(t.total)||0),0);
        const collections = tx.filter(t => isSettle(t)).reduce((s,t)=>s+(Number(t.total)||0),0);
        const expenses = tx.filter(t => t.type === 'EX').reduce((s,t)=>s+(Number(t.total)||0),0);
        let cogs = 0;
        let itemsSold = 0;
        const itemMap = {};
        revenue.forEach(t => (t.items || []).forEach(item => {
            const qty = (Number(item.qty)||0) * (Number(item.deduct)||1);
            itemsSold += qty;
            cogs += (Number(item.cost)||0) * qty;
            const key = item.name || item.id || 'Unknown';
            itemMap[key] = (itemMap[key] || 0) + qty;
        }));
        const totalSales = cashSales + creditSales;
        const cashIn = cashSales + collections;
        const netProfit = totalSales - cogs - expenses;
        const best = Object.entries(itemMap).sort((a,b)=>b[1]-a[1])[0];
        return {
            cashSales, creditSales, collections, expenses, cogs, totalSales, cashIn, netProfit,
            transactionCount: tx.length,
            itemsSold,
            bestSeller: best ? best[0] : null,
            bestSellerQty: best ? best[1] : 0,
            counts: {
                cash: tx.filter(t => t.type === 'SA' && !isSettle(t)).length,
                credit: tx.filter(t => t.type === 'CR' && !isSettle(t)).length,
                collections: tx.filter(t => isSettle(t)).length,
                expenses: tx.filter(t => t.type === 'EX').length
            }
        };
    }

    // Override current business day helpers so UI uses the new manager.
    getCurrentBusinessDay = function() {
        return v52GetOpenBusinessDay();
    };

    getBusinessDayTransactions = function(businessDayId) {
        return v52BusinessDayTransactions(businessDayId);
    };

    computeBusinessDaySummary = function(bd) {
        return v52ComputeMetrics(v52BusinessDayTransactions(bd.id));
    };

    function v52RefreshBusinessDayUI() {
        const bd = v52GetOpenBusinessDay();
        const latest = [...(state.businessDays || [])].sort((a,b)=>new Date(b.openedAt || b.closedAt || b.date || 0)-new Date(a.openedAt || a.closedAt || a.date || 0))[0];

        const pill = document.getElementById('business-day-pill');
        const pillText = document.getElementById('business-day-text');
        if (pill && pillText) {
            pill.classList.remove('hidden', 'open', 'closed', 'none');
            if (bd) {
                pill.classList.add('open');
                pillText.innerText = 'OPEN';
            } else {
                pill.classList.add(latest && latest.status === 'CLOSED' ? 'closed' : 'none');
                pillText.innerText = latest && latest.status === 'CLOSED' ? 'CLOSED' : 'NO DAY';
            }
        }

        const title = document.getElementById('bd-status-title');
        const sub = document.getElementById('bd-status-subtitle');
        const badge = document.getElementById('bd-status-badge');
        if (title && sub && badge) {
            badge.classList.remove('open', 'closed', 'none');
            if (bd) {
                const summary = v52ComputeMetrics(v52BusinessDayTransactions(bd.id));
                title.innerText = `${bd.id}`;
                sub.innerText = `Opened ${new Date(bd.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} • ${summary.transactionCount} transaction(s)`;
                badge.innerText = 'OPEN';
                badge.classList.add('open');
            } else if (latest && latest.status === 'CLOSED') {
                title.innerText = `${latest.id} closed`;
                sub.innerText = `Next transaction starts a new business day.`;
                badge.innerText = 'CLOSED';
                badge.classList.add('closed');
            } else {
                title.innerText = 'No active business day';
                sub.innerText = 'First transaction will start the business day automatically.';
                badge.innerText = 'AUTO';
                badge.classList.add('none');
            }
        }

        if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
    }

    // Override business dashboard cards to use open business day when available.
    updateBusinessDashboardCards = function() {
        const bd = v52GetOpenBusinessDay();
        const tx = bd ? v52BusinessDayTransactions(bd.id) : ((typeof getPeriodTransactions === 'function') ? getPeriodTransactions() : []);
        const m = v52ComputeMetrics(tx);

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.innerText = `₱${(Number(value)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        };
        setText('biz-total-sales', m.totalSales);
        setText('biz-cash-in', m.cashIn);
        setText('biz-credit-sales', m.creditSales);

        // Keep outstanding credit global.
        let allCredit = 0, allCollections = 0;
        (state.transactions || []).forEach(t => {
            const isSettle = t.notes && t.notes.includes('CR-');
            if (t.type === 'CR' && !isSettle) allCredit += Number(t.total)||0;
            if (isSettle) allCollections += Number(t.total)||0;
        });
        setText('biz-outstanding-credit', Math.max(0, allCredit - allCollections));
    };

    // End business day rewritten to use the manager.
    endBusinessDay = function() {
        const bd = v52GetOpenBusinessDay();
        if (!bd) {
            showToast && showToast('No active business day to close', 'info');
            return;
        }

        const summary = v52ComputeMetrics(v52BusinessDayTransactions(bd.id));
        if (!confirm(`End Business Day ${bd.id}?\n\nCash In: ₱${summary.cashIn.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}\nTotal Sales: ₱${summary.totalSales.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}\nNet Profit: ₱${summary.netProfit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`)) return;

        bd.status = 'CLOSED';
        bd.closedAt = new Date().toISOString();
        bd.closedBy = 'POS';
        bd.manualClosed = true;
        bd.autoClosed = false;
        bd.summary = summary;
        state.currentBusinessDayId = null;

        if (typeof sync === 'function') sync();

        bd._offline = true;
        if (typeof queueAction === 'function') queueAction('update', 'businessDays', bd);

        closeModal && closeModal('closing-summary-modal');
        closeModal && closeModal('business-day-modal');
        v52RefreshBusinessDayUI();
        renderInsights && renderInsights();
        showToast && showToast(`Business Day ${bd.id} closed`, 'success');
    };

    // Delete modal cleanup: patch the likely existing confirmation/delete function by event delegation too.
    document.addEventListener('click', (event) => {
        const btn = event.target.closest('button');
        if (!btn) return;
        const txt = (btn.innerText || '').toLowerCase();
        const onclick = (btn.getAttribute('onclick') || '').toLowerCase();
        if (txt.includes('delete') || txt.includes('void') || onclick.includes('delete') || onclick.includes('void')) {
            setTimeout(() => {
                ['tx-detail-modal','transaction-detail-modal','receipt-modal','mod-tx-details','transaction-modal'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.classList.add('hidden');
                        el.classList.remove('flex');
                    }
                });
                renderLedger && renderLedger();
                renderInsights && renderInsights();
            }, 250);
        }
    });

    setTimeout(() => {
        v52RefreshBusinessDayUI();
        renderInsights && renderInsights();
    }, 800);


    // v5.6.1 Business Day Date-Scope Fix
    // Rule: For your 5AM-10PM store, a new transaction belongs to its own calendar date.
    // Old transactions without businessDayId should not hijack today's active business day.
    function v521TodayCode() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    }

    function v521DateCodeFromTimestamp(ts) {
        const d = ts ? new Date(ts) : new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function v521BusinessDayIdFromDateCode(dateCode) {
        return `BD-${dateCode.replaceAll('-', '')}`;
    }

    function v521EnsureBusinessDayForDate(dateCode, openedAt) {
        if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];
        const id = v521BusinessDayIdFromDateCode(dateCode);
        let bd = state.businessDays.find(x => x.id === id);
        let createdOrChanged = false;
        if (!bd) {
            bd = {
                id,
                businessDayId: id,
                date: dateCode,
                status: 'OPEN',
                openedAt: openedAt || new Date().toISOString(),
                closedAt: null,
                terminal: 'Counter 1',
                autoStarted: true,
                createdAt: new Date().toISOString(),
                version: 'v5.6.1'
            };
            state.businessDays.push(bd);
            createdOrChanged = true;
        } else if (bd.status !== 'OPEN') {
            // If it was closed, do not reopen automatically. Create continuation.
            const suffix = state.businessDays.filter(x => x.id && x.id.startsWith(id)).length + 1;
            const newId = `${id}-${String(suffix).padStart(2, '0')}`;
            bd = {
                id: newId,
                businessDayId: newId,
                date: dateCode,
                status: 'OPEN',
                openedAt: openedAt || new Date().toISOString(),
                closedAt: null,
                terminal: 'Counter 1',
                autoStarted: true,
                createdAt: new Date().toISOString(),
                version: 'v5.6.1'
            };
            state.businessDays.push(bd);
            createdOrChanged = true;
        }
        bd._createdOrChanged = createdOrChanged;

        const today = v521TodayCode();
        if (dateCode === today) {
            state.currentBusinessDayId = bd.id;
        }

        return bd;
    }

    // Override v5.2.0 attach with date-aware attach.
    v52AttachBusinessDay = function(transaction) {
        if (!transaction || !transaction.id) return transaction;

        const operationalTypes = ['SA', 'CR', 'EX'];
        if (!operationalTypes.includes(transaction.type) && !(transaction.notes && transaction.notes.includes('CR-'))) return transaction;

        const txDate = v521DateCodeFromTimestamp(transaction.timestamp);
        const bd = v521EnsureBusinessDayForDate(txDate, transaction.timestamp || new Date().toISOString());
        const shouldQueueBusinessDay = !!bd._createdOrChanged;
        delete bd._createdOrChanged;

        transaction.businessDayId = bd.id;
        transaction.businessDate = bd.date;

        try {
            localStorage.setItem('villacart_business_days_v520', JSON.stringify(state.businessDays));
            localStorage.setItem('villacart_business_days', JSON.stringify(state.businessDays));
        } catch(e) {}

        if (shouldQueueBusinessDay) {
            bd._offline = true;
            if (typeof queueAction === 'function') queueAction('update', 'businessDays', bd);
        }

        return transaction;
    };

    // Current business day should mean today's OPEN business day, not yesterday's stale open day.
    getCurrentBusinessDay = function() {
        const today = v521TodayCode();
        if (!state.businessDays || !Array.isArray(state.businessDays)) return null;
        return state.businessDays
            .filter(bd => bd.status === 'OPEN' && bd.date === today)
            .sort((a,b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))[0] || null;
    };

    v52GetOpenBusinessDay = getCurrentBusinessDay;

    // v5.6.1 Dashboard wording and credit clarity polish
    function vc526MoneyValueFromText(text) {
        return Number(String(text || '').replace(/[₱,\s]/g, '')) || 0;
    }

    function vc526FindCardByValueId(valueId) {
        const el = document.getElementById(valueId);
        if (!el) return null;
        return el.closest('.business-card') || el.closest('[class*="rounded"]') || el.parentElement;
    }

    function vc526PolishCreditDashboardLabels() {
        // Ensure wording stays correct even after dynamic renders.
        const cashCard = vc526FindCardByValueId('biz-cash-in');
        if (cashCard) {
            const label = cashCard.querySelector('.business-label, p');
            const sub = cashCard.querySelector('.business-sub');
            if (label) label.innerText = 'Cash Received Today';
            if (sub) sub.innerText = 'Cash Sales + Credit Payments';
        }

        const creditCard = vc526FindCardByValueId('biz-credit-sales');
        if (creditCard) {
            const label = creditCard.querySelector('.business-label, p');
            const sub = creditCard.querySelector('.business-sub');
            if (label) label.innerText = 'Credit Sales Today';
            if (sub) sub.innerText = 'Sales made on credit today';
        }

        const outEl = document.getElementById('biz-outstanding-credit');
        const outCard = vc526FindCardByValueId('biz-outstanding-credit');
        if (outEl && outCard) {
            const value = vc526MoneyValueFromText(outEl.innerText);
            const sub = outCard.querySelector('.business-sub');
            outCard.classList.toggle('credit-settled-card', value <= 0);
            outCard.classList.toggle('credit-outstanding-card', value > 0);
            if (sub) {
                sub.innerText = value <= 0
                    ? '✓ All credit accounts are settled'
                    : 'Amount still owed by customers';
            }
        }
    }

    const vcOriginalSwitchScreen526 = typeof switchScreen === 'function' ? switchScreen : null;
    if (vcOriginalSwitchScreen526 && !window.__vcSwitchScreen526Patched) {
        window.__vcSwitchScreen526Patched = true;
        switchScreen = function(screen) {
            vcOriginalSwitchScreen526(screen);
            if (screen === 'insights') setTimeout(vc526PolishCreditDashboardLabels, 120);
        };
    }

    setTimeout(vc526PolishCreditDashboardLabels, 500);
    setTimeout(vc526PolishCreditDashboardLabels, 1500);


    // v5.6.1 Transaction Integrity Layer
    // Testing mode keeps Delete, but adds safe rules for credit sales and settlements.
    // v8.3.22: Removed the superseded vc530 delete/void implementation.
    // The later vc532 durable-queue delete path is the single active owner.
    const vcOriginalQueueTransaction530 = typeof queueTransaction === 'function' ? queueTransaction : null;
    if (vcOriginalQueueTransaction530 && !window.__vcQueueTransaction530Patched) {
        window.__vcQueueTransaction530Patched = true;
        queueTransaction = function(transaction) {
            vc530AttachSettlementLink(transaction);
            return vcOriginalQueueTransaction530(transaction);
        };
    }

    const vcOriginalDirectSync530 = typeof directSync === 'function' ? directSync : null;
    if (vcOriginalDirectSync530 && !window.__vcDirectSync530Patched) {
        window.__vcDirectSync530Patched = true;
        directSync = function(table, data) {
            if (table === 'transactions') vc530AttachSettlementLink(data);
            return vcOriginalDirectSync530(table, data);
        };
    }

    // Add a simple console integrity checker for testing.
    window.villacartIntegrityCheck = function() {
        const problems = [];
        vc530CleanTransactions().forEach(t => {
            if (vc530IsSettlement(t) && !vc530CreditIdFromSettlement(t)) {
                problems.push(`Settlement ${t.id} has no linked CR reference.`);
            }
            if (vc530IsCreditSale(t) && vc530CreditIsSettled(t) && !vc530FindSettlementForCredit(t.id) && !t.paid) {
                problems.push(`Credit ${t.id} looks settled but has no settlement record.`);
            }
        });
        console.table(problems.length ? problems : ['No integrity issues found.']);
        return problems;
    };

    // Replace renderInsights with an authoritative stable renderer.
    const vcOriginalRenderInsights531 = typeof renderInsights === 'function' ? renderInsights : null;
    if (vcOriginalRenderInsights531 && !window.__vcRenderInsights531Patched) {
        window.__vcRenderInsights531Patched = true;
        renderInsights = function() {
            vc531RefreshInsights();
        };
    }

    const vcOriginalSwitchScreen531 = typeof switchScreen === 'function' ? switchScreen : null;
    if (vcOriginalSwitchScreen531 && !window.__vcSwitchScreen531Patched) {
        window.__vcSwitchScreen531Patched = true;
        switchScreen = function(screen) {
            vcOriginalSwitchScreen531(screen);
            if (screen === 'insights') setTimeout(vc531RefreshInsights, 80);
            if (screen === 'business') setTimeout(vc531RefreshBusinessCalendarSafe, 80);
        };
    }

    // Patch realtime sync callbacks indirectly: whenever state is synced/rendered, refresh reports too.
    const vcOriginalSync531 = typeof sync === 'function' ? sync : null;
    if (vcOriginalSync531 && !window.__vcSync531Patched) {
        window.__vcSync531Patched = true;
        sync = function() {
            const result = vcOriginalSync531();
            setTimeout(() => {
                vc531RefreshInsights();
                vc531RefreshBusinessCalendarSafe();
            }, 0);
            return result;
        };
    }

    // Also refresh on Firestore snapshot-rendered ledger changes and browser focus.
    window.addEventListener('focus', () => {
        setTimeout(vc531RefreshInsights, 100);
        setTimeout(vc531RefreshBusinessCalendarSafe, 150);
    });

    setTimeout(vc531RefreshInsights, 600);
    setTimeout(vc531RefreshBusinessCalendarSafe, 900);


    // v5.6.1 Credit/Settlement Void Guidance + Color Coding
    function vc532Norm(v) { return String(v || '').trim().toUpperCase(); }

    function vc532IsSettlement(t) {
        if (!t) return false;
        const id = vc532Norm(t.id);
        const type = vc532Norm(t.type);
        const notes = vc532Norm(t.notes);
        return !!(
            t.settlementFor ||
            t.creditRef ||
            t.relatedCreditId ||
            (type === 'SA' && notes.includes('CR-')) ||
            (id.startsWith('SA-') && notes.includes('CR-')) ||
            notes.includes('SETTLEMENT') ||
            notes.includes('PAID CREDIT') ||
            notes.includes('PAYMENT')
        );
    }

    function vc532SettlementCreditId(t) {
        if (!t) return null;
        if (t.settlementFor) return t.settlementFor;
        if (t.creditRef) return t.creditRef;
        if (t.relatedCreditId) return t.relatedCreditId;
        const match = String(t.notes || '').match(/CR-[A-Z0-9-]+/i);
        return match ? match[0].toUpperCase() : null;
    }

    function vc532IsCreditSale(t) {
        return !!t && vc532Norm(t.type) === 'CR' && !vc532IsSettlement(t);
    }

    function vc532DeletedSet() {
        return new Set();
    }

    function vc532CleanTransactions() {
        const deleted = vc532DeletedSet();
        return (state.transactions || []).filter(t => t && t.id && !deleted.has(t.id));
    }

    function vc532FindTx(id) {
        return (state.transactions || []).find(t => t && t.id === id) || null;
    }

    function vc532FindSettlementForCredit(creditId) {
        if (!creditId) return null;
        const target = vc532Norm(creditId);
        return vc532CleanTransactions().filter(vc532IsSettlement).find(t => {
            const ref = vc532Norm(vc532SettlementCreditId(t));
            const notes = vc532Norm(t.notes);
            return ref === target || notes.includes(target);
        }) || null;
    }

    function vc532CreditIsPaid(creditTx) {
        if (!creditTx) return false;
        if (creditTx.paid === true || creditTx.settled === true) return true;
        const status = vc532Norm(creditTx.status);
        if (status === 'PAID' || status === 'SETTLED') return true;
        if (Number(creditTx.balance) === 0 || Number(creditTx.balanceDue) === 0 || Number(creditTx.remaining) === 0) return true;
        return !!vc532FindSettlementForCredit(creditTx.id);
    }

    function vc532ReopenCredit(creditId) {
        const cr = vc532FindTx(creditId);
        if (!cr) return;
        cr.paid = false;
        cr.settled = false;
        cr.status = 'OPEN';
        if (cr.balance !== undefined) cr.balance = Number(cr.total) || 0;
        if (cr.balanceDue !== undefined) cr.balanceDue = Number(cr.total) || 0;
        if (cr.remaining !== undefined) cr.remaining = Number(cr.total) || 0;
        cr._offline = true;
        if (typeof queueAction === 'function') queueAction('update', 'transactions', cr);
    }

    function vc532RestockItems(tx) {
        if (!tx || !tx.items || vc532IsSettlement(tx) || tx.type === 'EX') return;
        tx.items.forEach(item => {
            const p = (state.inventory || []).find(inv => inv.id === item.id);
            if (p) {
                p.stock += (Number(item.qty)||0) * (Number(item.deduct)||1);
                p._offline = true;
                if (typeof queueAction === 'function') queueAction('update', 'inventory', p);
            }
        });
    }

    function vc532CloseModals() {
        ['mod-tx','pin-modal','receipt-modal','tx-detail-modal','transaction-detail-modal','mod-tx-details','transaction-modal','void-modal','confirm-modal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
        });
    }

    async function vc532CloudDelete(id) {
        // Always use the durable queue. A direct Firestore delete can remain
        // pending without rejecting, which used to leave the detail modal open
        // and made the app look deleted while the cloud document remained.
        if (typeof queueAction === 'function') {
            queueAction('delete', 'transactions', { id });
            return;
        }

        console.warn('Transaction delete skipped because queueAction is unavailable:', id);
    }

    async function vc532DeleteTransaction(id, options = {}) {
        const tx = vc532FindTx(id);
        if (!tx) return;

        if (vc532IsCreditSale(tx) && vc532CreditIsPaid(tx) && !options.force) {
            const settlement = vc532FindSettlementForCredit(tx.id);
            alert(`This credit sale has already been paid.\n\nDelete the payment/settlement first before deleting the credit sale.${settlement ? '\n\nSettlement: ' + settlement.id : ''}`);
            if (settlement && typeof viewTxDetails === 'function') setTimeout(() => viewTxDetails(settlement.id), 150);
            return;
        }

        if (vc532IsSettlement(tx)) {
            const creditId = vc532SettlementCreditId(tx);
            if (!confirm(`Delete this credit payment?\n\nThis will reopen the customer's credit balance.\nInventory will not change.`)) return;
            if (creditId) vc532ReopenCredit(creditId);
        } else {
            if (!confirm(`Delete transaction ${tx.id}?\n\nInventory will be restored for product sales.`)) return;
            vc532RestockItems(tx);
        }

        // Do not permanently hide a cloud transaction in localStorage. The
        // pending queue already keeps this delete out of the UI until Firestore
        // confirms it.
        try { localStorage.removeItem('villacart_deleted_transactions'); } catch(e) {}

        state.transactions = (state.transactions || []).filter(t => t.id !== tx.id);
        if (typeof lastTransactionId !== 'undefined' && lastTransactionId === tx.id) lastTransactionId = null;

        await vc532CloudDelete(tx.id);
        vc532CloseModals();

        if (typeof sync === 'function') sync();
        if (typeof renderInventory === 'function') renderInventory();
        if (typeof renderFavorites === 'function') renderFavorites();
        if (typeof renderLedger === 'function') renderLedger();
        if (typeof renderInsights === 'function') renderInsights();
        if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
        if (typeof showToast === 'function') showToast(vc532IsSettlement(tx) ? 'Payment deleted; credit reopened' : 'Transaction deleted', 'success');
    }

    // Override delete/void aliases for testing mode.
    window.deleteTransaction = vc532DeleteTransaction;
    window.voidTransaction = vc532DeleteTransaction;
    window.deleteTx = vc532DeleteTransaction;
    window.voidTx = vc532DeleteTransaction;

    function vc532DecorateCards() {
        document.querySelectorAll('#ledger-content > div').forEach(card => {
            const text = vc532Norm(card.innerText);
            card.classList.remove('tx-card-credit','tx-card-settlement','tx-card-cash','tx-card-expense');
            if (text.includes('PAYMENT') || text.includes('SETTLEMENT') || (text.includes('SA-') && text.includes('CR-'))) card.classList.add('tx-card-settlement');
            else if (text.includes('CR-') || text.includes(' CR')) card.classList.add('tx-card-credit');
            else if (text.includes('EX-') || text.includes(' EXP')) card.classList.add('tx-card-expense');
            else if (text.includes('SA-') || text.includes(' SA')) card.classList.add('tx-card-cash');
        });
    }

    function vc532DecorateBadges() {
        document.querySelectorAll('span').forEach(span => {
            const text = vc532Norm(span.innerText);
            span.classList.remove('tx-badge-credit','tx-badge-settlement','tx-badge-cash','tx-badge-expense');
            if (text === 'CR') span.classList.add('tx-badge-credit');
            if (text === 'PAYMENT' || text === 'SETTLEMENT' || text === 'COLLECT') span.classList.add('tx-badge-settlement');
            if (text === 'SA') span.classList.add('tx-badge-cash');
            if (text === 'EX') span.classList.add('tx-badge-expense');
        });
    }

    function vc532DecorateTransactionColors() {
        vc532DecorateCards();
        vc532DecorateBadges();
    }

    const vcOriginalRenderLedger532 = typeof renderLedger === 'function' ? renderLedger : null;
    if (vcOriginalRenderLedger532 && !window.__vcRenderLedger532Patched) {
        window.__vcRenderLedger532Patched = true;
        renderLedger = function() {
            return vcOriginalRenderLedger532();
        };
    }

    const vcOriginalRenderInsights532 = typeof renderInsights === 'function' ? renderInsights : null;
    if (vcOriginalRenderInsights532 && !window.__vcRenderInsights532Patched) {
        window.__vcRenderInsights532Patched = true;
        renderInsights = function() {
            const result = vcOriginalRenderInsights532();
            setTimeout(vc532DecorateTransactionColors, 0);
            return result;
        };
    }

    setTimeout(vc532DecorateTransactionColors, 800);


    // v5.6.1 Final UI Override: clickable Insight cards + real Business month label
    function vc541Norm(v) { return String(v || '').trim().toUpperCase(); }

    function vc541DateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function vc541IsSettlement(t) {
        if (!t) return false;
        const id = vc541Norm(t.id);
        const type = vc541Norm(t.type);
        const notes = vc541Norm(t.notes);
        return !!(
            t.settlementFor ||
            t.creditRef ||
            t.relatedCreditId ||
            (type === 'SA' && notes.includes('CR-')) ||
            (id.startsWith('SA-') && notes.includes('CR-')) ||
            notes.includes('SETTLEMENT') ||
            notes.includes('PAID CREDIT') ||
            notes.includes('PAYMENT')
        );
    }

    function vc541Peso(v) {
        return `₱${(Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    }

    function vc541DeletedSet() {
        return new Set();
    }

    function vc541Clean(tx) {
        const deleted = vc541DeletedSet();
        return (tx || []).filter(t => t && t.id && !deleted.has(t.id));
    }

    function vc541MergeBusinessRecords(liveRecords, archiveRecords) {
        const merged = new Map();
        (Array.isArray(archiveRecords) ? archiveRecords : []).forEach(record => {
            if (record && record.id) merged.set(String(record.id), record);
        });
        // The live copy wins when the same record also exists in a loaded backup.
        (Array.isArray(liveRecords) ? liveRecords : []).forEach(record => {
            if (record && record.id) merged.set(String(record.id), record);
        });
        return Array.from(merged.values());
    }

    function vc541AllBusinessTransactions() {
        return vc541Clean(vc541MergeBusinessRecords(
            state.transactions || [],
            state.archiveTransactions || []
        ));
    }

    function vc541AllBusinessDays() {
        return vc541MergeBusinessRecords(
            state.businessDays || [],
            state.archiveBusinessDays || []
        );
    }

    // Read-only helpers for Business Calendar summaries. Archive rows remain in
    // their local-only arrays and are never added to the Firestore sync state.
    window.vc541AllBusinessTransactions = vc541AllBusinessTransactions;
    window.vc541AllBusinessDays = vc541AllBusinessDays;

    function vc541BusinessDate() {
        if (typeof businessCalendarDate !== 'undefined' && businessCalendarDate instanceof Date) return businessCalendarDate;
        return new Date();
    }

    function vc541FixBusinessMonthTitle() {
        const el = document.getElementById('business-month-title');
        if (!el) return;
        el.innerText = vc541BusinessDate().toLocaleDateString(undefined, {month:'long', year:'numeric'});
    }

    function vc541RenderBusinessGrid() {
        const grid = document.getElementById('business-calendar-grid');
        if (!grid) return;
        const current = vc541BusinessDate();
        const year = current.getFullYear();
        const month = current.getMonth();
        const today = vc541DateCode(new Date());

        const tx = vc541AllBusinessTransactions().filter(t => {
            const d = t.businessDate || (t.timestamp ? vc541DateCode(t.timestamp) : '');
            const dt = new Date(d + 'T00:00:00');
            return dt.getFullYear() === year && dt.getMonth() === month;
        });

        const byDate = {};
        vc541AllBusinessDays().forEach(day => {
            const d = day.date || (day.openedAt ? vc541DateCode(day.openedAt) : '');
            const dt = new Date(d + 'T00:00:00');
            if (!d || Number.isNaN(dt.getTime()) || dt.getFullYear() !== year || dt.getMonth() !== month) return;
            if (!byDate[d]) byDate[d] = { sales: 0, tx: 0 };
        });
        tx.forEach(t => {
            const d = t.businessDate || (t.timestamp ? vc541DateCode(t.timestamp) : '');
            if (!byDate[d]) byDate[d] = { sales: 0, tx: 0 };
            byDate[d].tx++;
            if ((t.type === 'SA' || t.type === 'CR') && !vc541IsSettlement(t)) byDate[d].sales += Number(t.total)||0;
        });

        const first = new Date(year, month, 1);
        const last = new Date(year, month+1, 0);
        const cells = [];
        for (let i=0; i<first.getDay(); i++) cells.push(`<div class="business-day-tile opacity-0 pointer-events-none"></div>`);
        for (let day=1; day<=last.getDate(); day++) {
            const d = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const rec = byDate[d];
            if (rec) {
                cells.push(`<button class="business-day-tile has-day ${d === today ? 'today' : ''}" onclick="typeof openBusinessDayDetail==='function' && openBusinessDayDetail('BD-${d.replaceAll('-', '')}')">
                    <span class="business-day-number">${day}</span>
                    <span class="business-day-sales">${vc541Peso(rec.sales).replace('.00','')}</span>
                    <span class="business-day-meta">${rec.tx} tx</span>
                </button>`);
            } else {
                cells.push(`<button class="business-day-tile ${d === today ? 'today' : ''}" onclick="typeof openEmptyBusinessDay==='function' && openEmptyBusinessDay('${d}')">
                    <span class="business-day-number">${day}</span>
                    <span class="business-day-off">Closed</span>
                </button>`);
            }
        }
        grid.innerHTML = cells.join('');
    }

    function vc541RefreshBusinessScreen() {
        vc541FixBusinessMonthTitle();
        vc541RenderBusinessGrid();
    }

    function vc541ForceUI() {
        if (!document.getElementById('screen-business')?.classList.contains('hidden')) vc541RefreshBusinessScreen();
    }

    window.vc541RefreshBusinessScreen = vc541RefreshBusinessScreen;

    const vc541OldBusiness = typeof renderBusinessCalendar === 'function' ? renderBusinessCalendar : null;
    if (vc541OldBusiness && !window.__vcRenderBusiness541Patched) {
        window.__vcRenderBusiness541Patched = true;
        renderBusinessCalendar = function() {
            const result = vc541OldBusiness.apply(this, arguments);
            vc541RefreshBusinessScreen();
            return result;
        };
    }

    const vc541OldSwitch = typeof switchScreen === 'function' ? switchScreen : null;
    if (vc541OldSwitch && !window.__vcSwitch541Patched) {
        window.__vcSwitch541Patched = true;
        switchScreen = function(screen) {
            const result = vc541OldSwitch.apply(this, arguments);
            if (screen === 'business') setTimeout(vc541RefreshBusinessScreen, 80);
            return result;
        };
    }

    window.addEventListener('focus', vc541ForceUI);
    window.addEventListener('resize', vc541ForceUI);
    setTimeout(vc541ForceUI, 700);


    // Keep Insights period calculations aligned with the live transaction
    // state used by Ledger, with a safe fallback when a period is empty.
    function vc542DateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function vc542AllLiveTransactions() {
        // Ledger already trusts state.transactions after Firestore snapshot.
        // Do not let stale per-device deleted cache hide fresh cloud transactions in Insights.
        return (state.transactions || []).filter(t => t && t.id && t.timestamp);
    }

    function vc542PeriodTransactionsSafe() {
        const all = vc542AllLiveTransactions();
        if (!all.length) return [];

        const now = new Date();
        const today = vc542DateCode(now);
        const period = (typeof insightPeriod !== 'undefined') ? insightPeriod : 'day';

        let filtered = all;

        if (period === 'day') {
            filtered = all.filter(t => {
                const d = t.businessDate || (t.timestamp ? vc542DateCode(t.timestamp) : '');
                return d === today;
            });
        } else if (period === 'month') {
            filtered = all.filter(t => {
                const d = new Date((t.businessDate || (t.timestamp ? vc542DateCode(t.timestamp) : '')) + 'T00:00:00');
                return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
            });
        } else if (period === 'range') {
            const s = document.getElementById('insight-start-date')?.value;
            const e = document.getElementById('insight-end-date')?.value;
            if (s && e) {
                filtered = all.filter(t => {
                    const d = t.businessDate || (t.timestamp ? vc542DateCode(t.timestamp) : '');
                    return d >= s && d <= e;
                });
            }
        }

        // Fallback: if period filter returns empty on one device but live tx exists,
        // show latest live tx instead of a false "No activity".
        return filtered.length ? filtered : all;
    }

    // v5.6.1 Cross-device Business Day Card Fix
    // Tablet can show report totals from transactions while businessDay state is missing/stale.
    // This derives the open business day from today's live transactions and repairs Firestore/local state.
    function vc543DateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function vc543TodayCode() {
        return vc543DateCode(new Date());
    }

    function vc543LiveTransactions() {
        return (state.transactions || []).filter(t => t && t.id && t.timestamp);
    }

    function vc543TodayTransactions() {
        const today = vc543TodayCode();
        return vc543LiveTransactions().filter(t => {
            const d = t.businessDate || (t.timestamp ? vc543DateCode(t.timestamp) : '');
            return d === today;
        });
    }

    function vc543EnsureBusinessDayFromLiveTransactions() {
        if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];

        const today = vc543TodayCode();
        const todaysTx = vc543TodayTransactions();

        if (!todaysTx.length) {
            const existing = state.businessDays.find(bd => bd.date === today && bd.status === 'OPEN') || null;
            state.currentBusinessDayId = existing ? existing.id : null;
            return existing;
        }

        const bdId = `BD-${today.replaceAll('-', '')}`;
        let bd = state.businessDays.find(b => b.id === bdId);
        let bdChanged = false;

        if (!bd) {
            bd = {
                id: bdId,
                businessDayId: bdId,
                date: today,
                status: 'OPEN',
                openedAt: todaysTx.map(t => t.timestamp).filter(Boolean).sort()[0] || new Date().toISOString(),
                closedAt: null,
                terminal: 'Counter 1',
                autoStarted: true,
                createdAt: new Date().toISOString(),
                version: 'v5.6.1',
                repairedFromTransactions: true
            };
            state.businessDays.push(bd);
            bdChanged = true;
        } else if (bd.status !== 'CLOSED' && bd.status !== 'OPEN') {
            bd.status = 'OPEN';
            bd.closedAt = null;
            bdChanged = true;
        }

        const openToday = state.businessDays.find(day => day && day.date === today && String(day.status || '').toUpperCase() === 'OPEN');
        state.currentBusinessDayId = openToday ? openToday.id : null;

        let changedTx = false;
        todaysTx.forEach(t => {
            if (t.businessDayId !== bd.id || t.businessDate !== bd.date) {
                t.businessDayId = bd.id;
                t.businessDate = bd.date;
                changedTx = true;

                t._offline = true;
                if (typeof queueAction === 'function') queueAction('update', 'transactions', t);
            }
        });

        if (bdChanged) {
            bd._offline = true;
            if (typeof queueAction === 'function') queueAction('update', 'businessDays', bd);
        }

        try {
            localStorage.setItem('villacart_business_days_v520', JSON.stringify(state.businessDays));
            localStorage.setItem('villacart_business_days', JSON.stringify(state.businessDays));
        } catch(e) {}

        if (changedTx && typeof sync === 'function') sync();

        return bd;
    }

    function vc543RefreshBusinessDayUI() {
        const bd = vc543EnsureBusinessDayFromLiveTransactions();
        const todaysTx = vc543TodayTransactions();

        const title = document.getElementById('bd-status-title');
        const sub = document.getElementById('bd-status-subtitle');
        const badge = document.getElementById('bd-status-badge');
        const pill = document.getElementById('business-day-pill');
        const pillText = document.getElementById('business-day-text');

        if (bd) {
            const opened = bd.openedAt ? new Date(bd.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--';
            if (title) title.innerText = bd.id;
            if (sub) sub.innerText = `Opened ${opened} • ${todaysTx.length} transaction(s)`;

            if (badge) {
                const badgeText = bd.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
                if (badge.innerText !== badgeText) badge.innerText = badgeText;
                const badgeClass = bd.status === 'CLOSED' ? 'closed' : 'open';
                if (!badge.classList.contains(badgeClass)) {
                    badge.classList.remove('none','closed','open');
                    badge.classList.add(badgeClass);
                }
            }

            if (pill && pillText) {
                const pillClass = bd.status === 'CLOSED' ? 'closed' : 'open';
                if (!pill.classList.contains(pillClass) || pill.classList.contains('hidden') || pill.classList.contains('none')) {
                    pill.classList.remove('hidden','none','closed','open');
                    pill.classList.add(pillClass);
                }
                const pillLabel = bd.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
                if (pillText.innerText !== pillLabel) pillText.innerText = pillLabel;
            }
        } else {
            if (title) title.innerText = 'No active business day';
            if (sub) sub.innerText = 'First transaction will start the business day automatically.';

            if (badge) {
                badge.innerText = 'AUTO';
                badge.classList.remove('open','closed');
                badge.classList.add('none');
            }

            if (pill && pillText) {
                pill.classList.remove('hidden','open','closed');
                pill.classList.add('none');
                pillText.innerText = 'NO DAY';
            }
        }
    }

    // Keep older business-day callers on the live transaction-aware helper.
    getCurrentBusinessDay = function() {
        return vc543EnsureBusinessDayFromLiveTransactions();
    };

    const vc543OldSwitchScreen = typeof switchScreen === 'function' ? switchScreen : null;
    if (vc543OldSwitchScreen && !window.__vcSwitchScreen543Patched) {
        window.__vcSwitchScreen543Patched = true;
        switchScreen = function(screen) {
            vc543OldSwitchScreen(screen);
            if (screen === 'business') {
                setTimeout(vc543RefreshBusinessDayUI, 100);
                setTimeout(vc543RefreshBusinessDayUI, 500);
            }
        };
    }

    const vc543OldSync = typeof sync === 'function' ? sync : null;
    if (vc543OldSync && !window.__vcSync543Patched) {
        window.__vcSync543Patched = true;
        sync = function() {
            const result = vc543OldSync();
            setTimeout(vc543RefreshBusinessDayUI, 50);
            return result;
        };
    }

    setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        const hasTx = vc543TodayTransactions().length > 0;
        const saysNoDay = (document.getElementById('business-day-text')?.innerText || '').toUpperCase().includes('NO');
        const saysNoActive = (document.getElementById('bd-status-title')?.innerText || '').toUpperCase().includes('NO ACTIVE');
        if (hasTx && (saysNoDay || saysNoActive)) vc543RefreshBusinessDayUI();
    }, 10000);

    setTimeout(vc543RefreshBusinessDayUI, 800);
    setTimeout(vc543RefreshBusinessDayUI, 1800);


    const vc544OldShowClosing = typeof showStoreClosingSummary === 'function' ? showStoreClosingSummary : null;
    if (vc544OldShowClosing && !window.__vcShowClosing544Patched) {
        window.__vcShowClosing544Patched = true;
        showStoreClosingSummary = function() {
            vc544OldShowClosing();
            setTimeout(vc544RenderClosingSummary, 0);
            setTimeout(vc544RenderClosingSummary, 150);
        };
    }

    const vc544OldEndBusinessDay = typeof endBusinessDay === 'function' ? endBusinessDay : null;
    if (vc544OldEndBusinessDay && !window.__vcEndBusinessDay544Patched) {
        window.__vcEndBusinessDay544Patched = true;
        endBusinessDay = function() {
            const { bd, metrics } = vc544RenderClosingSummary();

            if (!bd && !vc544TodayTransactions().length) {
                if (typeof showToast === 'function') showToast('No active business day to close', 'info');
                return;
            }

            const activeBD = bd || vc544GetBusinessDay();
            if (!activeBD) {
                if (typeof showToast === 'function') showToast('No active business day to close', 'info');
                return;
            }

            if (!confirm(`End Business Day ${activeBD.id}?\n\nCash Received: ${vc544Peso(metrics.cashIn)}\nTotal Sales: ${vc544Peso(metrics.totalSales)}\nNet Profit: ${vc544Peso(metrics.netProfit)}\n\nThis will save and close today's business day.`)) return;

            activeBD.status = 'CLOSED';
            activeBD.closedAt = new Date().toISOString();
            activeBD.summary = metrics;
            activeBD.closedBy = 'POS';
            activeBD.manualClosed = true;
            activeBD.autoClosed = false;
            state.currentBusinessDayId = null;

            activeBD._offline = true;
            if (typeof queueAction === 'function') queueAction('update', 'businessDays', activeBD);

            // If older layers created duplicate OPEN business-day records
            // for the same calendar date, close them together so the header pill
            // cannot remain OPEN after a manual End Day.
            const closeDate = activeBD.date || (activeBD.openedAt ? String(activeBD.openedAt).slice(0, 10) : new Date().toISOString().slice(0, 10));
            (state.businessDays || []).forEach(day => {
                if (!day || day.id === activeBD.id) return;
                const dayDate = day.date || (day.openedAt ? String(day.openedAt).slice(0, 10) : '');
                if (dayDate === closeDate && String(day.status || '').toUpperCase() === 'OPEN') {
                    day.status = 'CLOSED';
                    day.closedAt = activeBD.closedAt;
                    day.closedBy = 'POS';
                    day.manualClosed = true;
                    day.autoClosed = false;
                    day._offline = true;
                    if (typeof queueAction === 'function') queueAction('update', 'businessDays', day);
                }
            });

            if (typeof sync === 'function') sync();
            if (typeof closeModal === 'function') closeModal('closing-summary-modal');
            if (typeof closeModal === 'function') closeModal('business-day-modal');
            if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI();
            if (typeof v52RefreshBusinessDayUI === 'function') v52RefreshBusinessDayUI();
            if (typeof vc543RefreshBusinessDayUI === 'function') vc543RefreshBusinessDayUI();
            if (typeof vc551RefreshHeader === 'function') vc551RefreshHeader();
            if (typeof renderInsights === 'function') renderInsights();
            if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
            if (typeof showToast === 'function') showToast(`Business Day ${activeBD.id} closed`, 'success');
        };
    }


    const vc545OldUpdateLastSynced = typeof updateLastSyncedTime === 'function' ? updateLastSyncedTime : null;
    if (vc545OldUpdateLastSynced && !window.__vcUpdateLastSynced545Patched) {
        window.__vcUpdateLastSynced545Patched = true;
        updateLastSyncedTime = function() {
            vc545OldUpdateLastSynced();
            const ts = document.getElementById('sync-timestamp');
            if (ts && ts.innerText.includes('Last Synced:')) {
                ts.innerText = ts.innerText.replace('Last Synced:', 'Last Sync •');
            }
            vc545NormalizeHeaderStatus();
        };
    }

    const vc545OldUpdateSyncUI = typeof updateSyncUI === 'function' ? updateSyncUI : null;
    if (vc545OldUpdateSyncUI && !window.__vcUpdateSyncUI545Patched) {
        window.__vcUpdateSyncUI545Patched = true;
        updateSyncUI = function() {
            const result = vc545OldUpdateSyncUI();
            vc545NormalizeHeaderStatus();
            return result;
        };
    }

    const vc545OldRefreshBD = typeof vc543RefreshBusinessDayUI === 'function' ? vc543RefreshBusinessDayUI : null;
    if (vc545OldRefreshBD && !window.__vcRefreshBD545Patched) {
        window.__vcRefreshBD545Patched = true;
        vc543RefreshBusinessDayUI = function() {
            const result = vc545OldRefreshBD();
            vc545NormalizeHeaderStatus();
            return result;
        };
    }

    window.addEventListener('online', vc545NormalizeHeaderStatus);
    window.addEventListener('offline', vc545NormalizeHeaderStatus);
    window.addEventListener('resize', vc545RefreshTodayLine);

    setInterval(vc545NormalizeHeaderStatus, 30000);
    setTimeout(vc545NormalizeHeaderStatus, 300);
    setTimeout(vc545NormalizeHeaderStatus, 1200);


    setInterval(vc547PremiumHeaderText, 60000);
    window.addEventListener('resize', vc547PremiumHeaderText);
    setTimeout(vc547PremiumHeaderText, 200);
    setTimeout(vc547PremiumHeaderText, 1000);


    setInterval(vc548UpdateCompactDate, 60000);
    window.addEventListener('resize', vc548UpdateCompactDate);
    setTimeout(vc548UpdateCompactDate, 200);
    setTimeout(vc548UpdateCompactDate, 1200);

    ['online','offline','resize','focus'].forEach(evt => window.addEventListener(evt, vc551DebouncedHeader));

    const vc551OldSwitchScreen = typeof switchScreen === 'function' ? switchScreen : null;
    if (vc551OldSwitchScreen && !window.__vcSwitch551Patched) {
        window.__vcSwitch551Patched = true;
        switchScreen = function(screen) {
            const result = vc551OldSwitchScreen(screen);
            vc551DebouncedHeader();
            return result;
        };
    }

    const vc551OldSync = typeof sync === 'function' ? sync : null;
    if (vc551OldSync && !window.__vcSync551Patched) {
        window.__vcSync551Patched = true;
        sync = function() {
            const result = vc551OldSync();
            vc551DebouncedHeader();
            return result;
        };
    }

    setTimeout(vc551RefreshHeader, 200);
    setTimeout(vc551RefreshHeader, 1200);

    // v5.6.16: Retire persistent deleted-transaction caches.
    // Firestore/REST is the source of truth. Old deleted-ID caches could hide
    // valid cloud transactions on one device after a failed delete.
    try { localStorage.removeItem('villacart_deleted_transactions'); } catch(e) {}
    [
        'vc522GetDeletedSet',
        'vc523DeletedSet',
        'vc524DeletedSet',
        'vc530DeletedSet',
        'vc531DeletedSet',
        'vc532DeletedSet',
        'vc541DeletedSet',
        'vc544DeletedSet'
    ].forEach(name => {
        if (typeof window[name] === 'function') window[name] = () => new Set();
    });
    ['vc522SaveDeletedSet', 'vc530SaveDeletedSet'].forEach(name => {
        if (typeof window[name] === 'function') window[name] = () => {
            try { localStorage.removeItem('villacart_deleted_transactions'); } catch(e) {}
        };
    });

    // v5.6.26 Insights UI Polish
    // Presentation-only layer: improves the Insights dashboard layout without touching sync, Firestore, queue, or transaction logic.
    function vc560Peso(value) {
        return `₱${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function vc560SafeText(value) {
        return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
    }

    function vc560Norm(value) {
        return String(value || '').trim().toUpperCase();
    }

    function vc560IsSettlement(t) {
        if (!t) return false;
        const id = vc560Norm(t.id);
        const type = vc560Norm(t.type);
        const notes = vc560Norm(t.notes);
        return !!(
            t.settlementFor ||
            t.creditRef ||
            t.relatedCreditId ||
            (type === 'SA' && notes.includes('CR-')) ||
            (id.startsWith('SA-') && notes.includes('CR-')) ||
            notes.includes('SETTLEMENT') ||
            notes.includes('PAID CREDIT') ||
            notes.includes('PAYMENT')
        );
    }

    function vc560PeriodTransactions() {
        try {
            if (typeof vc542PeriodTransactionsSafe === 'function') return vc542PeriodTransactionsSafe();
            if (typeof vc531PeriodTransactions === 'function') return vc531PeriodTransactions();
            if (typeof getPeriodTransactions === 'function') return getPeriodTransactions();
        } catch(e) {}
        return Array.isArray(state.transactions) ? state.transactions : [];
    }

    function vc560Metrics(tx) {
        const clean = (tx || []).filter(t => t && t.id);
        const revenue = clean.filter(t => (t.type === 'SA' || t.type === 'CR') && !vc560IsSettlement(t));
        const totalSales = revenue.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const avgSale = revenue.length ? totalSales / revenue.length : 0;
        const productMap = {};

        revenue.forEach(t => (t.items || []).forEach(item => {
            const qty = (Number(item.qty) || 0) * (Number(item.deduct) || 1);
            const key = item.name || item.id || 'Unknown Item';
            if (!productMap[key]) productMap[key] = { name: key, qty: 0, revenue: 0 };
            productMap[key].qty += qty;
            productMap[key].revenue += (Number(item.price) || 0) * (Number(item.qty) || 0);
        }));

        const topProducts = Object.values(productMap).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
        const lowStock = (state.inventory || []).filter(isStockAlertVisibleProduct);

        return { clean, revenue, totalSales, avgSale, topProducts, topProduct: topProducts[0] || null, lowStock };
    }

    function vc560EnsureInsightsShell() {
        const screen = document.getElementById('screen-insights');
        if (!screen) return null;
        screen.classList.add('vc560-insights');

        const title = screen.querySelector('h2');
        if (title) {
            title.innerText = 'Insights';
            if (!document.getElementById('vc560-insights-subtitle')) {
                const sub = document.createElement('p');
                sub.id = 'vc560-insights-subtitle';
                sub.className = 'vc560-insights-subtitle';
                sub.innerText = 'Daily sales, profit, stock, and activity at a glance.';
                title.insertAdjacentElement('afterend', sub);
            }
        }

        const dashboard = document.getElementById('business-dashboard-cards');
        if (dashboard) {
            dashboard.classList.add('vc560-summary-grid');
            if (!document.getElementById('vc560-quick-metrics')) {
                const quick = document.createElement('div');
                quick.id = 'vc560-quick-metrics';
                quick.className = 'vc560-quick-grid';
                dashboard.insertAdjacentElement('afterend', quick);
            }
        }

        const chart = document.getElementById('sales-chart');
        if (chart && chart.parentElement) chart.parentElement.classList.add('vc560-chart-card');
        const topList = document.getElementById('best-sellers-list');
        if (topList && topList.parentElement) topList.parentElement.classList.add('vc560-top-products-card');
        return screen;
    }

    function vc560RenderQuickMetrics(tx) {
        const quick = document.getElementById('vc560-quick-metrics');
        if (!quick) return;
        const m = vc560Metrics(tx);
        const best = m.topProduct;
        quick.innerHTML = `
            <div class="vc560-mini-card vc560-mini-blue">
                <span class="material-symbols-outlined">star</span>
                <p>Best Seller</p>
                <strong>${best ? vc560SafeText(best.name) : '—'}</strong>
                <small>${best ? `${best.qty.toLocaleString()} sold` : 'No product sales yet'}</small>
            </div>
            <div class="vc560-mini-card vc560-mini-orange">
                <span class="material-symbols-outlined">inventory_2</span>
                <p>Low Stock</p>
                <strong>${m.lowStock.length}</strong>
                <small>${m.lowStock.length === 1 ? 'item needs attention' : 'items need attention'}</small>
            </div>
            <div class="vc560-mini-card vc560-mini-green">
                <span class="material-symbols-outlined">receipt_long</span>
                <p>Avg Sale</p>
                <strong>${vc560Peso(m.avgSale)}</strong>
                <small>Per sales transaction</small>
            </div>
            <div class="vc560-mini-card vc560-mini-purple">
                <span class="material-symbols-outlined">tag</span>
                <p>Transactions</p>
                <strong>${m.clean.length.toLocaleString()}</strong>
                <small>In selected period</small>
            </div>`;
    }

    function vc560RenderTopProducts(tx) {
        const list = document.getElementById('best-sellers-list');
        if (!list) return;
        const top = vc560Metrics(tx).topProducts.slice(0, 5);
        if (!top.length) {
            list.innerHTML = `<div class="vc560-empty-state">No product sales yet</div>`;
            return;
        }
        list.innerHTML = top.map((p, idx) => `
            <div class="vc560-product-row">
                <div class="vc560-rank">${idx + 1}</div>
                <div class="vc560-product-main">
                    <p>${vc560SafeText(p.name)}</p>
                    <span>${p.qty.toLocaleString()} sold</span>
                </div>
                <strong>${vc560Peso(p.revenue)}</strong>
            </div>`).join('');
    }

    function vc560RefreshInsightsUI() {
        if (!vc560EnsureInsightsShell()) return;
        const tx = vc560PeriodTransactions();
        vc560RenderQuickMetrics(tx);
        vc560RenderTopProducts(tx);
    }

    const vc560OldRenderInsights = typeof renderInsights === 'function' ? renderInsights : null;
    if (vc560OldRenderInsights && !window.__vcRenderInsights560Patched) {
        window.__vcRenderInsights560Patched = true;
        renderInsights = function() {
            const result = vc560OldRenderInsights.apply(this, arguments);
            vc560RefreshInsightsUI();
            return result;
        };
    }

    const vc560OldSwitchScreen = typeof switchScreen === 'function' ? switchScreen : null;
    if (vc560OldSwitchScreen && !window.__vcSwitchScreen560Patched) {
        window.__vcSwitchScreen560Patched = true;
        switchScreen = function(screen) {
            const result = vc560OldSwitchScreen.apply(this, arguments);
            if (screen === 'insights') {
                vc560RefreshInsightsUI();
            }
            return result;
        };
    }

    // Delayed Insights repaint disabled to prevent flicker.

async function vc7218StartApp() {
        if (window.__vc7218Started) return;
        window.__vc7218Started = true;
        vcStartupMark('app-start-called');
        try {
            await vc860HydrateDurableStorage();
            vcStartupMark('pos-switch-start');
            switchScreen('pos');
            vcStartupMark('pos-screen-shown', {
                localInventory: Array.isArray(state.inventory) ? state.inventory.length : null,
                localTransactions: Array.isArray(state.transactions) ? state.transactions.length : null
            });

            setTimeout(() => {
                try {
                    applyUIPolish();
                    vcStartupMark('ui-polish-complete');
                } catch (polishError) {
                    console.warn('Villacart UI polish delayed task failed', polishError);
                    vcStartupMark('ui-polish-failed', { error: polishError && polishError.message ? polishError.message : String(polishError) });
                }
            }, 80);

            setTimeout(v52RefreshBusinessDayUI, 1200);
            setTimeout(() => {
                const ready = window.villacartAuthReady || Promise.resolve(null);
                ready.finally(() => {
                    vcStartupMark('realtime-sync-auth-ready');
                    setupRealTimeSync();
                });
            }, 1500);
            vcStartupMark('realtime-sync-scheduled');
        } catch (error) {
            console.error('Villacart startup failed', error);
            vcStartupMark('app-start-failed', { error: error && error.message ? error.message : String(error) });
            try {
                switchScreen('pos');
                vcStartupMark('pos-screen-fallback-shown');
            } catch(e) {}
            try { updateSyncUI(); } catch(e) {}
        }
    }

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', vc7218StartApp, { once: true });
} else {
    vc7218StartApp();
}
window.addEventListener('load', vc7218StartApp, { once: true });
setTimeout(vc7218StartApp, 1200);

document.addEventListener('click', function(e){
  // Keep this cleanup scoped to POS search-result selections only.
  // The older global selector cleared Stock/Favorites search fields after
  // unrelated button taps, which made stock searching feel jumpy.
  const resultButton = e.target.closest('#search-results-container button');
  if (!resultButton) return;
  setTimeout(() => {
    const posSearch = document.getElementById('pos-search');
    const clearButton = document.getElementById('clear-search-btn');
    const results = document.getElementById('search-results-container');
    if (posSearch) {
      posSearch.value = '';
      posSearch.blur();
      posSearch.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (clearButton) clearButton.classList.add('hidden');
    if (results) results.classList.add('hidden');
  }, 100);
});

document.addEventListener('DOMContentLoaded',()=>{
 const s=document.getElementById('pos-search');
 const b=document.getElementById('clear-search-btn');
 let scanInputTimer = null;
 if(s&&b){
  s.addEventListener('input',()=>{
    b.classList.toggle('hidden',!s.value);
    clearTimeout(scanInputTimer);
    scanInputTimer = setTimeout(()=>{
      try {
        const code = typeof vc7227NormalizeBarcode === 'function' ? vc7227NormalizeBarcode(s.value) : String(s.value || '').trim();
        if (
          typeof vc7226LooksLikeBarcode === 'function' &&
          typeof vc7227FindProductByBarcode === 'function' &&
          typeof handlePhysicalScan === 'function' &&
          vc7226LooksLikeBarcode(code) &&
          vc7227FindProductByBarcode(code) &&
          !(typeof vc7228RecentlyHandled === 'function' && vc7228RecentlyHandled(code))
        ) {
          handlePhysicalScan(code);
        }
      } catch(e) {}
    }, 160);
  });
  s.addEventListener('keydown',(e)=>{
    if(e.key==='Enter' || e.key==='Tab' || e.key==='NumpadEnter'){
      const code = typeof vc7227NormalizeBarcode === 'function' ? vc7227NormalizeBarcode(s.value) : String(s.value || '').trim();
      if (
        typeof vc7226LooksLikeBarcode === 'function' &&
        typeof handlePhysicalScan === 'function' &&
        vc7226LooksLikeBarcode(code) &&
        !(typeof vc7228RecentlyHandled === 'function' && vc7228RecentlyHandled(code))
      ) {
        e.preventDefault();
        handlePhysicalScan(code);
      } else {
        s.blur();
      }
    }
  });
 }
});

// v5.6.30 Sync safety: auto retry pending work and stop UI repair write loops.
(function(){
    if (window.__vcSyncSafety5630) return;
    window.__vcSyncSafety5630 = true;

    const SIG_KEY = 'villacart_synced_doc_signatures' + (typeof STORAGE_SUFFIX !== 'undefined' ? STORAGE_SUFFIX : '');
    let lastSyncAttemptAt = 0;

    function vc5630Stable(value) {
        if (Array.isArray(value)) return value.map(vc5630Stable);
        if (value && typeof value === 'object') {
            return Object.keys(value)
                .filter(key => key !== '_offline')
                .sort()
                .reduce((acc, key) => {
                    acc[key] = vc5630Stable(value[key]);
                    return acc;
                }, {});
        }
        return value == null ? null : value;
    }

    function vc5630Signature(data) {
        try { return JSON.stringify(vc5630Stable(data || {})); }
        catch(e) { return ''; }
    }

    function vc5630SigId(table, id) {
        return String(table || '') + '/' + String(id || '');
    }

    function vc5630LoadSigs() {
        try { return JSON.parse(localStorage.getItem(SIG_KEY) || '{}') || {}; }
        catch(e) { return {}; }
    }

    function vc5630SaveSigs(sigs) {
        try { localStorage.setItem(SIG_KEY, JSON.stringify(sigs || {})); } catch(e) {}
    }

    function vc5630Remember(table, data) {
        if (!table || !data || !data.id) return;
        const sigs = vc5630LoadSigs();
        sigs[vc5630SigId(table, data.id)] = vc5630Signature(data);
        vc5630SaveSigs(sigs);
    }

    let vc5630BulkRememberRunning = false;

    function vc5630RememberLoadedState(reason) {
        if (vc5630BulkRememberRunning) return;
        vc5630BulkRememberRunning = true;

        let entries = [];
        try {
            entries = [['inventory', state.inventory], ['transactions', state.transactions], ['businessDays', state.businessDays]]
                .flatMap(([table, list]) => (Array.isArray(list) ? list : [])
                    .filter(item => item && item.id && !item._offline)
                    .map(item => [table, item]));
        } catch(e) {
            vc5630BulkRememberRunning = false;
            return;
        }

        const sigs = vc5630LoadSigs();
        let index = 0;
        const total = entries.length;

        const pump = () => {
            const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            try {
                while (index < total) {
                    const [table, item] = entries[index++];
                    sigs[vc5630SigId(table, item.id)] = vc5630Signature(item);

                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    if (now - start >= 8) break;
                }

                if (index < total) {
                    setTimeout(pump, 16);
                    return;
                }

                vc5630SaveSigs(sigs);
                if (typeof vcStartupMark === 'function') {
                    vcStartupMark('synced-signatures-ready', { reason, count: total, chunked: true });
                }
            } catch(e) {
                console.warn('Loaded-state signature scan failed', reason, e);
            } finally {
                if (index >= total) vc5630BulkRememberRunning = false;
            }
        };

        setTimeout(pump, 0);
    }

    function vc5630SameAsSynced(table, data) {
        if (!table || !data || !data.id) return false;
        const sigs = vc5630LoadSigs();
        return sigs[vc5630SigId(table, data.id)] === vc5630Signature(data);
    }

    function vc5630SamePending(type, table, data) {
        if (!Array.isArray(offlineQueue) || !data || !data.id) return false;
        const sig = vc5630Signature(data);
        return offlineQueue.some(task =>
            task && task.type === type && task.table === table &&
            task.data && task.data.id === data.id &&
            vc5630Signature(task.data) === sig
        );
    }

    const vc5630OldMarkSynced = typeof markSyncedTaskLocally === 'function' ? markSyncedTaskLocally : null;
    if (vc5630OldMarkSynced && !window.__vcMarkSynced5630Patched) {
        window.__vcMarkSynced5630Patched = true;
        markSyncedTaskLocally = function(task) {
            const result = vc5630OldMarkSynced.apply(this, arguments);
            if (task && task.type !== 'delete' && task.table && task.data && task.data.id) {
                vc5630Remember(task.table, task.data);
            }
            return result;
        };
    }

    const vc5630OldQueueAction = typeof queueAction === 'function' ? queueAction : null;
    if (vc5630OldQueueAction && !window.__vcQueueAction5630Patched) {
        window.__vcQueueAction5630Patched = true;
        queueAction = function(type, table, data) {
            if (type !== 'delete' && data && data.id) {
                if (vc5630SamePending(type, table, data)) {
                    if (typeof sync === 'function') sync();
                    return;
                }

                // If an older UI repair layer tries to rewrite an unchanged
                // transaction/business-day document, keep it local only.
                if ((table === 'transactions' || table === 'businessDays') && vc5630SameAsSynced(table, data)) {
                    delete data._offline;
                    if (typeof sync === 'function') sync();
                    return;
                }
            }
            return vc5630OldQueueAction.apply(this, arguments);
        };
    }

    // Replace the business-day repair helper with a local-only version. New
    // sales already attach and queue business-day fields before saving. This
    // prevents screen refreshes from rewriting older transactions just to repair
    // reporting metadata.
    if (typeof vc543EnsureBusinessDayFromLiveTransactions === 'function' && !window.__vc543LocalOnly5630) {
        window.__vc543LocalOnly5630 = true;
        vc543EnsureBusinessDayFromLiveTransactions = function() {
            if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];
            const today = typeof vc543TodayCode === 'function'
                ? vc543TodayCode()
                : new Date().toISOString().slice(0, 10);
            const todaysTx = typeof vc543TodayTransactions === 'function'
                ? vc543TodayTransactions()
                : (state.transactions || []).filter(t => (t.businessDate || String(t.timestamp || '').slice(0,10)) === today);

            const existingOpen = state.businessDays.find(bd => bd.date === today && bd.status === 'OPEN') || null;
            if (!todaysTx.length) {
                state.currentBusinessDayId = existingOpen ? existingOpen.id : null;
                return existingOpen;
            }

            const bdId = 'BD-' + today.replaceAll('-', '');
            let bd = state.businessDays.find(b => b.id === bdId) || existingOpen;
            if (!bd) {
                bd = {
                    id: bdId,
                    businessDayId: bdId,
                    date: today,
                    status: 'OPEN',
                    openedAt: todaysTx.map(t => t.timestamp).filter(Boolean).sort()[0] || new Date().toISOString(),
                    closedAt: null,
                    terminal: 'Counter 1',
                    autoStarted: true,
                    createdAt: new Date().toISOString(),
                    version: 'v5.6.30-local'
                };
                state.businessDays.push(bd);
            }

            state.currentBusinessDayId = bd.id;
            todaysTx.forEach(t => {
                if (!t.businessDayId) t.businessDayId = bd.id;
                if (!t.businessDate) t.businessDate = bd.date;
            });

            try {
                localStorage.setItem('villacart_business_days_v520', JSON.stringify(state.businessDays));
                localStorage.setItem('villacart_business_days', JSON.stringify(state.businessDays));
            } catch(e) {}
            if (typeof sync === 'function') sync();
            return bd;
        };
    }

    function vc5630AutoFlush(reason) {
        if (!navigator.onLine || !Array.isArray(offlineQueue) || offlineQueue.length === 0) return;
        if (typeof syncNow !== 'function') return;
        const now = Date.now();
        if (now - lastSyncAttemptAt < 120000) return;
        lastSyncAttemptAt = now;
        try { syncNow(); } catch(e) { console.warn('Auto sync retry failed', reason, e); }
    }

    // v7.2.37: Keep the post-startup signature safety scan, but do it in
    // tiny chunks. This prevents the first Ledger/Insights taps from feeling
    // ignored while hundreds of local docs are fingerprinted.
    function vc5630ScheduleRememberLoadedState(reason, delay) {
        setTimeout(() => {
            try { vc5630RememberLoadedState(reason); }
            catch(e) { console.warn('Loaded-state signature scan failed', reason, e); }
        }, delay);
    }

    vc5630ScheduleRememberLoadedState('post-startup', 6500);
    setTimeout(() => vc5630AutoFlush('startup'), 7000);
    setInterval(() => {
        if (document.visibilityState !== 'hidden') vc5630AutoFlush('timer');
    }, 5 * 60 * 1000);
    window.addEventListener('online', () => setTimeout(() => vc5630AutoFlush('online'), 1500));
    window.addEventListener('focus', () => setTimeout(() => vc5630AutoFlush('focus'), 1500));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') setTimeout(() => vc5630AutoFlush('visible'), 1500);
    });
})();


// v5.6.31 Cross-device reconcile: keep realtime, plus safe focus/online cloud refresh.
(function(){
    if (window.__vcCrossDeviceReconcile5631) return;
    window.__vcCrossDeviceReconcile5631 = true;

    let vc5631Reconciling = false;
    let vc5631LastAt = 0;
    let vc5631WasHiddenAt = 0;
    const MIN_RECONCILE_MS = 90 * 1000;
    const BACKGROUND_REFRESH_MS = 20 * 1000;

    function vc5631PendingIds(table) {
        return new Set((Array.isArray(offlineQueue) ? offlineQueue : [])
            .filter(task => task && task.table === table && task.data && task.data.id)
            .map(task => task.data.id));
    }

    function vc5631MergeServer(table, serverList, localList) {
        const pending = vc5631PendingIds(table);
        const merged = new Map();
        (Array.isArray(serverList) ? serverList : [])
            .filter(item => item && item.id && !pending.has(item.id))
            .forEach(item => merged.set(item.id, item));
        (Array.isArray(localList) ? localList : [])
            .filter(item => item && item.id && item._offline && pending.has(item.id))
            .forEach(item => merged.set(item.id, item));
        return Array.from(merged.values());
    }

    async function vc5631Reconcile(reason, options = {}) {
        if (!navigator.onLine || vc5631Reconciling) return false;
        if (typeof readCollectionWithFirestoreRest !== 'function') return false;
        const now = Date.now();
        const localEmpty = !(state.inventory || []).length || !(state.businessDays || []).length;
        const force = !!options.force || localEmpty;
        if (!force && now - vc5631LastAt < MIN_RECONCILE_MS) return false;

        vc5631Reconciling = true;
        vc5631LastAt = now;
        try {
            const bounds = typeof vc5632mTodayBounds === 'function' ? vc5632mTodayBounds() : (typeof vc5632lMonthBounds === 'function' ? vc5632lMonthBounds() : null);
            const [transactions, businessDays] = await Promise.all([
                bounds && typeof queryCollectionWithFirestoreRest === 'function'
                    ? queryCollectionWithFirestoreRest('transactions', [
                        { field: 'businessDate', op: 'GREATER_THAN_OR_EQUAL', value: bounds.start },
                        { field: 'businessDate', op: 'LESS_THAN_OR_EQUAL', value: bounds.end }
                    ], 500)
                    : readCollectionWithFirestoreRest('transactions'),
                bounds && typeof queryCollectionWithFirestoreRest === 'function'
                    ? queryCollectionWithFirestoreRest('businessDays', [
                        { field: 'date', op: 'GREATER_THAN_OR_EQUAL', value: bounds.start },
                        { field: 'date', op: 'LESS_THAN_OR_EQUAL', value: bounds.end }
                    ], 80)
                    : readCollectionWithFirestoreRest('businessDays')
            ]);

            // v7.2.14: Do not auto-pull inventory here. Refresh Stock owns inventory reads.
            const localOldTransactions = (state.transactions || []).filter(t => t && typeof vc5632mInDateRange === 'function' && !vc5632mInDateRange(t, bounds));
            const localOldBusinessDays = (state.businessDays || []).filter(day => day && typeof vc5632mInDateRange === 'function' && !vc5632mInDateRange(day, bounds));
            state.transactions = [...vc5631MergeServer('transactions', transactions, state.transactions || []), ...localOldTransactions]
                .filter((item, idx, arr) => item && item.id && arr.findIndex(other => other && other.id === item.id) === idx)
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            state.businessDays = [...vc5631MergeServer('businessDays', businessDays, state.businessDays || []), ...localOldBusinessDays]
                .filter((item, idx, arr) => item && item.id && arr.findIndex(other => other && other.id === item.id) === idx);

            if (typeof window.vc7240AutoClosePreviousBusinessDays === 'function') {
                window.vc7240AutoClosePreviousBusinessDays('after-reconcile');
            }
            const openDay = (state.businessDays || [])
                .filter(day => day && day.status === 'OPEN')
                .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))[0];
            state.currentBusinessDayId = openDay ? openDay.id : null;

            if (typeof sync === 'function') sync();
            if (typeof renderInventory === 'function') renderInventory();
            if (typeof renderFavorites === 'function') renderFavorites();
            if (typeof renderLedger === 'function') renderLedger();
            if (typeof renderInsights === 'function') renderInsights();
            if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI();
            if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
            if (typeof updateSyncUI === 'function') updateSyncUI();
            syncErrorMsg = null;
            return true;
        } catch (error) {
            console.warn('Cross-device reconcile failed', reason, error);
            syncErrorMsg = error.message || String(error);
            if (typeof updateSyncUI === 'function') updateSyncUI();
            return false;
        } finally {
            vc5631Reconciling = false;
        }
    }

    function vc5631Schedule(reason, options = {}) {
        setTimeout(() => vc5631Reconcile(reason, options), options.delay || 900);
    }

    // Fresh browser/cache: auto-load once so inventory/sales appear without Diagnostics.
    setTimeout(() => {
        const empty = !(state.inventory || []).length || !(state.businessDays || []).length;
        if (empty) vc5631Reconcile('fresh-start', { force: true });
    }, 2500);

    // When a phone/PWA wakes up from background, reconcile once. This catches
    // tablet deletes/sales even if the mobile browser froze the realtime stream.
    window.addEventListener('online', () => vc5631Schedule('online', { force: true, delay: 1200 }));
    window.addEventListener('focus', () => {
        const wasHiddenLongEnough = vc5631WasHiddenAt && Date.now() - vc5631WasHiddenAt > BACKGROUND_REFRESH_MS;
        if (wasHiddenLongEnough) vc5631Schedule('focus-after-background');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            vc5631WasHiddenAt = Date.now();
            return;
        }
        const wasHiddenLongEnough = vc5631WasHiddenAt && Date.now() - vc5631WasHiddenAt > BACKGROUND_REFRESH_MS;
        if (wasHiddenLongEnough) vc5631Schedule('visible-after-background');
    });

    window.vcRefreshFromCloud = function() {
        return vc5631Reconcile('manual-console', { force: true });
    };
})();


// v5.6.32a: requested fixes, based on pre-autofocus backup.
// No automatic search focus is added here.
(function(){
    if (window.__vc5632aNoFocusRequestedFixes) return;
    window.__vc5632aNoFocusRequestedFixes = true;

    if (typeof renderInsights === 'function' && !window.__vc5632aStableInsights) {
        window.__vc5632aStableInsights = true;
        const oldRenderInsights = renderInsights;
        let lastSig = '';
        let lastAt = 0;
        renderInsights = function() {
            let sig = '';
            try {
                const tx = Array.isArray(state.transactions) ? state.transactions : [];
                const inv = Array.isArray(state.inventory) ? state.inventory : [];
                sig = JSON.stringify({
                    period: typeof insightPeriod !== 'undefined' ? insightPeriod : 'day',
                    tx: tx.map(t => [t.id, t.total, t.timestamp, t.type, t.paid, t.businessDate]).join('|'),
                    inv: inv.map(p => [p.id, p.stock, p.lowStock]).join('|')
                });
            } catch(e) { sig = String(Date.now()); }
            const now = Date.now();
            if (sig === lastSig && now - lastAt < 1200) return;
            lastSig = sig;
            lastAt = now;
            return oldRenderInsights.apply(this, arguments);
        };
    }
})();
// v7.2.15 Insights Business Day card flicker guard.
// On Insights, vc531RefreshBusinessDayCard is the only writer for the card.
(function(){
    if (window.__vc5632kBusinessDayFlickerGuard) return;
    window.__vc5632kBusinessDayFlickerGuard = true;

    function vc5632kIsInsightsVisible() {
        const screen = document.getElementById('screen-insights');
        return !!screen && !screen.classList.contains('hidden');
    }

    function stableInsightsBusinessDay() {
        if (typeof vc531RefreshBusinessDayCard === 'function') vc531RefreshBusinessDayCard();
    }

    if (typeof v52RefreshBusinessDayUI === 'function') {
        const oldV52RefreshBusinessDayUI = v52RefreshBusinessDayUI;
        v52RefreshBusinessDayUI = function() {
            if (vc5632kIsInsightsVisible()) {
                stableInsightsBusinessDay();
                return;
            }
            return oldV52RefreshBusinessDayUI.apply(this, arguments);
        };
    }

    if (typeof vc543RefreshBusinessDayUI === 'function') {
        const oldVc543RefreshBusinessDayUI = vc543RefreshBusinessDayUI;
        vc543RefreshBusinessDayUI = function() {
            if (vc5632kIsInsightsVisible()) {
                stableInsightsBusinessDay();
                return;
            }
            return oldVc543RefreshBusinessDayUI.apply(this, arguments);
        };
    }

    const oldRenderInsights = typeof renderInsights === 'function' ? renderInsights : null;
    if (oldRenderInsights && !window.__vc5632kRenderInsightsBDStable) {
        window.__vc5632kRenderInsightsBDStable = true;
        renderInsights = function() {
            const result = oldRenderInsights.apply(this, arguments);
            stableInsightsBusinessDay();
            return result;
        };
    }
})();


// v7.2.15: Today-first auto sync + on-demand Month/Range cloud loads.
(function(){
    if (window.__vc5632mOnDemandPeriodLoads) return;
    window.__vc5632mOnDemandPeriodLoads = true;

    const loadedRanges = {};
    let loadingKey = '';

    function vc5632mMergeById(local, incoming) {
        const map = new Map();
        (Array.isArray(local) ? local : []).forEach(item => { if (item && item.id) map.set(item.id, item); });
        (Array.isArray(incoming) ? incoming : []).forEach(item => {
            if (!item || !item.id) return;
            const pending = Array.isArray(offlineQueue) && offlineQueue.some(task => task && task.data && task.data.id === item.id);
            if (!pending) map.set(item.id, item);
        });
        return Array.from(map.values());
    }

    function currentRangeForPeriod(period) {
        if (period === 'month' && typeof vc5632lMonthBounds === 'function') return vc5632lMonthBounds();
        if (period === 'range') {
            const start = document.getElementById('insight-start-date')?.value;
            const end = document.getElementById('insight-end-date')?.value;
            if (start && end) return { start, end };
        }
        return null;
    }

    async function loadPeriodFromCloud(period, reason) {
        if (!navigator.onLine || typeof queryCollectionWithFirestoreRest !== 'function') return false;
        const bounds = currentRangeForPeriod(period);
        if (!bounds) return false;
        const key = period + ':' + bounds.start + ':' + bounds.end;
        const now = Date.now();
        if (loadingKey === key) return false;
        if (loadedRanges[key] && now - loadedRanges[key] < 5 * 60 * 1000) return false;
        loadingKey = key;
        try {
            const [transactions, businessDays] = await Promise.all([
                queryCollectionWithFirestoreRest('transactions', [
                    { field: 'businessDate', op: 'GREATER_THAN_OR_EQUAL', value: bounds.start },
                    { field: 'businessDate', op: 'LESS_THAN_OR_EQUAL', value: bounds.end }
                ], 1500),
                queryCollectionWithFirestoreRest('businessDays', [
                    { field: 'date', op: 'GREATER_THAN_OR_EQUAL', value: bounds.start },
                    { field: 'date', op: 'LESS_THAN_OR_EQUAL', value: bounds.end }
                ], 120)
            ]);
            state.transactions = vc5632mMergeById(state.transactions || [], transactions)
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            state.businessDays = vc5632mMergeById(state.businessDays || [], businessDays);
            loadedRanges[key] = Date.now();
            if (typeof sync === 'function') sync();
            if (typeof renderLedger === 'function') renderLedger();
            if (typeof renderInsights === 'function') renderInsights();
            if (typeof updateSyncUI === 'function') updateSyncUI();
            return true;
        } catch (error) {
            console.warn('Insights period cloud load failed', reason, error);
            syncErrorMsg = error.message || String(error);
            if (typeof updateSyncUI === 'function') updateSyncUI();
            return false;
        } finally {
            loadingKey = '';
        }
    }

    const oldSwitchInsightPeriod = typeof switchInsightPeriod === 'function' ? switchInsightPeriod : null;
    if (oldSwitchInsightPeriod) {
        switchInsightPeriod = function(period) {
            const result = oldSwitchInsightPeriod.apply(this, arguments);
            if (period === 'month' || period === 'range') {
                setTimeout(() => loadPeriodFromCloud(period, 'switchInsightPeriod'), 50);
            }
            return result;
        };
    }

    ['insight-start-date', 'insight-end-date'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
            if (typeof insightPeriod !== 'undefined' && insightPeriod === 'range') {
                loadPeriodFromCloud('range', 'range-date-change');
            }
        });
    });

    window.vc5632mLoadInsightPeriodFromCloud = loadPeriodFromCloud;
})();


// v7.2.14: Correct Cash Received and default Ledger to Today.
(function(){
    if (window.__vc5632nCashReceivedAndLedgerDefault) return;
    window.__vc5632nCashReceivedAndLedgerDefault = true;

    function isSettlement(tx) {
        if (!tx) return false;
        const notes = String(tx.notes || '').toUpperCase();
        const id = String(tx.id || '').toUpperCase();
        return !!(
            tx.settlementFor ||
            tx.creditRef ||
            tx.relatedCreditId ||
            notes.includes('CR-') ||
            notes.includes('PARTIAL:') ||
            notes.includes('SETTLEMENT') ||
            notes.includes('PAID CREDIT') ||
            (id.startsWith('SA-') && notes.includes('CR-'))
        );
    }

    function periodTransactions() {
        if (typeof vc531PeriodTransactions === 'function') {
            try { return vc531PeriodTransactions(); } catch (_) {}
        }
        if (typeof getPeriodTransactions === 'function') {
            try { return getPeriodTransactions(); } catch (_) {}
        }
        return Array.isArray(state.transactions) ? state.transactions : [];
    }

    function cashReceivedForPeriod() {
        const tx = (periodTransactions() || []).filter(t => t && t.id);
        const cashSales = tx
            .filter(t => t.type === 'SA' && !isSettlement(t) && t.paid !== false)
            .reduce((sum, t) => sum + Number(t.total || 0), 0);
        const collections = tx
            .filter(isSettlement)
            .reduce((sum, t) => sum + Number(t.total || t.cashReceived || 0), 0);
        return cashSales + collections;
    }

    function peso(value) {
        return '₱' + (Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function correctCashReceivedCard() {
        const el = document.getElementById('biz-cash-in');
        if (!el) return;
        const value = peso(cashReceivedForPeriod());
        if (el.innerText !== value) el.innerText = value;
    }

    function defaultLedgerDateToToday() {
        const select = document.getElementById('vc5629-ledger-date');
        if (!select) return;
        if (!select.dataset.vcDefaultedToday) {
            select.value = 'today';
            select.dataset.vcDefaultedToday = '1';
        }
    }

    const oldRenderInsights = typeof renderInsights === 'function' ? renderInsights : null;
    if (oldRenderInsights) {
        renderInsights = function() {
            const result = oldRenderInsights.apply(this, arguments);
            correctCashReceivedCard();
            return result;
        };
    }

    setTimeout(function(){
        defaultLedgerDateToToday();
        correctCashReceivedCard();
    }, 300);
})();


// v7.2.14: Inventory cloud reconcile.
// Inventory is small, so do an independent inventory refresh that cannot be
// blocked by transaction/businessDay scoped queries. Applies to tablet + phone.
(function(){
    if (window.__vc5632qInventoryCloudReconcile) return;
    window.__vc5632qInventoryCloudReconcile = true;

    let lastInventoryReconcileAt = 0;
    let inventoryReconciling = false;

    function pendingInventoryIds() {
        return new Set((Array.isArray(offlineQueue) ? offlineQueue : [])
            .filter(task => task && task.table === 'inventory' && task.data && task.data.id)
            .map(task => task.data.id));
    }

    async function reconcileInventoryFromCloud(reason, options = {}) {
        if (!navigator.onLine || inventoryReconciling) return false;
        if (typeof readCollectionWithFirestoreRest !== 'function') return false;
        const now = Date.now();
        const force = !!options.force;
        if (!force && now - lastInventoryReconcileAt < 5 * 60 * 1000) return false;

        inventoryReconciling = true;
        lastInventoryReconcileAt = now;
        try {
            const cloud = await readCollectionWithFirestoreRest('inventory');
            const pending = pendingInventoryIds();
            const merged = new Map();

            // Firestore is the source for synced inventory.
            (Array.isArray(cloud) ? cloud : [])
                .filter(item => item && item.id && !pending.has(item.id))
                .forEach(item => merged.set(item.id, item));

            // Keep local pending edits/deletes from being overwritten before sync.
            (Array.isArray(state.inventory) ? state.inventory : [])
                .filter(item => item && item.id && (item._offline || pending.has(item.id)))
                .forEach(item => merged.set(item.id, item));

            state.inventory = Array.from(merged.values())
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

            if (typeof sync === 'function') sync();
            if (typeof renderInventory === 'function') renderInventory();
            if (typeof renderFavorites === 'function') renderFavorites();
            if (typeof renderPOS === 'function') renderPOS();
            if (typeof updateSyncUI === 'function') updateSyncUI();
            return true;
        } catch (error) {
            console.warn('Inventory cloud reconcile failed', reason, error);
            syncErrorMsg = error.message || String(error);
            if (typeof updateSyncUI === 'function') updateSyncUI();
            return false;
        } finally {
            inventoryReconciling = false;
        }
    }

    window.vc5632qReconcileInventoryFromCloud = reconcileInventoryFromCloud;

    window.refreshStockFromCloud = async function() {
        const btn = document.getElementById('refresh-stock-btn');
        const oldText = btn ? btn.innerHTML : '';
        try {
            if (btn) {
                btn.disabled = true;
                btn.classList.add('opacity-60');
                btn.innerHTML = '<span class="material-symbols-outlined text-[20px] animate-spin">refresh</span><span>Refreshing</span>';
            }
            const ok = await reconcileInventoryFromCloud('manual-refresh-stock', { force: true });
            if (typeof showToast === 'function') showToast(ok ? 'Stock refreshed from cloud' : 'Stock refresh skipped', ok ? 'success' : 'info');
            return ok;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-60');
                btn.innerHTML = oldText || '<span class="material-symbols-outlined text-[20px]">sync</span><span>Refresh Stock</span>';
            }
        }
    };
})();






