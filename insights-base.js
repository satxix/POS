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
