// Calendar-month backup/archive actions, hardened in v8.7.0.
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

    function archiveRecordStateRank(item) {
        if (!item || typeof item !== 'object') return 0;
        const status = String(item.status || '').trim().toUpperCase();
        if (item.paid === true || item.settled === true || status === 'PAID' || status === 'SETTLED') return 3;
        if (String(item.type || '').trim().toUpperCase() === 'CR') {
            const hasZeroBalance = ['balance', 'balanceDue', 'remaining', 'amountDue'].some(key => {
                if (item[key] === undefined || item[key] === null || item[key] === '') return false;
                const value = Number(item[key]);
                return Number.isFinite(value) && value === 0;
            });
            if (hasZeroBalance) return 3;
            if (item.paid === false || item.settled === false || status === 'OPEN' || status === 'UNPAID') return 1;
        }
        return 2;
    }

    function archiveRecordMoment(item) {
        if (!item || typeof item !== 'object') return 0;
        const fields = ['updatedAt', 'modifiedAt', 'settledAt', 'paidAt', 'closedAt', 'timestamp', 'date', 'businessDate'];
        for (const field of fields) {
            const raw = item[field];
            if (raw === undefined || raw === null || raw === '') continue;
            const value = raw && typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
            const time = value instanceof Date ? value.getTime() : NaN;
            if (Number.isFinite(time)) return time;
        }
        return 0;
    }

    function archiveSnapshotMoment(item) {
        const value = new Date(item && item._archiveSnapshotAt || 0).getTime();
        return Number.isFinite(value) ? value : 0;
    }

    function preferredArchiveRecord(current, candidate) {
        const currentRank = archiveRecordStateRank(current);
        const candidateRank = archiveRecordStateRank(candidate);
        if (currentRank !== candidateRank) return candidateRank > currentRank ? candidate : current;
        const currentMoment = archiveRecordMoment(current);
        const candidateMoment = archiveRecordMoment(candidate);
        if (currentMoment !== candidateMoment) return candidateMoment > currentMoment ? candidate : current;
        const currentSnapshot = archiveSnapshotMoment(current);
        const candidateSnapshot = archiveSnapshotMoment(candidate);
        if (currentSnapshot !== candidateSnapshot) return candidateSnapshot > currentSnapshot ? candidate : current;
        return current;
    }

    function vc710MergeArchiveById(existing, incoming, snapshotAt) {
        const map = new Map();
        (Array.isArray(existing) ? existing : []).forEach(item => {
            if (item && item.id) map.set(String(item.id), { ...item, _archiveOnly: true });
        });
        (Array.isArray(incoming) ? incoming : []).forEach(item => {
            if (!item || !item.id) return;
            const id = String(item.id);
            const candidate = { ...item, _archiveOnly: true, _archiveSnapshotAt: snapshotAt || item._archiveSnapshotAt || null };
            const current = map.get(id);
            if (!current) {
                map.set(id, candidate);
                return;
            }
            const winner = preferredArchiveRecord(current, candidate);
            const other = winner === current ? candidate : current;
            map.set(id, { ...other, ...winner, _archiveOnly: true });
        });
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

    const DELETE_BATCH_SIZE = 100;
    const DELETE_MAX_ATTEMPTS = 3;
    const DELETE_TIMEOUT_MS = 30000;

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function setBackupButtonStatus(button, text, icon = 'refresh', spinning = false) {
        if (!button) return;
        button.innerHTML = `<span class="material-symbols-outlined text-[18px]${spinning ? ' animate-spin' : ''}">${icon}</span> ${text}`;
        button.setAttribute('aria-label', text);
    }

    function creditProtectionPlan(allTransactions, cutoff) {
        const transactions = Array.isArray(allTransactions) ? allTransactions.filter(tx => tx && tx.id) : [];
        const creditUtils = window.VillacartCreditUtils || {};
        const normalize = value => String(value == null ? '' : value).trim().toUpperCase();
        const isSettlement = typeof creditUtils.isCreditSettlement === 'function'
            ? tx => creditUtils.isCreditSettlement(tx)
            : tx => !!(tx && (tx.settlementFor || tx.creditRef || tx.relatedCreditId || normalize(tx.notes).includes('PAYMENT') || normalize(tx.notes).includes('SETTLEMENT')));
        const settlementIds = tx => {
            if (typeof creditUtils.settlementCreditIds === 'function') {
                return Array.from(creditUtils.settlementCreditIds(tx) || []).map(normalize).filter(Boolean);
            }
            const ids = new Set();
            ['settlementFor', 'creditRef', 'relatedCreditId'].forEach(key => {
                if (tx && tx[key]) ids.add(normalize(tx[key]));
            });
            const matches = normalize(tx && tx.notes).match(/CR-[A-Z0-9-]+/g) || [];
            matches.forEach(id => ids.add(id));
            return Array.from(ids);
        };
        const credits = transactions.filter(tx => normalize(tx.type) === 'CR' && !isSettlement(tx));
        const creditById = new Map(credits.map(tx => [normalize(tx.id), tx]));
        const linkedRowsByCredit = new Map();
        const settlementRows = [];
        transactions.forEach(tx => {
            if (!isSettlement(tx)) return;
            const refs = settlementIds(tx);
            if (!refs.length) return;
            settlementRows.push({ tx, refs });
            refs.forEach(id => {
                if (!linkedRowsByCredit.has(id)) linkedRowsByCredit.set(id, []);
                linkedRowsByCredit.get(id).push(tx);
            });
        });
        const creditIndex = typeof creditUtils.creditStateIndex === 'function'
            ? creditUtils.creditStateIndex(transactions)
            : null;
        const intrinsicallySettled = credit => {
            if (!credit) return false;
            if (credit.paid === true || credit.settled === true) return true;
            const status = normalize(credit.status);
            if (status === 'PAID' || status === 'SETTLED') return true;
            return ['balance', 'balanceDue', 'remaining', 'amountDue'].some(key => {
                if (credit[key] === undefined || credit[key] === null || credit[key] === '') return false;
                const value = Number(credit[key]);
                return Number.isFinite(value) && value === 0;
            });
        };
        const isSettled = credit => creditIndex && typeof creditIndex.isCreditSettled === 'function'
            ? creditIndex.isCreditSettled(credit)
            : intrinsicallySettled(credit);
        const protectedCreditIds = new Set();

        creditById.forEach((credit, id) => {
            const groupRows = [credit, ...(linkedRowsByCredit.get(id) || [])];
            const groupTouchesCurrentMonth = groupRows.some(tx => {
                const date = txDate(tx);
                return date && date >= cutoff;
            });
            if (!isSettled(credit) || groupTouchesCurrentMonth) protectedCreditIds.add(id);
        });

        // If one payment references multiple credits, protect the entire linked
        // group whenever any member is open/recent. This prevents orphaned
        // settlement records and incorrect remaining balances.
        let changed = true;
        while (changed) {
            changed = false;
            settlementRows.forEach(({ refs }) => {
                if (!refs.some(id => protectedCreditIds.has(id))) return;
                refs.forEach(id => {
                    if (creditById.has(id) && !protectedCreditIds.has(id)) {
                        protectedCreditIds.add(id);
                        changed = true;
                    }
                });
            });
        }

        const protectedTransactionIds = new Set();
        protectedCreditIds.forEach(id => {
            const credit = creditById.get(id);
            if (credit && credit.id) protectedTransactionIds.add(String(credit.id));
            (linkedRowsByCredit.get(id) || []).forEach(tx => {
                if (tx && tx.id) protectedTransactionIds.add(String(tx.id));
            });
        });
        return { protectedCreditIds, protectedTransactionIds };
    }

    async function readArchiveCollections() {
        if (typeof readCollectionWithFirestoreRest !== 'function') throw new Error('Cloud read helper unavailable.');
        const [transactions, businessDays, gcashRecords] = await Promise.all([
            readCollectionWithFirestoreRest('transactions'),
            readCollectionWithFirestoreRest('businessDays'),
            readCollectionWithFirestoreRest('gcashRecords')
        ]);
        return { transactions, businessDays, gcashRecords };
    }

    async function deleteBatchRequest(table, docs) {
        if (typeof db === 'undefined' || !db || typeof db.batch !== 'function') {
            throw new Error('Authenticated Firestore batch helper unavailable.');
        }
        const batch = db.batch();
        (docs || []).forEach(doc => {
            const id = String(doc && doc.id || '');
            if (!id || id.includes('/')) throw new Error(`Invalid ${table} document ID.`);
            batch.delete(db.collection(table).doc(id));
        });
        if (!(docs || []).length) return;
        let timer = null;
        try {
            await Promise.race([
                batch.commit(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Firestore delete batch timed out.')), DELETE_TIMEOUT_MS);
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function deleteCloudDocs(table, docs, onProgress) {
        const rows = (Array.isArray(docs) ? docs : []).filter(doc => doc && doc.id);
        let completed = 0;
        for (let offset = 0; offset < rows.length; offset += DELETE_BATCH_SIZE) {
            const chunk = rows.slice(offset, offset + DELETE_BATCH_SIZE);
            let lastError = null;
            for (let attempt = 1; attempt <= DELETE_MAX_ATTEMPTS; attempt++) {
                try {
                    await deleteBatchRequest(table, chunk);
                    lastError = null;
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt < DELETE_MAX_ATTEMPTS) {
                        if (typeof onProgress === 'function') onProgress({ table, completed, retry: attempt, error });
                        await wait(750 * attempt);
                    }
                }
            }
            if (lastError) throw lastError;
            completed += chunk.length;
            if (typeof onProgress === 'function') onProgress({ table, completed, added: chunk.length });
        }
        return completed;
    }

    async function verifyDeletedTargets(targets) {
        const cloud = await readArchiveCollections();
        const remaining = [];
        ['transactions', 'businessDays', 'gcashRecords'].forEach(table => {
            const intended = new Set((targets[table] || []).map(doc => String(doc.id)));
            (cloud[table] || []).forEach(doc => {
                if (doc && intended.has(String(doc.id))) remaining.push({ table, id: doc.id });
            });
        });
        return remaining;
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
        const oldAriaLabel = btn ? btn.getAttribute('aria-label') : null;
        let backupDownloaded = false;
        let deletionStarted = false;
        let deletionCompleted = 0;
        let deletionTotal = 0;
        let deletionTable = null;
        try {
            const pendingCount = typeof offlineQueue !== 'undefined' && Array.isArray(offlineQueue) ? offlineQueue.length : 0;
            if (pendingCount > 0) {
                if (typeof showToast === 'function') showToast(`Sync ${pendingCount} pending item(s) before archiving`, 'error');
                return;
            }
            if (btn) {
                btn.disabled = true;
                btn.classList.add('opacity-60');
                setBackupButtonStatus(btn, 'Reading cloud…', 'refresh', true);
            }
            const cloud = await readArchiveCollections();
            const transactionsRaw = cloud.transactions || [];
            const businessDaysRaw = cloud.businessDays || [];
            const gcashRaw = cloud.gcashRecords || [];
            const transactions = (transactionsRaw || []).filter(t => txDate(t) && txDate(t) < cutoff);
            const businessDays = (businessDaysRaw || []).filter(d => String(d.date || '').slice(0, 10) < cutoff);
            const gcashRecords = (gcashRaw || []).filter(r => String(r.businessDate || '').slice(0, 10) < cutoff);
            if (!transactions.length && !businessDays.length && !gcashRecords.length) {
                if (typeof showToast === 'function') showToast('No old records before this month', 'info');
                return;
            }
            const payload = {
                app: 'Villacart POS',
                backupVersion: 'v8.7.0',
                environment: window.VILLACART_ENV || 'live',
                firebaseProjectId: window.VILLACART_FIREBASE_PROJECT || null,
                archiveBefore: cutoff,
                createdAt: new Date().toISOString(),
                note: 'Inventory is intentionally not included. Loaded backups are local archive-only. Open credits and their linked payment records are included in this backup but protected from cloud deletion.',
                transactions,
                businessDays,
                gcashRecords
            };
            const protection = creditProtectionPlan(transactionsRaw, cutoff);
            const transactionsToDelete = transactions.filter(tx => !protection.protectedTransactionIds.has(String(tx.id)));
            const protectedOldTransactions = transactions.filter(tx => protection.protectedTransactionIds.has(String(tx.id)));
            const targets = { transactions: transactionsToDelete, businessDays, gcashRecords };
            deletionTotal = transactionsToDelete.length + businessDays.length + gcashRecords.length;
            payload.cloudDeletionPlan = {
                eligibleRecords: deletionTotal,
                protectedCreditTransactions: protectedOldTransactions.length,
                protectedOpenOrRecentCreditGroups: protection.protectedCreditIds.size
            };
            const fileMonth = cutoff.slice(0, 7);
            setBackupButtonStatus(btn, 'Saving backup…', 'download', false);
            downloadJson('Villacart_Archive_before_' + fileMonth + '.json', payload);
            backupDownloaded = true;
            updateArchiveMeta({
                lastExportAt: payload.createdAt,
                lastArchiveBefore: cutoff,
                lastExportFile: 'Villacart_Archive_before_' + fileMonth + '.json',
                lastExportTransactions: transactions.length,
                lastExportBusinessDays: businessDays.length,
                lastExportGcashRecords: gcashRecords.length
            });
            const ok = confirm(
                'Backup file downloaded for records before ' + cutoff + '.\n\n' +
                'Eligible for cloud deletion: ' + deletionTotal + ' record(s)\n' +
                'Protected credit-related records: ' + protectedOldTransactions.length + '\n\n' +
                'Delete the eligible records from Firestore now? Keep the app open until verification finishes.\n\n' +
                'Choose Cancel if you want to verify the backup file first.'
            );
            if (!ok) {
                if (typeof showToast === 'function') showToast('Backup downloaded; cloud delete skipped', 'info');
                return;
            }
            if (!deletionTotal) {
                if (typeof showToast === 'function') showToast('Backup saved; all old records are protected or already archived', 'success');
                return;
            }
            deletionStarted = true;
            const progress = info => {
                if (info && info.added) deletionCompleted += info.added;
                const retryText = info && info.retry ? ` · retry ${info.retry}` : '';
                setBackupButtonStatus(btn, `Deleting ${deletionCompleted}/${deletionTotal}${retryText}`, 'delete_sweep', false);
            };
            deletionTable = 'transactions';
            await deleteCloudDocs('transactions', transactionsToDelete, progress);
            deletionTable = 'businessDays';
            await deleteCloudDocs('businessDays', businessDays, progress);
            deletionTable = 'gcashRecords';
            await deleteCloudDocs('gcashRecords', gcashRecords, progress);
            deletionTable = 'verification';
            setBackupButtonStatus(btn, 'Verifying cloud…', 'fact_check', true);
            const remaining = await verifyDeletedTargets(targets);
            if (remaining.length) {
                throw new Error(`${remaining.length} record(s) remain in Firestore. Run Backup Old Data again to resume.`);
            }
            const deletedTransactionIds = new Set(transactionsToDelete.map(tx => String(tx.id)));
            const deletedBusinessDayIds = new Set(businessDays.map(day => String(day.id)));
            const deletedGcashIds = new Set(gcashRecords.map(record => String(record.id)));
            state.transactions = (state.transactions || []).filter(tx => !tx || !deletedTransactionIds.has(String(tx.id)));
            state.businessDays = (state.businessDays || []).filter(day => !day || !deletedBusinessDayIds.has(String(day.id)));
            state.gcashRecords = (state.gcashRecords || []).filter(record => !record || !deletedGcashIds.has(String(record.id)));
            updateArchiveMeta({
                lastDeleteAt: new Date().toISOString(),
                lastDeleteStatus: 'verified',
                lastDeleteEligible: deletionTotal,
                lastDeleteCompleted: deletionTotal,
                lastDeleteProtectedCreditTransactions: protectedOldTransactions.length,
                lastDeleteTable: null,
                lastDeleteError: null
            });
            if (typeof sync === 'function') sync();
            if (typeof renderLedger === 'function') renderLedger();
            if (typeof renderInsights === 'function') renderInsights();
            if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
            if (typeof showToast === 'function') showToast(`Archive verified · ${deletionTotal} cloud record(s) deleted`, 'success');
        } catch (error) {
            console.error('Backup/archive failed', error);
            try {
                updateArchiveMeta({
                    lastDeleteAttemptAt: deletionStarted ? new Date().toISOString() : null,
                    lastDeleteStatus: deletionStarted ? 'incomplete' : 'not-started',
                    lastDeleteEligible: deletionTotal,
                    lastDeleteCompleted: deletionCompleted,
                    lastDeleteTable: deletionTable,
                    lastDeleteError: error && error.message ? error.message : String(error)
                });
            } catch (metaError) {}
            const prefix = backupDownloaded ? 'Backup saved; cloud deletion incomplete: ' : 'Backup failed: ';
            const detail = error && error.message ? error.message : String(error);
            const progressText = deletionStarted
                ? `\n\nStopped at: ${deletionTable || 'cloud deletion'}\nDeleted: ${deletionCompleted}/${deletionTotal}`
                : '';
            if (typeof showToast === 'function') showToast('Backup/delete needs attention. Full details are saved in Backup Safety.', 'error');
            // A backup/delete failure is important enough to remain visible until
            // acknowledged. The same details are also retained in archiveMeta.
            alert(prefix + detail + progressText);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-60');
                btn.innerHTML = oldHtml;
                if (oldAriaLabel === null) btn.removeAttribute('aria-label');
                else btn.setAttribute('aria-label', oldAriaLabel);
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
                const fileModifiedAt = file && Number(file.lastModified) ? new Date(file.lastModified).toISOString() : null;
                const snapshotAt = data.createdAt || fileModifiedAt || new Date().toISOString();
                state.archiveTransactions = vc710MergeArchiveById(state.archiveTransactions || [], tx, snapshotAt);
                state.archiveBusinessDays = vc710MergeArchiveById(state.archiveBusinessDays || [], bd, snapshotAt);
                state.archiveGcashRecords = vc710MergeArchiveById(state.archiveGcashRecords || [], gr, snapshotAt);
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
