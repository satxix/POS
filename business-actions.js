// Business screen action/maintenance helpers extracted from app.js in v8.3.0.
// Keeps Firestore behavior unchanged; this module attaches the same window functions and wrappers.

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
            // Closed business days must remain closed. Older repair layers used
            // to reopen them, which made the header/calendar disagree after an
            // intentional End Day or a manual Firestore correction.
        }
        transaction.businessDayId = id;
        transaction.businessDate = date;
        state.currentBusinessDayId = String(bd.status || '').toUpperCase() === 'OPEN' ? id : null;
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
