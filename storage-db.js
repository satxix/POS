// Villacart durable local storage (v8.6.0)
// Keeps large operational and archive snapshots in IndexedDB. localStorage is
// reserved for small UI preferences and is used only as a compatibility
// fallback when IndexedDB is unavailable.
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const environment = params.get('env') === 'test' ? 'test' : 'live';
    const databaseName = `villacart-pos-local-${environment}`;
    const storeName = 'snapshots';
    const schemaVersion = 1;
    const status = {
        environment,
        databaseName,
        ready: false,
        available: 'indexedDB' in window,
        migrated: false,
        migrationAt: null,
        lastSavedAt: null,
        lastError: null,
        pendingWrites: 0
    };
    let legacyKeys = null;

    function errorText(error) {
        return error && error.message ? error.message : String(error || 'Unknown storage error');
    }

    function publishError(error, operation) {
        status.lastError = `${operation}: ${errorText(error)}`;
        console.error('Villacart durable storage error:', operation, error);
        try {
            window.dispatchEvent(new CustomEvent('villacart-storage-error', {
                detail: { operation, message: status.lastError }
            }));
        } catch (eventError) {}
    }

    function cloneValue(value) {
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (error) {}
        }
        return JSON.parse(JSON.stringify(value));
    }

    const openPromise = new Promise((resolve, reject) => {
        if (!status.available) {
            reject(new Error('IndexedDB is not supported by this browser.'));
            return;
        }
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return false;
            settled = true;
            clearTimeout(openTimer);
            callback(value);
            return true;
        };
        const openTimer = setTimeout(() => {
            finish(reject, new Error('IndexedDB did not open within 4 seconds.'));
        }, 4000);
        const request = indexedDB.open(databaseName, schemaVersion);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => {
            if (settled) {
                try { request.result.close(); } catch (error) {}
                return;
            }
            status.ready = true;
            finish(resolve, request.result);
        };
        request.onerror = () => finish(reject, request.error || new Error('Unable to open IndexedDB.'));
        request.onblocked = () => console.warn('Villacart IndexedDB upgrade is blocked by another open app window.');
    }).catch(error => {
        status.available = false;
        publishError(error, 'open');
        return null;
    });

    async function readRecord(key) {
        const db = await openPromise;
        if (!db) return null;
        return new Promise((resolve, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error(`Unable to read ${key}.`));
        });
    }

    const pendingValues = new Map();
    let pendingWaiters = [];
    let flushTimer = null;
    let flushRunning = false;

    function scheduleFlush() {
        if (flushTimer || flushRunning) return;
        flushTimer = setTimeout(flushWrites, 0);
    }

    async function flushWrites() {
        flushTimer = null;
        if (flushRunning || !pendingValues.size) return;
        flushRunning = true;
        const batch = Array.from(pendingValues.entries());
        pendingValues.clear();
        const waiters = pendingWaiters;
        pendingWaiters = [];
        status.pendingWrites = pendingValues.size + batch.length;
        try {
            const db = await openPromise;
            if (!db) throw new Error('IndexedDB is unavailable.');
            await new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                const savedAt = new Date().toISOString();
                batch.forEach(([key, value]) => store.put({ key, value, savedAt, schemaVersion }));
                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
                transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
            });
            status.lastSavedAt = new Date().toISOString();
            status.lastError = null;
            waiters.forEach(waiter => waiter.resolve());
        } catch (error) {
            publishError(error, 'save');
            waiters.forEach(waiter => waiter.reject(error));
        } finally {
            flushRunning = false;
            status.pendingWrites = pendingValues.size;
            if (pendingValues.size) scheduleFlush();
        }
    }

    function queueWrite(key, value) {
        let snapshot;
        try {
            snapshot = cloneValue(value);
        } catch (error) {
            publishError(error, `clone-${key}`);
            return Promise.reject(error);
        }
        pendingValues.set(key, snapshot);
        status.pendingWrites = pendingValues.size;
        const promise = new Promise((resolve, reject) => pendingWaiters.push({ resolve, reject }));
        scheduleFlush();
        return promise;
    }

    function mergeById(first, second) {
        const merged = new Map();
        (Array.isArray(first) ? first : []).forEach(item => {
            if (item && item.id !== undefined && item.id !== null) merged.set(String(item.id), item);
        });
        (Array.isArray(second) ? second : []).forEach(item => {
            if (item && item.id !== undefined && item.id !== null) merged.set(String(item.id), item);
        });
        return Array.from(merged.values());
    }

    function mergeQueue(first, second) {
        const merged = new Map();
        [...(Array.isArray(first) ? first : []), ...(Array.isArray(second) ? second : [])]
            .filter(task => task && task.table && task.data && task.data.id)
            .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
            .forEach(task => merged.set(`${task.table}:${task.data.id}`, task));
        return Array.from(merged.values());
    }

    function normalizeMain(value, fallback) {
        const source = value && typeof value === 'object' ? value : (fallback || {});
        return {
            ...source,
            inventory: Array.isArray(source.inventory) ? source.inventory : [],
            transactions: Array.isArray(source.transactions) ? source.transactions : [],
            businessDays: Array.isArray(source.businessDays) ? source.businessDays : [],
            gcashRecords: Array.isArray(source.gcashRecords) ? source.gcashRecords : [],
            cart: Array.isArray(source.cart) ? source.cart : [],
            favorites: Array.isArray(source.favorites) ? source.favorites : new Array(8).fill(null)
        };
    }

    function normalizeArchive(value) {
        const source = value && typeof value === 'object' ? value : {};
        return {
            transactions: Array.isArray(source.transactions) ? source.transactions : [],
            businessDays: Array.isArray(source.businessDays) ? source.businessDays : [],
            gcashRecords: Array.isArray(source.gcashRecords) ? source.gcashRecords : [],
            meta: source.meta && typeof source.meta === 'object' ? source.meta : {},
            savedAt: source.savedAt || null
        };
    }

    async function hydrate(options) {
        const supplied = options || {};
        legacyKeys = supplied.keys || legacyKeys;
        const fallbackMain = normalizeMain(supplied.main, {});
        const fallbackArchive = normalizeArchive(supplied.archive);
        const fallbackQueue = Array.isArray(supplied.queue) ? supplied.queue : [];
        const db = await openPromise;
        if (!db) {
            return { main: fallbackMain, archive: fallbackArchive, queue: fallbackQueue, source: 'localStorage-fallback' };
        }

        try {
            const [mainRecord, archiveRecord, queueRecord] = await Promise.all([
                readRecord('main'), readRecord('archive'), readRecord('queue')
            ]);
            let main = normalizeMain(mainRecord && mainRecord.value, fallbackMain);
            let archive = normalizeArchive(archiveRecord && archiveRecord.value);
            let queue = Array.isArray(queueRecord && queueRecord.value) ? queueRecord.value : [];

            // A real legacy key means an older build wrote usable data after the
            // last IndexedDB snapshot. Prefer that complete operational snapshot
            // during migration; archive/queue records are safely merged by id.
            if (supplied.hasLegacyMain) main = fallbackMain;
            if (supplied.hasLegacyArchive) {
                archive = {
                    ...archive,
                    ...fallbackArchive,
                    transactions: mergeById(archive.transactions, fallbackArchive.transactions),
                    businessDays: mergeById(archive.businessDays, fallbackArchive.businessDays),
                    gcashRecords: mergeById(archive.gcashRecords, fallbackArchive.gcashRecords),
                    meta: { ...(archive.meta || {}), ...(fallbackArchive.meta || {}) }
                };
            }
            if (supplied.hasLegacyQueue) queue = mergeQueue(queue, fallbackQueue);

            await Promise.all([queueWrite('main', main), queueWrite('archive', archive), queueWrite('queue', queue)]);
            if (legacyKeys) {
                [legacyKeys.main, legacyKeys.archive, legacyKeys.queue].forEach(key => {
                    if (!key) return;
                    try { localStorage.removeItem(key); } catch (error) {}
                });
            }
            status.migrated = !!(supplied.hasLegacyMain || supplied.hasLegacyArchive || supplied.hasLegacyQueue);
            if (status.migrated) status.migrationAt = new Date().toISOString();
            return { main, archive, queue, source: mainRecord ? 'indexedDB' : 'migrated' };
        } catch (error) {
            publishError(error, 'hydrate');
            return { main: fallbackMain, archive: fallbackArchive, queue: fallbackQueue, source: 'localStorage-recovery' };
        }
    }

    async function storageEstimate() {
        if (!navigator.storage || typeof navigator.storage.estimate !== 'function') return null;
        try {
            const estimate = await navigator.storage.estimate();
            return {
                usage: Number(estimate.usage) || 0,
                quota: Number(estimate.quota) || 0,
                percent: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 1000) / 10 : null
            };
        } catch (error) {
            return null;
        }
    }

    async function getStatus() {
        return { ...status, estimate: await storageEstimate() };
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && pendingValues.size) flushWrites();
    });
    window.addEventListener('pagehide', () => {
        if (pendingValues.size) flushWrites();
    });

    window.VillacartStorage = {
        ready: openPromise,
        hydrate,
        saveMain: value => queueWrite('main', value),
        saveArchive: value => queueWrite('archive', value),
        saveQueue: value => queueWrite('queue', value),
        flush: flushWrites,
        getStatus
    };
})();
