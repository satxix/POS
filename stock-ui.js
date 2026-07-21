// --- Villacart Stock UI module ---
// v8.1.2: Extracted from app.js. Product save/delete/restock/cloud write logic remains in app.js.

    function getInventorySearchValue() {
        const stockSearch = document.getElementById('stock-search') || document.querySelector('#screen-inventory input[type="text"]');
        return stockSearch ? String(stockSearch.value || '') : '';
    }
    function vc8046UpdateStockSearchClear() {
        const stockSearch = document.getElementById('stock-search') || document.querySelector('#screen-inventory input[type="text"]');
        const clearBtn = document.getElementById('stock-search-clear');
        if (!clearBtn) return;
        const hasValue = !!(stockSearch && String(stockSearch.value || '').trim());
        clearBtn.classList.toggle('hidden', !hasValue);
    }

    function clearStockSearch() {
        const stockSearch = document.getElementById('stock-search') || document.querySelector('#screen-inventory input[type="text"]');
        if (stockSearch) {
            stockSearch.value = '';
            try { stockSearch.focus({ preventScroll: true }); } catch (_) { stockSearch.focus(); }
        }
        renderInventory('');
        vc8046UpdateStockSearchClear();
    }


    function inventoryLowStockThreshold(product) {
        return inventoryLowStockThresholdValue(product);
    }

    function isLowStockProduct(product) {
        return inventoryIsLowStock(product);
    }
    function saveMutedStockAlertIds() {
        try { localStorage.setItem(STOCK_ALERT_HIDE_KEY, JSON.stringify(Array.from(mutedStockAlertIds))); } catch (e) {}
    }

    function isStockAlertMuted(productOrId) {
        const id = typeof productOrId === 'object' && productOrId ? productOrId.id : productOrId;
        return !!(id && mutedStockAlertIds.has(String(id)));
    }

    function isStockAlertVisibleProduct(product) {
        return isLowStockProduct(product) && !isStockAlertMuted(product);
    }

    function toggleStockAlertMute(id) {
        const key = String(id || '');
        if (!key) return;
        const product = (state.inventory || []).find(p => String(p.id) === key);
        if (mutedStockAlertIds.has(key)) {
            mutedStockAlertIds.delete(key);
            showToast(product ? `Alerts restored for ${product.name}` : 'Stock alerts restored', 'success');
        } else {
            mutedStockAlertIds.add(key);
            showToast(product ? `Hidden from alerts: ${product.name}` : 'Hidden from stock alerts', 'info');
        }
        saveMutedStockAlertIds();
        renderInventory(getInventorySearchValue());
        if (typeof renderHeaderLowStockTicker === 'function') renderHeaderLowStockTicker();
        if (typeof updateNotifBadge === 'function') updateNotifBadge();
        if (typeof renderInsights === 'function') {
            const insights = document.getElementById('screen-insights');
            if (insights && !insights.classList.contains('hidden')) renderInsights();
        }
    }


    function inventoryCategoryKey(product) {
        return inventoryCategoryKeyValue(product);
    }

    function inventoryCategoryName(product) {
        return inventoryCategoryNameValue(product);
    }

    function inventoryMatchesSearch(product, searchValue) {
        return inventoryMatchesSearchValue(product, searchValue, vc7227NormalizeBarcode);
    }

    function inventoryEmptyStateHtml(hasInventory) {
        if (!hasInventory) {
            return '<div class="col-span-full flex flex-col items-center justify-center py-24 opacity-50"><span class="material-symbols-outlined text-[64px] text-primary/30 mb-4">inventory_2</span><p class="font-black text-sm uppercase text-primary/40 tracking-widest mb-2">No Products Yet</p><p class="text-xs text-on-surface-variant font-bold">Tap "Add Product" to get started</p></div>';
        }
        return '<div class="col-span-full flex flex-col items-center justify-center py-24 opacity-50"><span class="material-symbols-outlined text-[64px] text-primary/30 mb-4">search_off</span><p class="font-black text-sm uppercase text-primary/40 tracking-widest">No matching products</p></div>';
    }

    function inventoryMetricCard(label, value, extraClass = 'bg-surface-container/60', valueClass = 'text-on-surface') {
        return `<div class="${extraClass} rounded-xl p-2"><p class="text-[8px] font-black uppercase opacity-60">${label}</p><p class="text-xs font-black ${valueClass}">${value}</p></div>`;
    }

    function renderInventoryProductRow(product) {
        const isLow = isLowStockProduct(product);
        const isMuted = isStockAlertMuted(product);
        const isVisibleAlert = isLow && !isMuted;
        const marginVal = Number(product.price) > 0 ? (((Number(product.price) - Number(product.cost || 0)) / Number(product.price)) * 100).toFixed(1) : 0;
        const stockValue = `${escapeHTML(product.stock)} pcs`;
        const metrics = [
            inventoryMetricCard('Stock', stockValue, 'bg-surface-container/60', isVisibleAlert ? 'text-error' : (isMuted ? 'text-on-surface-variant' : 'text-primary')),
            inventoryMetricCard('Cost', formatCurrency(product.cost), 'bg-surface-container/60', 'text-on-surface'),
            inventoryMetricCard('Retail', formatCurrency(product.price), 'bg-surface-container/60', 'text-primary'),
            inventoryMetricCard('Margin', `${marginVal}%`, 'bg-secondary/5 border border-secondary/10', 'text-secondary')
        ].join('');
        const muteTitle = isMuted ? 'Show this item in stock alerts' : 'Hide this item from stock alerts';
        const muteIcon = isMuted ? 'notifications_off' : 'notifications';
        const muteClass = isMuted ? 'bg-surface-container text-on-surface-variant' : 'bg-yellow-50 text-yellow-700';
        const mutedBadge = isMuted ? '<span class="ml-2 px-2 py-0.5 rounded-full bg-surface-container text-[8px] font-black text-on-surface-variant uppercase align-middle">Alerts off</span>' : '';

        return `<div class="p-4 flex gap-3 ${isVisibleAlert ? 'low-stock-row' : ''}"><div class="flex-1 min-w-0"><h4 class="font-bold text-sm truncate uppercase">${escapeHTML(product.name)}${mutedBadge}</h4><p class="text-[10px] font-medium opacity-50 mb-3 tracking-tight">#${escapeHTML(product.barcode || '---')}</p><div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${metrics}</div></div><div class="flex flex-col gap-1.5 border-l pl-3 justify-center"><button onclick="openStockAdjust(${jsArg(product.id)})" class="w-9 h-9 flex items-center justify-center bg-secondary/10 text-secondary rounded-xl active-scale transition-all" title="Adjust Stock"><span class="material-symbols-outlined text-[20px]">move_item</span></button><button onclick="openProductModal(${jsArg(product.id)})" class="w-9 h-9 flex items-center justify-center bg-primary-container text-primary rounded-xl active-scale transition-all" title="Edit Product"><span class="material-symbols-outlined text-[20px]">edit</span></button><button onclick="toggleStockAlertMute(${jsArg(product.id)})" class="w-9 h-9 flex items-center justify-center ${muteClass} rounded-xl active-scale transition-all" title="${muteTitle}"><span class="material-symbols-outlined text-[20px]">${muteIcon}</span></button><button onclick="deleteProduct(${jsArg(product.id)})" class="w-9 h-9 flex items-center justify-center bg-error/10 text-error rounded-xl active-scale transition-all" title="Delete Product"><span class="material-symbols-outlined text-[20px]">delete</span></button></div></div>`;
    }

    function renderInventoryCategory(catKey, group, searchValue) {
        const isCollapsed = inventoryState.collapsedCategories[catKey] === true && String(searchValue || '').length === 0;
        // v8.1.1: Do not build every product row for collapsed categories.
        // This keeps Stock opening fast after PIN while preserving search/expanded views.
        const itemsHtml = isCollapsed ? '' : group.items.map(renderInventoryProductRow).join('');
        return `<div class="category-folder bg-surface border border-border-subtle rounded-3xl overflow-hidden shadow-sm h-fit ${isCollapsed ? 'collapsed' : ''}"><button onclick="toggleCategory(${jsArg(catKey)})" class="w-full px-5 py-4 bg-surface-container/50 flex justify-between items-center hover:bg-primary-container transition-colors"><div class="flex items-center gap-3 text-left"><span class="material-symbols-outlined text-primary/60 folder-icon">expand_more</span><div><h3 class="font-black text-xs text-primary uppercase tracking-wider">${escapeHTML(group.name)}</h3><p class="text-[9px] font-bold text-on-surface-variant/60 uppercase">${group.items.length} items</p></div></div></button><div class="category-content divide-y divide-border-subtle">${itemsHtml}</div></div>`;
    }

    function toggleCategory(cat) {
        inventoryState.collapsedCategories[cat] = !inventoryState.collapsedCategories[cat];
        renderInventory(getInventorySearchValue());
    }

    function renderInventory(f = '') {
        const list = document.getElementById('inventory-list');
        if (!list) return;

        const inventory = Array.isArray(state.inventory) ? state.inventory : [];
        const lowStockItems = inventory.filter(isStockAlertVisibleProduct);
        const lowStockAlert = document.getElementById('low-stock-alert');
        const lowStockText = document.getElementById('low-stock-alert-text');
        if (lowStockAlert) lowStockAlert.classList.toggle('hidden', lowStockItems.length === 0);
        if (lowStockText) lowStockText.innerText = `${lowStockItems.length} items are low on stock!`;

        const searchValue = String(f || '');
        if (typeof vc8046UpdateStockSearchClear === 'function') vc8046UpdateStockSearchClear();
        const filtered = inventory.filter(product => inventoryMatchesSearch(product, searchValue));
        if (filtered.length === 0) {
            list.innerHTML = inventoryEmptyStateHtml(inventory.length > 0);
            updateNotifBadge();
            return;
        }

        const groups = {};
        filtered.forEach(product => {
            const cat = inventoryCategoryKey(product);
            if (!groups[cat]) groups[cat] = { name: inventoryCategoryName(product), items: [] };
            groups[cat].items.push(product);
            if (inventoryState.collapsedCategories[cat] === undefined) inventoryState.collapsedCategories[cat] = true;
        });

        list.innerHTML = Object.keys(groups)
            .sort()
            .map(catKey => renderInventoryCategory(catKey, groups[catKey], searchValue))
            .join('');
        updateNotifBadge();
    }
