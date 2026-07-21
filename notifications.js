// --- Villacart Notifications UI module ---
// v8.0.58: Extracted from app.js. Display-only notification, low-stock ticker, and bell modal logic.

    function getLowStockDisplayItems(outLimit = 30, lowLimit = 30) {
        const inventory = Array.isArray(state.inventory) ? state.inventory : [];
        const lowStockItems = inventory
            .filter(isStockAlertVisibleProduct)
            .map(p => ({ ...p, stock: Number(p.stock) || 0 }));
        const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
        const outItems = lowStockItems
            .filter(p => p.stock <= 0)
            .sort(byName);
        const lowItems = lowStockItems
            .filter(p => p.stock > 0)
            .sort((a, b) => a.stock - b.stock || byName(a, b));
        const totalLimit = Math.max(0, Number(outLimit || 0) + Number(lowLimit || 0));
        const baseOutCount = Math.min(outItems.length, outLimit);
        const baseLowCount = Math.min(lowItems.length, lowLimit);
        const borrowedByLow = Math.max(0, outLimit - baseOutCount);
        const borrowedByOut = Math.max(0, lowLimit - baseLowCount);
        const shownOutCount = Math.min(outItems.length, baseOutCount + borrowedByOut);
        const shownLowCount = Math.min(lowItems.length, baseLowCount + borrowedByLow, totalLimit - shownOutCount);
        const shownOut = outItems.slice(0, shownOutCount);
        const shownLow = lowItems.slice(0, shownLowCount);
        const shown = [...shownOut, ...shownLow].slice(0, totalLimit);
        return { all: [...outItems, ...lowItems], shown, outItems, lowItems, shownOut, shownLow };
    }

    function renderHeaderLowStockTicker() {
        const ticker = document.getElementById('vc-lowstock-ticker');
        const label = document.getElementById('vc-lowstock-ticker-label');
        const track = document.getElementById('vc-lowstock-ticker-track');
        if (!ticker || !label || !track) return;
        const { all, shown } = getLowStockDisplayItems(30, 30);
        if (!all.length) {
            ticker.classList.add('hidden');
            track.innerHTML = '';
            return;
        }
        const outCount = all.filter(p => Number(p.stock) <= 0).length;
        const lowCount = all.length - outCount;
        label.textContent = outCount ? `OUT ${outCount} · LOW ${lowCount}` : `LOW ${lowCount}`;

        const parts = [];
        const outShown = shown.filter(p => Number(p.stock) <= 0);
        const lowShown = shown.filter(p => Number(p.stock) > 0);
        outShown.forEach(p => parts.push(`<span class="vc-lowstock-chip out"><span class="vc-lowstock-name">${escapeHTML(p.name || 'Unnamed')}</span><span>OUT</span></span>`));
        lowShown.forEach(p => parts.push(`<span class="vc-lowstock-chip low"><span class="vc-lowstock-name">${escapeHTML(p.name || 'Unnamed')}</span><span>${escapeHTML(p.stock)} left</span></span>`));
        if (all.length > shown.length) parts.push(`<span class="vc-lowstock-chip more">+${all.length - shown.length} more</span>`);

        track.innerHTML = parts.join('<span class="vc-lowstock-sep">•</span>');
        ticker.classList.remove('hidden');
    }

    function notificationOpenCredits() {
        const tx = typeof vc710AllTransactionsForLocalViews === 'function'
            ? vc710AllTransactionsForLocalViews()
            : (Array.isArray(state.transactions) ? state.transactions : []);
        if (window.VillacartCreditUtils && typeof window.VillacartCreditUtils.openCredits === 'function') {
            return window.VillacartCreditUtils.openCredits(tx);
        }
        return tx.filter(t => t && t.type === 'CR' && !t.paid && !t.settled);
    }

    function updateNotifBadge() {
        const lowStockItems = state.inventory.filter(isStockAlertVisibleProduct);
        const openCredits = notificationOpenCredits();
        const dot = document.getElementById('notif-dot');
        if (dot) dot.classList.toggle('hidden', lowStockItems.length === 0 && openCredits.length === 0);
        renderHeaderLowStockTicker();
    }

    function showNotifications() {
        const lowStockItems = state.inventory
            .filter(isStockAlertVisibleProduct)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true }));
        const pendingCredits = notificationOpenCredits();
        const list = document.getElementById('notif-list');
        let html = '';
        if (lowStockItems.length > 0) {
            html += `<div class="p-3 bg-yellow-50"><p class="text-[9px] font-black uppercase text-yellow-700 mb-2 tracking-wider">Low Stock (${lowStockItems.length})</p>` +
                lowStockItems.map(p => `<div class="flex justify-between items-center py-1.5"><span class="text-xs font-bold truncate">${escapeHTML(p.name || 'Unnamed')}</span><span class="text-[10px] font-black text-error ml-2">${escapeHTML(p.stock)} left</span></div>`).join('') + '</div>';
        }
        if (pendingCredits.length > 0) {
            const total = pendingCredits.reduce((a, b) => a + (Number(b.total) || 0), 0);
            html += `<div class="p-3"><p class="text-[9px] font-black uppercase text-orange-600 mb-2 tracking-wider">Pending Credits (${pendingCredits.length})</p><p class="text-xs font-black text-on-surface">Total outstanding: ${formatCurrency(total)}</p></div>`;
        }
        if (!html) html = '<div class="p-6 text-center text-xs opacity-40 font-bold uppercase">All clear — nothing to report!</div>';
        list.innerHTML = html;
        document.getElementById('notif-panel').classList.replace('hidden', 'flex');
    }
