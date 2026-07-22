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
