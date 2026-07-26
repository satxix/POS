// Villacart POS reporting/dashboard helpers.
// Loaded before app.js so existing render guards can keep wrapping these
// public functions while app.js is reduced gradually.

function getBusinessMetricsForPeriod(transactions) {
    const periodTx = transactions || getPeriodTransactions();
    return businessMetricsForTransactions(periodTx, state.transactions || []);
}

function updateBusinessDashboardCards() {
    const scope = typeof getActiveBusinessDayTransactionsOrPeriod === 'function'
        ? getActiveBusinessDayTransactionsOrPeriod()
        : undefined;
    const metrics = getBusinessMetricsForPeriod(scope);
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.innerText = formatPesoFixed(value);
    };
    setText('biz-total-sales', metrics.totalSales);
    setText('biz-cash-in', metrics.cashIn);
    setText('biz-credit-sales', metrics.creditSales);
    setText('biz-outstanding-credit', metrics.outstandingCredit);
}

function moneyFmt(value) {
    return formatPesoFixed(value);
}

function getClosingTransactionsScope() {
    const businessDay = typeof getCurrentBusinessDay === 'function' ? getCurrentBusinessDay() : null;
    if (businessDay && typeof getBusinessDayTransactions === 'function') {
        return getBusinessDayTransactions(businessDay.id);
    }
    return getPeriodTransactions();
}

function getClosingCounts(transactions) {
    return transactionTypeCounts(transactions || getPeriodTransactions());
}

function showStoreClosingSummary() {
    const periodTransactions = getClosingTransactionsScope();
    const metrics = getBusinessMetricsForPeriod(periodTransactions);
    const counts = getClosingCounts(periodTransactions);
    const activeBusinessDay = typeof getCurrentBusinessDay === 'function' ? getCurrentBusinessDay() : null;
    const periodLabel = activeBusinessDay
        ? `${activeBusinessDay.id} \u2022 ${new Date(activeBusinessDay.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to Now`
        : (insightPeriod === 'day' ? 'Today \u2022 12:00 AM to Now' : insightPeriod === 'month' ? 'This Month' : 'Selected Range');
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.innerText = value;
    };
    setText('closing-period-label', periodLabel);
    setText('closing-cash-in', moneyFmt(metrics.cashIn));
    setText('closing-cash-sales', moneyFmt(metrics.cashSales));
    setText('closing-credit-sales', moneyFmt(metrics.creditSales));
    setText('closing-collections', moneyFmt(metrics.collections));
    setText('closing-expenses', moneyFmt(metrics.expenses));
    setText('closing-total-sales', moneyFmt(metrics.totalSales));
    setText('closing-cogs', moneyFmt(metrics.cogs));
    setText('closing-net-profit', moneyFmt(metrics.netProfit));
    setText('closing-outstanding', moneyFmt(metrics.outstandingCredit));
    setText('closing-count-cash', counts.cash);
    setText('closing-count-credit', counts.credit);
    setText('closing-count-collections', counts.collections);
    setText('closing-count-expenses', counts.expenses);
    const modal = document.getElementById('closing-summary-modal');
    if (modal) modal.classList.replace('hidden', 'flex');
}

function printClosingSummary() {
    window.print();
}

function getActiveBusinessDayTransactionsOrPeriod() {
    try {
        const businessDay = typeof getCurrentBusinessDay === 'function' ? getCurrentBusinessDay() : null;
        if (businessDay && typeof getBusinessDayTransactions === 'function') {
            const transactions = getBusinessDayTransactions(businessDay.id);
            if (transactions && transactions.length > 0) return transactions;
        }
    } catch (error) {
        console.warn('Business-day reporting fallback used', error);
    }
    return getPeriodTransactions();
}

function getTodayTransactionsResilient() {
    const today = typeof localDateCode === 'function' ? localDateCode(new Date()) : new Date().toISOString().slice(0, 10);
    return (state.transactions || []).filter(transaction => {
        const transactionDate = transaction.businessDate || (transaction.timestamp ? transaction.timestamp.slice(0, 10) : '');
        return transactionDate === today;
    });
}

function getBusinessMetricsResilient(transactions) {
    const source = transactions || getTodayTransactionsResilient();
    return businessMetricsForTransactions(source, state.transactions || []);
}

function forceUpdateInsightsNumbersFromTransactions() {
    const periodTransactions = typeof getPeriodTransactions === 'function' ? getPeriodTransactions() : getTodayTransactionsResilient();
    const metrics = getBusinessMetricsResilient(periodTransactions);
    const setMoney = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.innerText = formatPesoFixed(value);
    };
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.innerText = value;
    };
    setMoney('daily-revenue', metrics.totalSales);
    setMoney('daily-profit', metrics.netProfit);
    setMoney('daily-cogs', metrics.cogs);
    setMoney('daily-expenses', metrics.expenses);
    setText('daily-margin', `${metrics.totalSales > 0 ? ((metrics.netProfit / metrics.totalSales) * 100).toFixed(1) : '0'}%`);
    setMoney('biz-total-sales', metrics.totalSales);
    setMoney('biz-cash-in', metrics.cashIn);
    setMoney('biz-credit-sales', metrics.creditSales);
    if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI();
    if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar();
}

/* v8.3.18: pure closing-summary calculations and rendering (write/close wrappers remain in app.js). */
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
