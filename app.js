// --- Firebase Configuration ---
    // SECURITY NOTE: Restrict API keys to your GitHub Pages domain in Firebase Console > API restrictions.
    // Normal URL uses live Firestore. Add ?env=test to use the sandbox Firebase project.
    window.VILLACART_APP_VERSION = 'v7.2.70';
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
    
    function safeLocalJson(key, fallback, label) {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return parsed == null ? fallback : parsed;
        } catch (error) {
            const recovery = {
                key,
                label: label || key,
                at: new Date().toISOString(),
                error: error && error.message ? error.message : String(error)
            };
            window.__villacartStorageRecovery = window.__villacartStorageRecovery || [];
            window.__villacartStorageRecovery.push(recovery);
            try {
                localStorage.setItem(key + '_corrupt_' + Date.now(), raw);
            } catch (backupError) {}
            try { localStorage.removeItem(key); } catch (removeError) {}
            console.warn('Recovered from corrupted local storage:', recovery);
            return fallback;
        }
    }

    vcStartupMark('before-local-state-load');
    let state = safeLocalJson(DB_KEY, {
        inventory: [],
        transactions: [],
        businessDays: [],
        currentBusinessDayId: null,
        cart: [],
        favorites: new Array(8).fill(null)
    }, 'main app state');
    
    if (!state.favorites || !Array.isArray(state.favorites)) {
        state.favorites = new Array(8).fill(null);
    }
    const localArchive = (() => {
        try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '{}') || {}; }
        catch(e) { return {}; }
    })();
    state.archiveTransactions = Array.isArray(localArchive.transactions) ? localArchive.transactions : (Array.isArray(state.archiveTransactions) ? state.archiveTransactions : []);
    state.archiveBusinessDays = Array.isArray(localArchive.businessDays) ? localArchive.businessDays : (Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays : []);
    state.archiveMeta = localArchive.meta && typeof localArchive.meta === 'object' ? localArchive.meta : (state.archiveMeta && typeof state.archiveMeta === 'object' ? state.archiveMeta : {});
    const localFavs = safeLocalJson(FAV_KEY, null, 'favorites');
    if (localFavs && Array.isArray(localFavs)) {
        state.favorites = localFavs;
    }
    state.cartDiscount = Math.max(0, Number(state.cartDiscount) || 0);

    let offlineQueue = safeLocalJson(QUEUE_KEY, [], 'offline queue');
    if (!Array.isArray(offlineQueue)) offlineQueue = [];
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
    let favoriteSlotColors = (() => {
        try {
            const saved = JSON.parse(localStorage.getItem(FAV_COLOR_KEY) || '{}');
            return saved && typeof saved === 'object' ? saved : {};
        } catch(e) { return {}; }
    })();
    let inventoryState = {
        collapsedCategories: {}
    };

    let inventoryUnsubscribe = null;
    let transactionsUnsubscribe = null;
    let businessDaysUnsubscribe = null;

    function titleCase(str) {
        if (!str) return 'Unknown';
        return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function escapeAttr(value) {
        return escapeHTML(value);
    }

    function jsArg(value) {
        return JSON.stringify(String(value ?? '')).replace(/"/g, '&quot;');
    }

    function formatCurrency(value) {
        return `₱${(Number(value) || 0).toLocaleString()}`;
    }

    function csvEscape(value) {
        let text = String(value ?? '');
        if (/^[=+\-@]/.test(text)) text = "'" + text;
        return `"${text.replace(/"/g, '""')}"`;
    }

    function isCreditSettlement(t) {
        return !!(t && t.notes && t.notes.includes('CR-'));
    }

    function isRevenueSale(t) {
        return !!(t && (t.type === 'SA' || t.type === 'CR') && !isCreditSettlement(t));
    }

    function queueTaskIsConfirmed(task, cloudRecord) {
        if (!task || !task.data || !task.data.id) return true;
        if (task.type === 'delete') return !cloudRecord;
        if (!cloudRecord) return false;

        const queued = { ...task.data };
        delete queued._offline;
        return Object.keys(queued).every(key => JSON.stringify(cloudRecord[key]) === JSON.stringify(queued[key]));
    }

    function clearConfirmedQueueRecords(table, cloudRecords) {
        const cloudById = new Map((cloudRecords || []).map(record => [record.id, record]));
        const before = offlineQueue.length;
        offlineQueue = offlineQueue.filter(task =>
            task.table !== table || !queueTaskIsConfirmed(task, cloudById.get(task.data && task.data.id))
        );
        if (offlineQueue.length !== before) {
            if (offlineQueue.length === 0) syncErrorMsg = null;
            sync();
            updateSyncUI();
        }
    }

    function clearConfirmedQueueTasks(table, snapshot) {
        // Do not treat Firestore's local cache as confirmation. Wait for a
        // server-backed snapshot, then remove only operations whose final
        // state is visible there.
        if (!snapshot || snapshot.metadata.hasPendingWrites) return;
        clearConfirmedQueueRecords(table, snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }

    function nextTransactionId(type) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(-2);
        const dateCode = dd + mm + yy;
        const counterKey = APP_ENV === 'test' ? 'dailyCounters_test' : 'dailyCounters';
        const counters = JSON.parse(localStorage.getItem(counterKey) || '{}');
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


    // v7.2.14: Auto-sync read scope.
    // Keep automatic sync, but avoid re-reading old transaction history forever.
    function vc5632lDateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function vc5632lMonthBounds(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        return { start: vc5632lDateCode(start), end: vc5632lDateCode(end) };
    }

    function vc5632lTransactionDate(tx) {
        return tx && (tx.businessDate || (tx.timestamp ? vc5632lDateCode(tx.timestamp) : ''));
    }

    function vc5632lInCurrentMonth(tx) {
        const bounds = vc5632lMonthBounds();
        const d = vc5632lTransactionDate(tx);
        return !!d && d >= bounds.start && d <= bounds.end;
    }

    function vc5632lBusinessDayInScope(day) {
        const bounds = vc5632lMonthBounds();
        const d = day && (day.date || (day.openedAt ? vc5632lDateCode(day.openedAt) : ''));
        return !!d && d >= bounds.start && d <= bounds.end;
    }

    function vc5632mTodayBounds() {
        const today = vc5632lDateCode(new Date());
        return { start: today, end: today };
    }

    function vc5632mInDateRange(item, bounds) {
        if (!bounds) return true;
        const d = item && (item.businessDate || item.date || (item.timestamp ? vc5632lDateCode(item.timestamp) : ''));
        return !!d && d >= bounds.start && d <= bounds.end;
    }

    function saveLocalArchive() {
        try {
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify({
                transactions: Array.isArray(state.archiveTransactions) ? state.archiveTransactions : [],
                businessDays: Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays : [],
                meta: state.archiveMeta && typeof state.archiveMeta === 'object' ? state.archiveMeta : {},
                savedAt: new Date().toISOString()
            }));
        } catch(e) {}
    }

    function sync() { 
        localStorage.setItem(DB_KEY, JSON.stringify(state)); 
        localStorage.setItem(QUEUE_KEY, JSON.stringify(offlineQueue));
        localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites));
        saveLocalArchive();
        updateQueueBadge();
    }

    function firestoreWriteWithTimeout(write, timeoutMs = 15000) {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Firestore write timed out; it will be retried.')), timeoutMs);
        });
        return Promise.race([write, timeout]).finally(() => clearTimeout(timeoutId));
    }

    function firestoreRestValue(value) {
        if (value === null || value === undefined) return { nullValue: null };
        if (value instanceof Date) return { timestampValue: value.toISOString() };
        if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreRestValue) } };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
        if (typeof value === 'object') {
            return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreRestValue(item)])) } };
        }
        return { stringValue: String(value) };
    }

    function firestoreRestToValue(value) {
        if (!value || typeof value !== 'object') return null;
        if ('nullValue' in value) return null;
        if ('booleanValue' in value) return value.booleanValue;
        if ('integerValue' in value) return Number(value.integerValue);
        if ('doubleValue' in value) return Number(value.doubleValue);
        if ('timestampValue' in value) return value.timestampValue;
        if ('stringValue' in value) return value.stringValue;
        if ('referenceValue' in value) return value.referenceValue;
        if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreRestToValue);
        if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, firestoreRestToValue(item)]));
        return null;
    }

    const VC_OPTIONAL_SCRIPTS = {
        html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        Chart: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
    };
    const vcOptionalScriptPromises = {};

    function loadOptionalScript(globalName, src) {
        if (window[globalName]) return Promise.resolve(window[globalName]);
        if (vcOptionalScriptPromises[globalName]) return vcOptionalScriptPromises[globalName];
        vcOptionalScriptPromises[globalName] = new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-vc-optional="${globalName}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve(window[globalName]), { once: true });
                existing.addEventListener('error', () => reject(new Error(globalName + ' failed to load')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.vcOptional = globalName;
            script.onload = () => resolve(window[globalName]);
            script.onerror = () => reject(new Error(globalName + ' failed to load'));
            document.head.appendChild(script);
        });
        return vcOptionalScriptPromises[globalName];
    }

    function ensureHtml2CanvasLoaded() {
        return loadOptionalScript('html2canvas', VC_OPTIONAL_SCRIPTS.html2canvas);
    }

    function ensureChartLoaded() {
        return loadOptionalScript('Chart', VC_OPTIONAL_SCRIPTS.Chart);
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

        return documents.map(document => ({
            id: document.name.split('/').pop(),
            ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreRestToValue(value)]))
        }));
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
            .map(document => ({
                id: document.name.split('/').pop(),
                ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreRestToValue(value)]))
            }));
    }

    async function syncTaskWithFirestoreRest(task) {
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
        }
    }

    function markSyncedTaskLocally(task) {
        if (!task || !task.table || !task.data || !task.data.id) return;
        const list = task.table === 'transactions' ? state.transactions
            : task.table === 'inventory' ? state.inventory
            : task.table === 'businessDays' ? state.businessDays
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
    function vc7226LooksLikeBarcode(value) {
        const text = String(value || '').trim();
        return text.length >= 3 && /^[0-9A-Za-z._-]+$/.test(text);
    }

    function vc7227NormalizeBarcode(value) {
        return String(value == null ? '' : value).trim().replace(/\s+/g, '');
    }

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

    window.__villacartScannerDebug = window.__villacartScannerDebug || {
        events: [],
        lastInputValue: '',
        lastBarcodeAttempt: '',
        lastBarcodeResult: '',
        lastHandledAt: null,
        initAt: new Date().toISOString(),
        appVersion: window.VILLACART_APP_VERSION || 'unknown'
    };
    window.__villacartScannerDebug.appVersion = window.VILLACART_APP_VERSION || window.__villacartScannerDebug.appVersion || 'unknown';

    function vc7228ScannerDebug(type, data) {
        try {
            const dbg = window.__villacartScannerDebug;
            const entry = {
                at: new Date().toISOString(),
                type,
                ...(data || {})
            };
            dbg.events.push(entry);
            if (dbg.events.length > 25) dbg.events.shift();
        } catch(e) {}
    }

    function vc7228RecentlyHandled(code) {
        const dbg = window.__villacartScannerDebug;
        const clean = vc7227NormalizeBarcode(code);
        return !!(dbg && dbg.lastBarcodeAttempt === clean && dbg.lastHandledAt && Date.now() - dbg.lastHandledAt < 900);
    }

    function vc7228MarkHandled(code, result) {
        try {
            const dbg = window.__villacartScannerDebug;
            dbg.lastBarcodeAttempt = vc7227NormalizeBarcode(code);
            dbg.lastBarcodeResult = result || '';
            dbg.lastHandledAt = Date.now();
            vc7228ScannerDebug('handled', { code: dbg.lastBarcodeAttempt, result: dbg.lastBarcodeResult });
        } catch(e) {}
    }

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

    // v7.2.70: The older fallback keydown listener was removed.
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

    function toggleFavoritesMode() {
        favoritesEditMode = !favoritesEditMode;
        favoriteDragState = null;
        favoriteDragSuppressClick = false;
        const btn = document.getElementById('fav-mode-btn');
        btn.innerText = favoritesEditMode ? "Done Editing" : "Edit Slots";
        btn.classList.toggle('text-primary', favoritesEditMode);
        btn.classList.toggle('text-primary/40', !favoritesEditMode);
        renderFavorites();
    }

    function addFavoriteSlot() {
        state.favorites.push(null);
        sync();
        renderFavorites();
        showToast("Slot added", "success");
    }

    function removeFavoriteSlot(index, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        state.favorites.splice(index, 1);
        sync();
        renderFavorites();
        showToast("Slot removed", "info");
    }

    let favoriteDragState = null;
    let favoriteDragSuppressClick = false;

    function favoriteSlotShell(index, innerHtml) {
        const dragAttrs = favoritesEditMode
            ? ` data-fav-index="${index}" onpointerdown="beginFavoriteDrag(event, ${index})" onpointermove="moveFavoriteDrag(event)" onpointerup="endFavoriteDrag(event)" onpointercancel="cancelFavoriteDrag(event)"`
            : ` data-fav-index="${index}"`;
        const touchClass = favoritesEditMode ? 'touch-none' : 'touch-pan-y';
        return `<div class="favorite-slot relative h-[90px] md:h-32 ${touchClass} select-none"${dragAttrs}>${innerHtml}</div>`;
    }

    function saveFavoriteColors() {
        try { localStorage.setItem(FAV_COLOR_KEY, JSON.stringify(favoriteSlotColors || {})); } catch(e) {}
    }

    function favoriteColorValue(index) {
        const value = favoriteSlotColors && favoriteSlotColors[String(index)] ? String(favoriteSlotColors[String(index)]) : '';
        return favoriteColorPalette.some(color => color.value === value) ? value : '';
    }

    function favoriteColorStyle(index) {
        const value = favoriteColorValue(index);
        return value ? ` style="background-color: ${value};"` : '';
    }

    function favoriteSlotControls(index) {
        if (!favoritesEditMode) return '';
        return `${favoriteEditOverlay()}${favoriteColorButton(index)}${favoriteRemoveButton(index)}`;
    }

    function favoriteColorButton(index) {
        if (!favoritesEditMode) return '';
        return `<button data-fav-color="true" onclick="openFavoriteColorPicker(${index}, event)" class="absolute top-1 left-1 bg-white/90 text-primary w-6 h-6 rounded-full flex items-center justify-center shadow-md active:scale-90 z-20 border border-primary/10" title="Change color"><span class="material-symbols-outlined text-[14px]">palette</span></button>`;
    }

    function favoriteEditOverlay() {
        if (!favoritesEditMode) return '';
        return `<div class="absolute inset-0 bg-primary/75 flex flex-col items-center justify-center text-white gap-1 pointer-events-none">
            <span class="material-symbols-outlined text-[22px]">drag_indicator</span>
            <span class="text-[7px] md:text-[9px] font-black uppercase tracking-widest">Drag</span>
        </div>`;
    }

    function favoriteRemoveButton(index) {
        if (!favoritesEditMode) return '';
        return `<button data-fav-remove="true" onclick="removeFavoriteSlot(${index}, event)" class="absolute top-1 right-1 bg-error text-white w-6 h-6 rounded-full flex items-center justify-center shadow-md active:scale-90 z-20">
            <span class="material-symbols-outlined text-[14px]">close</span>
        </button>`;
    }

    function favoriteBaseButtonClass(kind) {
        if (kind === 'empty') return 'w-full h-full border-2 border-dashed border-primary/10 rounded-2xl flex flex-col items-center justify-center gap-1 active-scale group hover:border-primary/30 transition-colors';
        if (kind === 'missing') return 'w-full h-full border-2 border-dashed border-error/20 rounded-2xl flex flex-col items-center justify-center text-error/50';
        return 'relative w-full h-full border border-border-subtle rounded-2xl flex flex-col items-center justify-center px-1.5 pt-2 pb-6 md:px-2 md:pt-3 md:pb-7 overflow-hidden active-scale shadow-sm hover:shadow-md transition-all';
    }

    function favoriteStockClass(product) {
        const stockCount = Math.max(0, Number(product.stock) || 0);
        if (stockCount <= 0) return 'text-error bg-error/10';
        if (stockCount <= (Number(product.lowStock) || 5)) return 'text-amber-700 bg-amber-50';
        return 'text-primary/60 bg-primary/5';
    }

    function renderFavoriteEmptySlot(index) {
        return favoriteSlotShell(index, `<button onclick="openFavoritesPicker(${index})" class="${favoriteBaseButtonClass('empty')}"${favoriteColorStyle(index)}>
            <span class="material-symbols-outlined text-[20px] md:text-[28px] text-primary/30 group-hover:text-primary transition-colors">add</span>
            <span class="text-[7px] md:text-[10px] font-black uppercase text-primary/30 group-hover:text-primary transition-colors">Set Slot</span>
        </button>${favoriteSlotControls(index)}`);
    }

    function renderFavoriteMissingSlot(index) {
        return favoriteSlotShell(index, `<button onclick="openFavoritesPicker(${index})" class="${favoriteBaseButtonClass('missing')}"${favoriteColorStyle(index)}>
            <span class="material-symbols-outlined">error</span>
        </button>${favoriteSlotControls(index)}`);
    }

    function favoriteProductContent(product) {
        const stockCount = Math.max(0, Number(product.stock) || 0);
        return `<span class="text-[9px] md:text-[13px] font-black text-primary leading-tight line-clamp-2 md:line-clamp-3 text-center uppercase">${escapeHTML(product.name)}</span>
            <span class="text-[11px] md:text-[16px] font-black text-secondary mt-1 leading-none">${formatCurrency(product.price)}</span>
            <span class="absolute bottom-1.5 md:bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap px-1 md:px-2 py-0.5 rounded-full text-[6px] md:text-[8px] font-black uppercase tracking-wide ${favoriteStockClass(product)}">Stock: ${stockCount}</span>`;
    }

    function renderFavoriteProductSlot(fav, index) {
        const product = state.inventory.find(p => p.id === fav.id);
        if (!product) return renderFavoriteMissingSlot(index);
        return favoriteSlotShell(index, `<button onclick="handleFavoriteClick(${index})" class="${favoriteBaseButtonClass('product')}"${favoriteColorStyle(index)}>
            ${favoriteProductContent(product)}
        </button>${favoriteSlotControls(index)}`);
    }

    function renderFavorites() {
        const grid = document.getElementById('favorites-grid');
        if (!grid) return;
        let html = state.favorites.map((fav, index) => fav ? renderFavoriteProductSlot(fav, index) : renderFavoriteEmptySlot(index)).join('');
        if (favoritesEditMode) {
            html += `<button onclick="addFavoriteSlot()" class="h-[90px] md:h-32 border-2 border-primary/20 bg-primary/5 rounded-2xl flex flex-col items-center justify-center gap-1 active-scale group hover:bg-primary/10 transition-colors">
                <span class="material-symbols-outlined text-[20px] md:text-[28px] text-primary">add_circle</span>
                <span class="text-[7px] md:text-[10px] font-black uppercase text-primary">Add New Slot</span>
            </button>`;
        }
        grid.innerHTML = html;
    }

    function beginFavoriteDrag(event, index) {
        if (!favoritesEditMode || event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest('[data-fav-remove="true"],[data-fav-color="true"]')) return;
        favoriteDragState = {
            from: index,
            startX: event.clientX,
            startY: event.clientY,
            dragging: false,
            slot: event.currentTarget
        };
        if (favoriteDragState.slot && favoriteDragState.slot.setPointerCapture) {
            try { favoriteDragState.slot.setPointerCapture(event.pointerId); } catch(e) {}
        }
    }

    function moveFavoriteDrag(event) {
        if (!favoriteDragState) return;
        const dx = event.clientX - favoriteDragState.startX;
        const dy = event.clientY - favoriteDragState.startY;
        if (!favoriteDragState.dragging && Math.hypot(dx, dy) > 10) {
            favoriteDragState.dragging = true;
            if (favoriteDragState.slot) {
                favoriteDragState.slot.style.opacity = '0.55';
                favoriteDragState.slot.style.transform = 'scale(0.96)';
                favoriteDragState.slot.style.zIndex = '30';
            }
        }
        if (favoriteDragState.dragging) {
            event.preventDefault();
            if (favoriteDragState.slot) favoriteDragState.slot.style.transform = `translate(${dx}px, ${dy}px) scale(0.96)`;
        }
    }

    function reorderFavoriteSlot(fromIndex, toIndex) {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.favorites.length || toIndex >= state.favorites.length) return false;
        const moved = state.favorites.splice(fromIndex, 1)[0];
        state.favorites.splice(toIndex, 0, moved);
        sync();
        renderFavorites();
        return true;
    }

    function endFavoriteDrag(event) {
        if (!favoriteDragState) return;
        const drag = favoriteDragState;
        favoriteDragState = null;
        if (drag.slot) {
            drag.slot.style.opacity = '';
            drag.slot.style.transform = '';
            drag.slot.style.zIndex = '';
        }
        if (!drag.dragging) return;
        event.preventDefault();
        event.stopPropagation();
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const targetSlot = target && target.closest ? target.closest('[data-fav-index]') : null;
        const toIndex = targetSlot ? Number(targetSlot.getAttribute('data-fav-index')) : drag.from;
        favoriteDragSuppressClick = true;
        const changed = reorderFavoriteSlot(drag.from, toIndex);
        if (changed) showToast('Favorite moved', 'success');
        setTimeout(() => { favoriteDragSuppressClick = false; }, 150);
    }

    function cancelFavoriteDrag() {
        if (favoriteDragState && favoriteDragState.slot) {
            favoriteDragState.slot.style.opacity = '';
            favoriteDragState.slot.style.transform = '';
            favoriteDragState.slot.style.zIndex = '';
        }
        favoriteDragState = null;
    }

    function handleFavoriteClick(index) {
        if (favoriteDragSuppressClick) return;
        if (favoritesEditMode) { openFavoritesPicker(index); } else {
            const fav = state.favorites[index];
            if (fav) {
                const product = state.inventory.find(p => p.id === fav.id);
                if (product && product.packPrice && product.packPrice > 0) openScanChoiceModal(product);
                else addToCart(fav.id, 'piece');
            }
        }
    }

    function openFavoritesPicker(index) {
        currentFavSlotIndex = index;
        document.getElementById('fav-picker-search').value = '';
        const btn = document.getElementById('fav-remove-slot-btn');
        if (btn) btn.classList.toggle('hidden', !favoritesEditMode);
        renderFavPickerList();
        closeModal('fav-picker-modal');
        document.getElementById('fav-picker-modal').classList.replace('hidden', 'flex');
    }

    function renderFavPickerList(query = '') {
        const list = document.getElementById('fav-picker-list');
        const filtered = state.inventory.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
        if (filtered.length === 0) { list.innerHTML = `<div class="p-4 text-center text-xs opacity-50 font-bold uppercase">No matches</div>`; return; }
        list.innerHTML = filtered.map(p => `<button onclick="assignFavorite(${jsArg(p.id)})" class="w-full p-4 bg-surface-container/30 border border-border-subtle rounded-2xl flex justify-between items-center active-scale hover:bg-primary-container transition-colors text-left"><div class="min-w-0 flex-1"><p class="text-xs font-black text-primary uppercase truncate">${escapeHTML(p.name)}</p><p class="text-[10px] font-bold text-on-surface-variant">${escapeHTML(p.category || 'General')}</p></div><p class="text-xs font-black text-secondary ml-2">${formatCurrency(p.price)}</p></button>`).join('');
    }

    function assignFavorite(productId) { if (currentFavSlotIndex === null) return; state.favorites[currentFavSlotIndex] = { id: productId }; sync(); renderFavorites(); closeModal('fav-picker-modal'); showToast("Slot updated", "success"); }
    function clearFavoriteSlot() { if (currentFavSlotIndex === null) return; state.favorites[currentFavSlotIndex] = null; sync(); renderFavorites(); closeModal('fav-picker-modal'); showToast("Slot cleared", "info"); }
    function removeFavoriteSlotAction() { if (currentFavSlotIndex === null) return; removeFavoriteSlot(currentFavSlotIndex); closeModal('fav-picker-modal'); }

    function openFavoriteColorPicker(index, event) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        currentFavSlotIndex = index;
        const list = document.getElementById('fav-color-palette');
        if (!list) return;
        const current = favoriteColorValue(index);
        list.innerHTML = favoriteColorPalette.map(color => {
            const selected = current === color.value;
            const swatch = color.value || '#FFFFFF';
            return `<button onclick="setFavoriteColor('${color.value}', ${index})" class="fav-color-chip ${selected ? 'selected' : ''}" style="--fav-chip-color:${swatch}"><span></span><small>${escapeHTML(color.name)}</small></button>`;
        }).join('');
        closeModal('fav-picker-modal');
        document.getElementById('fav-color-modal').classList.replace('hidden', 'flex');
    }

    function setFavoriteColor(value, index = currentFavSlotIndex) {
        if (index === null || index === undefined) return;
        const key = String(index);
        if (!value) delete favoriteSlotColors[key];
        else favoriteSlotColors[key] = value;
        saveFavoriteColors();
        renderFavorites();
        closeModal('fav-color-modal');
        showToast(value ? 'Favorite color updated' : 'Favorite color reset', 'success');
    }

    function clearFavoriteColor() {
        setFavoriteColor('', currentFavSlotIndex);
    }

    function updateSyncUI() {
        const pill = document.getElementById('sync-pill');
        const dot = document.getElementById('sync-dot');
        const text = document.getElementById('sync-text');
        const spinner = document.getElementById('sync-spinner');
        const errLabel = document.getElementById('sync-error-label');
        if (!pill) return;
        
        if (syncErrorMsg) {
            errLabel.classList.remove('hidden');
            errLabel.innerText = syncErrorMsg;
            pill.classList.add('ring-2', 'ring-red-500/50');
        } else {
            errLabel.classList.add('hidden');
            pill.classList.remove('ring-2', 'ring-red-500/50');
        }

        if (!navigator.onLine) {
            pill.classList.replace('bg-white/10', 'bg-red-500/20'); pill.classList.replace('border-white/20', 'border-red-500/40');
            dot.classList.replace('bg-green-400', 'bg-red-500'); text.innerText = "Offline"; spinner.classList.add('hidden'); return;
        }
        if (isSyncing) { 
            dot.classList.add('hidden'); 
            spinner.classList.remove('hidden'); 
            spinner.classList.add('animate-spin-custom'); 
            text.innerText = "Syncing..."; 
        }
        else { 
            pill.classList.remove('bg-red-500/20', 'border-red-500/40'); 
            pill.classList.add('bg-white/10', 'border-white/20'); 
            dot.classList.remove('hidden'); 
            dot.classList.replace('bg-red-500', 'bg-green-400'); 
            spinner.classList.add('hidden'); 
            text.innerText = "Online"; 
        }
        updateQueueBadge();
    }

    function updateQueueBadge() {
        const badge = document.getElementById('queue-badge');
        if (badge) { if (offlineQueue.length > 0) { badge.innerText = offlineQueue.length; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); } }
    }

    function isPendingSync(table, id) {
        return Array.isArray(offlineQueue) && offlineQueue.some(task => task && task.table === table && task.data && task.data.id === id);
    }

    window.addEventListener('online', () => { updateSyncUI(); syncNow(); });
    window.addEventListener('offline', () => { updateSyncUI(); });

    
    // v5.6.1 UI Polish helpers
    function updateActiveNavigation(screen) {
        document.querySelectorAll('.nav-item').forEach(btn => {
            const isActive = btn.dataset.screen === screen;
            btn.classList.toggle('nav-active', isActive);
            btn.classList.toggle('text-primary', isActive);
            btn.classList.toggle('text-on-surface-variant', !isActive);
            btn.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
    }

    function updateTodayBadge() {
        const syncPill = document.getElementById('sync-pill');
        const syncTimestamp = document.getElementById('sync-timestamp');
        const now = new Date();
        const dateText = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        if (syncPill && !syncPill.dataset.vcPolished) {
            syncPill.dataset.vcPolished = 'true';
            syncPill.title = `Today • ${dateText}`;
        }
        if (syncTimestamp && !syncTimestamp.dataset.vcDateAdded) {
            syncTimestamp.dataset.vcDateAdded = 'true';
            syncTimestamp.innerText = `Today • ${dateText} • Last Synced: --:--`;
        }
    }

    function applyUIPolish() {
        updateTodayBadge();
        document.querySelectorAll('button').forEach(btn => btn.classList.add('vc-touch-polish'));
        const active = document.querySelector('.screen-transition:not(.hidden)');
        if (active && active.id && active.id.startsWith('screen-')) {
            updateActiveNavigation(active.id.replace('screen-', ''));
        } else {
            updateActiveNavigation('pos');
        }
    }


    // v5.6.1 UI Polish Fix: keep active nav synced on mobile/tablet
    function refreshActiveNavigationFromDOM() {
        const visibleScreen = Array.from(document.querySelectorAll('[id^="screen-"]'))
            .find(el => !el.classList.contains('hidden'));
        if (visibleScreen && visibleScreen.id) {
            updateActiveNavigation(visibleScreen.id.replace('screen-', ''));
        }
    }

    document.addEventListener('click', (event) => {
        const navBtn = event.target.closest('.nav-item[data-screen]');
        if (!navBtn) return;
        updateActiveNavigation(navBtn.dataset.screen);
        setTimeout(refreshActiveNavigationFromDOM, 80);
    });

function switchScreen(id) {
        document.querySelectorAll('.screen-transition').forEach(s => s.classList.add('hidden'));
        const targetScreen = document.getElementById('screen-' + id);
        if (targetScreen) targetScreen.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(n => {
            const isActive = n.dataset.screen === id;
            n.classList.toggle('text-primary', isActive);
            n.classList.toggle('text-on-surface-variant', !isActive);
        });
        if (id === 'inventory') renderInventory();
        if (id === 'history') switchLedgerTab(activeLedgerTab);
        if (id === 'insights') renderInsights();
        if (id === 'business' && typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
        if (id === 'pos') renderFavorites();
    }

    // v7.2.37: Android/PWA resume repaint guard.
    // Some WebView/TWA sessions return from background as a black compositor
    // frame until the user taps/back-navigates. This local-only repaint nudges
    // the browser to redraw the visible screen without doing Firestore reads.
    let vc7230LastResumeRepaintAt = 0;
    function vc7230VisibleScreenId() {
        const visible = Array.from(document.querySelectorAll('.screen-transition[id^="screen-"]'))
            .find(el => !el.classList.contains('hidden'));
        return visible && visible.id ? visible.id.replace('screen-', '') : 'pos';
    }

    function vc7230ResumeRepaint(reason) {
        const now = Date.now();
        if (now - vc7230LastResumeRepaintAt < 700) return;
        vc7230LastResumeRepaintAt = now;
        try {
            const id = vc7230VisibleScreenId();
            document.documentElement.classList.add('vc-pwa-resume-repaint');
            document.body.classList.add('vc-pwa-resume-repaint');

            requestAnimationFrame(() => {
                try {
                    const screen = document.getElementById('screen-' + id) || document.getElementById('screen-pos');
                    if (screen) screen.classList.remove('hidden');
                    refreshActiveNavigationFromDOM();
                    updateTodayBadge();
                    if (typeof updateSyncUI === 'function') updateSyncUI();
                    if (id === 'pos') {
                        if (typeof renderFavorites === 'function') renderFavorites();
                        if (typeof updateCartUI === 'function') updateCartUI();
                    }
                    if (typeof vcStartupMark === 'function') vcStartupMark('pwa-resume-repaint', { reason, screen: id });
                } catch(e) {
                    console.warn('PWA resume repaint inner failed', reason, e);
                }
                setTimeout(() => {
                    document.documentElement.classList.remove('vc-pwa-resume-repaint');
                    document.body.classList.remove('vc-pwa-resume-repaint');
                }, 180);
            });
        } catch(e) {
            console.warn('PWA resume repaint failed', reason, e);
        }
    }

    window.addEventListener('pageshow', () => vc7230ResumeRepaint('pageshow'));
    window.addEventListener('focus', () => vc7230ResumeRepaint('focus'));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') vc7230ResumeRepaint('visible');
    });

    function attemptInventoryAccess() { if (!document.getElementById('screen-inventory').classList.contains('hidden')) { switchScreen('inventory'); return; } openPinModal("inventory"); }

    function openPinModal(target) { pinBuffer = ""; updatePinDots(); const modal = document.getElementById('pin-modal'); modal.classList.replace('hidden', 'flex'); window._pinTarget = target; }
    function pressPin(num) { if (pinBuffer.length < 4) { pinBuffer += num; updatePinDots(); if (pinBuffer.length === 4) setTimeout(validatePin, 150); } }
    function updatePinDots() { for (let i = 0; i < 4; i++) { const dot = document.getElementById(`dot-${i}`); if (dot) dot.classList.toggle('bg-primary', i < pinBuffer.length); } }
    function validatePin() { 
        hashPin(pinBuffer).then(hash => {
            if (hash === STORED_PIN_HASH) { 
                const target = window._pinTarget; 
                closeModal('pin-modal'); 
                if (target === 'inventory') switchScreen('inventory'); 
                else if (target === 'change-pin') openChangePinModal();
                else if (target && target.action === 'delete') deleteTransaction(target.id); 
                showToast('Verified', 'success'); 
            } else { 
                showToast('Incorrect PIN', 'error'); 
                pinBuffer = ""; 
                updatePinDots(); 
            }
        });
    }
    function clearPin() { pinBuffer = ""; updatePinDots(); }

    function handlePosSearch(val) {
        const container = document.getElementById('search-results-container');
        const grid = document.getElementById('product-grid');
        if (!val) { container.classList.add('hidden'); return; }
        const filtered = state.inventory.filter(p => p.name.toLowerCase().includes(val.toLowerCase()) || (p.barcode && p.barcode.includes(val)));
        if (filtered.length > 0) {
            container.classList.remove('hidden');
            grid.innerHTML = filtered.map(p => `<div class="py-3 px-2 border-b border-border-subtle last:border-0"><div class="flex items-center gap-2 mb-2"><h4 class="font-black text-sm text-on-surface">${escapeHTML(p.name)}</h4><span class="text-[8px] font-black uppercase bg-primary-container text-primary px-2 py-0.5 rounded-full">${escapeHTML(p.category || 'General')}</span></div><div class="flex gap-2"><button onclick="addToCart(${jsArg(p.id)}, 'piece')" class="flex-1 bg-surface-container py-2.5 px-3 text-left rounded-xl active-scale"><p class="text-[8px] uppercase font-bold opacity-50">Piece</p><p class="font-black text-xs text-primary">${formatCurrency(p.price)}</p></button>${p.packPrice ? `<button onclick="addToCart(${jsArg(p.id)}, 'pack')" class="flex-1 bg-secondary/5 py-2.5 px-3 text-left rounded-xl active-scale"><p class="text-[8px] uppercase font-bold text-secondary">Pack (${escapeHTML(p.packSize)})</p><p class="font-black text-xs text-secondary">${formatCurrency(p.packPrice)}</p></button>` : ''}</div></div>`).join('');
        } else { grid.innerHTML = '<div class="p-6 text-center text-xs opacity-50 font-bold uppercase tracking-wider">No matches found</div>'; }
    }

    function addToCart(id, type) {
        const p = state.inventory.find(i => i.id === id);
        if (!p) return;
        const cartId = `${id}-${type}`;
        const existing = state.cart.find(item => item.cartId === cartId);
        const deduct = type === 'pack' ? (parseInt(p.packSize) || 1) : 1;
        const currentQty = existing ? existing.qty : 0;
        if ((currentQty + 1) * deduct > (Number(p.stock) || 0)) {
            showToast(`Only ${p.stock} pcs available`, 'error');
            return;
        }
        if (existing) { existing.qty++; } else { state.cart.push({ cartId, id: p.id, name: p.name, type, price: type === 'pack' ? p.packPrice : p.price, cost: p.cost, deduct, qty: 1 }); }
        const searchInput = document.getElementById('pos-search'); if (searchInput) searchInput.value = '';
        const results = document.getElementById('search-results-container'); if (results) results.classList.add('hidden');
        sync();
        updateCartUI();
    }

    function getCartStockIssue() {
        const totals = {};
        state.cart.forEach(item => {
            totals[item.id] = (totals[item.id] || 0) + (item.qty * (item.deduct || 1));
        });
        for (const [id, needed] of Object.entries(totals)) {
            const product = state.inventory.find(p => p.id === id);
            const available = product ? Number(product.stock) || 0 : 0;
            if (!product || needed > available) {
                return `${product ? product.name : 'A product'} needs ${needed} pcs, but only ${available} are available.`;
            }
        }
        return null;
    }

    function getCartSubtotal() {
        return (state.cart || []).reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
    }

    function getCartCount() {
        return (state.cart || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    }

    function getCartDiscount() {
        const subtotal = getCartSubtotal();
        const discount = Math.max(0, Number(state.cartDiscount) || 0);
        return Math.min(discount, subtotal);
    }

    function getCartTotal() {
        return Math.max(0, getCartSubtotal() - getCartDiscount());
    }

    function setCartDiscount() {
        if (!state.cart || state.cart.length === 0) {
            showToast('Add an item before discounting', 'error');
            return;
        }
        const modal = document.getElementById('cart-discount-modal');
        const input = document.getElementById('discount-modal-input');
        const subtotalEl = document.getElementById('discount-modal-subtotal');
        if (subtotalEl) subtotalEl.innerText = formatCurrency(getCartSubtotal());
        if (input) input.value = getCartDiscount() > 0 ? String(getCartDiscount()) : '';
        updateCartDiscountPreview();
        if (modal) modal.classList.replace('hidden', 'flex');
    }

    function updateCartDiscountPreview() {
        const input = document.getElementById('discount-modal-input');
        const subtotal = getCartSubtotal();
        const raw = input ? String(input.value || '').trim() : '';
        const amount = raw === '' ? 0 : Number(raw);
        const discount = Number.isFinite(amount) && amount > 0 ? Math.min(amount, subtotal) : 0;
        const totalEl = document.getElementById('discount-modal-total');
        const subtotalEl = document.getElementById('discount-modal-subtotal');
        if (subtotalEl) subtotalEl.innerText = formatCurrency(subtotal);
        if (totalEl) totalEl.innerText = formatCurrency(Math.max(0, subtotal - discount));
    }

    function applyCartDiscount() {
        const input = document.getElementById('discount-modal-input');
        const raw = input ? String(input.value || '').trim() : '';
        const amount = raw === '' ? 0 : Number(raw);
        if (!Number.isFinite(amount) || amount < 0) {
            showToast('Invalid discount amount', 'error');
            return;
        }
        state.cartDiscount = Math.min(amount, getCartSubtotal());
        sync();
        updateCartUI();
        closeModal('cart-discount-modal');
        showToast(state.cartDiscount > 0 ? 'Discount applied' : 'Discount removed', 'success');
    }

    function removeCartDiscount() {
        state.cartDiscount = 0;
        sync();
        updateCartUI();
        closeModal('cart-discount-modal');
        showToast('Discount removed', 'success');
    }

    function resetCartDiscount() {
        state.cartDiscount = 0;
    }

    function updateCartUI() {
        const container = document.getElementById('cart-items');
        if (!container) return;
        const subtotalEl = document.getElementById('cart-subtotal');
        const totalEl = document.getElementById('cart-total');
        const discountRow = document.getElementById('cart-discount-row');
        const discountEl = document.getElementById('cart-discount');
        const discountBtn = document.getElementById('cart-discount-btn');
        const countPill = document.getElementById('cart-count-pill');
        if (countPill) countPill.innerText = String(getCartCount());
        if (state.cart.length === 0) {
            resetCartDiscount();
            container.innerHTML = `<div class="h-full flex flex-col items-center justify-center opacity-20 py-20"><span class="material-symbols-outlined text-[64px]">shopping_basket</span><p class="text-xs font-black uppercase mt-2 tracking-widest">Order is empty</p></div>`;
            if (subtotalEl) subtotalEl.innerText = '₱0.00';
            if (totalEl) totalEl.innerText = '₱0.00';
            if (discountRow) discountRow.classList.add('hidden');
            if (discountEl) discountEl.innerText = '-₱0.00';
            if (discountBtn) discountBtn.innerText = 'Add Discount';
            return;
        }
        container.innerHTML = state.cart.map((item, idx) => {
            const lineTotal = item.price * item.qty;
            return `<div class="bg-surface-container/50 border border-border-subtle p-4 rounded-2xl flex justify-between items-center shadow-sm"><div class="min-w-0 flex-1"><div class="flex items-center gap-2 mb-1.5"><span class="text-[8px] font-black ${item.type === 'pack' ? 'bg-secondary' : 'bg-primary'} text-white px-1.5 py-0.5 rounded uppercase tracking-tighter">${escapeHTML(item.type)}</span><h4 class="font-bold text-sm truncate">${escapeHTML(item.name)}</h4></div><p class="text-xs font-bold opacity-50">${formatCurrency(item.price)} each</p></div><div class="flex items-center gap-3"><span class="font-black text-base whitespace-nowrap">${formatCurrency(lineTotal)}</span><div class="flex items-center bg-white border border-border-subtle rounded-xl shadow-sm"><button onclick="updateQty(${idx}, -1)" class="w-9 h-9 flex items-center justify-center text-error active-scale"><span class="material-symbols-outlined text-[20px]">remove_circle</span></button><input type="number" inputmode="numeric" min="1" value="${item.qty}" onchange="setQty(${idx}, this.value)" class="w-10 text-center text-xs font-black border-0 bg-transparent focus:outline-none p-0" style="min-height:unset"/><button onclick="updateQty(${idx}, 1)" class="w-9 h-9 flex items-center justify-center text-secondary active-scale"><span class="material-symbols-outlined text-[20px]">add_circle</span></button></div></div></div>`;
        }).join('');
        const subtotal = getCartSubtotal();
        const discount = getCartDiscount();
        const total = getCartTotal();
        if (state.cartDiscount !== discount) state.cartDiscount = discount;
        if (subtotalEl) subtotalEl.innerText = formatCurrency(subtotal);
        if (totalEl) totalEl.innerText = formatCurrency(total);
        if (discountRow) discountRow.classList.toggle('hidden', discount <= 0);
        if (discountEl) discountEl.innerText = '-' + formatCurrency(discount);
        if (discountBtn) discountBtn.innerText = discount > 0 ? 'Edit Discount' : 'Add Discount';
    }

    function updateQty(idx, delta) {
        if (!state.cart[idx]) return;
        const nextQty = state.cart[idx].qty + delta;
        if (nextQty <= 0) { state.cart.splice(idx, 1); sync(); updateCartUI(); return; }
        const product = state.inventory.find(p => p.id === state.cart[idx].id);
        const available = product ? Number(product.stock) || 0 : 0;
        if (nextQty * (state.cart[idx].deduct || 1) > available) { showToast(`Only ${available} pcs available`, 'error'); return; }
        state.cart[idx].qty = nextQty;
        sync();
        updateCartUI();
    }
    function setQty(idx, val) {
        if (!state.cart[idx]) return;
        const n = parseInt(val);
        if (isNaN(n) || n < 1) { updateCartUI(); return; }
        const product = state.inventory.find(p => p.id === state.cart[idx].id);
        const available = product ? Number(product.stock) || 0 : 0;
        if (n * (state.cart[idx].deduct || 1) > available) { showToast(`Only ${available} pcs available`, 'error'); updateCartUI(); return; }
        state.cart[idx].qty = n;
        sync();
        updateCartUI();
    }
    
    function clearCart(event) { 
        if (document.activeElement) document.activeElement.blur();
        if (event) { event.preventDefault(); event.stopPropagation(); }
        if (state.cart.length === 0) return;
        if (!confirm('Clear all items from the cart?')) return;
        state.cart = [];
        resetCartDiscount();
        sync();
        updateCartUI(); 
    }

    function switchPayMode(mode) {
        currentPayMode = mode;
        const btnCash = document.getElementById('btn-pay-cash');
        const btnCredit = document.getElementById('btn-pay-credit');
        const cashArea = document.getElementById('cash-payment-area');
        const creditArea = document.getElementById('credit-payment-area');
        if (mode === 'cash') { btnCash.className = "flex-1 py-3 border-2 border-secondary bg-secondary text-white rounded-xl font-bold text-xs"; btnCredit.className = "flex-1 py-3 border-2 border-border-subtle text-on-surface-variant rounded-xl font-bold text-xs"; cashArea.classList.remove('hidden'); creditArea.classList.add('hidden'); }
        else { btnCredit.className = "flex-1 py-3 border-2 border-orange-600 bg-orange-600 text-white rounded-xl font-bold text-xs"; btnCash.className = "flex-1 py-3 border-2 border-border-subtle text-on-surface-variant rounded-xl font-bold text-xs"; creditArea.classList.remove('hidden'); cashArea.classList.add('hidden'); }
    }

    function resetReviewPaymentUi() {
        const cash = document.getElementById('cash-input');
        if (cash) {
            cash.value = '';
            cash.classList.remove('cash-input-highlight');
        }
        const customer = document.getElementById('credit-customer');
        if (customer) customer.value = '';
        document.querySelectorAll('.cash-quick-btn').forEach(btn => {
            btn.classList.remove('cash-selected');
            btn.setAttribute('aria-pressed', 'false');
        });
        const change = document.getElementById('change-display');
        if (change) {
            change.classList.add('hidden');
            change.classList.remove('change-ok', 'change-short', 'change-pulse');
        }
        const status = document.getElementById('change-status-label');
        if (status) status.innerText = 'Waiting for Payment';
        const amount = document.getElementById('change-amount');
        if (amount) amount.innerText = '₱0.00';
        const confirmBtn = document.getElementById('confirm-checkout');
        if (confirmBtn) {
            confirmBtn.classList.remove('bg-secondary');
            const label = confirmBtn.querySelector('span:last-child');
            if (label) label.innerText = 'Confirm Transaction';
        }
        if (typeof switchPayMode === 'function') switchPayMode('cash');
    }

    function openReview() { 
        if (document.activeElement) document.activeElement.blur();
        if (state.cart.length === 0) return; 
        const stockIssue = getCartStockIssue();
        if (stockIssue) { showToast(stockIssue, 'error'); return; }
        const total = getCartTotal(); 
        document.getElementById('rev-total').innerText = formatCurrency(total); 
        resetReviewPaymentUi();
        const modal = document.getElementById('review-modal'); 
        modal.classList.replace('hidden', 'flex'); 
    }

    function setCash(v) { document.getElementById('cash-input').value = v; calculateChange(); }
    function setExact() { const total = getCartTotal(); document.getElementById('cash-input').value = total; calculateChange(); }
    function calculateChange() {
        const total = getCartTotal();
        const cash = parseFloat(document.getElementById('cash-input').value) || 0;
        const changeDisplay = document.getElementById('change-display');
        if (cash >= total) { document.getElementById('change-amount').innerText = `₱${(cash - total).toLocaleString()}`; changeDisplay.classList.remove('hidden'); }
        else { changeDisplay.classList.add('hidden'); }
    }

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

    function createProductId() {
        // Always create a fresh product id. A previous build accidentally
        // froze this value, which could make new stock items overwrite each other.
        let id = '';
        do {
            const random = Math.random().toString(36).slice(2, 8);
            id = `${Date.now()}-${random}`;
        } while ((state.inventory || []).some(item => item && item.id === id));
        return id;
    }

    function openProductModal(id = null) {
        window._editId = id; const p = id ? state.inventory.find(i => i.id === id) : null;
        document.getElementById('p-barcode').value = p ? p.barcode : ''; document.getElementById('p-name').value = p ? p.name : '';
        document.getElementById('p-category').value = p ? p.category : ''; document.getElementById('p-cost').value = p ? p.cost : '';
        document.getElementById('p-price').value = p ? p.price : ''; document.getElementById('p-stock').value = p ? p.stock : '';
        document.getElementById('p-low-stock').value = p ? (p.lowStock !== undefined ? p.lowStock : 5) : 5;
        document.getElementById('p-has-pack').checked = p && !!p.packPrice; document.getElementById('p-pack-size').value = p ? p.packSize : '';
        document.getElementById('p-pack-price').value = p ? p.packPrice : ''; togglePackFields();
        document.getElementById('product-modal-title').innerText = id ? "Edit Product" : "Add New Product";
        document.getElementById('product-modal').classList.replace('hidden', 'flex');
    }

    function saveProduct() {
        const name = document.getElementById('p-name').value; if (!name) { showToast('Product name is required', 'error'); return; }
        const barcodeValue = vc7227NormalizeBarcode(document.getElementById('p-barcode').value || '');
        if (barcodeValue) {
            const duplicate = state.inventory.find(p => p && p.id !== window._editId && vc7227NormalizeBarcode(p.barcode || '') === barcodeValue);
            if (duplicate) {
                const message = 'Barcode ' + barcodeValue + ' is already used by "' + (duplicate.name || 'another product') + '". Save anyway?';
                if (!window.confirm(message)) {
                    showToast('Product not saved: duplicate barcode', 'error');
                    return;
                }
            }
        }
        const hasPack = document.getElementById('p-has-pack').checked;
        const cost = parseFloat(document.getElementById('p-cost').value) || 0;
        const price = parseFloat(document.getElementById('p-price').value) || 0;
        const stock = parseInt(document.getElementById('p-stock').value) || 0;
        const lowStock = parseInt(document.getElementById('p-low-stock').value) || 5;
        const packPrice = hasPack ? parseFloat(document.getElementById('p-pack-price').value) : null;
        const packSize = hasPack ? parseInt(document.getElementById('p-pack-size').value) : null;
        if (cost < 0 || price < 0 || stock < 0 || lowStock < 0 || (hasPack && ((packPrice || 0) <= 0 || (packSize || 0) <= 1))) {
            showToast('Check product prices, stock, and pack values', 'error');
            return;
        }
        const productId = window._editId || createProductId();
        const data = { id: productId, barcode: barcodeValue, name: name.trim(), category: document.getElementById('p-category').value.trim(), cost, price, stock, lowStock, packPrice, packSize, _offline: true };

        // Save locally first and let the persistent queue deliver it.  Waiting
        // for a direct Firestore request here made the button look broken when
        // a request was pending (or the browser was briefly offline).
        if (window._editId) {
            const idx = state.inventory.findIndex(i => i.id === window._editId);
            if (idx !== -1) state.inventory[idx] = data;
            else state.inventory.push(data);
        } else {
            state.inventory.push(data);
        }
        queueAction('update', 'inventory', data);
        sync();
        renderInventory();
        if (typeof renderFavorites === 'function') renderFavorites();
        closeModal('product-modal');
        showToast(navigator.onLine ? 'Product Saved' : 'Product saved locally; waiting to sync', 'success');
    }

    function deleteProduct(id) { 
        const p = state.inventory.find(i => i.id === id);
        if (!p) return;
        const txCount = state.transactions.filter(t => t.items && t.items.some(item => item.id === id)).length;
        const warning = txCount > 0 ? `\n\nWarning: This product appears in ${txCount} past transaction(s). Those records will show missing item names.` : '';
        if (confirm(`Delete "${p.name}"?${warning}`)) { 
            state.inventory = state.inventory.filter(i => i.id !== id); 
            queueAction('delete', 'inventory', { id }); 
            sync(); renderInventory(); if (typeof renderFavorites === 'function') renderFavorites(); showToast('Product Deleted', 'info'); 
        } 
    }

    function getInventorySearchValue() {
        const stockSearch = document.getElementById('stock-search') || document.querySelector('#screen-inventory input[type="text"]');
        return stockSearch ? String(stockSearch.value || '') : '';
    }

    function inventoryLowStockThreshold(product) {
        const threshold = Number(product && product.lowStock);
        return Number.isFinite(threshold) ? threshold : 5;
    }

    function isLowStockProduct(product) {
        return Number(product && product.stock) <= inventoryLowStockThreshold(product);
    }

    function inventoryCategoryKey(product) {
        return String((product && product.category) || 'Uncategorized').trim().toLowerCase() || 'uncategorized';
    }

    function inventoryCategoryName(product) {
        return titleCase((product && product.category) || 'Uncategorized');
    }

    function inventoryMatchesSearch(product, searchValue) {
        const q = String(searchValue || '').trim().toLowerCase();
        if (!q) return true;
        const barcode = vc7227NormalizeBarcode(product && product.barcode);
        return String(product && product.name || '').toLowerCase().includes(q)
            || barcode.toLowerCase().includes(q)
            || String(product && product.category || '').toLowerCase().includes(q);
    }

    function inventoryEmptyStateHtml(hasInventory) {
        if (!hasInventory) {
            return '<div class="col-span-full flex flex-col items-center justify-center py-24 opacity-50"><span class="material-symbols-outlined text-[64px] text-primary/30 mb-4">inventory_2</span><p class="font-black text-sm uppercase text-primary/40 tracking-widest mb-2">No Products Yet</p><p class="text-xs text-on-surface-variant font-bold">Tap "Add Product" to get started</p></div>';
        }
        return '<div class="col-span-full flex flex-col items-center justify-center py-24 opacity-50"><span class="material-symbols-outlined text-[64px] text-primary/30 mb-4">search_off</span><p class="font-black text-sm uppercase text-primary/40 tracking-widest">No matching products</p></div>';
    }

    function inventoryMetricCard(label, value, extraClass = 'bg-surface-container/60', valueClass = 'text-on-surface') {
        return `<div class="${extraClass} rounded-xl p-2"><p class="text-[8px] font-black uppercase opacity-60">${label}</p><p class="text-xs font-black ${valueClass}">${value}</p></div>`;
    }

    function renderInventoryProductRow(product) {
        const isLow = isLowStockProduct(product);
        const marginVal = Number(product.price) > 0 ? (((Number(product.price) - Number(product.cost || 0)) / Number(product.price)) * 100).toFixed(1) : 0;
        const stockValue = `${escapeHTML(product.stock)} pcs`;
        const metrics = [
            inventoryMetricCard('Stock', stockValue, 'bg-surface-container/60', isLow ? 'text-error' : 'text-primary'),
            inventoryMetricCard('Cost', formatCurrency(product.cost), 'bg-surface-container/60', 'text-on-surface'),
            inventoryMetricCard('Retail', formatCurrency(product.price), 'bg-surface-container/60', 'text-primary'),
            inventoryMetricCard('Margin', `${marginVal}%`, 'bg-secondary/5 border border-secondary/10', 'text-secondary')
        ].join('');

        return `<div class="p-4 flex gap-3 ${isLow ? 'low-stock-row' : ''}"><div class="flex-1 min-w-0"><h4 class="font-bold text-sm truncate uppercase">${escapeHTML(product.name)}</h4><p class="text-[10px] font-medium opacity-50 mb-3 tracking-tight">#${escapeHTML(product.barcode || '---')}</p><div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${metrics}</div></div><div class="flex flex-col gap-1.5 border-l pl-3 justify-center"><button onclick="openStockAdjust(${jsArg(product.id)})" class="w-9 h-9 flex items-center justify-center bg-secondary/10 text-secondary rounded-xl active-scale transition-all" title="Adjust Stock"><span class="material-symbols-outlined text-[20px]">move_item</span></button><button onclick="openProductModal(${jsArg(product.id)})" class="w-9 h-9 flex items-center justify-center bg-primary-container text-primary rounded-xl active-scale transition-all"><span class="material-symbols-outlined text-[20px]">edit</span></button><button onclick="deleteProduct(${jsArg(product.id)})" class="w-9 h-9 flex items-center justify-center bg-error/10 text-error rounded-xl active-scale transition-all"><span class="material-symbols-outlined text-[20px]">delete</span></button></div></div>`;
    }

    function renderInventoryCategory(catKey, group, searchValue) {
        const isCollapsed = inventoryState.collapsedCategories[catKey] === true && String(searchValue || '').length === 0;
        // v7.2.70: Do not build every product row for collapsed categories.
        // This keeps Stock opening fast after PIN while preserving search/expanded views.
        const itemsHtml = isCollapsed ? '' : group.items.map(renderInventoryProductRow).join('');
        return `<div class="category-folder bg-surface border border-border-subtle rounded-3xl overflow-hidden shadow-sm h-fit ${isCollapsed ? 'collapsed' : ''}"><button onclick="toggleCategory(${jsArg(catKey)})" class="w-full px-5 py-4 bg-surface-container/50 flex justify-between items-center hover:bg-primary-container transition-colors"><div class="flex items-center gap-3 text-left"><span class="material-symbols-outlined text-primary/60 folder-icon">expand_more</span><div><h3 class="font-black text-xs text-primary uppercase tracking-wider">${escapeHTML(group.name)}</h3><p class="text-[9px] font-bold text-on-surface-variant/60 uppercase">${group.items.length} items</p></div></div></button><div class="category-content divide-y divide-border-subtle">${itemsHtml}</div></div>`;
    }

    function toggleCategory(cat) {
        inventoryState.collapsedCategories[cat] = !inventoryState.collapsedCategories[cat];
        renderInventory(getInventorySearchValue());
    }

    function renderInventory(f = '') {
        const list = document.getElementById('inventory-list');
        if (!list) return;

        const inventory = Array.isArray(state.inventory) ? state.inventory : [];
        const lowStockItems = inventory.filter(isLowStockProduct);
        const lowStockAlert = document.getElementById('low-stock-alert');
        const lowStockText = document.getElementById('low-stock-alert-text');
        if (lowStockAlert) lowStockAlert.classList.toggle('hidden', lowStockItems.length === 0);
        if (lowStockText) lowStockText.innerText = `${lowStockItems.length} items are low on stock!`;

        const searchValue = String(f || '');
        const filtered = inventory.filter(product => inventoryMatchesSearch(product, searchValue));
        if (filtered.length === 0) {
            list.innerHTML = inventoryEmptyStateHtml(inventory.length > 0);
            updateNotifBadge();
            return;
        }

        const groups = {};
        filtered.forEach(product => {
            const cat = inventoryCategoryKey(product);
            if (!groups[cat]) groups[cat] = { name: inventoryCategoryName(product), items: [] };
            groups[cat].items.push(product);
            if (inventoryState.collapsedCategories[cat] === undefined) inventoryState.collapsedCategories[cat] = true;
        });

        list.innerHTML = Object.keys(groups)
            .sort()
            .map(catKey => renderInventoryCategory(catKey, groups[catKey], searchValue))
            .join('');
        updateNotifBadge();
    }

    function switchLedgerTab(tab) { activeLedgerTab = tab; document.querySelectorAll('[id^="tab-"]').forEach(btn => { const isActive = btn.id === 'tab-' + tab; btn.classList.toggle('ledger-tab-active', isActive); btn.classList.toggle('text-on-surface-variant', !isActive); }); renderLedger(); }
    function openExpenseModal() { document.getElementById('exp-desc').value = ''; document.getElementById('exp-amt').value = ''; document.getElementById('exp-category').value = 'Utilities'; document.getElementById('expense-modal').classList.replace('hidden', 'flex'); }
    function saveExpense() {
        const desc = document.getElementById('exp-desc').value; const amt = parseFloat(document.getElementById('exp-amt').value); const category = document.getElementById('exp-category').value;
        if (!desc || isNaN(amt)) { showToast("Required fields missing", "error"); return; }
        const expenseTrans = { id: nextTransactionId('EX'), type: 'EX', desc, category, total: amt, timestamp: new Date().toISOString(), notes: "" };
        if (typeof attachBusinessDayToTransaction === 'function') attachBusinessDayToTransaction(expenseTrans);
        queueTransaction(expenseTrans); closeModal('expense-modal'); showToast('Expense Saved', 'success'); if (activeLedgerTab === 'expense') renderLedger(); renderInsights();
    }

    function renderLedger() {
        const container = document.getElementById('ledger-content'); const summary = document.getElementById('ledger-summary-container');
        if (!container || !summary) return;
        let html = ''; let sumHtml = '';
        if (activeLedgerTab === 'cash') {
            const sales = state.transactions.filter(t => (t.type === 'SA' || (t.notes && t.notes.includes('CR-')))).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
            const total = sales.reduce((a, b) => a + b.total, 0);
            sumHtml = `<div class="bg-primary p-6 rounded-3xl text-white shadow-lg"><p class="text-[10px] font-bold uppercase opacity-70 tracking-widest mb-1">Total Cash Sales</p><h3 class="text-2xl font-black">₱${total.toLocaleString()}</h3></div>`;
            html = sales.map(t => `<div class="bg-surface border border-border-subtle p-5 rounded-3xl flex justify-between items-center shadow-sm hover:shadow-md transition-all"><div><div class="flex items-center gap-2"><p class="font-black text-sm text-primary">${t.id}</p>${(t.notes && t.notes.includes('CR-')) ? '<span class="text-[7px] bg-secondary text-white px-2 py-0.5 rounded-full uppercase font-bold">Settlement</span>' : ''}${isPendingSync('transactions', t.id) ? '<span class="text-[7px] bg-orange-500 text-white px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>' : ''}</div><p class="text-[10px] text-on-surface-variant font-bold mt-1">${new Date(t.timestamp).toLocaleDateString()} ${new Date(t.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p></div><div class="flex items-center gap-3"><p class="font-black text-xl text-secondary">₱${t.total.toLocaleString()}</p><button onclick="viewTxDetails('${t.id}')" class="w-10 h-10 flex items-center justify-center bg-primary-container text-primary rounded-xl active-scale"><span class="material-symbols-outlined">visibility</span></button></div></div>`).join('') || '<div class="col-span-full flex flex-col items-center justify-center py-20 opacity-40"><span class="material-symbols-outlined text-[48px] mb-3">point_of_sale</span><p class="font-black text-xs uppercase tracking-widest">No sales recorded yet</p></div>';
        } else if (activeLedgerTab === 'credit') {
            const credits = state.transactions.filter(t => t.type === 'CR' && !t.paid).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
            const grouped = credits.reduce((acc, curr) => { const rawName = curr.customer || 'Guest'; const normalizedKey = rawName.trim().toLowerCase(); if (!acc[normalizedKey]) acc[normalizedKey] = { displayName: titleCase(rawName), items: [], total: 0 }; acc[normalizedKey].items.push(curr); acc[normalizedKey].total += curr.total; return acc; }, {});
            const totalBalance = credits.reduce((a, b) => a + b.total, 0);
            sumHtml = `<div class="bg-orange-600 p-6 rounded-3xl text-white shadow-lg"><p class="text-[10px] font-bold uppercase opacity-70 tracking-widest mb-1">Total Outstanding Credits</p><h3 class="text-2xl font-black">₱${totalBalance.toLocaleString()}</h3></div>`;
            if (Object.keys(grouped).length === 0) { html = '<div class="col-span-full text-center py-20 opacity-30 font-black uppercase text-xs">No credits</div>'; }
            else { html = Object.entries(grouped).map(([key, data]) => `<div class="space-y-4"><div class="bg-white border-2 border-orange-500/20 p-5 rounded-3xl shadow-sm"><div class="flex justify-between items-start mb-4"><div class="min-w-0 flex-1"><h3 class="text-base font-black text-primary uppercase truncate">${data.displayName}</h3><p class="text-[10px] font-bold text-on-surface-variant">${data.items.length} Pending Tickets</p></div><div class="text-right"><p class="text-[10px] font-black text-orange-600 uppercase">Total</p><p class="text-2xl font-black text-orange-600 tracking-tighter">₱${data.total.toLocaleString()}</p></div></div><button onclick="payFullBalance('${data.displayName.replace(/'/g, "\\'")}')" class="w-full bg-secondary text-white py-3.5 rounded-2xl font-black text-xs uppercase shadow-lg active-scale">Pay Full Balance</button></div><div class="space-y-2 pl-3 border-l-2 border-border-subtle">${data.items.map(t => `<div class="bg-surface border border-border-subtle p-3.5 rounded-2xl flex justify-between items-center text-xs"><div class="min-w-0 flex-1"><div class="flex items-center gap-1.5"><p class="font-black text-primary/60 truncate">${t.id}</p>${isPendingSync('transactions', t.id) ? '<span class="text-[6px] bg-orange-500 text-white px-1.5 rounded uppercase">Pending</span>' : ''}</div><p class="opacity-50 font-bold">${new Date(t.timestamp).toLocaleDateString()}</p></div><div class="flex items-center gap-2"><p class="font-black text-on-surface mr-1">₱${t.total.toLocaleString()}</p><button onclick="payIndividualTicket('${t.id}')" class="bg-secondary text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase active-scale shadow-sm">Pay</button><button onclick="viewTxDetails('${t.id}')" class="w-8 h-8 flex items-center justify-center bg-primary/5 text-primary rounded-xl"><span class="material-symbols-outlined text-[18px]">visibility</span></button></div></div>`).join('')}</div></div>`).join(''); }
        } else if (activeLedgerTab === 'expense') {
            const expenses = state.transactions.filter(t => t.type === 'EX').sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
            const totalExp = expenses.reduce((a, b) => a + b.total, 0);
            sumHtml = `<div class="bg-error p-6 rounded-3xl text-white shadow-lg"><p class="text-[10px] font-bold uppercase opacity-70 tracking-widest mb-1">Total Expenses</p><h3 class="text-2xl font-black">₱${totalExp.toLocaleString()}</h3></div>`;
            html = expenses.map(t => `<div class="bg-surface border border-border-subtle p-5 rounded-3xl flex justify-between items-center shadow-sm hover:shadow-md transition-all"><div><div class="flex items-center gap-2"><p class="font-black text-sm text-error">${t.id}</p>${t.category ? `<span class="text-[7px] bg-error/10 text-error px-2 py-0.5 rounded-full uppercase font-bold">${t.category}</span>` : ''}${isPendingSync('transactions', t.id) ? '<span class="text-[7px] bg-orange-500 text-white px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>' : ''}</div><p class="text-xs font-bold text-on-surface mt-1 truncate max-w-[150px]">${t.desc || t.notes || 'Expense'}</p></div><div class="flex items-center gap-3"><p class="font-black text-xl text-error">₱${t.total.toLocaleString()}</p><button onclick="viewTxDetails('${t.id}')" class="w-10 h-10 flex items-center justify-center bg-primary-container text-primary rounded-xl active-scale"><span class="material-symbols-outlined">visibility</span></button></div></div>`).join('') || '<div class="col-span-full text-center py-20 opacity-30 font-black uppercase text-xs">No records</div>';
        }
        summary.innerHTML = sumHtml; container.innerHTML = html;
    }

    async function payIndividualTicket(id) {
        const t = state.transactions.find(tx => tx.id === id); if (!t) return;
        const amtStr = prompt(`Ticket ${id} — Balance: ₱${t.total.toLocaleString()}\n\nEnter amount to pay (or leave blank for full amount):`);
        if (amtStr === null) return;
        const amt = amtStr === '' ? t.total : parseFloat(amtStr);
        if (isNaN(amt) || amt <= 0) { showToast('Invalid amount', 'error'); return; }
        const isPartial = amt < t.total;
        const settlementId = nextTransactionId('SA');
        if (isPartial) {
            // Create a partial payment settlement, reduce the ticket balance
            const remaining = t.total - amt;
            const saleTransaction = { id: settlementId, type: 'SA', total: amt, timestamp: new Date().toISOString(), items: [], customer: t.customer, paid: true, cashReceived: amt, change: 0, notes: `Partial: ${t.id}` };
            t.total = remaining; t._offline = true;
            await directSync('transactions', t);
            queueTransaction(saleTransaction);
            showToast(`Partial payment ₱${amt.toLocaleString()} recorded`, 'success');
        } else {
            t.paid = true; t._offline = true;
            const saleTransaction = { id: settlementId, type: 'SA', total: t.total, timestamp: new Date().toISOString(), items: JSON.parse(JSON.stringify(t.items || [])), customer: t.customer, paid: true, cashReceived: t.total, change: 0, notes: t.id };
            await directSync('transactions', t);
            queueTransaction(saleTransaction);
            showToast('Ticket paid', 'success');
        }
        lastTransactionId = settlementId;
        viewReceipt(settlementId);
        renderLedger();
    }

    async function payFullBalance(customerName) {
        const normalizedName = customerName.trim().toLowerCase();
        const credits = state.transactions.filter(t => t.type === 'CR' && t.customer && t.customer.trim().toLowerCase() === normalizedName && !t.paid);
        if (credits.length === 0) return; 
        const totalToPay = credits.reduce((a, b) => a + b.total, 0);
        if (!confirm(`Collect full payment of ₱${totalToPay.toLocaleString()}?`)) return;
        const aggregatedItemsMap = {};
        for (const t of credits) {
            if (t.items && Array.isArray(t.items)) {
                t.items.forEach(item => {
                    const key = `${item.id}-${item.type}-${t.id}`;
                    if (aggregatedItemsMap[key]) { aggregatedItemsMap[key].qty += item.qty; } else { aggregatedItemsMap[key] = { ...item, originalTicketId: t.id }; }
                });
            }
            t.paid = true; t._offline = true;
            await directSync('transactions', t);
        }
        const settlementId = nextTransactionId('SA');
        const settlement = { id: settlementId, type: 'SA', customer: customerName, total: totalToPay, timestamp: new Date().toISOString(), items: Object.values(aggregatedItemsMap), notes: credits.map(c => c.id).join(', '), paid: true, cashReceived: totalToPay, change: 0 };
        queueTransaction(settlement); renderLedger(); showToast('Balance paid', 'success'); lastTransactionId = settlementId; viewReceipt(settlementId);
    }

    function switchInsightPeriod(period) { insightPeriod = period; document.querySelectorAll('[id^="insight-tab-"]').forEach(btn => { const isActive = btn.id === 'insight-tab-' + period; btn.classList.toggle('ledger-tab-active', isActive); btn.classList.toggle('text-on-surface-variant', !isActive); }); document.getElementById('date-range-controls').classList.toggle('hidden', period !== 'range'); renderInsights(); }

    function vc710AllTransactionsForLocalViews() {
        const live = Array.isArray(state.transactions) ? state.transactions : [];
        const archive = (Array.isArray(state.archiveTransactions) ? state.archiveTransactions : []).map(t => ({ ...t, _archiveOnly: true }));
        const map = new Map();
        archive.forEach(t => { if (t && t.id) map.set(t.id, t); });
        live.forEach(t => { if (t && t.id) map.set(t.id, t); });
        return Array.from(map.values()).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    }

    function getPeriodTransactions() {
        const now = new Date(); let periodTransactions = vc710AllTransactionsForLocalViews();
        if (insightPeriod === 'day') { const todayStr = now.toISOString().split('T')[0]; periodTransactions = periodTransactions.filter(t => String(t.timestamp || '').startsWith(todayStr)); }
        else if (insightPeriod === 'month') { const monthStr = now.toISOString().slice(0, 7); periodTransactions = periodTransactions.filter(t => String(t.businessDate || t.timestamp || '').startsWith(monthStr)); }
        else if (insightPeriod === 'range') { const start = document.getElementById('insight-start-date').value; const end = document.getElementById('insight-end-date').value; if (start && end) periodTransactions = periodTransactions.filter(t => { const ts = String(t.businessDate || t.timestamp || '').slice(0,10); return ts >= start && ts <= end; }); }
        return periodTransactions;
    }

    function renderInsights() {
        const lowStockItems = state.inventory.filter(p => p.stock <= (p.lowStock !== undefined ? p.lowStock : 5));
        const alertDiv = document.getElementById('restock-alerts-container');
        if (alertDiv) alertDiv.classList.toggle('hidden', lowStockItems.length === 0);
        const lowStockList = document.getElementById('insight-low-stock-list');
        if (lowStockList) lowStockList.innerHTML = lowStockItems.map(p => `<div class="flex justify-between items-center bg-white/70 p-3 rounded-2xl border border-yellow-200 shadow-sm"><span class="text-xs font-black text-yellow-900">${p.name}</span><span class="text-[10px] font-black text-error bg-error/10 px-2 py-0.5 rounded-full">${p.stock} left</span></div>`).join('');
        let periodTransactions = getPeriodTransactions();
        const salesTransactions = periodTransactions.filter(isRevenueSale);
        const revenue = salesTransactions.reduce((a, b) => a + b.total, 0);
        const totalExpenses = periodTransactions.filter(t => t.type === 'EX').reduce((a, b) => a + b.total, 0);
        let totalCogs = 0;
        salesTransactions.forEach(t => { 
            if (t.items) {
                t.items.forEach(item => { totalCogs += ((item.cost || 0) * item.qty * (item.deduct || 1)); }); 
            }
        });
        const netProfit = (revenue - totalCogs) - totalExpenses;
        const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
        
        document.getElementById('insight-revenue-label').innerText = `Gross Sales (Cash + Credit) (${insightPeriod === 'day' ? 'Today' : insightPeriod === 'month' ? 'This Month' : 'Range'})`;
        document.getElementById('daily-revenue').innerText = `₱${revenue.toLocaleString()}`;
        document.getElementById('daily-profit').innerText = `₱${netProfit.toLocaleString()}`;
        document.getElementById('daily-margin').innerText = `${profitMargin.toFixed(1)}%`;
        document.getElementById('daily-cogs').innerText = `₱${totalCogs.toLocaleString()}`;
        document.getElementById('daily-expenses').innerText = `₱${totalExpenses.toLocaleString()}`;
        document.getElementById('inventory-value').innerText = `₱${state.inventory.reduce((a, b) => a + (b.cost * b.stock), 0).toLocaleString()}`;
        document.getElementById('inventory-count').innerText = `${state.inventory.length} items tracking`;
        
        const recent = periodTransactions.slice(0, 10);
        document.getElementById('insight-transactions-list').innerHTML = `<p class="text-[10px] font-black uppercase text-primary/60 mb-3 tracking-widest px-1">Recent Period Activities</p>` + recent.map(t => `<div class="bg-surface border border-border-subtle p-4 rounded-3xl flex justify-between items-center shadow-sm mb-2 hover:shadow-md transition-all"><div><div class="flex items-center gap-2"><p class="font-black text-xs text-primary">${t.id}</p><span class="text-[7px] px-2 py-0.5 rounded-full uppercase font-bold ${t.type === 'CR' ? 'bg-orange-500 text-white' : t.type === 'EX' ? 'bg-error text-white' : 'bg-primary/10 text-primary'}">${(t.notes && t.notes.includes('CR-')) ? 'SA (SET)' : t.type}</span>${isPendingSync('transactions', t.id) ? '<span class="text-[7px] bg-orange-500 text-white px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>' : ''}</div><p class="text-[10px] text-on-surface-variant font-bold mt-0.5">${new Date(t.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p></div><div class="flex items-center gap-4"><span class="font-black text-sm ${t.type === 'EX' ? 'text-error' : 'text-on-surface'}">₱${t.total.toLocaleString()}</span><button onclick="viewTxDetails('${t.id}')" class="w-9 h-9 flex items-center justify-center bg-primary/10 text-primary rounded-xl"><span class="material-symbols-outlined text-[18px]">visibility</span></button></div></div>`).join('') || `<div class="text-center py-10 opacity-30 font-bold uppercase text-[10px]">No activity</div>`;

        // --- Sales Trend Chart (#15) ---
        renderSalesChart(periodTransactions);

        // --- Best Sellers (#16) ---
        renderBestSellers(periodTransactions);
    }

    let salesChartInstance = null;
    function renderSalesChart(transactions) {
        const canvas = document.getElementById('sales-chart');
        if (!canvas) return;
        if (typeof Chart === 'undefined') {
            if (canvas.parentElement) canvas.parentElement.classList.add('hidden');
            ensureChartLoaded()
                .then(() => renderSalesChart(transactions))
                .catch(error => console.warn('Chart load failed', error));
            return;
        }
        // Group sales by date
        const salesByDate = {};
        transactions.filter(isRevenueSale).forEach(t => {
            const d = t.timestamp.split('T')[0];
            salesByDate[d] = (salesByDate[d] || 0) + t.total;
        });
        const labels = Object.keys(salesByDate).sort();
        const values = labels.map(d => salesByDate[d]);
        if (salesChartInstance) { salesChartInstance.destroy(); salesChartInstance = null; }
        if (labels.length === 0) { canvas.parentElement.classList.add('hidden'); return; }
        canvas.parentElement.classList.remove('hidden');
        salesChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
                datasets: [{
                    label: 'Sales (₱)',
                    data: values,
                    backgroundColor: '#1e3a5f',
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { ticks: { callback: v => '₱' + v.toLocaleString() }, grid: { color: '#e2e8f0' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    function renderBestSellers(transactions) {
        const salesTxs = transactions.filter(t => isRevenueSale(t) && t.items);
        const itemTotals = {};
        salesTxs.forEach(t => {
            t.items.forEach(item => {
                if (!itemTotals[item.name]) itemTotals[item.name] = { qty: 0, revenue: 0 };
                itemTotals[item.name].qty += item.qty;
                itemTotals[item.name].revenue += item.price * item.qty;
            });
        });
        const sorted = Object.entries(itemTotals).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
        const container = document.getElementById('best-sellers-list');
        if (!container) return;
        if (sorted.length === 0) { container.parentElement.classList.add('hidden'); return; }
        container.parentElement.classList.remove('hidden');
        container.innerHTML = sorted.map(([name, data], i) => 
            `<div class="flex items-center gap-3 p-3 bg-surface-container/50 rounded-2xl">
                <span class="w-6 h-6 flex items-center justify-center rounded-full bg-primary text-white text-[10px] font-black">${i+1}</span>
                <div class="flex-1 min-w-0"><p class="text-xs font-black truncate uppercase">${name}</p><p class="text-[9px] text-on-surface-variant font-bold">${data.qty} units sold</p></div>
                <span class="text-xs font-black text-secondary">₱${data.revenue.toLocaleString()}</span>
            </div>`
        ).join('');
    }

    function canvasToPngBlob(canvas) {
        return new Promise((resolve, reject) => {
            if (!canvas || typeof canvas.toBlob !== 'function') {
                reject(new Error('Receipt image could not be created.'));
                return;
            }
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Receipt image is empty.'));
            }, 'image/png');
        });
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function thermalMoney(value) {
        const n = Number(value) || 0;
        const formatted = n.toLocaleString(undefined, {
            minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
            maximumFractionDigits: 2
        });
        // Use plain P for print clarity. Some budget ESC/POS drivers render the peso sign unevenly.
        return 'P' + formatted;
    }

    function thermalCleanText(text) {
        return String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function thermalFit(text, width) {
        const clean = thermalCleanText(text);
        if (clean.length <= width) return clean;
        if (width <= 3) return clean.slice(0, width);
        return clean.slice(0, width - 3) + '...';
    }

    function thermalLine(width = 32) {
        return '-'.repeat(width);
    }

    function thermalCenter(text, width = 32) {
        const clean = thermalFit(text, width);
        const left = Math.max(0, Math.floor((width - clean.length) / 2));
        return ' '.repeat(left) + clean;
    }

    function thermalRow(left, right, width = 32) {
        const r = thermalCleanText(right);
        const leftWidth = Math.max(1, width - r.length - 1);
        const l = thermalFit(left, leftWidth);
        return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
    }

    function thermalItemRows(name, qty, amount, width = 32) {
        // XP210/Android print services often wrap 42-column browser text.
        // Keep this intentionally narrow so item, qty, and price stay on one physical row.
        const itemWidth = 16;
        const qtyWidth = 4;
        const priceWidth = width - itemWidth - qtyWidth;
        const cleanName = thermalCleanText(name) || 'Item';
        const line = thermalFit(cleanName, itemWidth).padEnd(itemWidth) +
            thermalFit(qty, qtyWidth).padStart(qtyWidth) +
            thermalFit(amount, priceWidth).padStart(priceWidth);
        return [line];
    }

    function buildThermalReceiptText(tx) {
        const width = 32;
        const lines = [];
        const isSettlement = tx && tx.notes && tx.notes.includes('CR-') && tx.type === 'SA';
        const title = isSettlement ? 'CREDIT PAYMENT' : (tx && tx.type === 'EX' ? 'EXPENSE RECORD' : 'OFFICIAL RECEIPT');
        const txDate = tx && tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : new Date().toLocaleDateString();

        lines.push(thermalCenter('VILLACART', width));
        lines.push(thermalCenter('Balagtas BMA San Rafael, Bulacan', width));
        lines.push(thermalLine(width));
        lines.push(thermalCenter(title, width));
        lines.push(thermalLine(width));
        lines.push(thermalRow('Date:', txDate, width));
        if (tx && tx.id) lines.push(thermalRow('Trans #:', tx.id, width));
        if (tx && tx.customer) lines.push(thermalRow('Customer:', tx.customer, width));
        lines.push(thermalLine(width));

        if (isSettlement) {
            lines.push('Settlement Breakdown');
            if (tx.items && tx.items.length) {
                tx.items.forEach(item => {
                    thermalItemRows(item.name, item.qty, thermalMoney(Number(item.price) * Number(item.qty)), width).forEach(line => lines.push(line));
                });
            } else if (tx.notes) {
                lines.push(thermalFit('Settled: ' + tx.notes, width));
            }
            lines.push(thermalLine(width));
            lines.push(thermalRow('TOTAL PAID:', thermalMoney(tx.total), width));
        } else if (tx && tx.items && tx.items.length) {
            lines.push('Item'.padEnd(16) + 'Qty'.padStart(4) + 'Price'.padStart(12));
            lines.push(thermalLine(width));
            tx.items.forEach(item => {
                const qty = Number(item.qty) || 0;
                const lineTotal = Number(item.price || 0) * qty;
                thermalItemRows(item.name, qty, thermalMoney(lineTotal), width).forEach(line => lines.push(line));
            });
            lines.push(thermalLine(width));
            const discount = Number(tx.discount) || 0;
            if (discount > 0) {
                const subtotal = Number(tx.subtotal) || (Number(tx.total) + discount);
                lines.push(thermalRow('Subtotal:', thermalMoney(subtotal), width));
                lines.push(thermalRow('Discount:', '-' + thermalMoney(discount), width));
            }
            lines.push(thermalRow('TOTAL:', thermalMoney(tx.total), width));
            if (tx.type === 'SA') {
                lines.push(thermalRow('Cash Received:', thermalMoney(tx.cashReceived || 0), width));
                lines.push(thermalRow('Change:', thermalMoney(tx.change || 0), width));
            } else if (tx.type === 'CR') {
                lines.push(thermalRow('Payment:', 'CREDIT', width));
            }
        } else {
            lines.push(thermalFit((tx && (tx.desc || tx.notes)) || 'Transaction', width));
            lines.push(thermalLine(width));
            lines.push(thermalRow('TOTAL:', thermalMoney(tx ? tx.total : 0), width));
        }

        lines.push(thermalLine(width));
        lines.push(thermalCenter('THANK YOU!', width));
        lines.push(thermalCenter('Please come again.', width));
        lines.push('');
        return lines.join('\n');
    }

    function printThermalReceipt() {
        const tx = (state.transactions || []).find(t => t.id === lastTransactionId) || (state.archiveTransactions || []).find(t => t.id === lastTransactionId);
        const receiptEl = document.getElementById('receipt-content');
        if (!tx && !receiptEl) {
            if (typeof showToast === 'function') showToast('Receipt not ready', 'error');
            return;
        }
        const receiptText = tx ? buildThermalReceiptText(tx) : receiptEl.innerText;
        const receiptTitle = lastTransactionId ? `Villacart Receipt ${lastTransactionId}` : 'Villacart Receipt';
        const printHTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(receiptTitle)}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body {
    width: 80mm;
    min-width: 80mm;
    max-width: 80mm;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    overflow: visible;
}
body {
    display: block;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}
#thermal-receipt {
    width: 62mm;
    max-width: 62mm;
    margin: 0;
    padding: 2mm 2mm 5mm;
    background: #fff;
    color: #000;
    font-family: "Courier New", Courier, monospace;
    font-size: 16px;
    line-height: 1.22;
    font-weight: 900;
    letter-spacing: 0;
    white-space: pre;
    overflow: visible;
}
@media print {
    html, body { width: 80mm; margin: 0; padding: 0; overflow: visible; }
    #thermal-receipt { width: 62mm; max-width: 62mm; margin: 0; white-space: pre; font-size: 16px; font-weight: 900; }
}
</style>
</head>
<body><pre id="thermal-receipt">${escapeHTML(receiptText)}</pre></body>
</html>`;

        const printWin = window.open('', '_blank', 'popup,width=420,height=640');
        if (!printWin) {
            if (typeof showToast === 'function') showToast('Popup blocked. Using normal print.', 'info');
            window.print();
            return;
        }
        printWin.document.open();
        printWin.document.write(printHTML);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => {
            try { printWin.print(); }
            catch (error) {
                console.error('Thermal print failed:', error);
                if (typeof showToast === 'function') showToast('Print window opened', 'info');
            }
        }, 350);
    }

    async function shareReceipt() {
        const tx = state.transactions.find(t => t.id === lastTransactionId) || (state.archiveTransactions || []).find(t => t.id === lastTransactionId);
        if (!tx) { showToast('Receipt not found', 'error'); return; }
        const receiptEl = document.getElementById('receipt-content');
        if (!receiptEl) { showToast('Receipt not ready', 'error'); return; }
        const shareBtn = document.getElementById('share-receipt-btn');
        const originalBtnHtml = shareBtn ? shareBtn.innerHTML : '';
        if (shareBtn) {
            shareBtn.disabled = true;
            shareBtn.innerHTML = `<span class="material-symbols-outlined text-[20px] animate-spin-custom">sync</span> Processing...`;
        }
        try {
            await ensureHtml2CanvasLoaded();
            if (typeof html2canvas !== 'function') throw new Error('Image tool not loaded.');
            const canvas = await html2canvas(receiptEl, {
                scale: Math.min(2, window.devicePixelRatio || 2),
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false
            });
            const blob = await canvasToPngBlob(canvas);
            const fileName = `Villacart_Receipt_${tx.id}.png`;
            const canShareFile = typeof File === 'function' && navigator.share && navigator.canShare;
            if (canShareFile) {
                const file = new File([blob], fileName, { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({ files: [file], title: `Receipt ${tx.id}`, text: `Villacart receipt ${tx.id}` });
                        showToast('Shared', 'success');
                        return;
                    } catch (shareError) {
                        if (shareError && shareError.name === 'AbortError') {
                            showToast('Share cancelled', 'info');
                            return;
                        }
                    }
                }
            }
            downloadBlob(blob, fileName);
            showToast('Receipt image downloaded', 'success');
        } catch (error) {
            console.error('Share receipt failed:', error);
            showToast('Could not create image', 'error');
        } finally {
            if (shareBtn) {
                shareBtn.disabled = false;
                shareBtn.innerHTML = originalBtnHtml;
            }
        }
    }

    function exportSalesCSV() {
        const trans = getPeriodTransactions(); if (trans.length === 0) return;
        const csvContent = ["Date,ID,Type,Customer,Subtotal,Discount,Total,Notes", ...trans.map(t => [
            new Date(t.timestamp).toLocaleDateString(),
            t.id,
            t.type,
            t.customer || 'N/A',
            t.subtotal || t.total || 0,
            t.discount || 0,
            t.total,
            t.notes || ''
        ].map(csvEscape).join(","))].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Villacart_Sales.csv`; link.click(); showToast("Exported", "success");
    }

    function viewTxDetails(id) {
        const tx = (state.transactions || []).find(t => t.id === id) || (state.archiveTransactions || []).find(t => t.id === id);
        if (!tx) return; lastTransactionId = id;
        document.getElementById('txmtitle').innerText = tx.id;
        let html = `<div class="p-4 bg-primary/5 rounded-2xl border border-primary/10 mb-5"><div class="flex justify-between text-xs mb-1.5"><span class="font-bold opacity-60">Date</span><span class="font-black">${escapeHTML(new Date(tx.timestamp).toLocaleString())}</span></div><div class="flex justify-between text-xs mb-1.5"><span class="font-bold opacity-60">Type</span><span class="font-black uppercase">${escapeHTML((tx.notes && tx.notes.includes('CR-')) ? 'Settlement' : tx.type)}</span></div>${tx.customer ? `<div class="flex justify-between text-xs"><span class="font-bold opacity-60">Customer</span><span class="font-black">${escapeHTML(tx.customer)}</span></div>` : ''}</div>`;
        if (tx.items && tx.items.length > 0) html += `<div class="space-y-2 mb-5">${tx.items.map(item => `<div class="flex justify-between text-xs border-b border-border-subtle pb-2"><span>${escapeHTML(item.name)} x${escapeHTML(item.qty)}</span><span class="font-black">${formatCurrency(item.price * item.qty)}</span></div>`).join('')}</div>`;
        else if (tx.notes && tx.notes.includes('CR-')) html += `<div class="p-3 bg-surface-container/50 rounded-xl mb-5"><p class="text-[10px] font-bold text-on-surface-variant uppercase mb-1">Settled Tickets</p><p class="text-xs font-black text-primary">${escapeHTML(tx.notes)}</p></div>`;
        html += `<div class="flex justify-between items-center p-4 ${tx.type === 'EX' ? 'bg-error/10 text-error' : 'bg-secondary/10 text-secondary'} rounded-2xl"><span class="text-xs font-black">TOTAL</span><span class="text-2xl font-black">${formatCurrency(tx.total)}</span></div>`;
        document.getElementById('txdetail').innerHTML = html; closeModal('mod-tx'); document.getElementById('mod-tx').classList.replace('hidden', 'flex');
    }

    function printTx() { if (!lastTransactionId) return; viewReceipt(lastTransactionId); closeModal('mod-tx'); }
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

    function findReceiptTransaction(id) {
        return (state.transactions || []).find(t => t.id === id)
            || (state.archiveTransactions || []).find(t => t.id === id)
            || null;
    }

    function resetReceiptModalScroll() {
        requestAnimationFrame(() => {
            const modal = document.getElementById('receipt-modal');
            const content = document.getElementById('receipt-content');
            if (modal) modal.scrollTop = 0;
            if (content) content.scrollTop = 0;
        });
    }

    function resetReceiptFields() {
        const byId = id => document.getElementById(id);
        if (byId('rec-items-list')) byId('rec-items-list').innerHTML = '';
        if (byId('rec-label-total')) byId('rec-label-total').innerText = 'TOTAL:';
        if (byId('rec-cash')) byId('rec-cash').innerText = formatCurrency(0);
        if (byId('rec-change')) byId('rec-change').innerText = formatCurrency(0);
        if (byId('rec-customer')) byId('rec-customer').innerText = 'N/A';
        if (byId('rec-set-customer')) byId('rec-set-customer').innerText = 'N/A';
    }

    function showReceiptModal() {
        const modal = document.getElementById('receipt-modal');
        if (modal) modal.classList.replace('hidden', 'flex');
        resetReceiptModalScroll();
    }

    function renderReceiptItems(items) {
        if (!items || !items.length) return '';
        return items.map(i => `<div class="flex justify-between gap-2 py-0.5"><span class="w-1/2 min-w-0 break-words">${escapeHTML(i.name)}</span><span class="w-1/4 text-center">${escapeHTML(i.qty)}</span><span class="w-1/4 text-right whitespace-nowrap">${formatCurrency((Number(i.price) || 0) * (Number(i.qty) || 0))}</span></div>`).join('');
    }

    function viewReceipt(id) {
        const tx = findReceiptTransaction(id);
        if (!tx) {
            showToast('Receipt not found', 'error');
            return;
        }
        lastTransactionId = id;
        resetReceiptFields();
        if (tx.notes && tx.notes.includes('CR-') && tx.type === 'SA') { buildSettlementRcpt(tx); return; }
        document.getElementById('receipt-title').innerText = 'OFFICIAL RECEIPT';
        document.getElementById('receipt-standard-fields').classList.remove('hidden');
        document.getElementById('receipt-settlement-fields').classList.add('hidden');
        document.getElementById('receipt-items-header').classList.remove('hidden');
        document.getElementById('receipt-settlement-header').classList.add('hidden');
        document.getElementById('rec-id').innerText = tx.id;
        document.getElementById('rec-date').innerText = new Date(tx.timestamp).toLocaleDateString();
        document.getElementById('rec-total').innerText = formatCurrency(tx.total);
        let receiptItemsHtml = tx.items && tx.items.length > 0 ? renderReceiptItems(tx.items) : `<div>${escapeHTML(tx.desc || tx.notes || '')}</div>`;
        if ((Number(tx.discount) || 0) > 0) {
            receiptItemsHtml += `<div class="mt-2 pt-2 border-t border-black/40 space-y-1"><div class="flex justify-between"><span class="font-bold">Subtotal</span><span>${formatCurrency(tx.subtotal || (Number(tx.total) + Number(tx.discount)))}</span></div><div class="flex justify-between"><span class="font-bold">Discount</span><span>-${formatCurrency(tx.discount)}</span></div></div>`;
        }
        document.getElementById('rec-items-list').innerHTML = receiptItemsHtml;
        document.getElementById('rec-cash-row').classList.toggle('hidden', tx.type !== 'SA');
        document.getElementById('rec-change-row').classList.toggle('hidden', tx.type !== 'SA');
        if (tx.type === 'SA') {
            document.getElementById('rec-cash').innerText = formatCurrency(tx.cashReceived || 0);
            document.getElementById('rec-change').innerText = formatCurrency(tx.change || 0);
        }
        document.getElementById('rec-customer-row').classList.toggle('hidden', !tx.customer);
        if (tx.customer) document.getElementById('rec-customer').innerText = tx.customer;
        showReceiptModal();
    }

    function buildSettlementRcpt(tx) {
        resetReceiptFields();
        document.getElementById('receipt-title').innerText = 'CREDIT SETTLEMENT';
        document.getElementById('receipt-standard-fields').classList.add('hidden');
        document.getElementById('receipt-settlement-fields').classList.remove('hidden');
        document.getElementById('receipt-items-header').classList.add('hidden');
        document.getElementById('receipt-settlement-header').classList.remove('hidden');
        document.getElementById('rec-set-customer').innerText = tx.customer || 'Guest';
        document.getElementById('rec-set-date').innerText = new Date(tx.timestamp).toLocaleDateString();
        document.getElementById('rec-label-total').innerText = 'TOTAL PAID:';
        document.getElementById('rec-total').innerText = formatCurrency(tx.total);
        const itemsList = document.getElementById('rec-items-list');
        let html = '';
        if (tx.items && tx.items.length > 0) {
            const ticketGroups = {};
            tx.items.forEach(item => {
                const ticketId = item.originalTicketId || tx.notes || 'Original Order';
                if (!ticketGroups[ticketId]) ticketGroups[ticketId] = [];
                ticketGroups[ticketId].push(item);
            });
            for (const ticketId in ticketGroups) {
                html += `<div class="mt-4 mb-1.5 border-b border-black pb-0.5"><span class="font-bold uppercase text-[10px]">Ticket: ${escapeHTML(ticketId)}</span></div>`;
                html += renderReceiptItems(ticketGroups[ticketId]);
            }
        } else {
            html = `<div class="p-2 bg-gray-50 border border-gray-200 rounded text-[9px]"><p class="font-mono break-all">Settled: ${escapeHTML(tx.notes)}</p></div>`;
        }
        itemsList.innerHTML = html;
        document.getElementById('rec-cash-row').classList.add('hidden');
        document.getElementById('rec-change-row').classList.add('hidden');
        document.getElementById('rec-customer-row').classList.add('hidden');
        showReceiptModal();
    }

    function printReceiptFromSuccess() { if (lastTransactionId) viewReceipt(lastTransactionId); closeModal('mod-success'); }
    function closeSuccessAndNewSale() { closeModal('mod-success'); }
    function togglePackFields() { const packFields = document.getElementById('pack-fields'); const hasPack = document.getElementById('p-has-pack'); if (packFields && hasPack) { if (hasPack.checked) { packFields.classList.remove('hidden'); packFields.classList.add('grid'); } else { packFields.classList.add('hidden'); packFields.classList.remove('grid'); } } }
    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.replace('flex', 'hidden');
        if (id === 'review-modal' && typeof resetReviewPaymentUi === 'function') resetReviewPaymentUi();
        if (id === 'product-modal') stopInvScanner();
    }
    function showToast(m, t = 'info') { const c = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `p-3 px-4 rounded-xl shadow-lg flex items-center gap-2 text-white text-xs font-bold transition-all duration-300 transform translate-x-10 opacity-0 z-[300] ${t === 'success' ? 'bg-secondary' : t === 'error' ? 'bg-error' : 'bg-primary'}`; toast.innerHTML = `<span class="material-symbols-outlined text-[16px]">${t === 'success' ? 'check_circle' : 'info'}</span><span>${escapeHTML(m)}</span>`; c.appendChild(toast); requestAnimationFrame(() => toast.classList.remove('translate-x-10', 'opacity-0')); setTimeout(() => { toast.classList.add('opacity-0', 'translate-x-full'); setTimeout(() => toast.remove(), 300); }, 2500); }
    
    function updateNotifBadge() {
        const lowStockItems = state.inventory.filter(p => p.stock <= (p.lowStock !== undefined ? p.lowStock : 5));
        const dot = document.getElementById('notif-dot');
        if (dot) dot.classList.toggle('hidden', lowStockItems.length === 0);
    }

    function showNotifications() {
        const lowStockItems = state.inventory.filter(p => p.stock <= (p.lowStock !== undefined ? p.lowStock : 5));
        const pendingCredits = state.transactions.filter(t => t.type === 'CR' && !t.paid);
        const list = document.getElementById('notif-list');
        let html = '';
        if (lowStockItems.length > 0) {
            html += `<div class="p-3 bg-yellow-50"><p class="text-[9px] font-black uppercase text-yellow-700 mb-2 tracking-wider">Low Stock (${lowStockItems.length})</p>` +
                lowStockItems.map(p => `<div class="flex justify-between items-center py-1.5"><span class="text-xs font-bold truncate">${p.name}</span><span class="text-[10px] font-black text-error ml-2">${p.stock} left</span></div>`).join('') + '</div>';
        }
        if (pendingCredits.length > 0) {
            const total = pendingCredits.reduce((a, b) => a + b.total, 0);
            html += `<div class="p-3"><p class="text-[9px] font-black uppercase text-orange-600 mb-2 tracking-wider">Pending Credits (${pendingCredits.length})</p><p class="text-xs font-black text-on-surface">Total outstanding: ₱${total.toLocaleString()}</p></div>`;
        }
        if (!html) html = '<div class="p-6 text-center text-xs opacity-40 font-bold uppercase">All clear — nothing to report!</div>';
        list.innerHTML = html;
        document.getElementById('notif-panel').classList.replace('hidden', 'flex');
    }

    // --- Inventory Export ---
    let posScannerRunning = false;

    function togglePosScanner() {
        if (posScannerRunning) { stopPosScanner(); return; }
        startPosScanner();
    }

    function startPosScanner() {
        const container = document.getElementById('pos-cam-area-container');
        const camArea = document.getElementById('pos-cam-area');
        const label = document.getElementById('pos-scanner-active-label');
        if (!container || !camArea) return;
        if (typeof Quagga === 'undefined') {
            showToast('Scanner library is still loading. Try again in a moment.', 'error');
            return;
        }
        container.classList.remove('hidden');
        camArea.innerHTML = '';
        if (posScannerRunning) return;
        try { Quagga.offDetected(); } catch(e) {}
        try { Quagga.stop(); } catch(e) {}
        posScannerRunning = true;
        label && label.classList.remove('hidden');

        Quagga.init({
            inputStream: { type: 'LiveStream', target: camArea, constraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 480 } } },
            locator: { patchSize: 'medium', halfSample: true },
            numOfWorkers: navigator.hardwareConcurrency || 2,
            decoder: { readers: ['ean_reader','ean_8_reader','code_128_reader','code_39_reader','upc_reader','upc_e_reader','codabar_reader','i2of5_reader'] },
            locate: true
        }, function(err) {
            if (err) {
                posScannerRunning = false;
                container.classList.add('hidden');
                label && label.classList.add('hidden');
                showToast(err.name === 'NotAllowedError' ? 'Camera permission denied' : 'Camera error', 'error');
                return;
            }
            Quagga.start();
            showToast('Aim camera at barcode', 'info');
        });

        let lastCode = '', lastTime = 0;
        Quagga.onDetected(function(result) {
            const code = result && result.codeResult && result.codeResult.code ? String(result.codeResult.code).trim() : '';
            if (!vc7226LooksLikeBarcode(code)) return;
            const now = Date.now();
            if (code === lastCode && now - lastTime < 2000) return;
            lastCode = code; lastTime = now;
            stopPosScanner();
            handlePhysicalScan(code);
        });
    }

    function stopPosScanner() {
        if (!posScannerRunning) return;
        try { Quagga.stop(); } catch(e) {}
        posScannerRunning = false;
        const container = document.getElementById('pos-cam-area-container');
        const camArea = document.getElementById('pos-cam-area');
        const label = document.getElementById('pos-scanner-active-label');
        if (container) container.classList.add('hidden');
        if (camArea) camArea.innerHTML = '';
        label && label.classList.add('hidden');
    }

    // --- Change PIN Logic ---
    let newPinBuffer = '';
    let newPinConfirmBuffer = '';
    let newPinStage = 'enter'; // 'enter' or 'confirm'

    function openChangePinModal() {
        newPinBuffer = ''; newPinConfirmBuffer = ''; newPinStage = 'enter';
        document.getElementById('change-pin-msg').innerText = 'Enter your new 4-digit PIN';
        updateNewPinDots('');
        closeModal('change-pin-modal');
        document.getElementById('change-pin-modal').classList.replace('hidden', 'flex');
    }

    function pressNewPin(num) {
        if (newPinStage === 'enter') {
            if (newPinBuffer.length < 4) { newPinBuffer += num; updateNewPinDots(newPinBuffer); if (newPinBuffer.length === 4) setTimeout(advanceNewPin, 150); }
        } else {
            if (newPinConfirmBuffer.length < 4) { newPinConfirmBuffer += num; updateNewPinDots(newPinConfirmBuffer); if (newPinConfirmBuffer.length === 4) setTimeout(confirmNewPin, 150); }
        }
    }

    function clearNewPin() {
        if (newPinStage === 'enter') { newPinBuffer = ''; updateNewPinDots(''); }
        else { newPinConfirmBuffer = ''; updateNewPinDots(''); }
    }

    function updateNewPinDots(buf) {
        for (let i = 0; i < 4; i++) {
            const dot = document.getElementById(`new-dot-${i}`);
            if (dot) dot.classList.toggle('bg-primary', i < buf.length);
        }
    }

    function advanceNewPin() {
        newPinStage = 'confirm';
        document.getElementById('change-pin-msg').innerText = 'Confirm your new PIN';
        updateNewPinDots('');
    }

    function confirmNewPin() {
        if (newPinBuffer === newPinConfirmBuffer) {
            hashPin(newPinBuffer).then(hash => {
                STORED_PIN_HASH = hash;
                localStorage.setItem(PIN_KEY, hash);
                closeModal('change-pin-modal');
                showToast('PIN changed successfully', 'success');
            });
        } else {
            showToast('PINs do not match', 'error');
            newPinBuffer = ''; newPinConfirmBuffer = ''; newPinStage = 'enter';
            document.getElementById('change-pin-msg').innerText = 'Enter your new 4-digit PIN';
            updateNewPinDots('');
        }
    }

    // --- Stock Adjustment ---
    function openStockAdjust(id) {
        const p = state.inventory.find(i => i.id === id);
        if (!p) return;
        const qty = prompt(`Adjust stock for "${p.name}"\nCurrent stock: ${p.stock}\n\nEnter amount to ADD (positive) or DEDUCT (negative):`);
        if (qty === null || qty === '') return;
        const delta = parseInt(qty);
        if (isNaN(delta)) { showToast('Invalid quantity', 'error'); return; }
        p.stock = Math.max(0, p.stock + delta);
        p._offline = true;
        queueAction('update', 'inventory', p);
        sync(); renderInventory();
        if (typeof renderFavorites === 'function') renderFavorites();
        showToast(`Stock ${delta >= 0 ? 'added' : 'deducted'}: ${Math.abs(delta)} pcs`, 'success');
    }

    // --- Inventory CSV Export ---
    function exportInventoryCSV() {
        if (state.inventory.length === 0) { showToast('No inventory to export', 'error'); return; }
        const rows = ["Name,Barcode,Category,Cost,Price,Stock,PackSize,PackPrice",
            ...state.inventory.map(p => `"${p.name}",${p.barcode || ''},${p.category || ''},${p.cost || 0},${p.price || 0},${p.stock || 0},${p.packSize || ''},${p.packPrice || ''}`)
        ];
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
        link.download = 'Villacart_Inventory.csv'; link.click();
        showToast('Inventory exported', 'success');
    }

    let invScannerRunning = false;

    function startInvScanner() {
        const container = document.getElementById('scanner-preview-container');
        const camArea = document.getElementById('inv-cam-area');
        if (!container || !camArea) return;

        // Show the preview container
        container.classList.remove('hidden');
        camArea.innerHTML = '';

        if (invScannerRunning) return;
        invScannerRunning = true;

        Quagga.init({
            inputStream: {
                type: 'LiveStream',
                target: camArea,
                constraints: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            },
            locator: { patchSize: 'medium', halfSample: true },
            numOfWorkers: navigator.hardwareConcurrency || 2,
            decoder: {
                readers: [
                    'ean_reader', 'ean_8_reader', 'code_128_reader',
                    'code_39_reader', 'upc_reader', 'upc_e_reader',
                    'codabar_reader', 'i2of5_reader'
                ]
            },
            locate: true
        }, function(err) {
            if (err) {
                invScannerRunning = false;
                container.classList.add('hidden');
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    showToast('Camera permission denied', 'error');
                } else if (err.name === 'NotFoundError') {
                    showToast('No camera found', 'error');
                } else {
                    showToast('Camera error: ' + (err.message || err), 'error');
                }
                return;
            }
            Quagga.start();
            showToast('Scanner active — aim at barcode', 'success');
        });

        let lastScanned = '';
        let lastScannedTime = 0;

        Quagga.onDetected(function(result) {
            const code = result.codeResult.code;
            const now = Date.now();
            // Debounce: ignore same code within 2 seconds
            if (code === lastScanned && now - lastScannedTime < 2000) return;
            lastScanned = code;
            lastScannedTime = now;

            const barcodeField = document.getElementById('p-barcode');
            if (barcodeField) {
                barcodeField.value = code;
                showToast('Barcode scanned: ' + code, 'success');
            }
            stopInvScanner();
        });
    }

    function stopInvScanner() {
        if (!invScannerRunning) return;
        try { Quagga.stop(); } catch(e) {}
        invScannerRunning = false;
        const container = document.getElementById('scanner-preview-container');
        const camArea = document.getElementById('inv-cam-area');
        if (container) container.classList.add('hidden');
        if (camArea) camArea.innerHTML = '';
    }

    
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


    // v5.6.1 Cash amount selection polish
    function markCashQuickAmount(value) {
        document.querySelectorAll('.cash-quick-btn').forEach(btn => {
            const isSelected = String(btn.dataset.cash) === String(value);
            btn.classList.toggle('cash-selected', isSelected);
            btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
        const cashInput = document.getElementById('cash-input');
        if (cashInput) cashInput.classList.toggle('cash-input-highlight', !!value);
    }

    const vcOriginalSetCash = typeof setCash === 'function' ? setCash : null;
    if (vcOriginalSetCash && !window.__vcSetCashPatched) {
        window.__vcSetCashPatched = true;
        setCash = function(amount) {
            vcOriginalSetCash(amount);
            markCashQuickAmount(amount);
        };
    }

    const vcOriginalSetExact = typeof setExact === 'function' ? setExact : null;
    if (vcOriginalSetExact && !window.__vcSetExactPatched) {
        window.__vcSetExactPatched = true;
        setExact = function() {
            vcOriginalSetExact();
            markCashQuickAmount('exact');
        };
    }

    document.addEventListener('input', (event) => {
        if (event.target && event.target.id === 'cash-input') {
            document.querySelectorAll('.cash-quick-btn').forEach(btn => {
                btn.classList.remove('cash-selected');
                btn.setAttribute('aria-pressed', 'false');
            });
            event.target.classList.toggle('cash-input-highlight', event.target.value !== '');
        }
    });


    // v5.6.1 Change display polish
    function polishChangeDisplay() {
        const totalEl = document.getElementById('rev-total');
        const cashEl = document.getElementById('cash-input');
        const changeDisplay = document.getElementById('change-display');
        const changeAmount = document.getElementById('change-amount');
        const statusLabel = document.getElementById('change-status-label');
        const confirmBtn = document.getElementById('confirm-checkout');
        if (!cashEl || !changeDisplay || !changeAmount) return;

        const payableText = totalEl ? totalEl.innerText.replace(/[₱,\s]/g, '') : '0';
        const total = parseFloat(payableText) || 0;
        const cash = parseFloat(cashEl.value) || 0;
        const diff = cash - total;

        changeDisplay.classList.remove('change-ok', 'change-short', 'change-pulse');
        void changeDisplay.offsetWidth;
        changeDisplay.classList.add('change-pulse');

        if (!cashEl.value) {
            if (statusLabel) statusLabel.innerText = 'Waiting for Payment';
            changeAmount.innerText = '₱0.00';
            if (confirmBtn) {
                confirmBtn.classList.remove('bg-secondary');
                confirmBtn.querySelector('span:last-child').innerText = 'Confirm Transaction';
            }
            return;
        }

        if (diff >= 0) {
            changeDisplay.classList.add('change-ok');
            if (statusLabel) statusLabel.innerText = 'Change to Give';
            changeAmount.innerText = `₱${diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (confirmBtn) {
                confirmBtn.classList.add('bg-secondary');
                const label = confirmBtn.querySelector('span:last-child');
                if (label) label.innerText = 'Complete Sale';
            }
        } else {
            changeDisplay.classList.add('change-short');
            if (statusLabel) statusLabel.innerText = 'Balance Remaining';
            changeAmount.innerText = `₱${Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (confirmBtn) {
                confirmBtn.classList.remove('bg-secondary');
                const label = confirmBtn.querySelector('span:last-child');
                if (label) label.innerText = 'Confirm Transaction';
            }
        }
    }

    const vcOriginalCalculateChange = typeof calculateChange === 'function' ? calculateChange : null;
    if (vcOriginalCalculateChange && !window.__vcCalculateChangePatched) {
        window.__vcCalculateChangePatched = true;
        calculateChange = function() {
            vcOriginalCalculateChange();
            polishChangeDisplay();
        };
    }

    document.addEventListener('input', (event) => {
        if (event.target && event.target.id === 'cash-input') {
            setTimeout(polishChangeDisplay, 0);
        }
    });


    // v5.6.1 Business Dashboard calculations
    function getBusinessMetricsForPeriod(transactions) {
        const periodTx = transactions || getPeriodTransactions();
        const revenueSales = periodTx.filter(t => isRevenueSale ? isRevenueSale(t) : ((t.type === 'SA' || t.type === 'CR') && !(t.notes && t.notes.includes('CR-'))));
        const cashSales = revenueSales.filter(t => t.type === 'SA').reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const creditSales = revenueSales.filter(t => t.type === 'CR').reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const collections = periodTx.filter(t => t.notes && t.notes.includes('CR-')).reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const expenses = periodTx.filter(t => t.type === 'EX').reduce((sum, t) => sum + (Number(t.total) || 0), 0);

        let cogs = 0;
        revenueSales.forEach(t => {
            if (!t.items) return;
            t.items.forEach(item => {
                cogs += (Number(item.cost) || 0) * (Number(item.qty) || 0) * (Number(item.deduct) || 1);
            });
        });

        const totalSales = cashSales + creditSales;
        const cashIn = cashSales + collections;
        const netProfit = totalSales - cogs - expenses;

        const allCreditSales = state.transactions
            .filter(t => t.type === 'CR' && !(t.notes && t.notes.includes('CR-')))
            .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const allCollections = state.transactions
            .filter(t => t.notes && t.notes.includes('CR-'))
            .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const outstandingCredit = Math.max(0, allCreditSales - allCollections);

        return { cashSales, creditSales, collections, totalSales, cashIn, expenses, cogs, netProfit, outstandingCredit };
    }

    function updateBusinessDashboardCards() {
        const m = getBusinessMetricsForPeriod(typeof getActiveBusinessDayTransactionsOrPeriod === 'function' ? getActiveBusinessDayTransactionsOrPeriod() : undefined);
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.innerText = `₱${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };
        setText('biz-total-sales', m.totalSales);
        setText('biz-cash-in', m.cashIn);
        setText('biz-credit-sales', m.creditSales);
        setText('biz-outstanding-credit', m.outstandingCredit);
    }

    const vcOriginalRenderInsightsBiz = typeof renderInsights === 'function' ? renderInsights : null;
    if (vcOriginalRenderInsightsBiz && !window.__vcRenderInsightsBizPatched) {
        window.__vcRenderInsightsBizPatched = true;
        renderInsights = function() {
            vcOriginalRenderInsightsBiz();
            updateBusinessDashboardCards();
        };
    }

    


    // v5.6.1 Store Closing Preview Modal
    function moneyFmt(value) {
        return `₱${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    
    function getClosingTransactionsScope() {
        const bd = getCurrentBusinessDay ? getCurrentBusinessDay() : null;
        if (bd) return getBusinessDayTransactions(bd.id);
        return getPeriodTransactions();
    }

function getClosingCounts(transactions) {
        const periodTx = transactions || getPeriodTransactions();
        return {
            cash: periodTx.filter(t => t.type === 'SA' && !(t.notes && t.notes.includes('CR-'))).length,
            credit: periodTx.filter(t => t.type === 'CR' && !(t.notes && t.notes.includes('CR-'))).length,
            collections: periodTx.filter(t => t.notes && t.notes.includes('CR-')).length,
            expenses: periodTx.filter(t => t.type === 'EX').length
        };
    }

    function showStoreClosingSummary() {
        const periodTx = getClosingTransactionsScope();
        const m = getBusinessMetricsForPeriod(periodTx);
        const c = getClosingCounts(periodTx);
        const activeBD = getCurrentBusinessDay ? getCurrentBusinessDay() : null;
        const periodLabel = activeBD ? `${activeBD.id} • ${new Date(activeBD.openedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} to Now` : (insightPeriod === 'day' ? 'Today • 12:00 AM to Now' : insightPeriod === 'month' ? 'This Month' : 'Selected Range');

        const set = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
        set('closing-period-label', periodLabel);
        set('closing-cash-in', moneyFmt(m.cashIn));
        set('closing-cash-sales', moneyFmt(m.cashSales));
        set('closing-credit-sales', moneyFmt(m.creditSales));
        set('closing-collections', moneyFmt(m.collections));
        set('closing-expenses', moneyFmt(m.expenses));
        set('closing-total-sales', moneyFmt(m.totalSales));
        set('closing-cogs', moneyFmt(m.cogs));
        set('closing-net-profit', moneyFmt(m.netProfit));
        set('closing-outstanding', moneyFmt(m.outstandingCredit));
        set('closing-count-cash', c.cash);
        set('closing-count-credit', c.credit);
        set('closing-count-collections', c.collections);
        set('closing-count-expenses', c.expenses);

        document.getElementById('closing-summary-modal').classList.replace('hidden', 'flex');
    }

    function printClosingSummary() {
        window.print();
    }


    // v5.6.1 Reporting Fallback: never hide real transactions because businessDayId is missing
    function getActiveBusinessDayTransactionsOrPeriod() {
        try {
            const bd = (typeof getCurrentBusinessDay === 'function') ? getCurrentBusinessDay() : null;
            if (bd && typeof getBusinessDayTransactions === 'function') {
                const bdTx = getBusinessDayTransactions(bd.id);
                if (bdTx && bdTx.length > 0) return bdTx;
            }
        } catch(e) {}
        return getPeriodTransactions();
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

    function getTodayTransactionsResilient() {
        const today = typeof localDateCode === 'function'
            ? localDateCode(new Date())
            : new Date().toISOString().slice(0,10);
        return (state.transactions || []).filter(t => {
            const txDate = t.businessDate || (t.timestamp ? t.timestamp.slice(0,10) : '');
            return txDate === today;
        });
    }

    function getBusinessMetricsResilient(transactions) {
        const tx = transactions || getTodayTransactionsResilient();
        const isSettlementFn = (t) => (typeof isCreditSettlement === 'function') ? isCreditSettlement(t) : !!(t.notes && t.notes.includes('CR-'));
        const revenueSales = tx.filter(t => (t.type === 'SA' || t.type === 'CR') && !isSettlementFn(t));
        const cashSales = revenueSales.filter(t => t.type === 'SA').reduce((s,t)=>s+(Number(t.total)||0),0);
        const creditSales = revenueSales.filter(t => t.type === 'CR').reduce((s,t)=>s+(Number(t.total)||0),0);
        const collections = tx.filter(t => isSettlementFn(t)).reduce((s,t)=>s+(Number(t.total)||0),0);
        const expenses = tx.filter(t => t.type === 'EX').reduce((s,t)=>s+(Number(t.total)||0),0);
        let cogs = 0;
        revenueSales.forEach(t => {
            (t.items || []).forEach(item => {
                cogs += (Number(item.cost)||0) * (Number(item.qty)||0) * (Number(item.deduct)||1);
            });
        });
        const totalSales = cashSales + creditSales;
        const cashIn = cashSales + collections;
        const netProfit = totalSales - cogs - expenses;
        return { cashSales, creditSales, collections, expenses, cogs, totalSales, cashIn, netProfit, transactionCount: tx.length };
    }

    function forceUpdateInsightsNumbersFromTransactions() {
        const periodTx = (typeof getPeriodTransactions === 'function') ? getPeriodTransactions() : getTodayTransactionsResilient();
        const m = getBusinessMetricsResilient(periodTx);

        const setMoney = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.innerText = `₱${(Number(value)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        };
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.innerText = value;
        };

        setMoney('daily-revenue', m.totalSales);
        setMoney('daily-profit', m.netProfit);
        setMoney('daily-cogs', m.cogs);
        setMoney('daily-expenses', m.expenses);
        setText('daily-margin', `${m.totalSales > 0 ? ((m.netProfit / m.totalSales) * 100).toFixed(1) : '0'}%`);

        setMoney('biz-total-sales', m.totalSales);
        setMoney('biz-cash-in', m.cashIn);
        setMoney('biz-credit-sales', m.creditSales);

        if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI();
        if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
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
        if (canvas.dataset.vc531ChartSig === sig) return;
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

    function vc541Kind(t) {
        if (vc541IsSettlement(t)) return 'settlement';
        if (t && t.type === 'CR') return 'credit';
        if (t && t.type === 'EX') return 'expense';
        return 'cash';
    }

    function vc541Label(kind) {
        return ({ cash: 'SA', credit: 'CR', settlement: 'PAYMENT', expense: 'EX' })[kind] || 'TX';
    }

    function vc541Icon(kind) {
        return ({ cash: 'payments', credit: 'schedule', settlement: 'task_alt', expense: 'remove_circle' })[kind] || 'receipt_long';
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

    function vc541PeriodTransactions() {
        if (typeof vc531PeriodTransactions === 'function') return vc531PeriodTransactions();
        if (typeof getPeriodTransactions === 'function') {
            try { return getPeriodTransactions(); } catch(e) {}
        }
        const today = vc541DateCode(new Date());
        return vc541Clean(state.transactions || []).filter(t => {
            const d = t.businessDate || (t.timestamp ? vc541DateCode(t.timestamp) : '');
            return d === today;
        });
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

        state.currentBusinessDayId = bd.id;

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
            return vc543EnsureBusinessDayFromLiveTransactions();
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
        const lowStock = (state.inventory || []).filter(p => {
            const stock = Number(p.stock) || 0;
            const low = Number(p.lowStock);
            return !Number.isNaN(low) && low >= 0 && stock <= low;
        });

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
            setTimeout(setupRealTimeSync, 1500);
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
        const notes = String(t && t.notes || '').toUpperCase();
        const id = String(t && t.id || '').toUpperCase();
        return notes.includes('CR-') || notes.includes('PARTIAL:') || notes.includes('PAYMENT') || (id.startsWith('SA-') && notes.includes('CR-'));
    }

    function vc5632SettlementCreditIds(t) {
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
            if (ledgerSearch) ledgerSearch.addEventListener('input', () => renderLedger());
            if (ledgerDate) {
                ledgerDate.addEventListener('input', () => {
                    ledgerDate.dataset.vcUserPickedDate = '1';
                    renderLedger();
                });
                ledgerDate.addEventListener('change', () => {
                    ledgerDate.dataset.vcUserPickedDate = '1';
                    renderLedger();
                });
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

    function vc5632TxCard(t, kind) {
        const note = t.desc || t.notes || '';
        const customer = t.customer ? '<p class="vc5629-meta">Customer: ' + vc5632Safe(t.customer) + '</p>' : '';
        const isSettledCredit = kind === 'credit-settled' || !!(t && t._vcCreditSettled);
        const cardKind = kind === 'credit-settled' ? 'credit' : kind;
        const payButton = kind === 'credit' && !isSettledCredit ? '<button type="button" class="vc5632-mini-pay" onclick="payIndividualTicket(\'' + vc5632Js(t.id) + '\')">Pay</button>' : '';
        return '<article class="vc5629-tx-card vc5629-' + cardKind + (isSettledCredit ? ' vc5632-settled-credit-card' : '') + '">' +
            '<div class="vc5629-tx-main"><div class="vc5629-tx-top"><h3>' + vc5632Safe(t.id || 'Transaction') + '</h3><div class="vc5629-pills">' + vc5632Pills(t, kind) + '</div></div>' +
            '<p class="vc5629-time">' + vc5632Safe(vc5632Time(t)) + '</p>' + customer +
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
        const total = list.reduce((sum, t) => sum + Number(t.total || 0), 0);
        return {
            list,
            kind: 'cash',
            summary: vc5632SummaryCard('Total Cash Sales', vc5632Peso(total), 'Cash sales and payments', 'blue') +
                vc5632SummaryCard('Cash Received', vc5632Peso(total), 'Collected amount', 'green') +
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

    // v7.2.70: Do not pre-render Stock while the PIN modal is still open.
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


// v7.2.14: Calendar-month backup/archive. Inventory is never archived/deleted.
(function(){
    if (window.__vc710CalendarArchive) return;
    window.__vc710CalendarArchive = true;

    function dateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function currentMonthStart() {
        const now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    }

    function txDate(tx) {
        return String((tx && (tx.businessDate || tx.date || tx.timestamp)) || '').slice(0, 10);
    }

    function vc710MergeArchiveById(existing, incoming) {
        const map = new Map();
        (Array.isArray(existing) ? existing : []).forEach(item => { if (item && item.id) map.set(item.id, item); });
        (Array.isArray(incoming) ? incoming : []).forEach(item => { if (item && item.id) map.set(item.id, { ...item, _archiveOnly: true }); });
        return Array.from(map.values()).sort((a, b) => String(b.timestamp || b.date || '').localeCompare(String(a.timestamp || a.date || '')));
    }

    function downloadJson(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            URL.revokeObjectURL(link.href);
            link.remove();
        }, 500);
    }

    async function queryOld(collection, field, cutoff, limit) {
        if (typeof queryCollectionWithFirestoreRest !== 'function') return [];
        return queryCollectionWithFirestoreRest(collection, [
            { field, op: 'LESS_THAN', value: cutoff }
        ], limit || 3000);
    }

    async function deleteCloudDocs(table, docs) {
        if (typeof syncTaskWithFirestoreRest !== 'function') throw new Error('Delete helper unavailable.');
        for (const doc of docs || []) {
            if (!doc || !doc.id) continue;
            await syncTaskWithFirestoreRest({ type: 'delete', table, data: { id: doc.id } });
        }
    }


    function archiveFormatDateTime(value) {
        if (!value) return 'Never';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return 'Unknown';
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function updateArchiveMeta(patch) {
        state.archiveMeta = { ...(state.archiveMeta || {}), ...(patch || {}), updatedAt: new Date().toISOString() };
        if (typeof saveLocalArchive === 'function') saveLocalArchive();
        renderArchiveSafety();
    }

    function renderArchiveSafety() {
        const panel = document.getElementById('vc728-archive-safety');
        if (!panel) return;
        const meta = state.archiveMeta || {};
        const txCount = Array.isArray(state.archiveTransactions) ? state.archiveTransactions.length : 0;
        const dayCount = Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays.length : 0;
        const lastExport = archiveFormatDateTime(meta.lastExportAt);
        const lastLoad = archiveFormatDateTime(meta.lastLoadAt);
        const loadFile = meta.lastLoadFile ? ' • ' + String(meta.lastLoadFile) : '';
        const exportScope = meta.lastArchiveBefore ? 'Before ' + String(meta.lastArchiveBefore) : 'No archive export yet';
        panel.innerHTML = '<div class="flex items-start gap-3">' +
            '<div class="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">verified_user</span></div>' +
            '<div class="min-w-0 flex-1">' +
                '<div class="flex flex-wrap items-center gap-2">' +
                    '<p class="text-[10px] font-black uppercase tracking-[0.22em] text-primary/70">Backup Safety</p>' +
                    '<span class="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase">Local archive only</span>' +
                '</div>' +
                '<p class="mt-1 text-xs font-bold text-on-surface-variant">Loaded archives stay on this device and are not written back to Firestore.</p>' +
                '<div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-bold">' +
                    '<div class="rounded-2xl bg-white/80 border border-border-subtle p-3"><span class="block uppercase text-[9px] tracking-widest text-on-surface-variant">Last export</span><strong class="text-primary">' + lastExport + '</strong><span class="block text-on-surface-variant mt-1">' + exportScope + '</span></div>' +
                    '<div class="rounded-2xl bg-white/80 border border-border-subtle p-3"><span class="block uppercase text-[9px] tracking-widest text-on-surface-variant">Last local load</span><strong class="text-primary">' + lastLoad + '</strong><span class="block text-on-surface-variant mt-1 truncate">' + (loadFile || 'No file loaded') + '</span></div>' +
                    '<div class="rounded-2xl bg-white/80 border border-border-subtle p-3"><span class="block uppercase text-[9px] tracking-widest text-on-surface-variant">Local archive stored</span><strong class="text-primary">' + txCount + ' tx / ' + dayCount + ' day(s)</strong><span class="block text-on-surface-variant mt-1">Keep original JSON files safe</span></div>' +
                '</div>' +
                '<div class="mt-3 flex flex-wrap items-center gap-2">' +
                    '<button type="button" onclick="clearLoadedArchiveData()" class="px-3 py-2 rounded-2xl bg-error/10 text-error text-[10px] font-black uppercase tracking-wider border border-error/10 active-scale">Delete loaded backup data</button>' +
                    '<span class="text-[10px] font-bold text-on-surface-variant">This clears local archive history on this device only.</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    async function backupOldCalendarData() {
        if (!navigator.onLine) {
            if (typeof showToast === 'function') showToast('Go online before backup', 'error');
            return;
        }
        const cutoff = currentMonthStart();
        const btn = document.getElementById('vc710-backup-old-btn');
        const oldHtml = btn ? btn.innerHTML : '';
        try {
            if (btn) {
                btn.disabled = true;
                btn.classList.add('opacity-60');
                btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Preparing';
            }
            const [transactionsRaw, businessDaysRaw] = await Promise.all([
                queryOld('transactions', 'businessDate', cutoff, 5000),
                queryOld('businessDays', 'date', cutoff, 1000)
            ]);
            const transactions = (transactionsRaw || []).filter(t => txDate(t) && txDate(t) < cutoff);
            const businessDays = (businessDaysRaw || []).filter(d => String(d.date || '').slice(0, 10) < cutoff);
            if (!transactions.length && !businessDays.length) {
                if (typeof showToast === 'function') showToast('No old records before this month', 'info');
                return;
            }
            const payload = {
                app: 'Villacart POS',
                backupVersion: 'v7.2.14',
                environment: window.VILLACART_ENV || 'live',
                firebaseProjectId: window.VILLACART_FIREBASE_PROJECT || null,
                archiveBefore: cutoff,
                createdAt: new Date().toISOString(),
                note: 'Inventory is intentionally not included. Loaded backups are local archive-only and must not sync to Firestore.',
                transactions,
                businessDays
            };
            const fileMonth = cutoff.slice(0, 7);
            downloadJson('Villacart_Archive_before_' + fileMonth + '.json', payload);
            updateArchiveMeta({
                lastExportAt: payload.createdAt,
                lastArchiveBefore: cutoff,
                lastExportFile: 'Villacart_Archive_before_' + fileMonth + '.json',
                lastExportTransactions: transactions.length,
                lastExportBusinessDays: businessDays.length
            });
            const ok = confirm('Backup file downloaded for records before ' + cutoff + '.\n\nDelete these old transactions/business days from Firestore now?\n\nChoose Cancel if you want to verify the file first.');
            if (!ok) {
                if (typeof showToast === 'function') showToast('Backup downloaded; cloud delete skipped', 'info');
                return;
            }
            await deleteCloudDocs('transactions', transactions);
            await deleteCloudDocs('businessDays', businessDays);
            state.transactions = (state.transactions || []).filter(t => !(txDate(t) && txDate(t) < cutoff));
            state.businessDays = (state.businessDays || []).filter(d => !(String(d.date || '').slice(0, 10) < cutoff));
            if (typeof sync === 'function') sync();
            if (typeof renderLedger === 'function') renderLedger();
            if (typeof renderInsights === 'function') renderInsights();
            if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
            if (typeof showToast === 'function') showToast('Old cloud records archived/deleted', 'success');
        } catch (error) {
            console.error('Backup/archive failed', error);
            if (typeof showToast === 'function') showToast('Backup failed: ' + (error.message || error), 'error');
            else alert('Backup failed: ' + (error.message || error));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-60');
                btn.innerHTML = oldHtml;
            }
        }
    }

    function loadBackupFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function() {
            try {
                const data = JSON.parse(String(reader.result || '{}'));
                const tx = Array.isArray(data.transactions) ? data.transactions : [];
                const bd = Array.isArray(data.businessDays) ? data.businessDays : [];
                if (!tx.length && !bd.length) throw new Error('No transactions/businessDays found in backup.');
                state.archiveTransactions = vc710MergeArchiveById(state.archiveTransactions || [], tx);
                state.archiveBusinessDays = vc710MergeArchiveById(state.archiveBusinessDays || [], bd);
                updateArchiveMeta({
                    lastLoadAt: new Date().toISOString(),
                    lastLoadFile: file.name || 'archive.json',
                    lastLoadTransactions: tx.length,
                    lastLoadBusinessDays: bd.length
                });
                if (typeof sync === 'function') sync();
                if (typeof renderLedger === 'function') renderLedger();
                if (typeof renderInsights === 'function') renderInsights();
                if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
                if (typeof showToast === 'function') showToast('Backup loaded locally only', 'success');
            } catch (error) {
                console.error('Load backup failed', error);
                if (typeof showToast === 'function') showToast('Load failed: ' + (error.message || error), 'error');
                else alert('Load failed: ' + (error.message || error));
            }
        };
        reader.readAsText(file);
    }


    function clearLoadedArchiveData() {
        const txCount = Array.isArray(state.archiveTransactions) ? state.archiveTransactions.length : 0;
        const dayCount = Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays.length : 0;
        if (!txCount && !dayCount) {
            if (typeof showToast === 'function') showToast('No loaded backup data to delete', 'info');
            return;
        }
        const ok = confirm('Delete loaded backup/archive data from this device only?\n\nThis will NOT delete Firestore data and will NOT delete your original JSON backup files.');
        if (!ok) return;
        state.archiveTransactions = [];
        state.archiveBusinessDays = [];
        state.archiveMeta = {
            ...(state.archiveMeta || {}),
            lastClearedAt: new Date().toISOString(),
            lastLoadAt: null,
            lastLoadFile: null,
            lastLoadTransactions: 0,
            lastLoadBusinessDays: 0
        };
        if (typeof saveLocalArchive === 'function') saveLocalArchive();
        renderArchiveSafety();
        if (typeof renderLedger === 'function') renderLedger();
        if (typeof renderInsights === 'function') renderInsights();
        if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
        if (typeof showToast === 'function') showToast('Loaded backup data deleted locally', 'success');
    }

    window.vc728RenderArchiveSafety = renderArchiveSafety;
    setTimeout(renderArchiveSafety, 300);
    window.clearLoadedArchiveData = clearLoadedArchiveData;
    window.backupOldCalendarData = backupOldCalendarData;
    window.loadBackupArchive = function() {
        const input = document.getElementById('vc710-load-backup-input');
        if (input) input.click();
    };
    window.vc710HandleBackupFile = function(input) {
        const file = input && input.files && input.files[0];
        loadBackupFile(file);
        if (input) input.value = '';
    };
})();


// v7.2.14: Business month arrows + favorite stock display.
// Keep this small and late so it controls the currently active Business renderer
// without touching checkout, sync, or Firestore code.
(function(){
    if (window.__vc713BusinessMonthArrows) return;
    window.__vc713BusinessMonthArrows = true;

    if (typeof businessCalendarDate === 'undefined' || !(businessCalendarDate instanceof Date)) {
        var businessCalendarDate = new Date();
        window.businessCalendarDate = businessCalendarDate;
    }

    function refreshBusinessMonthView() {
        if (typeof renderBusinessCalendar === 'function') {
            try { renderBusinessCalendar(); } catch (e) { console.warn(e); }
        } else if (typeof vc541RefreshBusinessScreen === 'function') {
            try { vc541RefreshBusinessScreen(); } catch (e) { console.warn(e); }
        }
        if (typeof vc728RenderArchiveSafety === 'function') {
            try { vc728RenderArchiveSafety(); } catch (e) { console.warn(e); }
        }
    }

    window.changeBusinessMonth = function(delta) {
        const current = (typeof businessCalendarDate !== 'undefined' && businessCalendarDate instanceof Date)
            ? businessCalendarDate
            : new Date();
        businessCalendarDate = new Date(current.getFullYear(), current.getMonth() + Number(delta || 0), 1);
        window.businessCalendarDate = businessCalendarDate;
        refreshBusinessMonthView();
    };

    const oldSwitch = typeof switchScreen === 'function' ? switchScreen : null;
    if (oldSwitch && !window.__vc713BusinessSwitchPatch) {
        window.__vc713BusinessSwitchPatch = true;
        switchScreen = function(screen) {
            const result = oldSwitch.apply(this, arguments);
            if (screen === 'business') setTimeout(refreshBusinessMonthView, 80);
            return result;
        };
    }
})();


// Cheap manual refresh for Business Calendar metadata only.
// Reads only the businessDays collection; it does not read transactions/inventory and does not write to Firestore.
(function(){
    if (window.__vc7250BusinessDaysRefreshOnly) return;
    window.__vc7250BusinessDaysRefreshOnly = true;

    function vc7250PendingBusinessDayIds() {
        return new Set((Array.isArray(offlineQueue) ? offlineQueue : [])
            .filter(task => task && task.table === 'businessDays' && task.data && task.data.id)
            .map(task => task.data.id));
    }

    function vc7250RenderBusinessAfterRefresh() {
        if (typeof sync === 'function') sync();
        if (typeof updateBusinessDayUI === 'function') {
            try { updateBusinessDayUI(); } catch (error) { console.warn(error); }
        }
        if (typeof renderBusinessCalendar === 'function') {
            try { renderBusinessCalendar(); } catch (error) { console.warn(error); }
        }
        if (typeof vc728RenderArchiveSafety === 'function') {
            try { vc728RenderArchiveSafety(); } catch (error) { console.warn(error); }
        }
        if (typeof vc541RefreshBusinessScreen === 'function') {
            try { vc541RefreshBusinessScreen(); } catch (error) { console.warn(error); }
        }
        if (typeof updateSyncUI === 'function') updateSyncUI();
    }

    window.refreshBusinessDaysOnly = async function() {
        const btn = document.getElementById('vc7250-refresh-businessdays-btn');
        const oldHtml = btn ? btn.innerHTML : '';
        try {
            if (!navigator.onLine) {
                if (typeof showToast === 'function') showToast('You are offline. Business days will stay local for now.', 'info');
                return false;
            }
            if (typeof readCollectionWithFirestoreRest !== 'function') {
                throw new Error('Business day refresh helper is not ready');
            }
            if (btn) {
                btn.disabled = true;
                btn.classList.add('opacity-60');
                btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Refreshing';
            }

            const cloudDays = await readCollectionWithFirestoreRest('businessDays');
            const pendingIds = vc7250PendingBusinessDayIds();
            const merged = new Map();

            (Array.isArray(cloudDays) ? cloudDays : [])
                .filter(day => day && day.id && !pendingIds.has(day.id))
                .forEach(day => merged.set(day.id, day));

            (Array.isArray(state.businessDays) ? state.businessDays : [])
                .filter(day => day && day.id && (day._offline || pendingIds.has(day.id)))
                .forEach(day => merged.set(day.id, day));

            state.businessDays = Array.from(merged.values())
                .filter(day => day && day.id)
                .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

            const today = typeof getBusinessDateString === 'function' ? getBusinessDateString(new Date()) : new Date().toISOString().slice(0, 10);
            const openToday = state.businessDays.find(day => day && day.date === today && String(day.status || '').toUpperCase() === 'OPEN');
            if (openToday) state.currentBusinessDayId = openToday.id;

            vc7250RenderBusinessAfterRefresh();
            if (typeof showToast === 'function') showToast(`Business days refreshed (${state.businessDays.length})`, 'success');
            return true;
        } catch (error) {
            console.warn('Business days refresh failed', error);
            syncErrorMsg = error.message || String(error);
            if (typeof showToast === 'function') showToast('Business days refresh failed', 'error');
            if (typeof updateSyncUI === 'function') updateSyncUI();
            return false;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-60');
                btn.innerHTML = oldHtml || '<span class="material-symbols-outlined text-[18px]">event_repeat</span> Refresh Days';
            }
        }
    };
})();


// v7.2.37: Canonical business-day guard + manual duplicate cleanup.
// Business days should be one document per calendar date: BD-YYYYMMDD.
// Cleanup only runs when the user presses the Business screen "Clean Days" button.
(function(){
    if (window.__vc7236CanonicalBusinessDays) return;
    window.__vc7236CanonicalBusinessDays = true;

    function vc7236DateFrom(value) {
        if (!value) return '';
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function vc7236DateFromBusinessDay(day) {
        const explicit = vc7236DateFrom(day && day.date);
        if (explicit) return explicit;
        const id = String(day && (day.businessDayId || day.id) || '');
        const match = id.match(/^BD-(\d{4})(\d{2})(\d{2})/);
        if (match) return match[1] + '-' + match[2] + '-' + match[3];
        return vc7236DateFrom(day && (day.openedAt || day.createdAt || day.closedAt));
    }

    function vc7236DateFromTransaction(tx) {
        return vc7236DateFrom(tx && (tx.businessDate || tx.timestamp || tx.createdAt));
    }

    function vc7236CanonicalId(date) {
        return date ? 'BD-' + String(date).replaceAll('-', '') : '';
    }

    function vc7236CanonicalizeBusinessDay(day) {
        if (!day) return day;
        const date = vc7236DateFromBusinessDay(day);
        if (!date) return day;
        const id = vc7236CanonicalId(date);
        day.id = id;
        day.businessDayId = id;
        day.date = date;
        return day;
    }

    function vc7236NormalizeLocalBusinessDays() {
        if (!state || !Array.isArray(state.businessDays)) return [];
        const groups = new Map();
        state.businessDays.forEach(day => {
            if (!day) return;
            const date = vc7236DateFromBusinessDay(day);
            if (!date) return;
            if (!groups.has(date)) groups.set(date, []);
            groups.get(date).push(day);
        });

        const normalized = [];
        groups.forEach((days, date) => {
            const canonical = vc7236CanonicalId(date);
            const existingCanonical = days.find(d => d && d.id === canonical);
            const open = days.find(d => d && String(d.status || '').toUpperCase() === 'OPEN');
            const keeper = existingCanonical || open || days[0];
            const merged = { ...keeper, id: canonical, businessDayId: canonical, date };
            if (open) {
                merged.status = 'OPEN';
                merged.closedAt = null;
            }
            normalized.push(merged);
        });

        state.businessDays = normalized.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        const open = state.businessDays.find(d => String(d.status || '').toUpperCase() === 'OPEN') || null;
        state.currentBusinessDayId = open ? open.id : null;
        try {
            localStorage.setItem('villacart_business_days_v520', JSON.stringify(state.businessDays));
            localStorage.setItem('villacart_business_days', JSON.stringify(state.businessDays));
        } catch(e) {}
        return state.businessDays;
    }

    const oldQueueAction = typeof queueAction === 'function' ? queueAction : null;
    if (oldQueueAction && !window.__vc7236QueueBusinessDayGuard) {
        window.__vc7236QueueBusinessDayGuard = true;
        queueAction = function(type, table, data) {
            if (table === 'businessDays' && data && type !== 'delete') {
                data = vc7236CanonicalizeBusinessDay({ ...data });
            }
            if (table === 'transactions' && data && type !== 'delete') {
                const date = vc7236DateFromTransaction(data);
                if (date) {
                    data.businessDate = date;
                    data.businessDayId = vc7236CanonicalId(date);
                }
            }
            return oldQueueAction.apply(this, [type, table, data]);
        };
    }

    function vc7236EnsureBusinessDayForTransaction(transaction) {
        if (!transaction) return transaction;
        if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];
        const date = vc7236DateFromTransaction(transaction) || vc7236DateFrom(new Date());
        const id = vc7236CanonicalId(date);
        let bd = state.businessDays.find(day => day && vc7236DateFromBusinessDay(day) === date);
        if (!bd) {
            bd = {
                id,
                businessDayId: id,
                date,
                status: 'OPEN',
                openedAt: transaction.timestamp || new Date().toISOString(),
                closedAt: null,
                terminal: 'Counter 1',
                autoStarted: true,
                createdAt: new Date().toISOString(),
                version: window.VILLACART_APP_VERSION || 'v7.2.37'
            };
            state.businessDays.push(bd);
            bd._offline = true;
            if (typeof queueAction === 'function') queueAction('update', 'businessDays', bd);
        } else {
            vc7236CanonicalizeBusinessDay(bd);
            if (String(bd.status || '').toUpperCase() !== 'OPEN') {
                bd.status = 'OPEN';
                bd.closedAt = null;
                bd.reopenedAt = new Date().toISOString();
                bd._offline = true;
                if (typeof queueAction === 'function') queueAction('update', 'businessDays', bd);
            }
        }
        transaction.businessDayId = id;
        transaction.businessDate = date;
        state.currentBusinessDayId = id;
        vc7236NormalizeLocalBusinessDays();
        return transaction;
    }

    ensureBusinessDayForTransaction = vc7236EnsureBusinessDayForTransaction;
    if (typeof window !== 'undefined') window.ensureBusinessDayForTransaction = vc7236EnsureBusinessDayForTransaction;

    getCurrentBusinessDay = function() {
        vc7236NormalizeLocalBusinessDays();
        if (!state.businessDays || !Array.isArray(state.businessDays)) return null;
        const today = vc7236DateFrom(new Date());
        return state.businessDays.find(day => day.date === today && String(day.status || '').toUpperCase() === 'OPEN')
            || state.businessDays.find(day => String(day.status || '').toUpperCase() === 'OPEN')
            || null;
    };
    if (typeof window !== 'undefined') window.getCurrentBusinessDay = getCurrentBusinessDay;

    window.vc7236CleanupBusinessDays = async function() {
        if (!state.businessDays || !Array.isArray(state.businessDays)) state.businessDays = [];
        const groups = new Map();
        state.businessDays.forEach(day => {
            const date = vc7236DateFromBusinessDay(day);
            if (!date) return;
            if (!groups.has(date)) groups.set(date, []);
            groups.get(date).push(day);
        });

        const duplicateDays = [];
        groups.forEach((days, date) => {
            if (days.length <= 1 && days[0] && days[0].id === vc7236CanonicalId(date)) return;
            const canonical = vc7236CanonicalId(date);
            const keep = days.find(d => d.id === canonical) || days.find(d => String(d.status || '').toUpperCase() === 'OPEN') || days[0];
            days.forEach(day => {
                if (!day || day === keep) return;
                duplicateDays.push({ ...day, _canonicalDate: date, _canonicalId: canonical });
            });
            if (keep && keep.id !== canonical) duplicateDays.push({ ...keep, _canonicalDate: date, _canonicalId: canonical, _renamedKeeper: true });
        });

        if (!duplicateDays.length) {
            vc7236NormalizeLocalBusinessDays();
            if (typeof showToast === 'function') showToast('No duplicate business days found', 'success');
            return;
        }

        const ok = confirm('Clean duplicate business days now?\n\nThis will keep one BD-YYYYMMDD per date, move transaction businessDayId values to that day, and delete duplicate businessDays documents from Firestore. Transactions and inventory will NOT be deleted.');
        if (!ok) return;

        let txUpdates = 0;
        let dayDeletes = 0;
        let dayUpdates = 0;
        const duplicateIdToCanonical = new Map();
        duplicateDays.forEach(day => {
            if (day && day.id && day._canonicalId && day.id !== day._canonicalId) duplicateIdToCanonical.set(day.id, day._canonicalId);
        });

        (state.transactions || []).forEach(tx => {
            if (!tx || !tx.id) return;
            const txDate = vc7236DateFromTransaction(tx);
            const canonical = txDate ? vc7236CanonicalId(txDate) : duplicateIdToCanonical.get(tx.businessDayId);
            if (!canonical) return;
            if (duplicateIdToCanonical.has(tx.businessDayId) || tx.businessDayId !== canonical || tx.businessDate !== txDate) {
                tx.businessDayId = canonical;
                if (txDate) tx.businessDate = txDate;
                tx._offline = true;
                txUpdates++;
                if (typeof queueAction === 'function') queueAction('update', 'transactions', tx);
            }
        });

        groups.forEach((days, date) => {
            const canonical = vc7236CanonicalId(date);
            const keep = days.find(d => d.id === canonical) || days.find(d => String(d.status || '').toUpperCase() === 'OPEN') || days[0];
            if (!keep) return;
            const canonicalDoc = { ...keep, id: canonical, businessDayId: canonical, date };
            if (days.some(d => String(d.status || '').toUpperCase() === 'OPEN')) {
                canonicalDoc.status = 'OPEN';
                canonicalDoc.closedAt = null;
            }
            canonicalDoc._offline = true;
            dayUpdates++;
            if (typeof queueAction === 'function') queueAction('update', 'businessDays', canonicalDoc);
            days.forEach(day => {
                if (!day || !day.id || day.id === canonical) return;
                dayDeletes++;
                if (typeof queueAction === 'function') queueAction('delete', 'businessDays', { id: day.id });
            });
        });

        vc7236NormalizeLocalBusinessDays();
        if (typeof sync === 'function') sync();
        if (typeof syncNow === 'function' && navigator.onLine) syncNow();
        if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
        if (typeof renderLedger === 'function') renderLedger();
        if (typeof renderInsights === 'function') renderInsights();
        if (typeof showToast === 'function') showToast('Business days cleaned: ' + dayDeletes + ' duplicate(s), ' + txUpdates + ' transaction link(s)', 'success');
        console.log('Business day cleanup complete', { dayDeletes, dayUpdates, txUpdates });
    };

    setTimeout(vc7236NormalizeLocalBusinessDays, 800);
})();


// v7.2.37: Keep visible Outstanding Credit aligned with open CR tickets only.
(function(){
    if (window.__vc7237OutstandingCreditPolish) return;
    window.__vc7237OutstandingCreditPolish = true;

    function vc7237Peso(value) {
        try {
            if (typeof vc531Peso === 'function') return vc531Peso(value);
        } catch(e) {}
        return '₱' + Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function vc7237RefreshOutstandingCredit() {
        try {
            if (typeof vc531OutstandingCredit !== 'function') return;
            const el = document.getElementById('biz-outstanding-credit');
            if (el) el.innerText = vc7237Peso(vc531OutstandingCredit());
            if (typeof vc526PolishCreditDashboardLabels === 'function') vc526PolishCreditDashboardLabels();
        } catch(e) {
            console.warn('Outstanding credit refresh failed', e);
        }
    }

    const oldRenderInsights = typeof renderInsights === 'function' ? renderInsights : null;
    if (oldRenderInsights && !window.__vc7237RenderInsightsPatch) {
        window.__vc7237RenderInsightsPatch = true;
        renderInsights = function() {
            const result = oldRenderInsights.apply(this, arguments);
            setTimeout(vc7237RefreshOutstandingCredit, 0);
            return result;
        };
    }

    const oldSwitchScreen = typeof switchScreen === 'function' ? switchScreen : null;
    if (oldSwitchScreen && !window.__vc7237SwitchPatch) {
        window.__vc7237SwitchPatch = true;
        switchScreen = function(screen) {
            const result = oldSwitchScreen.apply(this, arguments);
            if (screen === 'insights' || screen === 'business') setTimeout(vc7237RefreshOutstandingCredit, 80);
            return result;
        };
    }

    setTimeout(vc7237RefreshOutstandingCredit, 1000);
})();


// Local-only missed business-day auto-close.
(function(){
    if (window.__vc7240AutoClosePreviousBusinessDays) return;
    window.__vc7240AutoClosePreviousBusinessDays = true;
    let lastRunKey = '';

    function localDateCode(value) {
        try {
            if (typeof vc544DateCode === 'function') return vc544DateCode(value || new Date());
        } catch(e) {}
        const d = value ? new Date(value) : new Date();
        if (isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function dayDate(day) {
        return day && (day.date || (day.openedAt ? localDateCode(day.openedAt) : ''));
    }

    function txDate(tx) {
        return tx && (tx.businessDate || (tx.timestamp ? localDateCode(tx.timestamp) : ''));
    }

    function transactionsForDay(day) {
        const id = day && day.id;
        const date = dayDate(day);
        const all = []
            .concat(Array.isArray(state.transactions) ? state.transactions : [])
            .concat(Array.isArray(state.archiveTransactions) ? state.archiveTransactions : []);
        const seen = new Set();
        return all.filter(tx => {
            if (!tx || !tx.id || seen.has(tx.id)) return false;
            const match = (id && tx.businessDayId === id) || (date && txDate(tx) === date);
            if (match) seen.add(tx.id);
            return match;
        });
    }

    function metricsForDay(day) {
        const tx = transactionsForDay(day);
        if (typeof vc544Metrics === 'function') return vc544Metrics(tx);
        if (typeof v52ComputeMetrics === 'function') return v52ComputeMetrics(tx);
        return { transactionCount: tx.length };
    }

    function refreshBusinessHeaderOnly() {
        try { if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI(); } catch(e) {}
        try { if (typeof v52RefreshBusinessDayUI === 'function') v52RefreshBusinessDayUI(); } catch(e) {}
        try { if (typeof vc543RefreshBusinessDayUI === 'function') vc543RefreshBusinessDayUI(); } catch(e) {}
        try { if (typeof vc551RefreshHeader === 'function') vc551RefreshHeader(); } catch(e) {}
        try { if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar(); } catch(e) {}
    }

    function autoClosePreviousBusinessDays(reason) {
        if (typeof state === 'undefined' || !Array.isArray(state.businessDays)) return 0;
        const today = localDateCode(new Date());
        const runKey = today + ':' + String(reason || 'check');
        if (lastRunKey === runKey) return 0;
        lastRunKey = runKey;

        const now = new Date().toISOString();
        let closed = 0;

        state.businessDays.forEach(day => {
            if (!day || String(day.status || '').toUpperCase() !== 'OPEN') return;
            const date = dayDate(day);
            if (!date || date >= today) return;

            day.status = 'CLOSED';
            day.closedAt = day.closedAt || now;
            day.closedBy = day.closedBy || 'AUTO';
            day.autoClosed = true;
            day.autoClosedAt = now;
            day.summary = day.summary || metricsForDay(day);
            day._offline = true;
            closed += 1;

            if (typeof queueAction === 'function') queueAction('update', 'businessDays', day);
        });

        if (closed > 0) {
            const current = state.businessDays
                .filter(day => day && String(day.status || '').toUpperCase() === 'OPEN' && dayDate(day) === today)
                .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))[0] || null;
            state.currentBusinessDayId = current ? current.id : null;
            if (typeof sync === 'function') sync();
            refreshBusinessHeaderOnly();
            console.info('Auto-closed previous business day(s):', closed);
        }
        return closed;
    }

    window.vc7240AutoClosePreviousBusinessDays = autoClosePreviousBusinessDays;

    setTimeout(() => autoClosePreviousBusinessDays('startup'), 900);
    window.addEventListener('focus', () => setTimeout(() => autoClosePreviousBusinessDays('focus'), 250));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            setTimeout(() => autoClosePreviousBusinessDays('visible'), 250);
        }
    });
})();

