// Calendar-month backup/archive actions extracted from app.js in v8.2.9.
// Inventory is never archived/deleted; loaded backups stay local archive-only.
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


    // v8.2.9: Archive safety UI moved to business-ui.js. Backup/load actions live here.
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
            const [transactionsRaw, businessDaysRaw, gcashRaw] = await Promise.all([
                queryOld('transactions', 'businessDate', cutoff, 5000),
                queryOld('businessDays', 'date', cutoff, 1000),
                queryOld('gcashRecords', 'businessDate', cutoff, 5000)
            ]);
            const transactions = (transactionsRaw || []).filter(t => txDate(t) && txDate(t) < cutoff);
            const businessDays = (businessDaysRaw || []).filter(d => String(d.date || '').slice(0, 10) < cutoff);
            const gcashRecords = (gcashRaw || []).filter(r => String(r.businessDate || '').slice(0, 10) < cutoff);
            if (!transactions.length && !businessDays.length && !gcashRecords.length) {
                if (typeof showToast === 'function') showToast('No old records before this month', 'info');
                return;
            }
            const payload = {
                app: 'Villacart POS',
                backupVersion: 'v8.2.9',
                environment: window.VILLACART_ENV || 'live',
                firebaseProjectId: window.VILLACART_FIREBASE_PROJECT || null,
                archiveBefore: cutoff,
                createdAt: new Date().toISOString(),
                note: 'Inventory is intentionally not included. Loaded backups are local archive-only and must not sync to Firestore.',
                transactions,
                businessDays,
                gcashRecords
            };
            const fileMonth = cutoff.slice(0, 7);
            downloadJson('Villacart_Archive_before_' + fileMonth + '.json', payload);
            updateArchiveMeta({
                lastExportAt: payload.createdAt,
                lastArchiveBefore: cutoff,
                lastExportFile: 'Villacart_Archive_before_' + fileMonth + '.json',
                lastExportTransactions: transactions.length,
                lastExportBusinessDays: businessDays.length,
                lastExportGcashRecords: gcashRecords.length
            });
            const ok = confirm('Backup file downloaded for records before ' + cutoff + '.\n\nDelete these old transactions/business days from Firestore now?\n\nChoose Cancel if you want to verify the file first.');
            if (!ok) {
                if (typeof showToast === 'function') showToast('Backup downloaded; cloud delete skipped', 'info');
                return;
            }
            await deleteCloudDocs('transactions', transactions);
            await deleteCloudDocs('businessDays', businessDays);
            await deleteCloudDocs('gcashRecords', gcashRecords);
            state.transactions = (state.transactions || []).filter(t => !(txDate(t) && txDate(t) < cutoff));
            state.businessDays = (state.businessDays || []).filter(d => !(String(d.date || '').slice(0, 10) < cutoff));
            state.gcashRecords = (state.gcashRecords || []).filter(r => !(String(r.businessDate || '').slice(0, 10) < cutoff));
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
                const gr = Array.isArray(data.gcashRecords) ? data.gcashRecords : [];
                if (!tx.length && !bd.length && !gr.length) throw new Error('No transactions/businessDays/gcashRecords found in backup.');
                state.archiveTransactions = vc710MergeArchiveById(state.archiveTransactions || [], tx);
                state.archiveBusinessDays = vc710MergeArchiveById(state.archiveBusinessDays || [], bd);
                state.archiveGcashRecords = vc710MergeArchiveById(state.archiveGcashRecords || [], gr);
                updateArchiveMeta({
                    lastLoadAt: new Date().toISOString(),
                    lastLoadFile: file.name || 'archive.json',
                    lastLoadTransactions: tx.length,
                    lastLoadBusinessDays: bd.length,
                    lastLoadGcashRecords: gr.length
                });
                if (typeof sync === 'function') sync();
                if (typeof renderLedger === 'function') renderLedger();
                if (typeof renderInsights === 'function') renderInsights();
                if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
                if (typeof renderGcashScreen === 'function') renderGcashScreen();
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
        const gcashCount = Array.isArray(state.archiveGcashRecords) ? state.archiveGcashRecords.length : 0;
        if (!txCount && !dayCount && !gcashCount) {
            if (typeof showToast === 'function') showToast('No loaded backup data to delete', 'info');
            return;
        }
        const ok = confirm('Delete loaded backup/archive data from this device only?\n\nThis will NOT delete Firestore data and will NOT delete your original JSON backup files.');
        if (!ok) return;
        state.archiveTransactions = [];
        state.archiveBusinessDays = [];
        state.archiveGcashRecords = [];
        state.archiveMeta = {
            ...(state.archiveMeta || {}),
            lastClearedAt: new Date().toISOString(),
            lastLoadAt: null,
            lastLoadFile: null,
            lastLoadTransactions: 0,
            lastLoadBusinessDays: 0,
            lastLoadGcashRecords: 0
        };
        if (typeof saveLocalArchive === 'function') saveLocalArchive();
        renderArchiveSafety();
        if (typeof renderLedger === 'function') renderLedger();
        if (typeof renderInsights === 'function') renderInsights();
        if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
        if (typeof renderGcashScreen === 'function') renderGcashScreen();
        if (typeof showToast === 'function') showToast('Loaded backup data deleted locally', 'success');
    }

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
