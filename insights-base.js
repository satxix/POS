// Villacart POS base Insights renderer.
// Loaded before app.js so the established anti-flicker and cloud-period guards
// in app.js continue to wrap this renderer in their original order.

function switchInsightPeriod(period) {
    insightPeriod = period;
    document.querySelectorAll('[id^="insight-tab-"]').forEach(button => {
        const isActive = button.id === 'insight-tab-' + period;
        button.classList.toggle('ledger-tab-active', isActive);
        button.classList.toggle('text-on-surface-variant', !isActive);
    });
    document.getElementById('date-range-controls').classList.toggle('hidden', period !== 'range');
    renderInsights();
}

function vc710AllTransactionsForLocalViews() {
    const live = Array.isArray(state.transactions) ? state.transactions : [];
    const archive = (Array.isArray(state.archiveTransactions) ? state.archiveTransactions : [])
        .map(transaction => ({ ...transaction, _archiveOnly: true }));
    const transactionsById = new Map();
    archive.forEach(transaction => {
        if (transaction && transaction.id) transactionsById.set(transaction.id, transaction);
    });
    live.forEach(transaction => {
        if (transaction && transaction.id) transactionsById.set(transaction.id, transaction);
    });
    return Array.from(transactionsById.values())
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}

function getPeriodTransactions() {
    const now = new Date();
    let periodTransactions = vc710AllTransactionsForLocalViews();
    if (insightPeriod === 'day') {
        const today = now.toISOString().split('T')[0];
        periodTransactions = periodTransactions.filter(transaction => String(transaction.timestamp || '').startsWith(today));
    } else if (insightPeriod === 'month') {
        const month = now.toISOString().slice(0, 7);
        periodTransactions = periodTransactions.filter(transaction => String(transaction.businessDate || transaction.timestamp || '').startsWith(month));
    } else if (insightPeriod === 'range') {
        const start = document.getElementById('insight-start-date').value;
        const end = document.getElementById('insight-end-date').value;
        if (start && end) {
            periodTransactions = periodTransactions.filter(transaction => {
                const date = String(transaction.businessDate || transaction.timestamp || '').slice(0, 10);
                return date >= start && date <= end;
            });
        }
    }
    return periodTransactions;
}

