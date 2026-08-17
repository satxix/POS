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

    // v8.2.11: The delete loop previously had no timeout and no progress
    // feedback, and ran one document at a time. A single stalled fetch()
    // (flaky WiFi, etc.) could leave the whole backup stuck on "Preparing"
    // forever with no error and no way to tell it apart from just being slow.
    // Fix: wrap every delete in a hard timeout, run several in parallel, and
    // report progress back to the caller so the button can show real status.
    function withDeleteTimeout(write, timeoutMs) {
        const helper = (window.VillacartUtils && window.VillacartUtils.firestoreWriteWithTimeout);
        if (typeof helper === 'function') return helper(write, timeoutMs);
        let timeoutId;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Firestore delete timed out; check your connection and try again.')), timeoutMs || 15000);
        });
        return Promise.race([write, timeout]).finally(() => clearTimeout(timeoutId));
    }

    async function deleteManyCloudDocs(items, onProgress) {
        // items: [{ table, doc }]
        if (typeof syncTaskWithFirestoreRest !== 'function') throw new Error('Delete helper unavailable.');
        const list = (items || []).filter(it => it && it.doc && it.doc.id);
        const total = list.length;
        if (!total) return;
        const CONCURRENCY = 6;
        let nextIndex = 0;
        let completed = 0;
        let firstError = null;

        async function worker() {
            while (nextIndex < list.length) {
                if (firstError) return;
                const item = list[nextIndex++];
                try {
                    await withDeleteTimeout(
                        syncTaskWithFirestoreRest({ type: 'delete', table: item.table, data: { id: item.doc.id } }),
                        15000
                    );
                } catch (error) {
                    if (!firstError) firstError = error;
                    return;
                }
                completed++;
                if (typeof onProgress === 'function') onProgress(completed, total);
            }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
        if (firstError) {
            firstError.message = (firstError.message || 'Delete failed') + ` (${completed}/${total} deleted before this error; safe to re-run backup to finish the rest)`;
            throw firstError;
        }
    }

    // v8.2.10: Never delete unpaid/open credit transactions from Firestore during
    // archive, even if their businessDate is before the cutoff. A credit sold last
    // month but not yet paid must stay live so it keeps showing in the Ledger's
    // Credit tab. Uses the same settlement logic the Ledger uses (VillacartCreditUtils)
    // so "paid" is determined consistently across the app.
    function splitDeletableTransactions(oldTransactions) {
        const utils = window.VillacartCreditUtils;
        if (!utils || typeof utils.creditStateIndex !== 'function') {
            // Utils unavailable: fail safe by keeping ALL credit transactions in the
            // cloud rather than risk deleting an unpaid one.
            const deletable = (oldTransactions || []).filter(t => String(t && t.type || '').toUpperCase() !== 'CR');
            const keep = (oldTransactions || []).filter(t => String(t && t.type || '').toUpperCase() === 'CR');
            return { deletable, keep };
        }
        // Combine with current live transactions so settlements made THIS month
        // (which won't appear in the "old" query results) are still visible when
        // checking whether an old credit has since been paid.
        const liveTx = Array.isArray(state.transactions) ? state.transactions : [];
        const combined = (oldTransactions || []).concat(liveTx);
        const index = utils.creditStateIndex(combined);
        const deletable = [];
        const keep = [];
        (oldTransactions || []).forEach(tx => {
            const isCredit = utils.norm(tx && tx.type) === 'CR' && !utils.isCreditSettlement(tx);
            if (isCredit && !index.isCreditSettled(tx)) {
                keep.push(tx);
            } else {
                deletable.push(tx);
            }
        });
        return { deletable, keep };
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
            const { deletable: deletableTransactions, keep: openCreditTransactions } = splitDeletableTransactions(transactions);
            const payload = {
                app: 'Villacart POS',
                backupVersion: 'v8.2.11',
                environment: window.VILLACART_ENV || 'live',
                firebaseProjectId: window.VILLACART_FIREBASE_PROJECT || null,
                archiveBefore: cutoff,
                createdAt: new Date().toISOString(),
                note: 'Inventory is intentionally not included. Loaded backups are local archive-only and must not sync to Firestore. Unpaid/open credit transactions are included here for reference but are kept live in Firestore, not deleted.',
                transactions: transactions.map(t => (
                    openCreditTransactions.includes(t) ? { ...t, _openCreditKeptInCloud: true } : t
                )),
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
                lastExportGcashRecords: gcashRecords.length,
                lastExportOpenCreditsKept: openCreditTransactions.length
            });
            if (!deletableTransactions.length && !businessDays.length && !gcashRecords.length) {
                if (typeof showToast === 'function') {
                    showToast('Backup downloaded. All ' + openCreditTransactions.length + ' old record(s) are unpaid credits, so nothing was deleted from Firestore.', 'info');
                }
                return;
            }
            const creditNote = openCreditTransactions.length
                ? ('\n\n' + openCreditTransactions.length + ' unpaid credit transaction(s) will be KEPT in Firestore (not deleted) so they stay collectible in the Ledger.')
                : '';
            const confirmFn = typeof vcConfirm === 'function' ? vcConfirm : (msg) => Promise.resolve(confirm(msg));
            const ok = await confirmFn('Backup file downloaded for records before ' + cutoff + '.\n\nDelete these old transactions/business days from Firestore now?' + creditNote + '\n\nChoose Cancel if you want to verify the file first.', 'Delete Old Records?');
            if (!ok) {
                if (typeof showToast === 'function') showToast('Backup downloaded; cloud delete skipped', 'info');
                return;
            }
            if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Deleting 0/' + (deletableTransactions.length + businessDays.length + gcashRecords.length);
            const deleteItems = [
                ...deletableTransactions.map(doc => ({ table: 'transactions', doc })),
                ...businessDays.map(doc => ({ table: 'businessDays', doc })),
                ...gcashRecords.map(doc => ({ table: 'gcashRecords', doc }))
            ];
            await deleteManyCloudDocs(deleteItems, (done, total) => {
                if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Deleting ' + done + '/' + total;
            });
            const deletableIds = new Set(deletableTransactions.map(t => t.id));
            state.transactions = (state.transactions || []).filter(t => !deletableIds.has(t.id));
            state.businessDays = (state.businessDays || []).filter(d => !(String(d.date || '').slice(0, 10) < cutoff));
            state.gcashRecords = (state.gcashRecords || []).filter(r => !(String(r.businessDate || '').slice(0, 10) < cutoff));
            if (typeof sync === 'function') sync();
            if (typeof renderLedger === 'function') renderLedger();
            if (typeof renderInsights === 'function') renderInsights();
            if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
            const successMsg = openCreditTransactions.length
                ? ('Old cloud records deleted. ' + openCreditTransactions.length + ' unpaid credit(s) kept in Firestore.')
                : 'Old cloud records archived/deleted';
            if (typeof showToast === 'function') showToast(successMsg, 'success');
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


    async function clearLoadedArchiveData() {
        const txCount = Array.isArray(state.archiveTransactions) ? state.archiveTransactions.length : 0;
        const dayCount = Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays.length : 0;
        const gcashCount = Array.isArray(state.archiveGcashRecords) ? state.archiveGcashRecords.length : 0;
        if (!txCount && !dayCount && !gcashCount) {
            if (typeof showToast === 'function') showToast('No loaded backup data to delete', 'info');
            return;
        }
        const confirmFn = typeof vcConfirm === 'function' ? vcConfirm : (msg) => Promise.resolve(confirm(msg));
        const ok = await confirmFn('Delete loaded backup/archive data from this device only?\n\nThis will NOT delete Firestore data and will NOT delete your original JSON backup files.', 'Clear Loaded Backup?');
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
