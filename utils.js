(function(window) {
    'use strict';

    function titleCase(str) {
        if (!str) return 'Unknown';
        return String(str).toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function jsArg(value) {
        return JSON.stringify(String(value ?? '')).replace(/"/g, '&quot;');
    }

    function formatCurrency(value) {
        return `₱${(Number(value) || 0).toLocaleString()}`;
    }

    function formatPesoFixed(value) {
        return '\u20B1' + (Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const FIRESTORE_SYNC_TABLES = new Set(['transactions', 'inventory', 'businessDays', 'gcashRecords']);

    function isFirestoreSyncTable(table) {
        return FIRESTORE_SYNC_TABLES.has(String(table || ''));
    }

    function isArchiveOnlyRecord(data) {
        return !!(data && (data._archiveOnly || data.archiveOnly || data.localArchiveOnly));
    }

    function safeLocalJson(key, fallback, label) {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return parsed == null ? fallback : parsed;
        } catch (error) {
            const recovery = {
                key,
                label: label || key,
                at: new Date().toISOString(),
                error: error && error.message ? error.message : String(error)
            };
            window.__villacartStorageRecovery = window.__villacartStorageRecovery || [];
            window.__villacartStorageRecovery.push(recovery);
            try {
                window.localStorage.setItem(key + '_corrupt_' + Date.now(), raw);
            } catch (backupError) {}
            try { window.localStorage.removeItem(key); } catch (removeError) {}
            console.warn('Recovered from corrupted local storage:', recovery);
            return fallback;
        }
    }

    function isCreditSettlement(t) {
        return !!(t && t.notes && t.notes.includes('CR-'));
    }

    function isRevenueSale(t) {
        return !!(t && (t.type === 'SA' || t.type === 'CR') && !isCreditSettlement(t));
    }

    function cartSubtotal(cart) {
        return (Array.isArray(cart) ? cart : []).reduce((sum, item) => sum + ((Number(item && item.price) || 0) * (Number(item && item.qty) || 0)), 0);
    }

    function cartCount(cart) {
        return (Array.isArray(cart) ? cart : []).reduce((sum, item) => sum + (Number(item && item.qty) || 0), 0);
    }

    function cartDiscount(cart, discountValue) {
        const subtotal = cartSubtotal(cart);
        const discount = Math.max(0, Number(discountValue) || 0);
        return Math.min(discount, subtotal);
    }

    function cartTotal(cart, discountValue) {
        return Math.max(0, cartSubtotal(cart) - cartDiscount(cart, discountValue));
    }

    function cartStockIssue(cart, inventory) {
        const totals = {};
        (Array.isArray(cart) ? cart : []).forEach(item => {
            if (!item || !item.id) return;
            totals[item.id] = (totals[item.id] || 0) + ((Number(item.qty) || 0) * (Number(item.deduct) || 1));
        });
        const products = Array.isArray(inventory) ? inventory : [];
        for (const [id, needed] of Object.entries(totals)) {
            const product = products.find(p => p && p.id === id);
            const available = product ? Number(product.stock) || 0 : 0;
            if (!product || needed > available) {
                return `${product ? product.name : 'A product'} needs ${needed} pcs, but only ${available} are available.`;
            }
        }
        return null;
    }

    function inventoryLowStockThresholdValue(product) {
        const threshold = Number(product && product.lowStock);
        return Number.isFinite(threshold) ? threshold : 5;
    }

    function inventoryIsLowStock(product) {
        return Number(product && product.stock) <= inventoryLowStockThresholdValue(product);
    }

    function inventoryCategoryKeyValue(product) {
        return String((product && product.category) || 'Uncategorized').trim().toLowerCase() || 'uncategorized';
    }

    function inventoryCategoryNameValue(product) {
        return titleCase((product && product.category) || 'Uncategorized');
    }

    function inventoryMatchesSearchValue(product, searchValue, normalizeBarcode = value => String(value || '').trim()) {
        const q = String(searchValue || '').trim().toLowerCase();
        if (!q) return true;
        const barcode = normalizeBarcode(product && product.barcode);
        return String(product && product.name || '').toLowerCase().includes(q)
            || String(barcode || '').toLowerCase().includes(q)
            || String(product && product.category || '').toLowerCase().includes(q);
    }



    function groupByKey(items, keyFn) {
        const grouped = new Map();
        (Array.isArray(items) ? items : []).forEach(item => {
            const key = keyFn(item);
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(item);
        });
        return grouped;
    }

    function businessMetricsForTransactions(periodTransactions, allTransactions = periodTransactions) {
        const periodTx = Array.isArray(periodTransactions) ? periodTransactions : [];
        const allTx = Array.isArray(allTransactions) ? allTransactions : periodTx;
        const revenueSales = periodTx.filter(isRevenueSale);
        const cashSales = revenueSales.filter(t => t && t.type === 'SA').reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const creditSales = revenueSales.filter(t => t && t.type === 'CR').reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const collections = periodTx.filter(isCreditSettlement).reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const expenses = periodTx.filter(t => t && t.type === 'EX').reduce((sum, t) => sum + (Number(t.total) || 0), 0);

        let cogs = 0;
        revenueSales.forEach(t => {
            (Array.isArray(t && t.items) ? t.items : []).forEach(item => {
                cogs += (Number(item && item.cost) || 0) * (Number(item && item.qty) || 0) * (Number(item && item.deduct) || 1);
            });
        });

        const totalSales = cashSales + creditSales;
        const cashIn = cashSales + collections;
        const netProfit = totalSales - cogs - expenses;
        const allCreditSales = allTx.filter(t => t && t.type === 'CR' && !isCreditSettlement(t)).reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const allCollections = allTx.filter(isCreditSettlement).reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const outstandingCredit = Math.max(0, allCreditSales - allCollections);

        return { cashSales, creditSales, collections, totalSales, cashIn, expenses, cogs, netProfit, outstandingCredit, transactionCount: periodTx.length };
    }



    function transactionTypeCounts(transactions) {
        const tx = Array.isArray(transactions) ? transactions : [];
        return {
            cash: tx.filter(t => t && t.type === 'SA' && !isCreditSettlement(t)).length,
            credit: tx.filter(t => t && t.type === 'CR' && !isCreditSettlement(t)).length,
            collections: tx.filter(t => t && isCreditSettlement(t)).length,
            expenses: tx.filter(t => t && t.type === 'EX').length
        };
    }

    function firestoreRestValue(value) {
        if (value === null || value === undefined) return { nullValue: null };
        if (value instanceof Date) return { timestampValue: value.toISOString() };
        if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreRestValue) } };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
        if (typeof value === 'object') {
            return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreRestValue(item)])) } };
        }
        return { stringValue: String(value) };
    }

    function firestoreRestToValue(value) {
        if (!value || typeof value !== 'object') return null;
        if ('nullValue' in value) return null;
        if ('booleanValue' in value) return value.booleanValue;
        if ('integerValue' in value) return Number(value.integerValue);
        if ('doubleValue' in value) return Number(value.doubleValue);
        if ('timestampValue' in value) return value.timestampValue;
        if ('stringValue' in value) return value.stringValue;
        if ('referenceValue' in value) return value.referenceValue;
        if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreRestToValue);
        if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, firestoreRestToValue(item)]));
        return null;
    }

    const VC_OPTIONAL_SCRIPTS = {
        html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        Chart: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
    };
    const vcOptionalScriptPromises = {};

    function loadOptionalScript(globalName, src) {
        if (window[globalName]) return Promise.resolve(window[globalName]);
        if (vcOptionalScriptPromises[globalName]) return vcOptionalScriptPromises[globalName];
        vcOptionalScriptPromises[globalName] = new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-vc-optional="${globalName}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve(window[globalName]), { once: true });
                existing.addEventListener('error', () => reject(new Error(globalName + ' failed to load')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.vcOptional = globalName;
            script.onload = () => resolve(window[globalName]);
            script.onerror = () => reject(new Error(globalName + ' failed to load'));
            document.head.appendChild(script);
        });
        return vcOptionalScriptPromises[globalName];
    }

    function ensureHtml2CanvasLoaded() {
        return loadOptionalScript('html2canvas', VC_OPTIONAL_SCRIPTS.html2canvas);
    }

    function ensureChartLoaded() {
        return loadOptionalScript('Chart', VC_OPTIONAL_SCRIPTS.Chart);
    }

    function canvasToPngBlob(canvas) {
        return new Promise((resolve, reject) => {
            if (!canvas || typeof canvas.toBlob !== 'function') {
                reject(new Error('Receipt image could not be created.'));
                return;
            }
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Receipt image is empty.'));
            }, 'image/png');
        });
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // v7.2.14: Auto-sync read scope.
    // Keep automatic sync, but avoid re-reading old transaction history forever.
    function vc5632lDateCode(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function vc5632lMonthBounds(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        return { start: vc5632lDateCode(start), end: vc5632lDateCode(end) };
    }

    function vc5632mTodayBounds() {
        const today = vc5632lDateCode(new Date());
        return { start: today, end: today };
    }

    function vc5632mInDateRange(item, bounds) {
        if (!bounds) return true;
        const d = item && (item.businessDate || item.date || (item.timestamp ? vc5632lDateCode(item.timestamp) : ''));
        return !!d && d >= bounds.start && d <= bounds.end;
    }

    function todayDateCode() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }



    function calcGcashFee(amount) {
        const n = Math.max(0, Number(amount) || 0);
        return n > 0 ? Math.ceil(n / 1000) * 10 : 0;
    }



    function gcashDrawerEffect(type, amount, fee) {
        const amt = Number(amount) || 0;
        const svc = Number(fee) || 0;
        return type === 'cashIn' ? amt + svc : svc - amt;
    }



    function gcashRecordDate(record) {
        if (record && record.businessDate) return String(record.businessDate).slice(0, 10);
        if (record && record.timestamp) return todayDateCodeFromDate(new Date(record.timestamp));
        return '';
    }



    function todayDateCodeFromDate(date) {
        const d = date instanceof Date && !isNaN(date) ? date : new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd;
    }



    function monthStartDateCode() {
        const now = new Date();
        return todayDateCodeFromDate(new Date(now.getFullYear(), now.getMonth(), 1));
    }





    function gcashDailySummary(records) {
        const rows = Array.isArray(records) ? records : [];
        return {
            cashOut: rows.filter(r => r && r.type === 'cashOut').reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
            cashIn: rows.filter(r => r && r.type === 'cashIn').reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
            fees: rows.reduce((sum, r) => sum + (Number(r && r.fee) || 0), 0),
            drawer: rows.reduce((sum, r) => sum + (Number(r && r.drawerEffect) || 0), 0)
        };
    }

    function gcashSearchText(record) {
        return [
            record && record.id,
            record && record.customerName,
            record && record.referenceNotes,
            record && record.notes,
            record && record.type,
            record && record.amount
        ].filter(Boolean).join(' ').toLowerCase();
    }



    function gcashMatchesSearch(record, query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return true;
        return gcashSearchText(record).includes(q);
    }



    function firestoreWriteWithTimeout(write, timeoutMs = 15000) {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Firestore write timed out; it will be retried.')), timeoutMs);
        });
        return Promise.race([write, timeout]).finally(() => clearTimeout(timeoutId));
    }



    function csvEscape(value) {
        let text = String(value ?? '');
        if (/^[=+\-@]/.test(text)) text = "'" + text;
        return `"${text.replace(/"/g, '""')}"`;
    }

    window.VillacartUtils = Object.freeze({
        titleCase,
        isFirestoreSyncTable,
        isArchiveOnlyRecord,
        escapeHTML,
        jsArg,
        formatCurrency,
        formatPesoFixed,
        safeLocalJson,
        isCreditSettlement,
        isRevenueSale,
        cartSubtotal,
        cartCount,
        cartDiscount,
        cartTotal,
        cartStockIssue,
        inventoryLowStockThresholdValue,
        inventoryIsLowStock,
        inventoryCategoryKeyValue,
        inventoryCategoryNameValue,
        inventoryMatchesSearchValue,
        groupByKey,
        businessMetricsForTransactions,
        transactionTypeCounts,
        firestoreRestValue,
        firestoreRestToValue,
        firestoreWriteWithTimeout,
        loadOptionalScript,
        ensureHtml2CanvasLoaded,
        ensureChartLoaded,
        canvasToPngBlob,
        downloadBlob,
        vc5632lDateCode,
        vc5632lMonthBounds,
        vc5632mTodayBounds,
        vc5632mInDateRange,
        todayDateCode,
        calcGcashFee,
        gcashDrawerEffect,
        gcashRecordDate,
        gcashDailySummary,
        todayDateCodeFromDate,
        monthStartDateCode,
        gcashSearchText,
        gcashMatchesSearch,
        csvEscape
    });
})(window);
