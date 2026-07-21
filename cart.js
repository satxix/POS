// --- Villacart Cart and Payment UI module ---
// v8.1.0: Extracted from app.js. Sale commit/write logic remains in app.js confirmSale().

    function handlePosSearch(val) {
        const container = document.getElementById('search-results-container');
        const grid = document.getElementById('product-grid');
        if (!val) { container.classList.add('hidden'); return; }
        const filtered = state.inventory.filter(p => p.name.toLowerCase().includes(val.toLowerCase()) || (p.barcode && p.barcode.includes(val)));
        if (filtered.length > 0) {
            container.classList.remove('hidden');
            grid.innerHTML = filtered.map(p => `<div class="py-3 px-2 border-b border-border-subtle last:border-0"><div class="flex items-center gap-2 mb-2"><h4 class="font-black text-sm text-on-surface">${escapeHTML(p.name)}</h4><span class="text-[8px] font-black uppercase bg-primary-container text-primary px-2 py-0.5 rounded-full">${escapeHTML(p.category || 'General')}</span></div><div class="flex gap-2"><button onclick="addToCart(${jsArg(p.id)}, 'piece')" class="flex-1 bg-surface-container py-2.5 px-3 text-left rounded-xl active-scale"><p class="text-[8px] uppercase font-bold opacity-50">Piece</p><p class="font-black text-xs text-primary">${formatCurrency(p.price)}</p></button>${p.packPrice ? `<button onclick="addToCart(${jsArg(p.id)}, 'pack')" class="flex-1 bg-secondary/5 py-2.5 px-3 text-left rounded-xl active-scale"><p class="text-[8px] uppercase font-bold text-secondary">Pack (${escapeHTML(p.packSize)})</p><p class="font-black text-xs text-secondary">${formatCurrency(p.packPrice)}</p></button>` : ''}</div></div>`).join('');
        } else { grid.innerHTML = '<div class="p-6 text-center text-xs opacity-50 font-bold uppercase tracking-wider">No matches found</div>'; }
    }

    function addToCart(id, type) {
        const p = state.inventory.find(i => i.id === id);
        if (!p) return;
        const cartId = `${id}-${type}`;
        const existing = state.cart.find(item => item.cartId === cartId);
        const deduct = type === 'pack' ? (parseInt(p.packSize) || 1) : 1;
        const currentQty = existing ? existing.qty : 0;
        if ((currentQty + 1) * deduct > (Number(p.stock) || 0)) {
            showToast(`Only ${p.stock} pcs available`, 'error');
            return;
        }
        if (existing) { existing.qty++; } else { state.cart.push({ cartId, id: p.id, name: p.name, type, price: type === 'pack' ? p.packPrice : p.price, cost: p.cost, deduct, qty: 1 }); }
        const searchInput = document.getElementById('pos-search'); if (searchInput) searchInput.value = '';
        const results = document.getElementById('search-results-container'); if (results) results.classList.add('hidden');
        sync();
        updateCartUI();
    }

    function getCartStockIssue() {
        return cartStockIssue(state.cart || [], state.inventory || []);
    }

    function getCartSubtotal() {
        return cartSubtotal(state.cart || []);
    }

    function getCartCount() {
        return cartCount(state.cart || []);
    }

    function getCartDiscount() {
        return cartDiscount(state.cart || [], state.cartDiscount);
    }

    function getCartTotal() {
        return cartTotal(state.cart || [], state.cartDiscount);
    }

    function setCartDiscount() {
        if (!state.cart || state.cart.length === 0) {
            showToast('Add an item before discounting', 'error');
            return;
        }
        const modal = document.getElementById('cart-discount-modal');
        const input = document.getElementById('discount-modal-input');
        const subtotalEl = document.getElementById('discount-modal-subtotal');
        if (subtotalEl) subtotalEl.innerText = formatCurrency(getCartSubtotal());
        if (input) input.value = getCartDiscount() > 0 ? String(getCartDiscount()) : '';
        updateCartDiscountPreview();
        if (modal) modal.classList.replace('hidden', 'flex');
    }

    function updateCartDiscountPreview() {
        const input = document.getElementById('discount-modal-input');
        const subtotal = getCartSubtotal();
        const raw = input ? String(input.value || '').trim() : '';
        const amount = raw === '' ? 0 : Number(raw);
        const discount = Number.isFinite(amount) && amount > 0 ? Math.min(amount, subtotal) : 0;
        const totalEl = document.getElementById('discount-modal-total');
        const subtotalEl = document.getElementById('discount-modal-subtotal');
        if (subtotalEl) subtotalEl.innerText = formatCurrency(subtotal);
        if (totalEl) totalEl.innerText = formatCurrency(Math.max(0, subtotal - discount));
    }

    function applyCartDiscount() {
        const input = document.getElementById('discount-modal-input');
        const raw = input ? String(input.value || '').trim() : '';
        const amount = raw === '' ? 0 : Number(raw);
        if (!Number.isFinite(amount) || amount < 0) {
            showToast('Invalid discount amount', 'error');
            return;
        }
        state.cartDiscount = Math.min(amount, getCartSubtotal());
        sync();
        updateCartUI();
        closeModal('cart-discount-modal');
        showToast(state.cartDiscount > 0 ? 'Discount applied' : 'Discount removed', 'success');
    }

    function removeCartDiscount() {
        state.cartDiscount = 0;
        sync();
        updateCartUI();
        closeModal('cart-discount-modal');
        showToast('Discount removed', 'success');
    }

    function resetCartDiscount() {
        state.cartDiscount = 0;
    }

    function updateCartUI() {
        const container = document.getElementById('cart-items');
        if (!container) return;
        const subtotalEl = document.getElementById('cart-subtotal');
        const totalEl = document.getElementById('cart-total');
        const discountRow = document.getElementById('cart-discount-row');
        const discountEl = document.getElementById('cart-discount');
        const discountBtn = document.getElementById('cart-discount-btn');
        const countPill = document.getElementById('cart-count-pill');
        if (countPill) countPill.innerText = String(getCartCount());
        if (state.cart.length === 0) {
            resetCartDiscount();
            container.innerHTML = `<div class="h-full flex flex-col items-center justify-center opacity-20 py-20"><span class="material-symbols-outlined text-[64px]">shopping_basket</span><p class="text-xs font-black uppercase mt-2 tracking-widest">Order is empty</p></div>`;
            if (subtotalEl) subtotalEl.innerText = '₱0.00';
            if (totalEl) totalEl.innerText = '₱0.00';
            if (discountRow) discountRow.classList.add('hidden');
            if (discountEl) discountEl.innerText = '-₱0.00';
            if (discountBtn) discountBtn.innerText = 'Add Discount';
            return;
        }
        container.innerHTML = state.cart.map((item, idx) => {
            const lineTotal = item.price * item.qty;
            return `<div class="bg-surface-container/50 border border-border-subtle p-4 rounded-2xl flex justify-between items-center shadow-sm"><div class="min-w-0 flex-1"><div class="flex items-center gap-2 mb-1.5"><span class="text-[8px] font-black ${item.type === 'pack' ? 'bg-secondary' : 'bg-primary'} text-white px-1.5 py-0.5 rounded uppercase tracking-tighter">${escapeHTML(item.type)}</span><h4 class="font-bold text-sm truncate">${escapeHTML(item.name)}</h4></div><p class="text-xs font-bold opacity-50">${formatCurrency(item.price)} each</p></div><div class="flex items-center gap-3"><span class="font-black text-base whitespace-nowrap">${formatCurrency(lineTotal)}</span><div class="flex items-center bg-white border border-border-subtle rounded-xl shadow-sm"><button onclick="updateQty(${idx}, -1)" class="w-9 h-9 flex items-center justify-center text-error active-scale"><span class="material-symbols-outlined text-[20px]">remove_circle</span></button><input type="number" inputmode="numeric" min="1" value="${item.qty}" onchange="setQty(${idx}, this.value)" class="w-10 text-center text-xs font-black border-0 bg-transparent focus:outline-none p-0" style="min-height:unset"/><button onclick="updateQty(${idx}, 1)" class="w-9 h-9 flex items-center justify-center text-secondary active-scale"><span class="material-symbols-outlined text-[20px]">add_circle</span></button></div></div></div>`;
        }).join('');
        const subtotal = getCartSubtotal();
        const discount = getCartDiscount();
        const total = getCartTotal();
        if (state.cartDiscount !== discount) state.cartDiscount = discount;
        if (subtotalEl) subtotalEl.innerText = formatCurrency(subtotal);
        if (totalEl) totalEl.innerText = formatCurrency(total);
        if (discountRow) discountRow.classList.toggle('hidden', discount <= 0);
        if (discountEl) discountEl.innerText = '-' + formatCurrency(discount);
        if (discountBtn) discountBtn.innerText = discount > 0 ? 'Edit Discount' : 'Add Discount';
    }

    function updateQty(idx, delta) {
        if (!state.cart[idx]) return;
        const nextQty = state.cart[idx].qty + delta;
        if (nextQty <= 0) { state.cart.splice(idx, 1); sync(); updateCartUI(); return; }
        const product = state.inventory.find(p => p.id === state.cart[idx].id);
        const available = product ? Number(product.stock) || 0 : 0;
        if (nextQty * (state.cart[idx].deduct || 1) > available) { showToast(`Only ${available} pcs available`, 'error'); return; }
        state.cart[idx].qty = nextQty;
        sync();
        updateCartUI();
    }
    function setQty(idx, val) {
        if (!state.cart[idx]) return;
        const n = parseInt(val);
        if (isNaN(n) || n < 1) { updateCartUI(); return; }
        const product = state.inventory.find(p => p.id === state.cart[idx].id);
        const available = product ? Number(product.stock) || 0 : 0;
        if (n * (state.cart[idx].deduct || 1) > available) { showToast(`Only ${available} pcs available`, 'error'); updateCartUI(); return; }
        state.cart[idx].qty = n;
        sync();
        updateCartUI();
    }
    
    function clearCart(event) { 
        if (document.activeElement) document.activeElement.blur();
        if (event) { event.preventDefault(); event.stopPropagation(); }
        if (state.cart.length === 0) return;
        if (!confirm('Clear all items from the cart?')) return;
        state.cart = [];
        resetCartDiscount();
        sync();
        updateCartUI(); 
    }

    function switchPayMode(mode) {
        currentPayMode = mode;
        const btnCash = document.getElementById('btn-pay-cash');
        const btnCredit = document.getElementById('btn-pay-credit');
        const cashArea = document.getElementById('cash-payment-area');
        const creditArea = document.getElementById('credit-payment-area');
        if (mode === 'cash') { btnCash.className = "flex-1 py-3 border-2 border-secondary bg-secondary text-white rounded-xl font-bold text-xs"; btnCredit.className = "flex-1 py-3 border-2 border-border-subtle text-on-surface-variant rounded-xl font-bold text-xs"; cashArea.classList.remove('hidden'); creditArea.classList.add('hidden'); }
        else { btnCredit.className = "flex-1 py-3 border-2 border-orange-600 bg-orange-600 text-white rounded-xl font-bold text-xs"; btnCash.className = "flex-1 py-3 border-2 border-border-subtle text-on-surface-variant rounded-xl font-bold text-xs"; creditArea.classList.remove('hidden'); cashArea.classList.add('hidden'); }
    }

    function resetReviewPaymentUi() {
        const cash = document.getElementById('cash-input');
        if (cash) {
            cash.value = '';
            cash.classList.remove('cash-input-highlight');
        }
        const customer = document.getElementById('credit-customer');
        if (customer) customer.value = '';
        document.querySelectorAll('.cash-quick-btn').forEach(btn => {
            btn.classList.remove('cash-selected');
            btn.setAttribute('aria-pressed', 'false');
        });
        const change = document.getElementById('change-display');
        if (change) {
            change.classList.add('hidden');
            change.classList.remove('change-ok', 'change-short', 'change-pulse');
        }
        const status = document.getElementById('change-status-label');
        if (status) status.innerText = 'Waiting for Payment';
        const amount = document.getElementById('change-amount');
        if (amount) amount.innerText = '₱0.00';
        const confirmBtn = document.getElementById('confirm-checkout');
        if (confirmBtn) {
            confirmBtn.classList.remove('bg-secondary');
            const label = confirmBtn.querySelector('span:last-child');
            if (label) label.innerText = 'Confirm Transaction';
        }
        if (typeof switchPayMode === 'function') switchPayMode('cash');
    }

    function openReview() { 
        if (document.activeElement) document.activeElement.blur();
        if (state.cart.length === 0) return; 
        const stockIssue = getCartStockIssue();
        if (stockIssue) { showToast(stockIssue, 'error'); return; }
        const total = getCartTotal(); 
        document.getElementById('rev-total').innerText = formatCurrency(total); 
        resetReviewPaymentUi();
        const modal = document.getElementById('review-modal'); 
        modal.classList.replace('hidden', 'flex'); 
    }

    function setCash(v) { document.getElementById('cash-input').value = v; calculateChange(); }
    function setExact() { const total = getCartTotal(); document.getElementById('cash-input').value = total; calculateChange(); }
    function calculateChange() {
        const total = getCartTotal();
        const cash = parseFloat(document.getElementById('cash-input').value) || 0;
        const changeDisplay = document.getElementById('change-display');
        if (cash >= total) { document.getElementById('change-amount').innerText = `₱${(cash - total).toLocaleString()}`; changeDisplay.classList.remove('hidden'); }
        else { changeDisplay.classList.add('hidden'); }
    }
