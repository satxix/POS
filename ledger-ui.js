// Villacart POS Ledger stability and grouped-ledger UI.
// Extracted unchanged from app.js in v8.3.15.
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
