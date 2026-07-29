(function (window) {
    'use strict';

    let selectedProductId = null;

    const utils = window.VillacartUtils || {};

    function money(value) {
        if (typeof utils.formatPesoFixed === 'function') return utils.formatPesoFixed(value);
        return '\u20B1' + (Number(value) || 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function html(value) {
        return typeof utils.escapeHTML === 'function'
            ? utils.escapeHTML(value)
            : String(value == null ? '' : value);
    }

    function arg(value) {
        return JSON.stringify(String(value == null ? '' : value)).replace(/"/g, '&quot;');
    }

    function dateCode(value) {
        if (!value) return '';
        const raw = String(value);
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }

    function todayCode() {
        return dateCode(new Date());
    }

    function monthStartCode() {
        const now = new Date();
        return dateCode(new Date(now.getFullYear(), now.getMonth(), 1));
    }

    function products() {
        return Array.isArray(state && state.inventory) ? state.inventory : [];
    }

    function productById(id) {
        return products().find(product => product && String(product.id) === String(id)) || null;
    }

    function deletedTransactionIds() {
        try {
            return new Set(JSON.parse(localStorage.getItem('villacart_deleted_transactions') || '[]').map(String));
        } catch (error) {
            return new Set();
        }
    }

    function localTransactions() {
        let rows;
        if (typeof vc710AllTransactionsForLocalViews === 'function') {
            rows = vc710AllTransactionsForLocalViews();
        } else {
            const merged = new Map();
            (Array.isArray(state && state.archiveTransactions) ? state.archiveTransactions : []).forEach(transaction => {
                if (transaction && transaction.id) merged.set(String(transaction.id), transaction);
            });
            (Array.isArray(state && state.transactions) ? state.transactions : []).forEach(transaction => {
                if (transaction && transaction.id) merged.set(String(transaction.id), transaction);
            });
            rows = Array.from(merged.values());
        }
        const deleted = deletedTransactionIds();
        return rows.filter(transaction => transaction && transaction.id && !deleted.has(String(transaction.id)));
    }

    function isRevenueTransaction(transaction) {
        if (typeof utils.isRevenueSale === 'function') return utils.isRevenueSale(transaction);
        return !!transaction && (transaction.type === 'SA' || transaction.type === 'CR');
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function renderProductList(query) {
        const list = document.getElementById('item-sales-product-list');
        if (!list) return;
        const search = String(query || '').trim().toLowerCase();
        const matches = products()
            .filter(product => {
                if (!search) return true;
                return String(product && product.name || '').toLowerCase().includes(search)
                    || String(product && product.barcode || '').toLowerCase().includes(search);
            })
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                sensitivity: 'base',
                numeric: true
            }))
            .slice(0, 12);

        if (!matches.length) {
            list.innerHTML = '<div class="p-4 text-center text-[10px] font-black uppercase text-on-surface-variant opacity-60">No matching product</div>';
            return;
        }

        list.innerHTML = matches.map(product => `
            <button type="button" onclick="selectItemSalesProduct(${arg(product.id)})" class="w-full px-4 py-3 rounded-2xl border border-border-subtle bg-surface-container/40 flex items-center justify-between gap-3 text-left active-scale">
                <span class="min-w-0">
                    <span class="block text-xs font-black text-primary uppercase truncate">${html(product.name)}</span>
                    <span class="block text-[9px] font-bold text-on-surface-variant mt-0.5">${html(product.barcode || 'No barcode')} · Stock ${Number(product.stock) || 0}</span>
                </span>
                <span class="text-xs font-black text-secondary whitespace-nowrap">${money(product.price)}</span>
            </button>
        `).join('');
    }

    function clearResult() {
        const result = document.getElementById('item-sales-result');
        if (result) result.classList.add('hidden');
    }

    function openItemSalesLookup() {
        selectedProductId = null;
        const search = document.getElementById('item-sales-search');
        const selected = document.getElementById('item-sales-selected');
        const from = document.getElementById('item-sales-from');
        const to = document.getElementById('item-sales-to');
        if (search) search.value = '';
        if (selected) selected.classList.add('hidden');
        if (from) from.value = monthStartCode();
        if (to) to.value = todayCode();
        clearResult();
        renderProductList('');
        const modal = document.getElementById('item-sales-modal');
        if (modal) modal.classList.replace('hidden', 'flex');
    }

    function filterItemSalesProducts(query) {
        if (selectedProductId) {
            const selected = productById(selectedProductId);
            if (!selected || String(query || '') !== String(selected.name || '')) {
                selectedProductId = null;
                const selectedCard = document.getElementById('item-sales-selected');
                if (selectedCard) selectedCard.classList.add('hidden');
                clearResult();
            }
        }
        renderProductList(query);
    }

    function selectItemSalesProduct(id) {
        const product = productById(id);
        if (!product) return;
        selectedProductId = String(product.id);
        const search = document.getElementById('item-sales-search');
        const selected = document.getElementById('item-sales-selected');
        if (search) search.value = product.name || '';
        if (selected) selected.classList.remove('hidden');
        setText('item-sales-selected-name', product.name || 'Unnamed product');
        const list = document.getElementById('item-sales-product-list');
        if (list) list.innerHTML = '';
        clearResult();
    }

    function clearItemSalesProduct() {
        selectedProductId = null;
        const search = document.getElementById('item-sales-search');
        const selected = document.getElementById('item-sales-selected');
        if (search) search.value = '';
        if (selected) selected.classList.add('hidden');
        clearResult();
        renderProductList('');
    }

    function transactionDate(transaction) {
        return dateCode(transaction && (transaction.businessDate || transaction.timestamp));
    }

    function lineMatchesProduct(item, product) {
        if (!item || !product) return false;
        // Modern sale lines carry the permanent inventory ID. When it exists,
        // it is authoritative: do not let a renamed or duplicate product name
        // combine two separately identified products in this report.
        if (item.id != null && String(item.id).trim() !== '') {
            return String(item.id) === String(product.id);
        }
        // Legacy sale lines created before product IDs were stored can still
        // be recovered by their normalized name.
        return String(item.name || '').trim().toLowerCase() === String(product.name || '').trim().toLowerCase();
    }

    function calculateItemSales() {
        const product = productById(selectedProductId);
        const from = document.getElementById('item-sales-from')?.value || '';
        const to = document.getElementById('item-sales-to')?.value || '';
        if (!product) {
            if (typeof showToast === 'function') showToast('Select a product first', 'error');
            return;
        }
        if (!from || !to || from > to) {
            if (typeof showToast === 'function') showToast('Choose a valid date range', 'error');
            return;
        }

        let pieces = 0;
        let packs = 0;
        let stockUnits = 0;
        let salesAmount = 0;
        const transactionIds = new Set();

        localTransactions()
            .filter(transaction => {
                const date = transactionDate(transaction);
                return isRevenueTransaction(transaction) && date >= from && date <= to;
            })
            .forEach(transaction => {
                const items = Array.isArray(transaction.items) ? transaction.items : [];
                const transactionGross = items.reduce((sum, item) => {
                    return sum + ((Number(item && item.price) || 0) * (Number(item && item.qty) || 0));
                }, 0);
                const explicitDiscount = Math.max(0, Number(transaction.discount) || 0);
                const derivedDiscount = transactionGross > 0
                    ? Math.max(0, transactionGross - (Number(transaction.total) || transactionGross))
                    : 0;
                const discount = Math.min(transactionGross, explicitDiscount || derivedDiscount);
                const revenueFactor = transactionGross > 0 ? Math.max(0, 1 - (discount / transactionGross)) : 1;

                items.filter(item => lineMatchesProduct(item, product)).forEach(item => {
                    const quantity = Math.max(0, Number(item.qty) || 0);
                    const isPack = String(item.type || '').toLowerCase() === 'pack';
                    const deduct = Math.max(0, Number(item.deduct) || (isPack ? Number(product.packSize) || 1 : 1));
                    const lineRevenue = (Number(item.price) || 0) * quantity * revenueFactor;
                    if (isPack) packs += quantity;
                    else pieces += quantity;
                    stockUnits += quantity * deduct;
                    salesAmount += lineRevenue;
                    transactionIds.add(String(transaction.id));
                });
            });

        const currentUnitCost = Math.max(0, Number(product.cost) || 0);
        const currentCostCogs = currentUnitCost * stockUnits;
        const estimatedProfit = salesAmount - currentCostCogs;

        setText('item-sales-result-name', product.name || 'Unnamed product');
        setText('item-sales-result-range', `${from} to ${to}`);
        setText('item-sales-units', stockUnits.toLocaleString());
        setText('item-sales-transactions', transactionIds.size.toLocaleString());
        setText('item-sales-pieces', pieces.toLocaleString());
        setText('item-sales-packs', packs.toLocaleString());
        setText('item-sales-revenue', money(salesAmount));
        setText('item-sales-cogs', money(currentCostCogs));
        setText('item-sales-profit', money(estimatedProfit));
        setText('item-sales-cost-note', `Using current cost ${money(currentUnitCost)} per stock unit.`);

        const result = document.getElementById('item-sales-result');
        if (result) {
            result.classList.remove('hidden');
            result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    window.openItemSalesLookup = openItemSalesLookup;
    window.filterItemSalesProducts = filterItemSalesProducts;
    window.selectItemSalesProduct = selectItemSalesProduct;
    window.clearItemSalesProduct = clearItemSalesProduct;
    window.calculateItemSales = calculateItemSales;
})(window);
