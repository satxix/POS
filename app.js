// --- Firebase Configuration ---
    // SECURITY NOTE: Restrict API keys to your GitHub Pages domain in Firebase Console > API restrictions.
    // Normal URL uses live Firestore. Add ?env=test to use the sandbox Firebase project.
    window.VILLACART_APP_VERSION = 'v8.3.5';
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
        { name: 'Tan', value: '#E6D1B3' }
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

    function nextTransactionId(type) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(-2);
        const dateCode = dd + mm + yy;
        const counterKey = APP_ENV === 'test' ? 'dailyCounters_test' : 'dailyCounters';
        let counters = safeLocalJson(counterKey, {}, 'daily counters');
        if (!counters || typeof counters !== 'object' || Array.isArray(counters)) counters = {};
        counters[dateCode] = counters[dateCode] || { SA: 0, CR: 0, EX: 0 };
        counters[dateCode][type] = (counters[dateCode][type] || 0) + 1;
        localStorage.setItem(counterKey, JSON.stringify(counters));
        const seq = String(counters[dateCode][type]).padStart(3, '0');
        return `${type}-${dateCode}-${seq}`;
    }

    function setupRealTimeSync() {
        vcStartupMark('setup-realtime-sync-start');
        if (inventoryUnsubscribe) inventoryUnsubscribe();
        if (transactionsUnsubscribe) transactionsUnsubscribe();
        if (businessDaysUnsubscribe) businessDaysUnsubscribe();

        // v7.2.14: Inventory is local-first/manual-refresh.
        // Do not keep a full inventory realtime listener open; it reads the
        // whole inventory collection on startup and reconnection. Product
        // add/edit/delete/restock writes still sync automatically through
        // queueAction/syncNow. Pull cloud changes with Refresh Stock.
        inventoryUnsubscribe = null;

        const vc5632lBounds = typeof vc5632mTodayBounds === 'function' ? vc5632mTodayBounds() : (typeof vc5632lMonthBounds === 'function' ? vc5632lMonthBounds() : null);
        let vc5632lTxQuery = db.collection('transactions');
        if (vc5632lBounds) {
            vc5632lTxQuery = vc5632lTxQuery
                .where('businessDate', '>=', vc5632lBounds.start)
                .where('businessDate', '<=', vc5632lBounds.end);
        }
        transactionsUnsubscribe = vc5632lTxQuery.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
            // Only hide a transaction while its delete request is still queued.
            // A permanent local "deleted IDs" list hid real Firestore records
            // (for example SA-260626-009) after a failed delete.
            const pendingDeleteIds = new Set(
                offlineQueue
                    .filter(q => q.table === 'transactions' && q.type === 'delete' && q.data && q.data.id)
                    .map(q => q.data.id)
            );
            const cloudTrans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(t => !pendingDeleteIds.has(t.id));
            
            const offlineIds = new Set(offlineQueue.filter(q => q.table === 'transactions').map(q => q.data.id));
            
            const filteredCloudTrans = cloudTrans.filter(t => !offlineIds.has(t.id));
            const activeOfflineTrans = state.transactions.filter(t => t._offline && offlineIds.has(t.id));
            
            const mergedMap = new Map();
            filteredCloudTrans.forEach(t => mergedMap.set(t.id, t));
            activeOfflineTrans.forEach(t => mergedMap.set(t.id, t));
            
            (state.transactions || [])
                .filter(t => t && t.id && typeof vc5632mInDateRange === 'function' && !vc5632mInDateRange(t, vc5632lBounds))
                .forEach(t => mergedMap.set(t.id, t));
            state.transactions = Array.from(mergedMap.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            updateLastSyncedTime();
            sync();
            renderLedger();
            renderInsights();
            if (typeof vc531RefreshInsights === 'function') vc531RefreshInsights();
            if (typeof vc531RefreshBusinessCalendarSafe === 'function') vc531RefreshBusinessCalendarSafe();
            if (offlineQueue.length === 0) syncErrorMsg = null;
            updateSyncUI();
        }, (error) => {
            syncErrorMsg = error.message;
            updateSyncUI();
        });

        const vc5632pDayBounds = typeof vc5632mTodayBounds === 'function' ? vc5632mTodayBounds() : null;
        let vc5632pBusinessDaysQuery = db.collection('businessDays');
        if (vc5632pDayBounds) {
            vc5632pBusinessDaysQuery = vc5632pBusinessDaysQuery
                .where('date', '>=', vc5632pDayBounds.start)
                .where('date', '<=', vc5632pDayBounds.end);
        }
        businessDaysUnsubscribe = vc5632pBusinessDaysQuery.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
            const cloudDays = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const offlineIds = new Set(offlineQueue.filter(q => q.table === 'businessDays').map(q => q.data.id));

            // Preserve local older days and pending/offline day changes. The
            // realtime listener is scoped to today; Month/Range loads older days
            // on demand together with their transactions.
            const localDays = Array.isArray(state.businessDays) ? state.businessDays : [];
            const merged = new Map();
            localDays.forEach(bd => { if (bd && bd.id) merged.set(bd.id, bd); });
            cloudDays
                .filter(bd => bd && bd.id && !offlineIds.has(bd.id))
                .forEach(bd => merged.set(bd.id, bd));

            state.businessDays = Array.from(merged.values());
            const today = vc5632pDayBounds ? vc5632pDayBounds.start : new Date().toISOString().slice(0, 10);
            const open = state.businessDays
                .filter(bd => bd && bd.status === 'OPEN' && (bd.date === today || !bd.date))
                .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))[0];
            state.currentBusinessDayId = open ? open.id : null;
            sync();
            updateBusinessDayUI();
            renderBusinessCalendar && renderBusinessCalendar();
        }, (error) => {
            syncErrorMsg = error.message;
            updateSyncUI();
        });

        // A reload while already online does not fire an `online` event. Drain
        // any saved work immediately instead of waiting for another sale/edit.
        if (navigator.onLine && offlineQueue.length > 0) setTimeout(syncNow, 0);

        // Realtime listeners already load today's transactions/business day.
        // Avoid an extra REST hydrate on every startup; it can hang on weak
        // networks and adds reads. Keep it only for a truly empty local state.
        const needsStartupHydrate =
            !(Array.isArray(state.transactions) && state.transactions.length) ||
            !(Array.isArray(state.businessDays) && state.businessDays.length);
        if (navigator.onLine && needsStartupHydrate) {
            setTimeout(() => hydrateInitialStateFromRest(), 900);
            vcStartupMark('hydrate-rest-scheduled-empty-local');
        } else {
            vcStartupMark('hydrate-rest-skipped-local-ready', {
                localTransactions: Array.isArray(state.transactions) ? state.transactions.length : null,
                localBusinessDays: Array.isArray(state.businessDays) ? state.businessDays.length : null
            });
        }
        vcStartupMark('setup-realtime-sync-complete');
    }

    async function hydrateInitialStateFromRest() {
        vcStartupMark('hydrate-rest-start');
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

            const pending = (table) => new Set(offlineQueue.filter(task => task.table === table && task.data && task.data.id).map(task => task.data.id));
            const merge = (server, local, table) => {
                const pendingIds = pending(table);
                const merged = new Map(server.filter(item => !pendingIds.has(item.id)).map(item => [item.id, item]));
                local.filter(item => item && item._offline && pendingIds.has(item.id)).forEach(item => merged.set(item.id, item));
                return Array.from(merged.values());
            };

            // Inventory stays local-first until Refresh Stock is tapped.
            const localOldTransactions = (state.transactions || []).filter(t => t && typeof vc5632mInDateRange === 'function' && !vc5632mInDateRange(t, bounds));
            const localOldBusinessDays = (state.businessDays || []).filter(day => day && typeof vc5632mInDateRange === 'function' && !vc5632mInDateRange(day, bounds));
            state.transactions = [...merge(transactions, state.transactions || [], 'transactions'), ...localOldTransactions]
                .filter((item, idx, arr) => item && item.id && arr.findIndex(other => other && other.id === item.id) === idx)
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            state.businessDays = [...merge(businessDays, state.businessDays || [], 'businessDays'), ...localOldBusinessDays]
                .filter((item, idx, arr) => item && item.id && arr.findIndex(other => other && other.id === item.id) === idx);
            const openDay = state.businessDays.find(day => day.status === 'OPEN');
            state.currentBusinessDayId = openDay ? openDay.id : null;

            sync();
            renderInventory();
            renderFavorites();
            renderLedger();
            renderInsights();
            updateBusinessDayUI();
            syncErrorMsg = null;
            updateSyncUI();
            vcStartupMark('hydrate-rest-complete', {
                localInventory: Array.isArray(state.inventory) ? state.inventory.length : null,
                localTransactions: Array.isArray(state.transactions) ? state.transactions.length : null,
                localBusinessDays: Array.isArray(state.businessDays) ? state.businessDays.length : null
            });
        } catch (error) {
            console.error('Initial Firestore REST load failed', error);
            syncErrorMsg = error.message || String(error);
            updateSyncUI();
            vcStartupMark('hydrate-rest-failed', { error: syncErrorMsg });
        }
    }

    function troubleshootConnection() {
        showToast("Refreshing local view...", "info");

        // Lightweight troubleshooting: refresh visible screens and queue/sync
        // indicators without restarting Firestore realtime listeners. This avoids
        // accidental extra Firestore reads. Use Diagnostics > Load Firestore only
        // when a true cloud reload is needed.
        try { if (typeof sync === 'function') sync(); } catch(e) { console.warn(e); }
        try { if (typeof updateQueueBadge === 'function') updateQueueBadge(); } catch(e) { console.warn(e); }
        try { if (typeof updateSyncUI === 'function') updateSyncUI(); } catch(e) { console.warn(e); }
        try { if (typeof renderLedger === 'function') renderLedger(); } catch(e) { console.warn(e); }
        try { if (typeof renderInventory === 'function') renderInventory(); } catch(e) { console.warn(e); }
        try { if (typeof renderInsights === 'function') renderInsights(); } catch(e) { console.warn(e); }
        try { if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar(); } catch(e) { console.warn(e); }

        const queueCount = Array.isArray(offlineQueue) ? offlineQueue.length : 0;
        setTimeout(() => {
            showToast(`Local refresh complete. Queue: ${queueCount}`, queueCount ? "warning" : "success");
        }, 350);
    }

    function showSyncInfo() {
        const status = navigator.onLine ? "ONLINE" : "OFFLINE";
        const msg = syncErrorMsg ? `LAST ERROR: ${syncErrorMsg}` : `All systems functional. Queue: ${offlineQueue.length} items.`;
        alert(`Cloud Connection Status: ${status}\n\n${msg}\n\nSync Engine: Robust Direct-Sync v5.6.1`);
    }

    function updateLastSyncedTime() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateText = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const tsEl = document.getElementById('sync-timestamp');
        if (tsEl) tsEl.innerText = `Today • ${dateText} • Last Synced: ${timeStr}`;
    }


    function saveLocalArchive() {
        try {
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify({
                transactions: Array.isArray(state.archiveTransactions) ? state.archiveTransactions : [],
                businessDays: Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays : [],
                gcashRecords: Array.isArray(state.archiveGcashRecords) ? state.archiveGcashRecords : [],
                meta: state.archiveMeta && typeof state.archiveMeta === 'object' ? state.archiveMeta : {},
                savedAt: new Date().toISOString()
            }));
        } catch(e) {}
    }

    function sync() { 
        const stateForStorage = { ...state };
        // Archive data has its own local-only storage key. Keeping it out of the
        // main operational state reduces startup/localStorage weight and makes
        // the boundary clear: archive data is never part of Firestore sync.
        delete stateForStorage.archiveTransactions;
        delete stateForStorage.archiveBusinessDays;
        delete stateForStorage.archiveGcashRecords;
        delete stateForStorage.archiveMeta;
        localStorage.setItem(DB_KEY, JSON.stringify(stateForStorage)); 
        offlineQueue = offlineQueue.filter(task => task && isFirestoreSyncTable(task.table) && task.data && task.data.id && !isArchiveOnlyRecord(task.data));
        localStorage.setItem(QUEUE_KEY, JSON.stringify(offlineQueue));
        localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites));
        saveLocalArchive();
        updateQueueBadge();
    }

    async function firestoreRestAuthHeaders(extraHeaders = {}) {
        const headers = { ...extraHeaders };
        try {
            const user = await authReadyPromise;
            const currentUser = user || (auth && auth.currentUser);
            if (currentUser && typeof currentUser.getIdToken === 'function') {
                headers.Authorization = 'Bearer ' + await currentUser.getIdToken();
            }
        } catch (error) {
            console.warn('Unable to attach Firebase Auth token to REST request:', error);
        }
        return headers;
    }

    async function readCollectionWithFirestoreRest(collection) {
        const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}?pageSize=300&key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const documents = [];
        let pageToken = '';
        const headers = await firestoreRestAuthHeaders();

        do {
            const url = pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
            const response = await fetch(url, { headers });
            if (!response.ok) throw new Error(`Firestore REST ${response.status}: ${(await response.text()).slice(0, 240)}`);
            const payload = await response.json();
            documents.push(...(payload.documents || []));
            pageToken = payload.nextPageToken || '';
        } while (pageToken);

        return documents.map(document => {
            const docId = document.name.split('/').pop();
            const data = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreRestToValue(value)]));
            return { ...data, id: docId };
        });
    }


    async function queryCollectionWithFirestoreRest(collection, filters = [], limit = 500) {
        const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents:runQuery?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const fieldFilters = filters.map(filter => ({
            fieldFilter: {
                field: { fieldPath: filter.field },
                op: filter.op,
                value: firestoreRestValue(filter.value)
            }
        }));
        const where = fieldFilters.length === 0 ? undefined
            : fieldFilters.length === 1 ? fieldFilters[0]
            : { compositeFilter: { op: 'AND', filters: fieldFilters } };
        const body = {
            structuredQuery: {
                from: [{ collectionId: collection }],
                ...(where ? { where } : {}),
                limit
            }
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: await firestoreRestAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`Firestore query REST ${response.status}: ${(await response.text()).slice(0, 240)}`);
        const payload = await response.json();
        return payload
            .map(row => row.document)
            .filter(Boolean)
            .map(document => {
                const docId = document.name.split('/').pop();
                const data = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreRestToValue(value)]));
                return { ...data, id: docId };
            });
    }

    async function syncTaskWithFirestoreRest(task) {
        if (!task || !isFirestoreSyncTable(task.table) || !task.data || !task.data.id || isArchiveOnlyRecord(task.data)) {
            throw new Error('Blocked non-operational Firestore sync task');
        }
        const projectId = firebaseConfig.projectId;
        const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(task.table)}/${encodeURIComponent(task.data.id)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const options = { method: task.type === 'delete' ? 'DELETE' : 'PATCH', headers: await firestoreRestAuthHeaders() };
        if (task.type !== 'delete') {
            const data = { ...task.data };
            delete data.id;
            delete data._offline;
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreRestValue(value)])) });
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Firestore REST ${response.status}: ${body.slice(0, 240)}`);
        }
    }

    async function syncNow() {
        if (!navigator.onLine || isSyncing || offlineQueue.length === 0) return;
        isSyncing = true;
        updateSyncUI();
        
        const failedIndices = [];
        const syncedTasks = [];

        try {
            for (let i = 0; i < offlineQueue.length; i++) {
                const task = offlineQueue[i];
                const col = task.table;
                const id = task.data.id;
                const data = { ...task.data };
                delete data._offline;

                try {
                    if (task.type === 'delete') {
                        await firestoreWriteWithTimeout(syncTaskWithFirestoreRest(task));
                    } else {
                        await firestoreWriteWithTimeout(syncTaskWithFirestoreRest(task));
                    }
                    syncedTasks.push(task);
                } catch (e) {
                    console.error(`Sync item ${id} failed:`, e);
                    failedIndices.push(i);
                    syncErrorMsg = e.message;
                }
            }
            
            offlineQueue = offlineQueue.filter((_, idx) => failedIndices.includes(idx));
            syncedTasks.forEach(markSyncedTaskLocally);
            sync();
            
            if (failedIndices.length === 0) {
                showToast("Cloud sync complete", "success");
                syncErrorMsg = null;
            } else {
                showToast(`Sync partial: ${failedIndices.length} failed`, "error");
                // Leave failed work queued for the next deliberate sync event.
                // Retrying every few seconds caused a runaway write loop.
            }
        } catch (err) {
            console.error("Critical sync loop error:", err);
            syncErrorMsg = err.message;
        } finally {
            isSyncing = false;
            updateSyncUI();
            renderLedger(); 
            renderInsights();
            if (typeof renderGcashScreen === 'function') renderGcashScreen();
        }
    }

    function markSyncedTaskLocally(task) {
        if (!task || !task.table || !task.data || !task.data.id) return;
        const list = task.table === 'transactions' ? state.transactions
            : task.table === 'inventory' ? state.inventory
            : task.table === 'businessDays' ? state.businessDays
            : task.table === 'gcashRecords' ? state.gcashRecords
            : null;
        if (!Array.isArray(list)) return;
        const idx = list.findIndex(item => item && item.id === task.data.id);
        if (task.type === 'delete') {
            if (idx !== -1) list.splice(idx, 1);
            return;
        }
        if (idx !== -1) {
            delete list[idx]._offline;
        }
    }

    async function directSync(table, data) {
        // Keep older feature code compatible, but route all writes through the
        // durable queue/REST sync path. Direct SDK writes can be masked by the
        // browser's local Firestore cache and were the source of inconsistent
        // "saved in app but not in Firestore Console" behavior.
        if (!data || !data.id) return false;
        const cleanData = { ...data, _offline: true };
        const list = table === 'transactions' ? state.transactions
            : table === 'inventory' ? state.inventory
            : table === 'businessDays' ? state.businessDays
            : table === 'gcashRecords' ? state.gcashRecords
            : null;
        if (Array.isArray(list)) {
            const idx = list.findIndex(item => item && item.id === cleanData.id);
            if (idx !== -1) list[idx] = cleanData;
            else list.unshift(cleanData);
        }
        queueAction('update', table, cleanData);
        return true;
    }

    function queueAction(type, table, data) {
        if (!data || !data.id) return; 
        if (!isFirestoreSyncTable(table) || isArchiveOnlyRecord(data)) {
            console.warn('Blocked non-operational sync queue item:', { type, table, id: data && data.id });
            return;
        }
        const task = { type, table, data, ts: Date.now() };
        // Keep exactly one pending operation per document.  Apart from avoiding
        // duplicate writes, this is important when a product is edited and then
        // deleted before a slow/offline connection has caught up: the deletion
        // must be the last (and only) operation sent to Firestore.
        const existingIndex = offlineQueue.findIndex(q => q.table === table && q.data && q.data.id === data.id);
        if (existingIndex !== -1) offlineQueue.splice(existingIndex, 1);
        offlineQueue.push(task);
        sync();
        if (navigator.onLine) syncNow();
    }

    function queueTransaction(transaction) {
        if (!transaction || !transaction.id) return;
        // v5.6.1 CORE BUSINESS DAY ATTACHMENT
        // This is inside queueTransaction itself so every transaction type is linked before local save and Firestore sync.
        if (typeof ensureBusinessDayForTransaction === 'function') {
            ensureBusinessDayForTransaction(transaction);
        }
 
        transaction._offline = true;
        
        const exists = state.transactions.findIndex(t => t.id === transaction.id);
        if (exists !== -1) state.transactions[exists] = transaction;
        else state.transactions.unshift(transaction);
        
        // Transactions must always be durable locally before attempting the
        // cloud write. A direct request can remain pending indefinitely, which
        // previously left a sale in the ledger but absent from Firestore.
        queueAction('new_transaction', 'transactions', transaction);
        
        const isSettlement = transaction.notes && transaction.notes.includes('CR-');
        
        if (transaction.items && transaction.items.length > 0 && (transaction.id.startsWith('SA-') || transaction.id.startsWith('CR-')) && !isSettlement) {
            transaction.items.forEach(item => {
                const p = state.inventory.find(inv => inv.id === item.id);
                if (p) {
                    p.stock -= (item.qty * (item.deduct || 1));
                    p._offline = true; 
                    queueAction('update', 'inventory', p);
                }
            });
            if (typeof renderFavorites === 'function') renderFavorites();
        }
        sync();
    }

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

    // v8.3.0: Favorites UI moved to favorites.js.
    // v8.3.0: Status/nav UI helpers moved to status-ui.js.


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
        if (id === 'pos') renderFavorites();
    }

    // v8.3.0: PWA resume/print-return repaint helpers moved to pwa-lifecycle.js.

    // v8.3.0: PIN modal helpers moved to ui-core.js.
    // v8.3.0: Cart and payment UI moved to cart.js. Sale commit remains in confirmSale().
    function confirmSale() {
        if (document.activeElement) document.activeElement.blur();
        const subtotal = getCartSubtotal();
        const discount = getCartDiscount();
        const total = getCartTotal();
        const cashVal = parseFloat(document.getElementById('cash-input').value) || 0;
        const type = currentPayMode === 'cash' ? 'SA' : 'CR';
        const id = nextTransactionId(type);
        const customer = document.getElementById('credit-customer').value;
        if (type === 'CR' && !customer) { showToast('Customer name required', 'error'); return; }
        if (type === 'SA' && cashVal < total) { showToast('Insufficient cash', 'error'); return; }
        const stockIssue = getCartStockIssue();
        if (stockIssue) { showToast(stockIssue, 'error'); return; }
        
        const transaction = { 
            id, 
            type, 
            total, 
            subtotal,
            discount,
            discountType: discount > 0 ? 'amount' : null,
            timestamp: new Date().toISOString(), 
            items: JSON.parse(JSON.stringify(state.cart)), 
            customer: customer ? customer.trim() : null, 
            paid: (type === 'SA'), 
            cashReceived: cashVal, 
            change: type === 'SA' ? (cashVal - total) : 0,
            notes: "" 
        };
        
        // v5.6.1: Ensure every new transaction is linked to a business day before syncing.
        if (typeof attachBusinessDayToTransaction === 'function') {
            attachBusinessDayToTransaction(transaction);
        }

        queueTransaction(transaction);
        lastTransactionId = id; state.cart = []; resetCartDiscount(); updateCartUI(); closeModal('review-modal'); document.getElementById('mod-success').classList.replace('hidden', 'flex');
    }

    // v8.3.0: Product add/edit/delete helpers moved to product.js.

    // v8.3.0: Stock screen rendering/search/mute UI moved to stock-ui.js. Product writes are in product.js.
    // v8.3.3: Base Ledger renderer and credit-payment actions moved to ledger.js.


    // v8.3.0: GCash screen logic moved to gcash.js.

    // v8.3.0: Expense modal/save logic moved to expenses.js.

    // v8.3.2: Base Insights period/render/chart helpers moved to insights-base.js.

    // v8.3.0: Receipt print/share UI moved to receipt-ui.js.
    // v8.3.0: Sales CSV export moved to sales-export.js.

    // v8.3.0: Transaction detail modal moved to transaction-detail.js.

    // v8.3.0: Receipt transaction print shortcut moved to receipt-ui.js.
    function confirmDeleteTransaction() { if (document.activeElement) document.activeElement.blur(); if (!lastTransactionId) return; openPinModal({ action: 'delete', id: lastTransactionId }); }
    
    async function deleteTransaction(id) {
        if (document.activeElement) document.activeElement.blur();
        const tx = state.transactions.find(t => t.id === id); if (!tx) return;
        const isSettlement = tx.notes && tx.notes.includes('CR-');
        if (tx.items && (tx.id.startsWith('SA-') || tx.id.startsWith('CR-')) && !isSettlement && tx.type !== 'EX') {
            tx.items.forEach(item => { 
                const p = state.inventory.find(inv => inv.id === item.id); 
                if (p) { p.stock += (item.qty * (item.deduct || 1)); p._offline = true; queueAction('update', 'inventory', p); } 
            });
        }
        state.transactions = state.transactions.filter(t => t.id !== id); 
        queueAction('delete', 'transactions', { id }); 
        sync(); renderInventory(); renderLedger(); renderInsights(); closeModal('mod-tx'); showToast('Voided', 'success');
    }

    // v8.3.0: Receipt modal rendering moved to receipt-ui.js.
    // v8.3.0: Success modal close helper moved to receipt-ui.js.
    // v8.3.0: Modal/toast/pack UI helpers moved to ui-core.js.
    
    // v8.3.0: Notifications UI moved to notifications.js.
    // --- Inventory Export ---
    // v8.3.0: Stock camera scanner helper moved to camera-scanner.js. Terminal camera scanner removed; physical scanner remains.

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


    // v8.3.0: Payment modal UI polish moved to payment-ui.js.

    // v8.3.1: Dashboard and closing-summary helpers moved to reporting-ui.js.

    const vcOriginalRenderInsightsBiz = typeof renderInsights === 'function' ? renderInsights : null;
    if (vcOriginalRenderInsightsBiz && !window.__vcRenderInsightsBizPatched) {
        window.__vcRenderInsightsBizPatched = true;
        renderInsights = function() {
            vcOriginalRenderInsightsBiz();
            updateBusinessDashboardCards();
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

    const vcOriginalRenderInsights513 = typeof renderInsights === 'function' ? renderInsights : null;
    if (vcOriginalRenderInsights513 && !window.__vcRenderInsights513Patched) {
        window.__vcRenderInsights513Patched = true;
        renderInsights = function() {
            vcOriginalRenderInsights513();
            forceUpdateInsightsNumbersFromTransactions();
        };
    }

    // v5.6.1 Delete Transaction Modal Fix
    function closeTransactionDetailScreensAfterDelete() {
        ['tx-detail-modal','transaction-detail-modal','receipt-modal','mod-tx-details','transaction-modal'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                el.classList.add('hidden');
                el.classList.remove('flex');
            }
        });
        setTimeout(() => {
            if (typeof renderLedger === 'function') renderLedger();
            if (typeof renderInsights === 'function') renderInsights();
        }, 80);
    }

    ['deleteTransaction','voidTransaction','deleteTx','voidTx'].forEach(fnName => {
        const original = window[fnName];
        if (typeof original === 'function' && !window[`__vc_${fnName}_patched513`]) {
            window[`__vc_${fnName}_patched513`] = true;
            window[fnName] = function(...args) {
                const result = original.apply(this, args);
                closeTransactionDetailScreensAfterDelete();
                return result;
            };
        }
    });


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

    const vcOriginalRenderInsights526 = typeof renderInsights === 'function' ? renderInsights : null;
    if (vcOriginalRenderInsights526 && !window.__vcRenderInsights526Patched) {
        window.__vcRenderInsights526Patched = true;
        renderInsights = function() {
            vcOriginalRenderInsights526();
            setTimeout(vc526PolishCreditDashboardLabels, 0);
        };
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
    const VC_DEV_DELETE_MODE = true;

    function vc530DeletedSet() {
        return new Set();
    }

    function vc530SaveDeletedSet(set) {
        try { localStorage.removeItem('villacart_deleted_transactions'); } catch(e) {}
    }

    function vc530Norm(value) {
        return String(value || '').trim().toUpperCase();
    }

    function vc530IsSettlement(t) {
        if (!t) return false;
        const id = vc530Norm(t.id);
        const type = vc530Norm(t.type);
        const notes = vc530Norm(t.notes);
        return !!(
            t.settlementFor ||
            t.creditRef ||
            t.relatedCreditId ||
            (type === 'SA' && notes.includes('CR-')) ||
            (id.startsWith('SA-') && notes.includes('CR-')) ||
            notes.includes('SETTLEMENT') ||
            notes.includes('PAID CREDIT')
        );
    }

    function vc530CreditIdFromSettlement(t) {
        if (!t) return null;
        if (t.settlementFor) return t.settlementFor;
        if (t.creditRef) return t.creditRef;
        if (t.relatedCreditId) return t.relatedCreditId;
        const notes = String(t.notes || '');
        const match = notes.match(/CR-[A-Z0-9-]+/i);
        return match ? match[0].toUpperCase() : null;
    }

    function vc530IsCreditSale(t) {
        return !!t && vc530Norm(t.type) === 'CR' && !vc530IsSettlement(t);
    }

    function vc530CleanTransactions() {
        const deleted = vc530DeletedSet();
        return (state.transactions || []).filter(t => t && t.id && !deleted.has(t.id));
    }

    function vc530FindTransaction(id) {
        return (state.transactions || []).find(t => t && t.id === id) || null;
    }

    function vc530FindSettlementForCredit(creditId) {
        if (!creditId) return null;
        const target = vc530Norm(creditId);
        return vc530CleanTransactions()
            .filter(vc530IsSettlement)
            .find(t => vc530Norm(vc530CreditIdFromSettlement(t)) === target || vc530Norm(t.notes).includes(target));
    }

    function vc530CreditIsSettled(creditTx) {
        if (!creditTx) return false;
        if (creditTx.paid === true || creditTx.settled === true) return true;
        const status = vc530Norm(creditTx.status);
        if (status === 'PAID' || status === 'SETTLED') return true;
        if (Number(creditTx.balance) === 0 || Number(creditTx.balanceDue) === 0 || Number(creditTx.remaining) === 0) return true;
        return !!vc530FindSettlementForCredit(creditTx.id);
    }

    function vc530MarkCreditOpen(creditId) {
        const credit = vc530FindTransaction(creditId);
        if (!credit) return;
        credit.paid = false;
        credit.settled = false;
        credit.status = 'OPEN';
        if (credit.balance !== undefined) credit.balance = Number(credit.total) || 0;
        if (credit.balanceDue !== undefined) credit.balanceDue = Number(credit.total) || 0;
        if (credit.remaining !== undefined) credit.remaining = Number(credit.total) || 0;

        credit._offline = true;
        if (typeof queueAction === 'function') queueAction('update', 'transactions', credit);
    }

    function vc530RestockTransactionItems(tx) {
        if (!tx || !tx.items || tx.type === 'EX' || vc530IsSettlement(tx)) return;
        if (!(String(tx.id || '').startsWith('SA-') || String(tx.id || '').startsWith('CR-'))) return;

        tx.items.forEach(item => {
            const p = (state.inventory || []).find(inv => inv.id === item.id);
            if (p) {
                p.stock += (Number(item.qty) || 0) * (Number(item.deduct) || 1);
                p._offline = true;
                if (typeof queueAction === 'function') queueAction('update', 'inventory', p);
            }
        });
    }

    async function vc530DeleteFromCloud(id) {
        if (typeof queueAction === 'function') queueAction('delete', 'transactions', { id });
    }

    function vc530CloseTransactionModals() {
        [
            'mod-tx','pin-modal','receipt-modal','tx-detail-modal','transaction-detail-modal',
            'mod-tx-details','transaction-modal','void-modal','confirm-modal'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('hidden');
                el.classList.remove('flex');
            }
        });
    }

    function vc530RefreshAll() {
        if (typeof sync === 'function') sync();
        if (typeof renderInventory === 'function') renderInventory();
        if (typeof renderLedger === 'function') renderLedger();
        if (typeof renderInsights === 'function') renderInsights();
        if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
        if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI();
        if (typeof vc526PolishCreditDashboardLabels === 'function') vc526PolishCreditDashboardLabels();
    }

    async function vc530DeleteTransaction(id, options = {}) {
        const tx = vc530FindTransaction(id);
        if (!tx) {
            vc530RefreshAll();
            return;
        }

        // Rule 1: A settled CR sale cannot be deleted until its settlement/payment is deleted first.
        if (vc530IsCreditSale(tx) && vc530CreditIsSettled(tx) && !options.force) {
            const settlement = vc530FindSettlementForCredit(tx.id);
            const settlementText = settlement ? `\n\nSettlement found: ${settlement.id}` : '';
            alert(`This credit sale has already been settled.${settlementText}\n\nDelete the settlement/payment first, then delete the credit sale.`);
            if (settlement && typeof viewTxDetails === 'function') {
                setTimeout(() => viewTxDetails(settlement.id), 120);
            }
            return;
        }

        // Rule 2: Deleting a settlement reopens the original credit. No inventory change.
        if (vc530IsSettlement(tx)) {
            const creditId = vc530CreditIdFromSettlement(tx);
            if (!confirm(`Delete this credit payment/settlement?\n\nThis will reopen the customer's credit balance.\nInventory will not change.`)) return;
            if (creditId) vc530MarkCreditOpen(creditId);
        } else {
            if (!confirm(`Delete transaction ${tx.id}?\n\nThis is allowed in testing mode.`)) return;
            vc530RestockTransactionItems(tx);
        }

        state.transactions = (state.transactions || []).filter(t => t.id !== tx.id);
        if (lastTransactionId === tx.id) lastTransactionId = null;

        await vc530DeleteFromCloud(tx.id);

        vc530CloseTransactionModals();
        vc530RefreshAll();
        if (typeof showToast === 'function') showToast('Transaction deleted', 'success');
    }

    // Override known delete names.
    deleteTransaction = vc530DeleteTransaction;
    voidTransaction = vc530DeleteTransaction;
    deleteTx = vc530DeleteTransaction;
    voidTx = vc530DeleteTransaction;

    // Link future settlements to their original CR transaction where possible.
    function vc530AttachSettlementLink(transaction) {
        if (!transaction || !vc530IsSettlement(transaction) || transaction.settlementFor) return transaction;
        const creditId = vc530CreditIdFromSettlement(transaction);
        if (creditId) {
            transaction.settlementFor = creditId;
            transaction.linkType = 'creditSettlement';
        }
        return transaction;
    }

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


    // v5.6.1 Authoritative Realtime Reporting Engine
    const VC531_DELETED_TX_KEY = 'villacart_deleted_transactions';

    function vc531DeletedSet() {
        try { return new Set(JSON.parse(localStorage.getItem(VC531_DELETED_TX_KEY) || '[]')); }
        catch(e) { return new Set(); }
    }

    function vc531DateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function vc531TodayCode() {
        return vc531DateCode(new Date());
    }

    function vc531IsSettlement(t) {
        if (!t) return false;
        const id = String(t.id || '').toUpperCase();
        const type = String(t.type || '').toUpperCase();
        const notes = String(t.notes || '').toUpperCase();
        return !!(
            t.settlementFor ||
            t.creditRef ||
            t.relatedCreditId ||
            (type === 'SA' && notes.includes('CR-')) ||
            (id.startsWith('SA-') && notes.includes('CR-')) ||
            notes.includes('SETTLEMENT') ||
            notes.includes('PAID CREDIT')
        );
    }

    function vc531IsRevenueSale(t) {
        return !!t && (t.type === 'SA' || t.type === 'CR') && !vc531IsSettlement(t);
    }

    function vc531CleanTransactions(tx = state.transactions || []) {
        const deleted = vc531DeletedSet();
        return (tx || []).filter(t => t && t.id && !deleted.has(t.id));
    }

    function vc531PeriodTransactions() {
        const all = vc531CleanTransactions(state.transactions || []);
        const now = new Date();

        if (typeof insightPeriod === 'undefined' || insightPeriod === 'day') {
            const today = vc531TodayCode();
            return all.filter(t => {
                const d = t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : '');
                return d === today;
            });
        }

        if (insightPeriod === 'month') {
            return all.filter(t => {
                const d = new Date((t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : '')) + 'T00:00:00');
                return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
            });
        }

        if (insightPeriod === 'range') {
            const s = document.getElementById('insight-start-date')?.value;
            const e = document.getElementById('insight-end-date')?.value;
            if (!s || !e) return all;
            return all.filter(t => {
                const d = t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : '');
                return d >= s && d <= e;
            });
        }

        return all;
    }

    function vc531Metrics(tx) {
        tx = vc531CleanTransactions(tx);
        const revenue = tx.filter(vc531IsRevenueSale);
        const cashSales = revenue.filter(t => t.type === 'SA').reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const creditSales = revenue.filter(t => t.type === 'CR').reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const collections = tx.filter(vc531IsSettlement).reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const expenses = tx.filter(t => t.type === 'EX').reduce((sum, t) => sum + (Number(t.total) || 0), 0);

        let cogs = 0;
        let itemsSold = 0;
        const productMap = {};
        revenue.forEach(t => (t.items || []).forEach(item => {
            const qty = Number(item.qty) || 0;
            const deduct = Number(item.deduct) || 1;
            const units = qty * deduct;
            const itemRevenue = (Number(item.price) || 0) * qty;
            const itemCogs = (Number(item.cost) || 0) * units;
            cogs += itemCogs;
            itemsSold += units;
            const key = item.name || item.id || 'Unknown Item';
            if (!productMap[key]) productMap[key] = { name: key, qty: 0, revenue: 0, profit: 0 };
            productMap[key].qty += units;
            productMap[key].revenue += itemRevenue;
            productMap[key].profit += itemRevenue - itemCogs;
        }));

        const totalSales = cashSales + creditSales;
        const cashIn = cashSales + collections;
        const netProfit = totalSales - cogs - expenses;

        return {
            cashSales, creditSales, collections, expenses, cogs,
            totalSales, cashIn, netProfit,
            transactionCount: tx.length,
            revenueCount: revenue.length,
            itemsSold,
            topProducts: Object.values(productMap).sort((a,b) => b.qty - a.qty)
        };
    }

    function vc531OutstandingCredit() {
        const tx = vc531CleanTransactions(state.transactions || []);
        const settlements = tx.filter(t => vc531IsSettlement(t));
        const credits = tx.filter(t => t && t.type === 'CR' && !vc531IsSettlement(t));
        let total = 0;

        function refsCredit(settlement, creditId) {
            const target = String(creditId || '').toUpperCase();
            if (!target) return false;
            const fields = [
                settlement && settlement.settlementFor,
                settlement && settlement.creditRef,
                settlement && settlement.relatedCreditId,
                settlement && settlement.notes
            ].map(v => String(v || '').toUpperCase());
            return fields.some(v => v.includes(target));
        }

        credits.forEach(cr => {
            if (!cr || !cr.id) return;
            if (cr.paid === true || cr.settled === true) return;
            const status = String(cr.status || '').trim().toUpperCase();
            if (status === 'PAID' || status === 'SETTLED') return;

            const fullSettlement = settlements.some(t => refsCredit(t, cr.id) && !String(t.notes || '').toUpperCase().includes('PARTIAL:'));
            if (fullSettlement) return;

            const explicit = [cr.balance, cr.balanceDue, cr.remaining, cr.outstanding, cr.amountDue]
                .map(v => Number(v))
                .find(v => !Number.isNaN(v) && v >= 0);

            if (explicit !== undefined) {
                total += explicit;
                return;
            }

            // In this app, partial payments reduce the CR ticket total itself.
            // So the safest default outstanding amount is the current CR total,
            // not original credit total minus every partial settlement again.
            total += Math.max(0, Number(cr.total) || 0);
        });

        return Math.max(0, total);
    }

    function vc531Peso(value) {
        return `₱${(Number(value)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    }

    function vc531SetText(id, value) {
        const el = document.getElementById(id);
        if (el && el.innerText !== String(value)) el.innerText = value;
    }

    function vc531SetMoney(id, value) {
        vc531SetText(id, vc531Peso(value));
    }

    function vc531EnsureBusinessDayForToday() {
        if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];
        const today = vc531TodayCode();
        const todaysTx = vc531PeriodTransactions().filter(t => {
            const d = t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : '');
            return d === today;
        });
        if (!todaysTx.length) return null;

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
                version: 'v5.6.1'
            };
            state.businessDays.push(bd);
            bdChanged = true;
        }
        if (bd.status !== 'CLOSED' && bd.status !== 'OPEN') {
            bd.status = 'OPEN';
            state.currentBusinessDayId = bd.id;
            bdChanged = true;
        } else if (bd.status === 'OPEN') {
            state.currentBusinessDayId = bd.id;
        }

        let changed = false;
        todaysTx.forEach(t => {
            if (t.businessDayId !== bd.id || t.businessDate !== today) {
                t.businessDayId = bd.id;
                t.businessDate = today;
                changed = true;
                t._offline = true;
                if (typeof queueAction === 'function') queueAction('update', 'transactions', t);
            }
        });

        if (bdChanged) {
            bd._offline = true;
            if (typeof queueAction === 'function') queueAction('update', 'businessDays', bd);
        }

        if (changed && typeof sync === 'function') sync();
        return bd;
    }

    function vc531RefreshBusinessDayCard() {
        const bd = vc531EnsureBusinessDayForToday();
        const title = document.getElementById('bd-status-title');
        const sub = document.getElementById('bd-status-subtitle');
        const badge = document.getElementById('bd-status-badge');
        const pill = document.getElementById('business-day-pill');
        const pillText = document.getElementById('business-day-text');

        if (bd) {
            const m = vc531Metrics(vc531PeriodTransactions());
            if (title) title.innerText = bd.id;
            if (sub) sub.innerText = `Opened ${new Date(bd.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} • ${m.transactionCount} transaction(s)`;
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

    function vc531RenderRecentActivities(tx) {
        const list = document.getElementById('insight-transactions-list');
        if (!list) return;
        const recent = vc531CleanTransactions(tx).sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0)).slice(0,10);
        const html = `<p class="text-[10px] font-black uppercase text-primary/60 mb-3 tracking-widest px-1">Recent Period Activities</p>` +
            (recent.map(t => {
                const label = vc531IsSettlement(t) ? 'PAYMENT' : t.type;
                return `<div class="bg-surface border border-border-subtle p-4 rounded-3xl flex justify-between items-center shadow-sm mb-2">
                    <div>
                        <div class="flex items-center gap-2">
                            <p class="font-black text-xs text-primary">${t.id}</p>
                            <span class="text-[7px] px-2 py-0.5 rounded-full uppercase font-bold bg-primary/10 text-primary">${label}</span>
                        </div>
                        <p class="text-[10px] text-on-surface-variant font-bold mt-0.5">${t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="font-black text-sm ${t.type === 'EX' ? 'text-error' : 'text-on-surface'}">${vc531Peso(t.total)}</span>
                        <button onclick="viewTxDetails('${String(t.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" class="w-9 h-9 flex items-center justify-center bg-primary/10 text-primary rounded-xl"><span class="material-symbols-outlined text-[18px]">visibility</span></button>
                    </div>
                </div>`;
            }).join('') || `<div class="text-center py-10 opacity-30 font-bold uppercase text-[10px]">No activity</div>`);
        if (list.innerHTML !== html) list.innerHTML = html;
    }

    function vc531RenderTopProducts(tx) {
        const list = document.getElementById('best-sellers-list');
        if (!list) return;
        const top = vc531Metrics(tx).topProducts.slice(0,5);
        if (!top.length) {
            const empty = `<div class="text-center py-8 opacity-40 font-bold uppercase text-[10px]">No product sales yet</div>`;
            if (list.innerHTML !== empty) list.innerHTML = empty;
            return;
        }
        const html = top.map((p, idx) => `
            <div class="flex items-center justify-between bg-surface-container/70 border border-border-subtle rounded-2xl p-3">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-xs font-black">${idx+1}</div>
                    <div class="min-w-0">
                        <p class="font-black text-xs text-on-surface truncate uppercase">${p.name}</p>
                        <p class="text-[10px] font-bold text-on-surface-variant">${p.qty.toLocaleString()} sold</p>
                    </div>
                </div>
                <p class="font-black text-xs text-primary">${vc531Peso(p.revenue)}</p>
            </div>
        `).join('');
        if (list.innerHTML !== html) list.innerHTML = html;
    }

    function vc531RenderSalesChart(tx) {
        const canvas = document.getElementById('sales-chart');
        if (!canvas) return;
        if (typeof Chart === 'undefined') {
            ensureChartLoaded()
                .then(() => vc531RenderSalesChart(tx))
                .catch(error => console.warn('Chart load failed', error));
            return;
        }

        const byDate = {};
        vc531CleanTransactions(tx).filter(vc531IsRevenueSale).forEach(t => {
            const d = t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : vc531TodayCode());
            byDate[d] = (byDate[d] || 0) + (Number(t.total) || 0);
        });

        const rawLabels = Object.keys(byDate).sort();
        const labels = rawLabels.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric'}));
        const values = rawLabels.map(d => byDate[d]);
        const parent = canvas.parentElement;
        if (parent) parent.classList.remove('hidden');

        const sig = JSON.stringify([labels, values]);
        if (canvas.dataset.vc531ChartSig === sig) {
            const existingChart = window.salesChartInstance;
            if (existingChart && existingChart.canvas === canvas && typeof existingChart.resize === 'function') {
                requestAnimationFrame(() => existingChart.resize());
            }
            return;
        }
        canvas.dataset.vc531ChartSig = sig;

        if (window.salesChartInstance && window.salesChartInstance.canvas === canvas) {
            window.salesChartInstance.data.labels = labels;
            window.salesChartInstance.data.datasets[0].data = values;
            window.salesChartInstance.update('none');
            return;
        }

        if (window.salesChartInstance) {
            try { window.salesChartInstance.destroy(); } catch(e) {}
            window.salesChartInstance = null;
        }

        window.salesChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ label: 'Sales', data: values, borderRadius: 8 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: window.innerWidth > 640,
                animation: false,
                transitions: { active: { animation: { duration: 0 } }, resize: { animation: { duration: 0 } } },
                plugins: { legend: { display: false } },
                scales: { y: { ticks: { callback: v => '₱' + Number(v).toLocaleString() } }, x: { grid: { display: false } } }
            }
        });
    }

    function vc531RefreshInsights() {
        const tx = vc531PeriodTransactions();
        const m = vc531Metrics(tx);

        vc531SetMoney('daily-revenue', m.totalSales);
        vc531SetMoney('daily-profit', m.netProfit);
        vc531SetText('daily-margin', `${m.totalSales > 0 ? ((m.netProfit/m.totalSales)*100).toFixed(1) : '0'}%`);
        vc531SetMoney('daily-cogs', m.cogs);
        vc531SetMoney('daily-expenses', m.expenses);

        vc531SetMoney('biz-total-sales', m.totalSales);
        vc531SetMoney('biz-cash-in', m.cashIn);
        vc531SetMoney('biz-credit-sales', m.creditSales);
        vc531SetMoney('biz-outstanding-credit', vc531OutstandingCredit());

        const inv = Array.isArray(state.inventory) ? state.inventory : [];
        vc531SetMoney('inventory-value', inv.reduce((sum,p)=>sum+((Number(p.cost)||0)*(Number(p.stock)||0)),0));
        vc531SetText('inventory-count', `${inv.length} items tracking`);

        vc531RefreshBusinessDayCard();
        vc531RenderRecentActivities(tx);
        vc531RenderTopProducts(tx);
        vc531RenderSalesChart(tx);

        if (typeof vc526PolishCreditDashboardLabels === 'function') vc526PolishCreditDashboardLabels();
    }

    // Business calendar: month summary should be based on businessDays + current open day from transactions.
    function vc531RefreshBusinessCalendarSafe() {
        if (typeof renderBusinessCalendar === 'function') {
            try { renderBusinessCalendar(); } catch(e) {}
        }

        const year = (typeof businessCalendarDate !== 'undefined' ? businessCalendarDate : new Date()).getFullYear();
        const month = (typeof businessCalendarDate !== 'undefined' ? businessCalendarDate : new Date()).getMonth();
        const tx = vc531CleanTransactions(state.transactions || []).filter(t => {
            const d = new Date((t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : '')) + 'T00:00:00');
            return d.getFullYear() === year && d.getMonth() === month;
        });
        const m = vc531Metrics(tx);
        const businessDates = new Set(tx.map(t => t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : '')).filter(Boolean));

        vc531SetText('month-business-days', businessDates.size);
        vc531SetMoney('month-total-sales', m.totalSales);
        vc531SetMoney('month-net-profit', m.netProfit);
        vc531SetText('month-transactions', m.transactionCount.toLocaleString());

        const salesByDate = {};
        tx.filter(vc531IsRevenueSale).forEach(t => {
            const d = t.businessDate || (t.timestamp ? vc531DateCode(t.timestamp) : '');
            salesByDate[d] = (salesByDate[d] || 0) + (Number(t.total)||0);
        });
        const best = Object.entries(salesByDate).sort((a,b)=>b[1]-a[1])[0];
        if (best) {
            vc531SetText('business-best-day', new Date(best[0] + 'T00:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric'}));
            vc531SetText('business-best-day-sub', vc531Peso(best[1]));
        }
        vc531SetMoney('business-average-day', businessDates.size ? m.totalSales/businessDates.size : 0);
        const latestDate = Array.from(businessDates).sort().pop();
        if (latestDate) {
            vc531SetText('business-latest-day', new Date(latestDate + 'T00:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric'}));
            vc531SetText('business-latest-day-sub', `${m.transactionCount.toLocaleString()} transaction(s) this month`);
        }
    }

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
    deleteTransaction = vc532DeleteTransaction;
    voidTransaction = vc532DeleteTransaction;
    deleteTx = vc532DeleteTransaction;
    voidTx = vc532DeleteTransaction;

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
            const result = vcOriginalRenderLedger532();
            setTimeout(vc532DecorateTransactionColors, 0);
            return result;
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

        const tx = vc541Clean(state.transactions || []).filter(t => {
            const d = t.businessDate || (t.timestamp ? vc541DateCode(t.timestamp) : '');
            const dt = new Date(d + 'T00:00:00');
            return dt.getFullYear() === year && dt.getMonth() === month;
        });

        const byDate = {};
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


    // v5.6.1 Cross-device Recent Activities Fix
    // Tablet issue: local deleted-id cache or period scope can make Recent Activities empty
    // while chart totals still show data. This renderer uses the same live state.transactions
    // that Ledger uses, then applies a safe period filter with fallback.
    function vc542DateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function vc542Norm(v) { return String(v || '').trim().toUpperCase(); }

    function vc542IsSettlement(t) {
        if (!t) return false;
        const id = vc542Norm(t.id);
        const type = vc542Norm(t.type);
        const notes = vc542Norm(t.notes);
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

    function vc542Kind(t) {
        if (vc542IsSettlement(t)) return 'settlement';
        if (t && t.type === 'CR') return 'credit';
        if (t && t.type === 'EX') return 'expense';
        return 'cash';
    }

    function vc542Label(kind) {
        return ({ cash:'SA', credit:'CR', settlement:'PAYMENT', expense:'EX' })[kind] || 'TX';
    }

    function vc542Icon(kind) {
        return ({ cash:'payments', credit:'schedule', settlement:'task_alt', expense:'remove_circle' })[kind] || 'receipt_long';
    }

    function vc542Peso(v) {
        return `₱${(Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
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

    function vc542OpenTx(id) {
        if (typeof viewTxDetails === 'function') {
            viewTxDetails(id);
            return;
        }
        const tx = (state.transactions || []).find(t => t.id === id);
        if (tx) alert(`${tx.id}\n\n${vc542Peso(tx.total)}\n${vc542Label(vc542Kind(tx))}`);
    }

    function vc542RenderRecentActivities() {
        const list = document.getElementById('insight-transactions-list');
        if (!list) return;

        const tx = vc542PeriodTransactionsSafe()
            .sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0))
            .slice(0,10);

        list.innerHTML = `<p class="text-[10px] font-black uppercase text-primary/60 mb-3 tracking-widest px-1">Recent Period Activities</p>` +
            (tx.map(t => {
                const kind = vc542Kind(t);
                const safeId = String(t.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
                return `
                    <button type="button" class="vc541-tx-card vc541-${kind}" onclick="vc542OpenTx('${safeId}')">
                        <div class="vc541-tx-left">
                            <div class="vc541-tx-icon vc541-icon-${kind}">
                                <span class="material-symbols-outlined">${vc542Icon(kind)}</span>
                            </div>
                            <div class="min-w-0">
                                <div class="flex items-center gap-2 min-w-0">
                                    <p class="vc541-tx-id truncate">${t.id}</p>
                                    <span class="vc541-tx-badge vc541-badge-${kind}">${vc542Label(kind)}</span>
                                </div>
                                <p class="vc541-tx-time">${time}</p>
                            </div>
                        </div>
                        <div class="vc541-tx-right">
                            <p class="vc541-tx-amount">${vc542Peso(t.total)}</p>
                            <span class="material-symbols-outlined vc541-chevron">chevron_right</span>
                        </div>
                    </button>`;
            }).join('') || `<div class="text-center py-10 opacity-30 font-bold uppercase text-[10px]">No activity</div>`);
    }

    const vc542OldInsights = typeof renderInsights === 'function' ? renderInsights : null;
    if (vc542OldInsights && !window.__vcRenderInsights542Patched) {
        window.__vcRenderInsights542Patched = true;
        renderInsights = function() {
            return vc542OldInsights();
        };
    }

    const vc542OldSwitch = typeof switchScreen === 'function' ? switchScreen : null;
    if (vc542OldSwitch && !window.__vcSwitch542Patched) {
        window.__vcSwitch542Patched = true;
        switchScreen = function(screen) {
            vc542OldSwitch(screen);
            if (screen === 'insights') {
                // Recent Activities is owned by vc531RefreshInsights to avoid flicker.
            }
        };
    }

    // Refresh when Firestore snapshot updates state/sync.
    const vc542OldSync = typeof sync === 'function' ? sync : null;
    if (vc542OldSync && !window.__vcSync542Patched) {
        window.__vcSync542Patched = true;
        sync = function() {
            const result = vc542OldSync();
            if (!document.getElementById('screen-insights')?.classList.contains('hidden')) {
                // Recent Activities is owned by vc531RefreshInsights to avoid repaint flicker.
            }
            return result;
        };
    }

    setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        if (!document.getElementById('screen-insights')?.classList.contains('hidden')) {
            const list = document.getElementById('insight-transactions-list');
            if (list && (list.innerText || '').toUpperCase().includes('NO ACTIVITY') && vc542AllLiveTransactions().length) {
                vc542RenderRecentActivities();
            }
        }
    }, 10000);

    // Initial Recent Activities repaint disabled; vc531RefreshInsights owns this area.


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

    // Override helpers used by older layers.
    getCurrentBusinessDay = function() {
        return vc543EnsureBusinessDayFromLiveTransactions();
    };

    const vc543OldRenderInsights = typeof renderInsights === 'function' ? renderInsights : null;
    if (vc543OldRenderInsights && !window.__vcRenderInsights543Patched) {
        window.__vcRenderInsights543Patched = true;
        renderInsights = function() {
            return vc543OldRenderInsights();
        };
    }

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


    // v5.6.1 Closing Summary Fix
    // Fixes stale note text and makes Closing use the same live transaction source as Insights/Business Day.
    function vc544DateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function vc544Norm(v) { return String(v || '').trim().toUpperCase(); }

    function vc544IsSettlement(t) {
        if (!t) return false;
        const id = vc544Norm(t.id);
        const type = vc544Norm(t.type);
        const notes = vc544Norm(t.notes);
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

    function vc544DeletedSet() {
        return new Set();
    }

    function vc544TodayTransactions() {
        const deleted = vc544DeletedSet();
        const today = vc544DateCode(new Date());
        return (state.transactions || [])
            .filter(t => t && t.id && !deleted.has(t.id))
            .filter(t => {
                const d = t.businessDate || (t.timestamp ? vc544DateCode(t.timestamp) : '');
                return d === today;
            });
    }

    function vc544Metrics(tx) {
        tx = tx || [];
        const revenue = tx.filter(t => (t.type === 'SA' || t.type === 'CR') && !vc544IsSettlement(t));
        const cashSales = revenue.filter(t => t.type === 'SA').reduce((s,t)=>s+(Number(t.total)||0),0);
        const creditSales = revenue.filter(t => t.type === 'CR').reduce((s,t)=>s+(Number(t.total)||0),0);
        const collections = tx.filter(vc544IsSettlement).reduce((s,t)=>s+(Number(t.total)||0),0);
        const expenses = tx.filter(t => t.type === 'EX').reduce((s,t)=>s+(Number(t.total)||0),0);

        let cogs = 0, itemsSold = 0;
        const productMap = {};
        revenue.forEach(t => (t.items || []).forEach(item => {
            const qty = Number(item.qty)||0;
            const deduct = Number(item.deduct)||1;
            const units = qty * deduct;
            const price = Number(item.price)||0;
            const cost = Number(item.cost)||0;
            cogs += cost * units;
            itemsSold += units;
            const key = item.name || item.id || 'Unknown Item';
            if (!productMap[key]) productMap[key] = { name:key, qty:0, revenue:0 };
            productMap[key].qty += units;
            productMap[key].revenue += price * qty;
        }));

        const totalSales = cashSales + creditSales;
        const cashIn = cashSales + collections;
        const netProfit = totalSales - cogs - expenses;
        const topProduct = Object.values(productMap).sort((a,b)=>b.qty-a.qty)[0] || null;

        return {
            cashSales, creditSales, collections, expenses, cogs,
            totalSales, cashIn, netProfit,
            transactionCount: tx.length,
            cashCount: revenue.filter(t => t.type === 'SA').length,
            creditCount: revenue.filter(t => t.type === 'CR').length,
            collectionCount: tx.filter(vc544IsSettlement).length,
            expenseCount: tx.filter(t => t.type === 'EX').length,
            itemsSold,
            topProduct
        };
    }

    function vc544Peso(v) {
        return `₱${(Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    }

    function vc544GetBusinessDay() {
        if (typeof vc543EnsureBusinessDayFromLiveTransactions === 'function') {
            const repaired = vc543EnsureBusinessDayFromLiveTransactions();
            if (repaired && String(repaired.status || '').toUpperCase() === 'OPEN') return repaired;
        }
        if (typeof getCurrentBusinessDay === 'function') return getCurrentBusinessDay();
        return null;
    }

    function vc544ClosingHTML(metrics, bd) {
        const opened = bd?.openedAt ? new Date(bd.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--';
        const now = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        return `
            <div class="space-y-4">
                <div class="closing-hero">
                    <p class="closing-label">Cash Received Today</p>
                    <h2>${vc544Peso(metrics.cashIn)}</h2>
                    <p class="closing-sub">Cash Sales + Credit Payments</p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div class="closing-mini"><span>Cash Sales</span><strong>${vc544Peso(metrics.cashSales)}</strong></div>
                    <div class="closing-mini"><span>Credit Sales</span><strong>${vc544Peso(metrics.creditSales)}</strong></div>
                    <div class="closing-mini"><span>Credit Payments</span><strong>${vc544Peso(metrics.collections)}</strong></div>
                    <div class="closing-mini"><span>Expenses</span><strong class="text-error">${vc544Peso(metrics.expenses)}</strong></div>
                </div>

                <div class="closing-section">
                    <div class="closing-row"><span>Business Day</span><strong>${bd?.id || 'AUTO'}</strong></div>
                    <div class="closing-row"><span>Opened</span><strong>${opened}</strong></div>
                    <div class="closing-row"><span>Closing Time</span><strong>${now}</strong></div>
                    <div class="closing-row"><span>Total Sales</span><strong>${vc544Peso(metrics.totalSales)}</strong></div>
                    <div class="closing-row"><span>COGS</span><strong>${vc544Peso(metrics.cogs)}</strong></div>
                    <div class="closing-row"><span>Net Profit</span><strong>${vc544Peso(metrics.netProfit)}</strong></div>
                </div>

                <div class="closing-section">
                    <p class="text-[10px] font-black uppercase text-primary/60 mb-3 tracking-widest">Transaction Count</p>
                    <div class="grid grid-cols-4 gap-2 text-center">
                        <div class="closing-count"><strong>${metrics.cashCount}</strong><span>Cash</span></div>
                        <div class="closing-count"><strong>${metrics.creditCount}</strong><span>Credit</span></div>
                        <div class="closing-count"><strong>${metrics.collectionCount}</strong><span>Payment</span></div>
                        <div class="closing-count"><strong>${metrics.expenseCount}</strong><span>Exp</span></div>
                    </div>
                </div>

                <div class="closing-note">
                    <p class="text-[10px] font-black uppercase tracking-widest text-primary/60 mb-2">How Closing Works</p>
                    <p>
                        This closing summary uses today's active business day and live synced transactions.
                        Tapping <b>End Day</b> will mark this business day as closed, save the final summary,
                        and the next transaction will automatically start a new business day.
                    </p>
                </div>
            </div>`;
    }

    function vc544RenderClosingSummary() {
        const bd = vc544GetBusinessDay();
        const tx = vc544TodayTransactions();
        const m = vc544Metrics(tx);

        const ids = [
            'closing-summary-content',
            'closing-content',
            'closing-summary-body',
            'store-closing-content',
            'closing-preview-content'
        ];

        let container = ids.map(id => document.getElementById(id)).find(Boolean);

        // Fallback: find the modal body area if the exact ID differs.
        if (!container) {
            const modal = document.getElementById('closing-summary-modal') || document.querySelector('[id*="closing"][id*="modal"]');
            if (modal) {
                container = modal.querySelector('.overflow-y-auto') || modal.querySelector('.custom-scrollbar') || modal.querySelector('.p-6') || modal;
            }
        }

        if (container) container.innerHTML = vc544ClosingHTML(m, bd);

        return { bd, metrics:m };
    }

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


    // v5.6.1 Brand Header Controller
    function vc545FormatToday() {
        const now = new Date();
        const mobile = window.innerWidth < 620;
        return mobile
            ? `Today • ${now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' })}`
            : `Today • ${now.toLocaleDateString(undefined, { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}`;
    }

    function vc545RefreshTodayLine() {
        const el = document.getElementById('vc-today-line');
        if (el) el.innerText = vc545FormatToday();
    }

    function vc545NormalizeHeaderStatus() {
        const day = document.getElementById('business-day-pill');
        const dayText = document.getElementById('business-day-text');
        if (day && dayText) {
            const raw = (dayText.innerText || '').trim().toUpperCase();
            day.classList.remove('open','closed','none','waiting');
            if (raw.includes('OPEN')) {
                dayText.innerText = 'Open';
                day.classList.add('open');
            } else if (raw.includes('CLOSED')) {
                dayText.innerText = 'Closed';
                day.classList.add('closed');
            } else {
                dayText.innerText = 'Waiting';
                day.classList.add('waiting');
            }
        }

        const sync = document.getElementById('sync-pill');
        const syncText = document.getElementById('sync-text');
        if (sync && syncText) {
            const online = navigator.onLine;
            sync.classList.toggle('offline', !online);
            syncText.innerText = online ? 'Online' : 'Offline';
        }

        vc545RefreshTodayLine();
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


    // v5.6.1 Premium Header Text Normalizer
    function vc547PremiumHeaderText() {
        const dayText = document.getElementById('business-day-text');
        if (dayText) {
            const raw = (dayText.innerText || '').toUpperCase();
            if (raw.includes('OPEN')) dayText.innerText = 'OPEN';
            else if (raw.includes('CLOSED')) dayText.innerText = 'CLOSED';
            else dayText.innerText = 'WAITING';
        }

        const syncText = document.getElementById('sync-text');
        if (syncText) syncText.innerText = navigator.onLine ? 'ONLINE' : 'OFFLINE';

        const dateLine = document.getElementById('vc-today-line');
        if (dateLine) {
            const now = new Date();
            dateLine.innerText = window.innerWidth < 620
                ? now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' })
                : `Today • ${now.toLocaleDateString(undefined, { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}`;
        }
    }

    setInterval(vc547PremiumHeaderText, 60000);
    window.addEventListener('resize', vc547PremiumHeaderText);
    setTimeout(vc547PremiumHeaderText, 200);
    setTimeout(vc547PremiumHeaderText, 1000);


    // v5.6.1 Ultra Compact Header Date Line
    function vc548UpdateCompactDate() {
        const copy = document.querySelector('.vc-brand-copy');
        if (!copy) return;
        const now = new Date();
        const syncEl = document.getElementById('sync-timestamp');
        let sync = '--:--';
        if (syncEl && syncEl.innerText) {
            const match = syncEl.innerText.match(/(\d{1,2}:\d{2})/);
            if (match) sync = match[1];
        }
        const date = window.innerWidth < 500
            ? now.toLocaleDateString(undefined, { day:'2-digit', month:'short' })
            : now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
        copy.setAttribute('data-date-line', `${date} • Sync ${sync}`);
    }
    setInterval(vc548UpdateCompactDate, 60000);
    window.addEventListener('resize', vc548UpdateCompactDate);
    setTimeout(vc548UpdateCompactDate, 200);
    setTimeout(vc548UpdateCompactDate, 1200);

    // v5.6.1 Stable Header Controller
    function vc551GetTodayBusinessDay() {
        try {
            if (typeof getCurrentBusinessDay === 'function') return getCurrentBusinessDay();
        } catch(e) {}
        try {
            const today = new Date();
            const code = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
            if (state && Array.isArray(state.businessDays)) {
                return state.businessDays.find(b => b.date === code && b.status === 'OPEN') || null;
            }
        } catch(e) {}
        return null;
    }

    function vc551RefreshHeader() {
        const date = document.getElementById('vc551-date');
        if (date) {
            const now = new Date();
            date.innerText = window.innerWidth < 620
                ? `Today • ${now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short' })}`
                : `Today • ${now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' })}`;
        }

        const dayPill = document.getElementById('vc551-day-pill');
        const dayText = document.getElementById('vc551-day-text');
        if (dayPill && dayText) {
            dayPill.classList.remove('waiting','closed','open');
            const bd = vc551GetTodayBusinessDay();
            if (bd && String(bd.status || '').toUpperCase() === 'CLOSED') {
                dayText.innerText = 'CLOSED';
                dayPill.classList.add('closed');
            } else if (bd) {
                dayText.innerText = 'OPEN';
                dayPill.classList.add('open');
            } else {
                dayText.innerText = 'WAITING';
                dayPill.classList.add('waiting');
            }
        }

        const syncPill = document.getElementById('vc551-sync-pill');
        const syncText = document.getElementById('vc551-sync-text');
        if (syncPill && syncText) {
            syncPill.classList.toggle('offline', !navigator.onLine);
            syncText.innerText = navigator.onLine ? 'ONLINE' : 'OFFLINE';
        }

        const alertDot = document.getElementById('vc551-notif-dot');
        const oldDot = document.getElementById('notif-dot');
        if (alertDot && oldDot) alertDot.classList.toggle('hidden', oldDot.classList.contains('hidden'));
        if (typeof renderHeaderLowStockTicker === 'function') renderHeaderLowStockTicker();
    }

    function vc551DebouncedHeader() {
        clearTimeout(window.__vc551HeaderTimer);
        window.__vc551HeaderTimer = setTimeout(vc551RefreshHeader, 80);
    }

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

    function vc560Kind(t) {
        if (vc560IsSettlement(t)) return 'payment';
        if (t && vc560Norm(t.type) === 'CR') return 'credit';
        if (t && vc560Norm(t.type) === 'EX') return 'expense';
        return 'cash';
    }

    function vc560Label(kind) {
        return ({ cash: 'SA', credit: 'CR', payment: 'PAYMENT', expense: 'EX' })[kind] || 'TX';
    }

    function vc560Icon(kind) {
        return ({ cash: 'payments', credit: 'schedule', payment: 'task_alt', expense: 'remove_circle' })[kind] || 'receipt_long';
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
        const activities = document.getElementById('insight-transactions-list');
        if (activities) activities.classList.add('vc560-activities-list');

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

    function vc560RenderActivities(tx) {
        const list = document.getElementById('insight-transactions-list');
        if (!list) return;
        const recent = (tx || [])
            .filter(t => t && t.id)
            .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
            .slice(0, 8);

        if (!recent.length) {
            list.innerHTML = `<div class="vc560-section-title">Recent Activities</div><div class="vc560-empty-state">No activity yet</div>`;
            return;
        }

        list.innerHTML = `<div class="vc560-section-title">Recent Activities</div>` + recent.map(t => {
            const kind = vc560Kind(t);
            const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const safeId = vc560SafeText(t.id);
            return `
                <button type="button" class="vc560-activity vc560-${kind}" onclick="typeof vc542OpenTx==='function' ? vc542OpenTx('${safeId}') : (typeof viewTxDetails==='function' && viewTxDetails('${safeId}'))">
                    <div class="vc560-activity-icon"><span class="material-symbols-outlined">${vc560Icon(kind)}</span></div>
                    <div class="vc560-activity-main">
                        <div><strong>${safeId}</strong><span>${vc560Label(kind)}</span></div>
                        <p>${time}</p>
                    </div>
                    <div class="vc560-activity-amount">${vc560Peso(t.total)}</div>
                    <span class="material-symbols-outlined vc560-chevron">chevron_right</span>
                </button>`;
        }).join('');
    }

    function vc560RefreshInsightsUI() {
        if (!vc560EnsureInsightsShell()) return;
        const tx = vc560PeriodTransactions();
        vc560RenderQuickMetrics(tx);
        vc560RenderTopProducts(tx);
        // Recent Activities is rendered by vc531RenderRecentActivities only.
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

function vc7218StartApp() {
        if (window.__vc7218Started) return;
        window.__vc7218Started = true;
        vcStartupMark('app-start-called');
        try {
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


// v5.6.32 Stability + UI: collision-proof transaction IDs, ledger date groups, insight debounce, faster PIN.
(function(){
    if (window.__vcStabilityUi5632) return;
    window.__vcStabilityUi5632 = true;

    const VC5632_COLLAPSE_KEY = 'villacart_ledger_date_groups_collapsed' + (typeof STORAGE_SUFFIX !== 'undefined' ? STORAGE_SUFFIX : '');

    function vc5632Safe(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function vc5632Js(value) {
        return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function vc5632Peso(value) {
        const n = Number(value || 0);
        return '₱' + n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
    }

    function vc5632DateCode(date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        const safe = Number.isNaN(d.getTime()) ? new Date() : d;
        const dd = String(safe.getDate()).padStart(2, '0');
        const mm = String(safe.getMonth() + 1).padStart(2, '0');
        const yy = String(safe.getFullYear()).slice(-2);
        return dd + mm + yy;
    }

    function vc5632DateKey(t) {
        if (t && t.businessDate) return t.businessDate;
        const d = t && t.timestamp ? new Date(t.timestamp) : new Date();
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function vc5632DateLabel(key) {
        const today = new Date();
        const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        if (key === todayKey) return 'Today';
        const d = new Date(key + 'T00:00:00');
        if (Number.isNaN(d.getTime())) return key || 'Unknown date';
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }

    function vc5632Time(t) {
        const d = t && t.timestamp ? new Date(t.timestamp) : null;
        if (!d || Number.isNaN(d.getTime())) return '';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function vc5632IsSettlement(t) {
        if (window.VillacartCreditUtils && typeof window.VillacartCreditUtils.isCreditSettlement === 'function') {
            return window.VillacartCreditUtils.isCreditSettlement(t);
        }
        const notes = String(t && t.notes || '').toUpperCase();
        const id = String(t && t.id || '').toUpperCase();
        return notes.includes('CR-') || notes.includes('PARTIAL:') || notes.includes('PAYMENT') || (id.startsWith('SA-') && notes.includes('CR-'));
    }

    function vc5632SettlementCreditIds(t) {
        if (window.VillacartCreditUtils && typeof window.VillacartCreditUtils.settlementCreditIds === 'function') {
            return window.VillacartCreditUtils.settlementCreditIds(t);
        }
        const ids = new Set();
        ['settlementFor', 'creditRef', 'relatedCreditId'].forEach(key => {
            if (t && t[key]) ids.add(String(t[key]).toUpperCase());
        });
        const notes = String(t && t.notes || '').toUpperCase();
        const matches = notes.match(/CR-[A-Z0-9-]+/g) || [];
        matches.forEach(id => ids.add(id));
        return ids;
    }

    function vc5632CreditIsSettled(creditTx, allTx) {
        if (window.VillacartCreditUtils && typeof window.VillacartCreditUtils.isCreditSettled === 'function') {
            return window.VillacartCreditUtils.isCreditSettled(creditTx, allTx);
        }
        if (!creditTx) return false;
        if (creditTx.paid === true || creditTx.settled === true) return true;
        const status = String(creditTx.status || '').trim().toUpperCase();
        if (status === 'PAID' || status === 'SETTLED') return true;
        if (Number(creditTx.balance) === 0 || Number(creditTx.balanceDue) === 0 || Number(creditTx.remaining) === 0 || Number(creditTx.amountDue) === 0) return true;

        const target = String(creditTx.id || '').toUpperCase();
        if (!target) return false;
        return (Array.isArray(allTx) ? allTx : []).some(t => {
            if (!t || t.id === creditTx.id || !vc5632IsSettlement(t)) return false;
            const notes = String(t.notes || '').toUpperCase();
            if (notes.includes('PARTIAL:')) return false;
            return vc5632SettlementCreditIds(t).has(target);
        });
    }

    window.vc5632CreditIsSettled = vc5632CreditIsSettled;

    function vc5632FindSettlementForCredit(creditTx, allTx) {
        const target = String(creditTx && creditTx.id || '').toUpperCase();
        if (!target) return null;
        return (Array.isArray(allTx) ? allTx : [])
            .filter(t => t && t.id !== creditTx.id && vc5632IsSettlement(t))
            .filter(t => {
                const notes = String(t.notes || '').toUpperCase();
                if (notes.includes('PARTIAL:')) return false;
                return vc5632SettlementCreditIds(t).has(target);
            })
            .sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0))[0] || null;
    }

    function vc5632SettlementDateKeyForCredit(creditTx, allTx) {
        const settlement = creditTx && creditTx._vcSettlement ? creditTx._vcSettlement : vc5632FindSettlementForCredit(creditTx, allTx);
        return settlement
            ? (settlement.businessDate || vc5632DateKey(settlement))
            : (creditTx && (creditTx.settledAt ? vc5632DateKey({ timestamp: creditTx.settledAt }) : vc5632DateKey(creditTx)));
    }

    function vc5632SettlementTimestampForCredit(creditTx, allTx) {
        const settlement = creditTx && creditTx._vcSettlement ? creditTx._vcSettlement : vc5632FindSettlementForCredit(creditTx, allTx);
        return settlement ? (settlement.timestamp || settlement.createdAt || '') : (creditTx && (creditTx.settledAt || creditTx.timestamp || creditTx.createdAt || ''));
    }

    function vc5632FilteredSettledCredits(list, allTx) {
        const q = String(document.getElementById('vc5629-ledger-search')?.value || '').trim().toLowerCase();
        const mode = document.getElementById('vc5629-ledger-date')?.value || 'today';
        const todayKey = vc5632DateKey({ timestamp: new Date().toISOString() });
        let out = (Array.isArray(list) ? list : []).map(t => {
            const settlement = vc5632FindSettlementForCredit(t, allTx);
            return {
                ...t,
                _vcCreditSettled: true,
                _vcSettlement: settlement,
                _vcSettlementDateKey: settlement ? (settlement.businessDate || vc5632DateKey(settlement)) : vc5632SettlementDateKeyForCredit(t, allTx),
                _vcSettlementTimestamp: settlement ? (settlement.timestamp || settlement.createdAt || '') : vc5632SettlementTimestampForCredit(t, allTx)
            };
        });
        if (mode === 'today') out = out.filter(t => t._vcSettlementDateKey === todayKey);
        if (q) {
            out = out.filter(t => {
                const s = t._vcSettlement || {};
                return [
                    t.id, t.customer, t.notes,
                    s.id, s.customer, s.notes,
                    ...(Array.isArray(t.items) ? t.items.map(i => i && i.name) : [])
                ].some(v => String(v || '').toLowerCase().includes(q));
            });
        }
        return out.sort((a, b) => new Date(b._vcSettlementTimestamp || b.timestamp || 0) - new Date(a._vcSettlementTimestamp || a.timestamp || 0));
    }

    function vc5632KnownTransactionIds() {
        const ids = new Set();
        (Array.isArray(state.transactions) ? state.transactions : []).forEach(t => { if (t && t.id) ids.add(t.id); });
        (Array.isArray(offlineQueue) ? offlineQueue : []).forEach(task => {
            if (task && task.table === 'transactions' && task.data && task.data.id) ids.add(task.data.id);
        });
        return ids;
    }

    function vc5632MaxSeq(type, dateCode) {
        const safeType = String(type || '').replace(/[^A-Z0-9]/gi, '') || 'SA';
        const pattern = new RegExp('^' + safeType + '-' + dateCode + '-(\\d+)$');
        let max = 0;
        vc5632KnownTransactionIds().forEach(id => {
            const match = String(id || '').match(pattern);
            if (match) max = Math.max(max, Number(match[1]) || 0);
        });
        return max;
    }

    const vc5632OldNextTransactionId = typeof nextTransactionId === 'function' ? nextTransactionId : null;
    if (vc5632OldNextTransactionId && !window.__vcNextId5632Patched) {
        window.__vcNextId5632Patched = true;
        nextTransactionId = function(type) {
            const now = new Date();
            const dateCode = vc5632DateCode(now);
            const counterKey = APP_ENV === 'test' ? 'dailyCounters_test' : 'dailyCounters';
            let counters = {};
            try { counters = JSON.parse(localStorage.getItem(counterKey) || '{}') || {}; } catch(e) { counters = {}; }
            counters[dateCode] = counters[dateCode] || { SA: 0, CR: 0, EX: 0 };
            const existingMax = vc5632MaxSeq(type, dateCode);
            const localMax = Number(counters[dateCode][type] || 0);
            let next = Math.max(existingMax, localMax) + 1;
            let id = '';
            const known = vc5632KnownTransactionIds();
            do {
                id = type + '-' + dateCode + '-' + String(next).padStart(3, '0');
                counters[dateCode][type] = next;
                next += 1;
            } while (known.has(id));
            try { localStorage.setItem(counterKey, JSON.stringify(counters)); } catch(e) {}
            return id;
        };
    }

    const vc5632OldQueueTransaction = typeof queueTransaction === 'function' ? queueTransaction : null;
    if (vc5632OldQueueTransaction && !window.__vcQueueTransaction5632Patched) {
        window.__vcQueueTransaction5632Patched = true;
        queueTransaction = function(transaction) {
            if (transaction && transaction.id) {
                const known = vc5632KnownTransactionIds();
                const duplicate = known.has(transaction.id) && !(state.transactions || []).some(t => t === transaction);
                if (duplicate) {
                    const type = transaction.type || String(transaction.id).split('-')[0] || 'SA';
                    const oldId = transaction.id;
                    transaction.id = nextTransactionId(type);
                    console.warn('Transaction ID collision prevented', oldId, '=>', transaction.id);
                    if (typeof showToast === 'function') showToast('Sale number adjusted to avoid duplicate', 'info');
                }
            }
            return vc5632OldQueueTransaction.apply(this, arguments);
        };
    }

    function vc5632LoadCollapsed() {
        try { return JSON.parse(localStorage.getItem(VC5632_COLLAPSE_KEY) || '{}') || {}; } catch(e) { return {}; }
    }

    function vc5632SaveCollapsed(value) {
        try { localStorage.setItem(VC5632_COLLAPSE_KEY, JSON.stringify(value || {})); } catch(e) {}
    }

    window.vc5632ToggleLedgerDate = function(key) {
        const collapsed = vc5632LoadCollapsed();
        collapsed[key] = !collapsed[key];
        vc5632SaveCollapsed(collapsed);
        if (typeof renderLedger === 'function') renderLedger();
    };

    let vc5632CreditLedgerView = 'open';
    window.vc5632SetCreditLedgerView = function(view) {
        vc5632CreditLedgerView = view === 'settled' ? 'settled' : 'open';
        if (typeof renderLedger === 'function') renderLedger();
    };

    let vc8043LedgerRenderScheduled = false;
    function vc8043ScheduleLedgerRender() {
        if (vc8043LedgerRenderScheduled) return;
        vc8043LedgerRenderScheduled = true;
        const run = () => {
            vc8043LedgerRenderScheduled = false;
            if (typeof renderLedger === 'function') renderLedger();
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
        else setTimeout(run, 0);
    }

    function vc5632EnsureLedgerShell() {
        const screen = document.getElementById('screen-history');
        const summary = document.getElementById('ledger-summary-container');
        const content = document.getElementById('ledger-content');
        if (!screen || !summary || !content) return false;
        screen.classList.add('vc5629-ledger', 'vc5632-ledger');
        const tabs = document.getElementById('tab-cash')?.parentElement;
        if (tabs) tabs.classList.add('vc5629-tabs');
        if (!document.getElementById('vc5629-ledger-tools')) {
            const tools = document.createElement('div');
            tools.id = 'vc5629-ledger-tools';
            tools.className = 'vc5629-ledger-tools';
            tools.innerHTML = '<label class="vc5629-search"><span class="material-symbols-outlined">search</span><input id="vc5629-ledger-search" type="search" placeholder="Search transaction, customer, notes..." autocomplete="off"></label><select id="vc5629-ledger-date"><option value="today" selected>Today only</option><option value="all">All dates</option></select>';
            (tabs || summary).insertAdjacentElement('afterend', tools);
            const ledgerSearch = tools.querySelector('#vc5629-ledger-search');
            const ledgerDate = tools.querySelector('#vc5629-ledger-date');
            if (ledgerSearch) ledgerSearch.addEventListener('input', () => vc8043ScheduleLedgerRender());
            if (ledgerDate) {
                const scheduleDateRender = () => {
                    ledgerDate.dataset.vcUserPickedDate = '1';
                    vc8043ScheduleLedgerRender();
                };
                ledgerDate.addEventListener('input', scheduleDateRender);
                ledgerDate.addEventListener('change', scheduleDateRender);
            }
        }
        summary.className = 'vc5629-summary-grid';
        content.className = 'vc5632-ledger-date-list';
        return true;
    }

    function vc5632Filtered(list) {
        const q = String(document.getElementById('vc5629-ledger-search')?.value || '').trim().toLowerCase();
        const mode = document.getElementById('vc5629-ledger-date')?.value || 'today';
        const todayKey = vc5632DateKey({ timestamp: new Date().toISOString() });
        let out = (Array.isArray(list) ? list : []).slice();
        if (mode === 'today') out = out.filter(t => vc5632DateKey(t) === todayKey);
        if (q) {
            out = out.filter(t => [
                t.id, t.customer, t.notes, t.desc, t.category,
                ...(Array.isArray(t.items) ? t.items.map(i => i && i.name) : [])
            ].some(v => String(v || '').toLowerCase().includes(q)));
        }
        return out.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    }

    function vc5632SummaryCard(label, value, sub, tone) {
        return '<div class="vc5629-summary-card vc5629-' + (tone || 'blue') + '"><p>' + vc5632Safe(label) + '</p><strong>' + vc5632Safe(value) + '</strong><span>' + vc5632Safe(sub || '') + '</span></div>';
    }

    function vc5632Pills(t, kind) {
        const pills = [];
        const isSettledCredit = kind === 'credit-settled' || !!(t && t._vcCreditSettled);
        if (typeof isPendingSync === 'function' && isPendingSync('transactions', t.id)) pills.push('<span class="vc5629-pill vc5629-pending">Pending</span>');
        else pills.push('<span class="vc5629-pill vc5629-synced">Synced</span>');
        if (kind === 'credit' || kind === 'credit-settled') pills.push('<span class="vc5629-pill vc5629-credit">Credit</span>');
        if (kind === 'expense') pills.push('<span class="vc5629-pill vc5629-expense">Expense</span>');
        if (vc5632IsSettlement(t) || isSettledCredit) pills.push('<span class="vc5629-pill vc5629-paid">' + (isSettledCredit ? 'Settled' : 'Paid') + '</span>');
        return pills.join('');
    }

    function vc8050TxPreview(t, kind) {
        const items = Array.isArray(t && t.items) ? t.items.filter(Boolean) : [];
        if (items.length) {
            const first = items[0] || {};
            const firstName = String(first.name || first.productName || 'Item').trim() || 'Item';
            const qty = Number(first.qty || first.quantity || 0);
            const qtyText = qty ? ' x' + qty : '';
            const more = items.length > 1 ? ' +' + (items.length - 1) + ' more' : '';
            return '<p class="vc8050-tx-preview">Item: ' + vc5632Safe(firstName + qtyText + more) + '</p>';
        }
        if (vc5632IsSettlement(t) || kind === 'credit-settled') {
            const ids = Array.from(vc5632SettlementCreditIds(t || {}));
            if (ids.length) {
                const first = ids[0];
                const more = ids.length > 1 ? ' +' + (ids.length - 1) + ' more' : '';
                return '<p class="vc8050-tx-preview">Paid: ' + vc5632Safe(first + more) + '</p>';
            }
        }
        if (kind === 'expense') {
            const cat = String((t && (t.category || t.desc || t.notes)) || 'Expense').trim();
            return '<p class="vc8050-tx-preview">Expense: ' + vc5632Safe(cat || 'Expense') + '</p>';
        }
        return '';
    }

    function vc5632TxCard(t, kind) {
        const note = t.desc || t.notes || '';
        const customer = t.customer ? '<p class="vc5629-meta">Customer: ' + vc5632Safe(t.customer) + '</p>' : '';
        const preview = vc8050TxPreview(t, kind);
        const isSettledCredit = kind === 'credit-settled' || !!(t && t._vcCreditSettled);
        const cardKind = kind === 'credit-settled' ? 'credit' : kind;
        const payButton = kind === 'credit' && !isSettledCredit ? '<button type="button" class="vc5632-mini-pay" onclick="payIndividualTicket(\'' + vc5632Js(t.id) + '\')">Pay</button>' : '';
        return '<article class="vc5629-tx-card vc5629-' + cardKind + (isSettledCredit ? ' vc5632-settled-credit-card' : '') + '">' +
            '<div class="vc5629-tx-main"><div class="vc5629-tx-top"><h3>' + vc5632Safe(t.id || 'Transaction') + '</h3><div class="vc5629-pills">' + vc5632Pills(t, kind) + '</div></div>' +
            '<p class="vc5629-time">' + vc5632Safe(vc5632Time(t)) + '</p>' + customer + preview +
            (note ? '<p class="vc5629-meta">' + vc5632Safe(note) + '</p>' : '') + '</div>' +
            '<div class="vc5629-tx-side"><strong class="' + (kind === 'expense' ? 'vc5629-amount-red' : '') + '">' + vc5632Peso(t.total) + '</strong><div class="vc5632-actions">' + payButton +
            '<button type="button" onclick="viewTxDetails(\'' + vc5632Js(t.id) + '\')" aria-label="View transaction ' + vc5632Safe(t.id) + '"><span class="material-symbols-outlined">visibility</span></button></div></div></article>';
    }

    function vc5632RenderGroups(list, kind) {
        // v7.2.14: Credit must never use date grouping. This keeps phone,
        // tablet, and any legacy caller on the customer-group Credit renderer.
        if (kind === 'credit' && typeof vc5632RenderCreditCustomers === 'function') {
            return vc5632RenderCreditCustomers(Array.isArray(list) ? list : []);
        }
        if (!list.length) {
            return '<div class="vc5629-empty"><span class="material-symbols-outlined">receipt_long</span><strong>No records</strong><p>Try another tab, date, or search.</p></div>';
        }
        const collapsed = vc5632LoadCollapsed();
        const groups = new Map();
        list.forEach(t => {
            const key = vc5632DateKey(t);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(t);
        });
        return Array.from(groups.entries()).map(([key, items]) => {
            const total = items.reduce((sum, t) => sum + Number(t.total || 0), 0);
            const collapseKey = (activeLedgerTab || 'cash') + ':' + key;
            const isCollapsed = !!collapsed[collapseKey];
            return '<section class="vc5632-date-group ' + (isCollapsed ? 'collapsed' : '') + '">' +
                '<button type="button" class="vc5632-date-header" onclick="vc5632ToggleLedgerDate(\'' + vc5632Js(collapseKey) + '\')">' +
                    '<div><span class="material-symbols-outlined">expand_more</span><strong>' + vc5632Safe(vc5632DateLabel(key)) + '</strong><small>' + items.length + ' transaction(s)</small></div>' +
                    '<em>' + vc5632Peso(total) + '</em>' +
                '</button>' +
                '<div class="vc5632-date-body">' + items.map(t => vc5632TxCard(t, kind)).join('') + '</div>' +
            '</section>';
        }).join('');
    }


    function vc5632RenderCreditToggle(view, openCount, settledCount) {
        const mode = view === 'settled' ? 'settled' : 'open';
        return '<div class="vc5632-credit-view-switch" role="group" aria-label="Credit view">' +
            '<button type="button" class="' + (mode === 'open' ? 'active' : '') + '" onclick="vc5632SetCreditLedgerView(\'open\')">Open <span>' + openCount + '</span></button>' +
            '<button type="button" class="' + (mode === 'settled' ? 'active' : '') + '" onclick="vc5632SetCreditLedgerView(\'settled\')">Settled <span>' + settledCount + '</span></button>' +
        '</div>';
    }

    function vc5632RenderSettledCreditByDateCustomer(list) {
        if (!list.length) {
            return '<div class="vc5629-empty"><span class="material-symbols-outlined">receipt_long</span><strong>No settled credits</strong><p>Paid credit tickets will appear here.</p></div>';
        }
        const collapsed = vc5632LoadCollapsed();
        const dateGroups = new Map();
        list.forEach(t => {
            const key = t._vcSettlementDateKey || vc5632DateKey(t);
            if (!dateGroups.has(key)) dateGroups.set(key, []);
            dateGroups.get(key).push(t);
        });
        return Array.from(dateGroups.entries())
            .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
            .map(([dateKey, items]) => {
                const total = items.reduce((sum, t) => sum + Number(t.total || 0), 0);
                const collapseKey = 'credit-settled:' + dateKey;
                const isCollapsed = !!collapsed[collapseKey];
                const customers = {};
                items.forEach(t => {
                    const raw = String(t.customer || 'Guest').trim() || 'Guest';
                    const key = raw.toLowerCase();
                    if (!customers[key]) {
                        customers[key] = {
                            rawName: raw,
                            displayName: typeof titleCase === 'function' ? titleCase(raw) : raw,
                            items: [],
                            total: 0
                        };
                    }
                    customers[key].items.push(t);
                    customers[key].total += Number(t.total || 0);
                });
                const body = Object.values(customers)
                    .sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName))
                    .map(group => {
                        return '<section class="vc5629-credit-group vc5632-credit-customer-group">' +
                            '<div class="vc5629-credit-head">' +
                                '<div><h3>' + vc5632Safe(group.displayName) + '</h3><p>' + group.items.length + ' settled ticket(s)</p></div>' +
                                '<div class="vc5632-credit-head-actions"><strong>' + vc5632Peso(group.total) + '</strong></div>' +
                            '</div>' +
                            '<div class="vc5629-credit-list">' + group.items.map(t => vc5632TxCard(t, 'credit-settled')).join('') + '</div>' +
                        '</section>';
                    }).join('');
                return '<section class="vc5632-date-group vc5632-settled-credit-date-group ' + (isCollapsed ? 'collapsed' : '') + '">' +
                    '<button type="button" class="vc5632-date-header" onclick="vc5632ToggleLedgerDate(\'' + vc5632Js(collapseKey) + '\')">' +
                        '<div><span class="material-symbols-outlined">expand_more</span><strong>' + vc5632Safe(vc5632DateLabel(dateKey)) + '</strong><small>' + items.length + ' settled ticket(s)</small></div>' +
                        '<em>' + vc5632Peso(total) + '</em>' +
                    '</button>' +
                    '<div class="vc5632-date-body">' + body + '</div>' +
                '</section>';
            }).join('');
    }

    function vc5632RenderCreditCustomers(list, view) {
        const isSettledView = view === 'settled';
        if (isSettledView) return vc5632RenderSettledCreditByDateCustomer(Array.isArray(list) ? list : []);
        if (!list.length) {
            return '<div class="vc5629-empty"><span class="material-symbols-outlined">receipt_long</span><strong>' + (isSettledView ? 'No settled credits' : 'No open credits') + '</strong><p>' + (isSettledView ? 'Paid credit tickets will appear here.' : 'Credit sales will appear here.') + '</p></div>';
        }
        const groups = {};
        list.forEach(t => {
            const raw = String(t.customer || 'Guest').trim() || 'Guest';
            const key = raw.toLowerCase();
            if (!groups[key]) {
                groups[key] = {
                    rawName: raw,
                    displayName: typeof titleCase === 'function' ? titleCase(raw) : raw,
                    items: [],
                    total: 0
                };
            }
            groups[key].items.push(t);
            groups[key].total += Number(t.total || 0);
        });
        return Object.values(groups)
            .sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName))
            .map(group => {
                return '<section class="vc5629-credit-group vc5632-credit-customer-group">' +
                    '<div class="vc5629-credit-head">' +
                        '<div><h3>' + vc5632Safe(group.displayName) + '</h3><p>' + group.items.length + (isSettledView ? ' settled ticket(s)' : ' pending ticket(s)') + '</p></div>' +
                        '<div class="vc5632-credit-head-actions"><strong>' + vc5632Peso(group.total) + '</strong>' +
                        (isSettledView ? '' : '<button type="button" onclick="payFullBalance(\'' + vc5632Js(group.rawName) + '\')" class="vc5629-pay-full vc5632-pay-full-inline">Pay Full</button>') + '</div>' +
                    '</div>' +
                    (isSettledView ? '' : '<button type="button" onclick="payFullBalance(\'' + vc5632Js(group.rawName) + '\')" class="vc5629-pay-full vc5632-pay-full-block">Pay Full Balance</button>') +
                    '<div class="vc5629-credit-list">' +
                        group.items.map(t => vc5632TxCard(t, isSettledView ? 'credit-settled' : 'credit')).join('') +
                    '</div>' +
                '</section>';
            }).join('');
    }

    function vc7262BuildCashLedger(tx) {
        const list = vc5632Filtered(tx.filter(t => t && (t.type === 'SA' || vc5632IsSettlement(t))));
        const cashSalesTotal = list
            .filter(t => t && t.type === 'SA' && !vc5632IsSettlement(t))
            .reduce((sum, t) => sum + Number(t.total || 0), 0);
        const cashReceivedTotal = list.reduce((sum, t) => {
            if (vc5632IsSettlement(t)) return sum + Number(t.total || 0);
            if (t && t.type === 'SA') return sum + Number(t.total || 0);
            return sum;
        }, 0);
        return {
            list,
            kind: 'cash',
            summary: vc5632SummaryCard('Total Cash Sales', vc5632Peso(cashSalesTotal), 'Cash sales only', 'blue') +
                vc5632SummaryCard('Cash Received', vc5632Peso(cashReceivedTotal), 'Cash sales + credit payments', 'green') +
                vc5632SummaryCard('Transactions', String(list.length), 'Matching records', 'purple')
        };
    }

    function vc7262BuildCreditLedger(tx) {
        const creditBase = tx.filter(t => t && t.type === 'CR');
        const openCredits = creditBase.filter(t => !vc5632CreditIsSettled(t, tx));
        const settledCredits = creditBase
            .filter(t => vc5632CreditIsSettled(t, tx))
            .map(t => ({ ...t, _vcCreditSettled: true }));
        const openList = vc5632Filtered(openCredits);
        const settledList = vc5632FilteredSettledCredits(settledCredits, tx);
        const view = vc5632CreditLedgerView === 'settled' ? 'settled' : 'open';
        const list = view === 'settled' ? settledList : openList;
        const total = list.reduce((sum, t) => sum + Number(t.total || 0), 0);
        const customers = new Set(list.map(t => String(t.customer || 'Guest').trim().toLowerCase() || 'guest'));
        return {
            list,
            kind: 'credit',
            view,
            summary: vc5632RenderCreditToggle(view, openList.length, settledList.length) +
                (view === 'settled'
                    ? vc5632SummaryCard('Settled Credit', vc5632Peso(total), 'Paid credit tickets', 'green')
                    : vc5632SummaryCard('Outstanding Credit', vc5632Peso(total), 'Unpaid balance', 'orange')) +
                vc5632SummaryCard('Customers', String(customers.size), view === 'settled' ? 'Paid accounts' : 'With balance', 'purple') +
                vc5632SummaryCard('Credit Tickets', String(list.length), view === 'settled' ? 'Settled tickets' : 'Pending tickets', 'blue')
        };
    }

    function vc7262BuildExpenseLedger(tx) {
        const list = vc5632Filtered(tx.filter(t => t && t.type === 'EX'));
        const total = list.reduce((sum, t) => sum + Number(t.total || 0), 0);
        const categories = new Set(list.map(t => t.category || 'Expense'));
        return {
            list,
            kind: 'expense',
            summary: vc5632SummaryCard('Total Expenses', vc5632Peso(total), 'Recorded expense amount', 'red') +
                vc5632SummaryCard('Expense Records', String(list.length), 'Matching records', 'purple') +
                vc5632SummaryCard('Categories', String(categories.size), 'Expense groups', 'blue')
        };
    }

    function vc7262BuildLedgerState(tab, tx) {
        if (tab === 'credit') return vc7262BuildCreditLedger(tx);
        if (tab === 'expense') return vc7262BuildExpenseLedger(tx);
        return vc7262BuildCashLedger(tx);
    }

    const vc5632OldRenderLedger = typeof renderLedger === 'function' ? renderLedger : null;
    if (vc5632OldRenderLedger && !window.__vcRenderLedger5632Patched) {
        window.__vcRenderLedger5632Patched = true;
        renderLedger = function() {
            try {
                if (!vc5632EnsureLedgerShell()) return vc5632OldRenderLedger.apply(this, arguments);
                const summary = document.getElementById('ledger-summary-container');
                const content = document.getElementById('ledger-content');
                const dateSelect = document.getElementById('vc5629-ledger-date');
                if (dateSelect && !dateSelect.dataset.vcUserPickedDate) dateSelect.value = 'today';
                const dateModeForArchive = document.getElementById('vc5629-ledger-date')?.value || 'today';
                const tx = dateModeForArchive === 'all' && typeof vc710AllTransactionsForLocalViews === 'function'
                    ? vc710AllTransactionsForLocalViews()
                    : (Array.isArray(state.transactions) ? state.transactions : []);
                const tab = activeLedgerTab || 'cash';
                const ledgerState = vc7262BuildLedgerState(tab, tx);
                const kind = ledgerState.kind || 'cash';
                summary.innerHTML = ledgerState.summary || '';
                content.classList.toggle('vc5632-credit-customer-list', kind === 'credit');
                content.classList.toggle('vc5632-ledger-date-list', kind !== 'credit');
                content.innerHTML = kind === 'credit'
                    ? vc5632RenderCreditCustomers(ledgerState.list || [], ledgerState.view || vc5632CreditLedgerView)
                    : vc5632RenderGroups(ledgerState.list || [], kind);
            } catch (error) {
                console.warn('Ledger render fallback', error);
                return vc5632OldRenderLedger.apply(this, arguments);
            }
        };
    }

    const vc5632OldRenderInsights = typeof renderInsights === 'function' ? renderInsights : null;
    if (vc5632OldRenderInsights && !window.__vcRenderInsights5632Patched) {
        window.__vcRenderInsights5632Patched = true;
        let lastSig = '';
        let lastAt = 0;
        renderInsights = function() {
            const tx = Array.isArray(state.transactions) ? state.transactions : [];
            const inv = Array.isArray(state.inventory) ? state.inventory : [];
            const sig = JSON.stringify({
                p: typeof insightPeriod !== 'undefined' ? insightPeriod : 'day',
                tx: tx.map(t => [t.id, t.total, t.timestamp, t.type, t.paid, t.businessDate]).join('|'),
                inv: inv.map(p => [p.id, p.stock]).join('|')
            });
            const now = Date.now();
            const visible = !document.getElementById('screen-insights')?.classList.contains('hidden');
            if (visible && sig === lastSig && now - lastAt < 1200) return;
            lastSig = sig;
            lastAt = now;
            return vc5632OldRenderInsights.apply(this, arguments);
        };
    }

    // v8.3.0: Do not pre-render Stock while the PIN modal is still open.
    // switchScreen('inventory') renders Stock once after PIN succeeds.


    const vc5632OldPressPin = typeof pressPin === 'function' ? pressPin : null;
    if (vc5632OldPressPin && !window.__vcPressPin5632Patched) {
        window.__vcPressPin5632Patched = true;
        pressPin = function(num) {
            if (pinBuffer.length < 4) {
                pinBuffer += num;
                updatePinDots();
                if (pinBuffer.length === 4) setTimeout(validatePin, 25);
            }
        };
    }
})();

// v5.6.32a: requested fixes, based on pre-autofocus backup.
// No automatic search focus is added here.
(function(){
    if (window.__vc5632aNoFocusRequestedFixes) return;
    window.__vc5632aNoFocusRequestedFixes = true;

    if (typeof renderSalesChart === 'function' && !window.__vc5632aStableChart) {
        window.__vc5632aStableChart = true;
        const oldRenderSalesChart = renderSalesChart;
        let lastChartSig = '';
        renderSalesChart = function(transactions) {
            try {
                const list = Array.isArray(transactions) ? transactions : [];
                const sig = list.map(t => [t.id, t.total, t.timestamp, t.type, t.paid].join(':')).join('|');
                if (sig === lastChartSig) return;
                lastChartSig = sig;
            } catch(e) {}
            return oldRenderSalesChart.apply(this, arguments);
        };
    }

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
// v7.2.15 Final Insights flicker guard: one owner for Business Day + Recent Activities.
(function(){
    if (window.__vc5632gInsightsFlickerGuard) return;
    window.__vc5632gInsightsFlickerGuard = true;

    function vc5632gIsInsightsVisible() {
        const screen = document.getElementById('screen-insights');
        return !!screen && !screen.classList.contains('hidden');
    }

    if (typeof vc542RenderRecentActivities === 'function') {
        const oldVc542Recent = vc542RenderRecentActivities;
        vc542RenderRecentActivities = function() {
            if (vc5632gIsInsightsVisible() && typeof vc531RenderRecentActivities === 'function') return;
            return oldVc542Recent.apply(this, arguments);
        };
    }

    if (typeof vc560RenderActivities === 'function') {
        const oldVc560Activities = vc560RenderActivities;
        vc560RenderActivities = function() {
            if (vc5632gIsInsightsVisible() && typeof vc531RenderRecentActivities === 'function') return;
            return oldVc560Activities.apply(this, arguments);
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



// v7.2.14: Ledger cleanup complete. Credit is rendered by the main v5.6.32 renderer.


// v8.3.0: Calendar backup/load/archive actions moved to backup-actions.js.

// v8.3.0: Business month, refresh, cleanup, outstanding-credit, and auto-close actions moved to business-actions.js.
