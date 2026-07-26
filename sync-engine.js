// --- Villacart Firestore / offline sync engine ---
// v8.3.12: Behavior-preserving extraction from app.js. Loaded before app.js; functions run only after app state is ready.

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
            const preserveLocalTransactions = !navigator.onLine || !!(snapshot.metadata && snapshot.metadata.fromCache);
            const localTransactionsInRange = (state.transactions || []).filter(t => {
                if (!t || !t.id || pendingDeleteIds.has(t.id)) return false;
                if (!vc5632lBounds || typeof vc5632mInDateRange !== 'function') return true;
                return vc5632mInDateRange(t, vc5632lBounds);
            });
            
            const mergedMap = new Map();
            filteredCloudTrans.forEach(t => mergedMap.set(t.id, t));
            activeOfflineTrans.forEach(t => mergedMap.set(t.id, t));
            // An empty/partial cache snapshot is not proof that locally saved
            // transactions were deleted. Preserve them until a server-backed
            // snapshot can authoritatively reconcile the current date range.
            if (preserveLocalTransactions) {
                localTransactionsInRange.forEach(t => {
                    if (!mergedMap.has(t.id)) mergedMap.set(t.id, t);
                });
            }
            
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