function renderInsights() {
    const lowStockItems = state.inventory
        .filter(isStockAlertVisibleProduct)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true }));
    const alertContainer = document.getElementById('restock-alerts-container');
    if (alertContainer) alertContainer.classList.toggle('hidden', lowStockItems.length === 0);
    const lowStockList = document.getElementById('insight-low-stock-list');
    if (lowStockList) {
        lowStockList.innerHTML = lowStockItems.map(product => `<div class="flex justify-between items-center bg-white/70 p-3 rounded-2xl border border-yellow-200 shadow-sm"><span class="text-xs font-black text-yellow-900">${product.name}</span><span class="text-[10px] font-black text-error bg-error/10 px-2 py-0.5 rounded-full">${product.stock} left</span></div>`).join('');
    }

    const periodTransactions = getPeriodTransactions();
    const salesTransactions = periodTransactions.filter(isRevenueSale);
    const revenue = salesTransactions.reduce((sum, transaction) => sum + transaction.total, 0);
    const totalExpenses = periodTransactions.filter(transaction => transaction.type === 'EX').reduce((sum, transaction) => sum + transaction.total, 0);
    let totalCogs = 0;
    salesTransactions.forEach(transaction => {
        if (transaction.items) {
            transaction.items.forEach(item => {
                totalCogs += ((item.cost || 0) * item.qty * (item.deduct || 1));
            });
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
    document.getElementById('inventory-value').innerText = `₱${state.inventory.reduce((sum, product) => sum + (product.cost * product.stock), 0).toLocaleString()}`;
    document.getElementById('inventory-count').innerText = `${state.inventory.length} items tracking`;

    const recent = periodTransactions.slice(0, 10);
    document.getElementById('insight-transactions-list').innerHTML = `<p class="text-[10px] font-black uppercase text-primary/60 mb-3 tracking-widest px-1">Recent Period Activities</p>` + recent.map(transaction => `<div class="bg-surface border border-border-subtle p-4 rounded-3xl flex justify-between items-center shadow-sm mb-2 hover:shadow-md transition-all"><div><div class="flex items-center gap-2"><p class="font-black text-xs text-primary">${transaction.id}</p><span class="text-[7px] px-2 py-0.5 rounded-full uppercase font-bold ${transaction.type === 'CR' ? 'bg-orange-500 text-white' : transaction.type === 'EX' ? 'bg-error text-white' : 'bg-primary/10 text-primary'}">${(transaction.notes && transaction.notes.includes('CR-')) ? 'SA (SET)' : transaction.type}</span>${isPendingSync('transactions', transaction.id) ? '<span class="text-[7px] bg-orange-500 text-white px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>' : ''}</div><p class="text-[10px] text-on-surface-variant font-bold mt-0.5">${new Date(transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div><div class="flex items-center gap-4"><span class="font-black text-sm ${transaction.type === 'EX' ? 'text-error' : 'text-on-surface'}">₱${transaction.total.toLocaleString()}</span><button onclick="viewTxDetails('${transaction.id}')" class="w-9 h-9 flex items-center justify-center bg-primary/10 text-primary rounded-xl"><span class="material-symbols-outlined text-[18px]">visibility</span></button></div></div>`).join('') || `<div class="text-center py-10 opacity-30 font-bold uppercase text-[10px]">No activity</div>`;

    renderSalesChart(periodTransactions);
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
    const salesByDate = {};
    transactions.filter(isRevenueSale).forEach(transaction => {
        const date = transaction.timestamp.split('T')[0];
        salesByDate[date] = (salesByDate[date] || 0) + transaction.total;
    });
    const labels = Object.keys(salesByDate).sort();
    const values = labels.map(date => salesByDate[date]);
    if (salesChartInstance) {
        salesChartInstance.destroy();
        salesChartInstance = null;
    }
    if (labels.length === 0) {
        canvas.parentElement.classList.add('hidden');
        return;
    }
    canvas.parentElement.classList.remove('hidden');
    salesChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels.map(date => new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
            datasets: [{
                label: 'Sales (₱)',
                data: values,
                backgroundColor: '#1e3a5f',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { ticks: { callback: value => '₱' + value.toLocaleString() }, grid: { color: '#e2e8f0' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderBestSellers(transactions) {
    const salesTransactions = transactions.filter(transaction => isRevenueSale(transaction) && transaction.items);
    const itemTotals = {};
    salesTransactions.forEach(transaction => {
        transaction.items.forEach(item => {
            if (!itemTotals[item.name]) itemTotals[item.name] = { qty: 0, revenue: 0 };
            itemTotals[item.name].qty += item.qty;
            itemTotals[item.name].revenue += item.price * item.qty;
        });
    });
    const sorted = Object.entries(itemTotals).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
    const container = document.getElementById('best-sellers-list');
    if (!container) return;
    if (sorted.length === 0) {
        container.parentElement.classList.add('hidden');
        return;
    }
    container.parentElement.classList.remove('hidden');
    container.innerHTML = sorted.map(([name, data], index) =>
        `<div class="flex items-center gap-3 p-3 bg-surface-container/50 rounded-2xl">
            <span class="w-6 h-6 flex items-center justify-center rounded-full bg-primary text-white text-[10px] font-black">${index + 1}</span>
            <div class="flex-1 min-w-0"><p class="text-xs font-black truncate uppercase">${name}</p><p class="text-[9px] text-on-surface-variant font-bold">${data.qty} units sold</p></div>
            <span class="text-xs font-black text-secondary">₱${data.revenue.toLocaleString()}</span>
        </div>`
    ).join('');
}

// v8.3.6: Consolidated authoritative Insights and business-summary engine.
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
    if (canvas.dataset.vc531ChartSig === sig) {
        const existingChart = window.salesChartInstance;
        if (existingChart && existingChart.canvas === canvas && typeof existingChart.resize === 'function') {
            requestAnimationFrame(() => existingChart.resize());
        }
        return;
    }
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
            maintainAspectRatio: window.innerWidth > 640,
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
