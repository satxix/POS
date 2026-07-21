// Inventory stock adjustment and CSV export extracted from app.js in v8.1.9.
// Depends on app globals: state, queueAction, sync, renderInventory, renderFavorites, showToast.

// --- Stock Adjustment ---
function openStockAdjust(id) {
    const p = state.inventory.find(i => i.id === id);
    if (!p) return;
    const qty = prompt(`Adjust stock for "${p.name}"\nCurrent stock: ${p.stock}\n\nEnter amount to ADD (positive) or DEDUCT (negative):`);
    if (qty === null || qty === '') return;
    const delta = parseInt(qty);
    if (isNaN(delta)) { showToast('Invalid quantity', 'error'); return; }
    p.stock = Math.max(0, p.stock + delta);
    p._offline = true;
    queueAction('update', 'inventory', p);
    sync(); renderInventory();
    if (typeof renderFavorites === 'function') renderFavorites();
    showToast(`Stock ${delta >= 0 ? 'added' : 'deducted'}: ${Math.abs(delta)} pcs`, 'success');
}

// --- Inventory CSV Export ---
function exportInventoryCSV() {
    if (state.inventory.length === 0) { showToast('No inventory to export', 'error'); return; }
    const rows = ["Name,Barcode,Category,Cost,Price,Stock,PackSize,PackPrice",
        ...state.inventory.map(p => `"${p.name}",${p.barcode || ''},${p.category || ''},${p.cost || 0},${p.price || 0},${p.stock || 0},${p.packSize || ''},${p.packPrice || ''}`)
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = 'Villacart_Inventory.csv'; link.click();
    showToast('Inventory exported', 'success');
}
