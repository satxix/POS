// Villacart GCash screen logic v8.0.56
// Depends on shared app globals from app.js at call time.

    // v8.0.56: Standalone GCash service ledger.
    let activeGcashType = 'cashOut';
    let activeGcashView = 'today';
    let expandedGcashDates = new Set();
    let editingGcashRecordId = null;

    function nextGcashId() {
        return nextTransactionId('GC');
    }

    function setGcashType(type) {
        activeGcashType = type === 'cashIn' ? 'cashIn' : 'cashOut';
        document.querySelectorAll('.gcash-type-btn').forEach(btn => {
            const active = btn.id === 'gcash-type-' + activeGcashType;
            btn.classList.toggle('bg-primary', active);
            btn.classList.toggle('text-white', active);
            btn.classList.toggle('bg-surface-container', !active);
            btn.classList.toggle('text-on-surface-variant', !active);
        });
        updateGcashPreview();
    }

    function addGcashAmount(amountToAdd) {
        const amountEl = document.getElementById('gcash-amount');
        if (!amountEl) return;
        const current = Math.max(0, Number(amountEl.value) || 0);
        amountEl.value = current + (Number(amountToAdd) || 0);
        updateGcashPreview();
    }

    function clearGcashAmount(showMessage = true) {
        const amountEl = document.getElementById('gcash-amount');
        if (amountEl) amountEl.value = '';
        updateGcashPreview();
        if (showMessage && typeof showToast === 'function') showToast('GCash amount cleared', 'info');
    }

    function resetGcashForm(showMessage = false) {
        const amountEl = document.getElementById('gcash-amount');
        const nameEl = document.getElementById('gcash-name');
        const notesEl = document.getElementById('gcash-notes');
        editingGcashRecordId = null;
        if (amountEl) amountEl.value = '';
        if (nameEl) nameEl.value = '';
        if (notesEl) notesEl.value = '';
        updateGcashPreview();
        updateGcashSaveButtonState();
        if (showMessage && typeof showToast === 'function') showToast('GCash form reset', 'info');
    }

    function updateGcashSaveButtonState() {
        const btn = document.getElementById('gcash-save-btn');
        if (!btn) return;
        btn.innerHTML = editingGcashRecordId ? 'Update<br class="hidden md:block"/> GCash Record' : 'Save<br class="hidden md:block"/> GCash Record';
        btn.classList.toggle('bg-secondary', !editingGcashRecordId);
        btn.classList.toggle('bg-primary', !!editingGcashRecordId);
    }

    function editGcashRecord(id) {
        state.gcashRecords = Array.isArray(state.gcashRecords) ? state.gcashRecords : [];
        const record = state.gcashRecords.find(r => r && r.id === id);
        if (!record) {
            showToast('Only current GCash records can be edited', 'error');
            return;
        }
        editingGcashRecordId = record.id;
        setGcashType(record.type);
        const amountEl = document.getElementById('gcash-amount');
        const nameEl = document.getElementById('gcash-name');
        const notesEl = document.getElementById('gcash-notes');
        if (amountEl) amountEl.value = Number(record.amount) || 0;
        if (nameEl) nameEl.value = record.customerName || record.name || '';
        if (notesEl) notesEl.value = record.referenceNotes || record.notes || '';
        updateGcashPreview();
        updateGcashSaveButtonState();
        showToast('Editing GCash record', 'info');
    }

    function updateGcashPreview() {
        const amount = Math.max(0, Number(document.getElementById('gcash-amount')?.value) || 0);
        const fee = calcGcashFee(amount);
        const drawer = gcashDrawerEffect(activeGcashType, amount, fee);
        const mainLabel = document.getElementById('gcash-preview-main-label');
        const mainValue = document.getElementById('gcash-preview-main');
        const feeValue = document.getElementById('gcash-preview-fee');
        const drawerValue = document.getElementById('gcash-preview-drawer');
        if (mainLabel) mainLabel.innerText = activeGcashType === 'cashIn' ? 'Cash to receive' : 'Cash to release';
        if (mainValue) mainValue.innerText = formatCurrency(amount);
        if (feeValue) feeValue.innerText = formatCurrency(fee);
        if (drawerValue) drawerValue.innerText = (drawer < 0 ? '-' : '') + formatCurrency(Math.abs(drawer));
    }

    function saveGcashRecord() {
        const amountEl = document.getElementById('gcash-amount');
        const nameEl = document.getElementById('gcash-name');
        const notesEl = document.getElementById('gcash-notes');
        const amount = Math.max(0, Number(amountEl?.value) || 0);
        if (amount <= 0) {
            showToast('Enter a GCash amount first', 'error');
            return;
        }
        const fee = calcGcashFee(amount);
        const now = new Date();
        state.gcashRecords = Array.isArray(state.gcashRecords) ? state.gcashRecords : [];
        const editIndex = editingGcashRecordId ? state.gcashRecords.findIndex(r => r && r.id === editingGcashRecordId) : -1;
        const existing = editIndex >= 0 ? state.gcashRecords[editIndex] : null;
        if (editingGcashRecordId && !existing) {
            showToast('GCash record no longer exists', 'error');
            editingGcashRecordId = null;
            updateGcashSaveButtonState();
            return;
        }
        const record = {
            ...(existing || {}),
            id: existing?.id || nextGcashId(),
            type: activeGcashType,
            amount,
            fee,
            drawerEffect: gcashDrawerEffect(activeGcashType, amount, fee),
            businessDate: existing?.businessDate || todayDateCode(),
            businessDayId: existing?.businessDayId || state.currentBusinessDayId || null,
            timestamp: existing?.timestamp || now.toISOString(),
            updatedAt: existing ? now.toISOString() : undefined,
            customerName: (nameEl?.value || '').trim(),
            referenceNotes: (notesEl?.value || '').trim(),
            notes: (notesEl?.value || '').trim(),
            _offline: true
        };
        if (record.updatedAt === undefined) delete record.updatedAt;
        if (editIndex >= 0) state.gcashRecords.splice(editIndex, 1, record);
        else state.gcashRecords.unshift(record);
        queueAction('update', 'gcashRecords', record);
        resetGcashForm(false);
        renderGcashScreen();
        showToast(existing ? 'GCash record updated' : 'GCash record saved', 'success');
    }

    function switchGcashView(view) {
        activeGcashView = view === 'history' ? 'history' : 'today';
        renderGcashScreen();
    }

    function toggleGcashDateGroup(dateKey) {
        if (!dateKey) return;
        if (expandedGcashDates.has(dateKey)) expandedGcashDates.delete(dateKey);
        else expandedGcashDates.add(dateKey);
        renderGcashScreen();
    }

    function currentGcashSearchQuery() {
        return document.getElementById('gcash-search')?.value || '';
    }

    function clearGcashSearch() {
        const input = document.getElementById('gcash-search');
        if (input) input.value = '';
        renderGcashScreen();
    }

    function renderGcashRecordCard(r) {
        const isOut = r.type === 'cashOut';
        const pending = isPendingSync('gcashRecords', r.id) || r._offline;
        const when = r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const meta = [r.customerName, r.referenceNotes || r.notes].filter(Boolean).join(' - ');
        const editButton = r._archiveOnly ? '' : `<button type="button" class="h-10 px-3 rounded-2xl bg-primary/10 text-primary font-black text-[10px] uppercase tracking-wider active-scale flex items-center gap-1" onclick="editGcashRecord(${jsArg(r.id)})"><span class="material-symbols-outlined text-[18px]">edit</span>Edit</button>`;
        return `<div class="bg-surface-container/40 border border-border-subtle rounded-3xl p-4 flex justify-between gap-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <p class="font-black text-sm ${isOut ? 'text-error' : 'text-primary'}">${escapeHTML(r.id)}</p>
                    <span class="text-[7px] px-2 py-0.5 rounded-full uppercase font-black ${isOut ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'}">${isOut ? 'Cash Out' : 'Cash In'}</span>
                    ${pending ? '<span class="text-[7px] px-2 py-0.5 rounded-full uppercase font-black bg-orange-500 text-white">Pending</span>' : ''}
                </div>
                <p class="text-[10px] font-bold text-on-surface-variant">${escapeHTML(when)}${meta ? ' - ' + escapeHTML(meta) : ''}</p>
                <p class="text-[10px] font-black uppercase tracking-wider text-secondary mt-1">Fee ${formatCurrency(r.fee)}</p>
            </div>
            <div class="text-right shrink-0 flex flex-col items-end gap-2">
                <div>
                    <p class="text-xl font-black text-on-surface">${formatCurrency(r.amount)}</p>
                    <p class="text-[10px] font-bold text-on-surface-variant">${isOut ? 'Released' : 'Received'}</p>
                </div>
                ${editButton}
            </div>
        </div>`;
    }

    function renderGcashHistoryGroups(records) {
        return Array.from(groupByKey(records, r => gcashRecordDate(r) || 'Unknown date').entries()).map(([date, items]) => {
            const { cashOut: out, cashIn: inn, fees } = gcashDailySummary(items);
            const label = date === 'Unknown date' ? date : new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            const expanded = expandedGcashDates.has(date);
            return `<div class="bg-white border border-border-subtle rounded-[1.75rem] p-3 shadow-sm">
                <button class="w-full flex items-start justify-between gap-3 px-1 text-left active-scale" onclick="toggleGcashDateGroup(${jsArg(date)})">
                    <div class="flex items-start gap-2 min-w-0">
                        <span class="material-symbols-outlined w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">${expanded ? 'expand_less' : 'expand_more'}</span>
                        <div class="min-w-0">
                            <h3 class="font-black text-primary text-sm">${escapeHTML(label)}</h3>
                            <p class="text-[10px] font-bold text-on-surface-variant">${items.length} record(s) - Fees ${formatCurrency(fees)}</p>
                        </div>
                    </div>
                    <div class="text-right text-[10px] font-black text-on-surface-variant shrink-0">
                        <p>Out ${formatCurrency(out)}</p>
                        <p>In ${formatCurrency(inn)}</p>
                    </div>
                </button>
                ${expanded ? `<div class="space-y-2 mt-3">${items.map(renderGcashRecordCard).join('')}</div>` : ''}
            </div>`;
        }).join('');
    }

    function renderGcashScreen() {
        state.gcashRecords = Array.isArray(state.gcashRecords) ? state.gcashRecords : [];
        const today = todayDateCode();
        const archiveRecords = (Array.isArray(state.archiveGcashRecords) ? state.archiveGcashRecords : []).map(r => ({ ...r, _archiveOnly: true }));
        const mergedRecords = new Map();
        archiveRecords.forEach(r => { if (r && r.id) mergedRecords.set(r.id, r); });
        (state.gcashRecords || []).forEach(r => { if (r && r.id) mergedRecords.set(r.id, r); });
        const records = Array.from(mergedRecords.values()).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
        const todays = records.filter(r => r && gcashRecordDate(r) === today);
        const { cashOut, cashIn, fees, drawer } = gcashDailySummary(todays);
        const searchQuery = currentGcashSearchQuery();
        const setText = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
        setText('gcash-sum-out', formatCurrency(cashOut));
        setText('gcash-sum-in', formatCurrency(cashIn));
        setText('gcash-sum-fees', formatCurrency(fees));
        setText('gcash-sum-drawer', (drawer < 0 ? '-' : '') + formatCurrency(Math.abs(drawer)));

        const todayBtn = document.getElementById('gcash-view-today');
        const historyBtn = document.getElementById('gcash-view-history');
        const rangeEl = document.getElementById('gcash-history-range');
        const subtitle = document.getElementById('gcash-list-subtitle');
        [todayBtn, historyBtn].forEach(btn => {
            if (!btn) return;
            const active = (btn.id === 'gcash-view-' + activeGcashView);
            btn.classList.toggle('bg-primary', active);
            btn.classList.toggle('text-white', active);
            btn.classList.toggle('bg-surface-container', !active);
            btn.classList.toggle('text-on-surface-variant', !active);
        });
        if (rangeEl) rangeEl.classList.toggle('hidden', activeGcashView !== 'history');
        if (subtitle) subtitle.innerText = activeGcashView === 'history' ? 'Grouped by date' : 'Today only';

        const list = document.getElementById('gcash-record-list');
        if (list) {
            if (activeGcashView === 'history') {
                const startEl = document.getElementById('gcash-range-start');
                const endEl = document.getElementById('gcash-range-end');
                if (startEl && !startEl.value) startEl.value = monthStartDateCode();
                if (endEl && !endEl.value) endEl.value = today;
                const start = startEl && startEl.value ? startEl.value : '';
                const end = endEl && endEl.value ? endEl.value : '';
                const filtered = records.filter(r => {
                    const d = gcashRecordDate(r);
                    return d && (!start || d >= start) && (!end || d <= end) && gcashMatchesSearch(r, searchQuery);
                });
                list.innerHTML = renderGcashHistoryGroups(filtered) || '<div class="text-center py-16 opacity-30"><span class="material-symbols-outlined text-[44px]">history</span><p class="font-black text-xs uppercase tracking-widest mt-2">No GCash history found</p></div>';
            } else {
                const filteredToday = todays.filter(r => gcashMatchesSearch(r, searchQuery));
                list.innerHTML = filteredToday.map(renderGcashRecordCard).join('') || '<div class="text-center py-16 opacity-30"><span class="material-symbols-outlined text-[44px]">account_balance_wallet</span><p class="font-black text-xs uppercase tracking-widest mt-2">No GCash records found</p></div>';
            }
        }
        setGcashType(activeGcashType);
        updateGcashSaveButtonState();
    }

    async function refreshGcashRecords() {
        if (!navigator.onLine) {
            showToast('You are offline', 'error');
            return;
        }
        try {
            const remote = await readCollectionWithFirestoreRest('gcashRecords');
            const merged = new Map();
            [...(state.gcashRecords || []), ...remote].forEach(r => {
                if (r && r.id) merged.set(r.id, { ...merged.get(r.id), ...r });
            });
            state.gcashRecords = Array.from(merged.values()).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            sync();
            renderGcashScreen();
            showToast('GCash refreshed', 'success');
        } catch (error) {
            syncErrorMsg = error.message || String(error);
            updateSyncUI();
            showToast('GCash refresh failed', 'error');
        }
    }

