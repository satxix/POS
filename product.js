// Product add/edit/delete helpers extracted from app.js in v8.1.6.
// Depends on app globals: state, saveState, queueAction, sync, renderInventory, renderFavorites, showToast, closeModal, togglePackFields, vc7227NormalizeBarcode.

function createProductId() {
    // Always create a fresh product id. A previous build accidentally
    // froze this value, which could make new stock items overwrite each other.
    let id = '';
    do {
        const random = Math.random().toString(36).slice(2, 8);
        id = `${Date.now()}-${random}`;
    } while ((state.inventory || []).some(item => item && item.id === id));
    return id;
}

function openProductModal(id = null) {
    window._editId = id; const p = id ? state.inventory.find(i => i.id === id) : null;
    document.getElementById('p-barcode').value = p ? p.barcode : ''; document.getElementById('p-name').value = p ? p.name : '';
    document.getElementById('p-category').value = p ? p.category : ''; document.getElementById('p-cost').value = p ? p.cost : '';
    document.getElementById('p-price').value = p ? p.price : ''; document.getElementById('p-stock').value = p ? p.stock : '';
    document.getElementById('p-low-stock').value = p ? (p.lowStock !== undefined ? p.lowStock : 5) : 5;
    document.getElementById('p-has-pack').checked = p && !!p.packPrice; document.getElementById('p-pack-size').value = p ? p.packSize : '';
    document.getElementById('p-pack-price').value = p ? p.packPrice : ''; togglePackFields();
    document.getElementById('product-modal-title').innerText = id ? "Edit Product" : "Add New Product";
    document.getElementById('product-modal').classList.replace('hidden', 'flex');
}

function saveProduct() {
    const name = document.getElementById('p-name').value; if (!name) { showToast('Product name is required', 'error'); return; }
    const barcodeValue = vc7227NormalizeBarcode(document.getElementById('p-barcode').value || '');
    if (barcodeValue) {
        const duplicate = state.inventory.find(p => p && p.id !== window._editId && vc7227NormalizeBarcode(p.barcode || '') === barcodeValue);
        if (duplicate) {
            const message = 'Barcode ' + barcodeValue + ' is already used by "' + (duplicate.name || 'another product') + '". Save anyway?';
            if (!window.confirm(message)) {
                showToast('Product not saved: duplicate barcode', 'error');
                return;
            }
        }
    }
    const hasPack = document.getElementById('p-has-pack').checked;
    const cost = parseFloat(document.getElementById('p-cost').value) || 0;
    const price = parseFloat(document.getElementById('p-price').value) || 0;
    const stock = parseInt(document.getElementById('p-stock').value) || 0;
    const lowStock = parseInt(document.getElementById('p-low-stock').value) || 5;
    const packPrice = hasPack ? parseFloat(document.getElementById('p-pack-price').value) : null;
    const packSize = hasPack ? parseInt(document.getElementById('p-pack-size').value) : null;
    if (cost < 0 || price < 0 || stock < 0 || lowStock < 0 || (hasPack && ((packPrice || 0) <= 0 || (packSize || 0) <= 1))) {
        showToast('Check product prices, stock, and pack values', 'error');
        return;
    }
    const productId = window._editId || createProductId();
    const data = { id: productId, barcode: barcodeValue, name: name.trim(), category: document.getElementById('p-category').value.trim(), cost, price, stock, lowStock, packPrice, packSize, _offline: true };

    // Save locally first and let the persistent queue deliver it.  Waiting
    // for a direct Firestore request here made the button look broken when
    // a request was pending (or the browser was briefly offline).
    if (window._editId) {
        const idx = state.inventory.findIndex(i => i.id === window._editId);
        if (idx !== -1) state.inventory[idx] = data;
        else state.inventory.push(data);
    } else {
        state.inventory.push(data);
    }
    queueAction('update', 'inventory', data);
    sync();
    renderInventory();
    if (typeof renderFavorites === 'function') renderFavorites();
    closeModal('product-modal');
    showToast(navigator.onLine ? 'Product Saved' : 'Product saved locally; waiting to sync', 'success');
}

function deleteProduct(id) { 
    const p = state.inventory.find(i => i.id === id);
    if (!p) return;
    const txCount = state.transactions.filter(t => t.items && t.items.some(item => item.id === id)).length;
    const warning = txCount > 0 ? `\n\nWarning: This product appears in ${txCount} past transaction(s). Those records will show missing item names.` : '';
    if (confirm(`Delete "${p.name}"?${warning}`)) { 
        state.inventory = state.inventory.filter(i => i.id !== id); 
        queueAction('delete', 'inventory', { id }); 
        sync(); renderInventory(); if (typeof renderFavorites === 'function') renderFavorites(); showToast('Product Deleted', 'info'); 
    } 
}
