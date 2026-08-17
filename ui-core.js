// --- Villacart Core UI module ---
// v8.1.5: Extracted from app.js. Depends on app.js globals; loaded after app.js.

    function attemptInventoryAccess() {
        const inventoryScreen = document.getElementById('screen-inventory');
        if (inventoryScreen && !inventoryScreen.classList.contains('hidden')) {
            switchScreen('inventory');
            return;
        }
        if (typeof isStockPinRequired === 'function' && !isStockPinRequired()) {
            switchScreen('inventory');
            return;
        }
        openPinModal("inventory");
    }

    function openPinModal(target) { pinBuffer = ""; updatePinDots(); const modal = document.getElementById('pin-modal'); modal.classList.replace('hidden', 'flex'); window._pinTarget = target; }
    function pressPin(num) { if (pinBuffer.length < 4) { pinBuffer += num; updatePinDots(); if (pinBuffer.length === 4) setTimeout(validatePin, 150); } }
    function updatePinDots() { for (let i = 0; i < 4; i++) { const dot = document.getElementById(`dot-${i}`); if (dot) dot.classList.toggle('bg-primary', i < pinBuffer.length); } }
    function validatePin() { 
        hashPin(pinBuffer).then(hash => {
            if (hash === STORED_PIN_HASH) { 
                const target = window._pinTarget; 
                closeModal('pin-modal'); 
                if (target === 'inventory') switchScreen('inventory'); 
                else if (target === 'change-pin') openChangePinModal();
                else if (target && target.action === 'delete') deleteTransaction(target.id); 
                showToast('Verified', 'success'); 
            } else { 
                showToast('Incorrect PIN', 'error'); 
                pinBuffer = ""; 
                updatePinDots(); 
            }
        });
    }
    function clearPin() { pinBuffer = ""; updatePinDots(); }

    function togglePackFields() { const packFields = document.getElementById('pack-fields'); const hasPack = document.getElementById('p-has-pack'); if (packFields && hasPack) { if (hasPack.checked) { packFields.classList.remove('hidden'); packFields.classList.add('grid'); } else { packFields.classList.add('hidden'); packFields.classList.remove('grid'); } } }
    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.replace('flex', 'hidden');
        if (id === 'review-modal' && typeof resetReviewPaymentUi === 'function') resetReviewPaymentUi();
        if (id === 'product-modal') stopInvScanner();
    }

    // v8.3.27: Reliable replacement for window.confirm(). Native confirm()
    // dialogs can silently resolve to false on some installed-PWA WebViews
    // even when the user taps OK, which made confirm()-gated actions like
    // payFullBalance() appear to silently do nothing with no error. This
    // renders an in-app modal and resolves a Promise<boolean> instead.
    function vcConfirm(message, title) {
        return new Promise(resolve => {
            const modal = document.getElementById('vc-confirm-modal');
            if (!modal) { resolve(window.confirm(message)); return; }
            const titleEl = document.getElementById('vc-confirm-title');
            const msgEl = document.getElementById('vc-confirm-message');
            const okBtn = document.getElementById('vc-confirm-ok');
            const cancelBtn = document.getElementById('vc-confirm-cancel');
            if (titleEl) titleEl.innerText = title || 'Please Confirm';
            if (msgEl) msgEl.innerText = message || '';
            const cleanup = (result) => {
                modal.classList.replace('flex', 'hidden');
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                resolve(result);
            };
            const onOk = () => cleanup(true);
            const onCancel = () => cleanup(false);
            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            modal.classList.replace('hidden', 'flex');
        });
    }
    window.vcConfirm = vcConfirm;
    function showToast(m, t = 'info') { const c = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `p-3 px-4 rounded-xl shadow-lg flex items-center gap-2 text-white text-xs font-bold transition-all duration-300 transform translate-x-10 opacity-0 z-[300] ${t === 'success' ? 'bg-secondary' : t === 'error' ? 'bg-error' : 'bg-primary'}`; toast.innerHTML = `<span class="material-symbols-outlined text-[16px]">${t === 'success' ? 'check_circle' : 'info'}</span><span>${escapeHTML(m)}</span>`; c.appendChild(toast); requestAnimationFrame(() => toast.classList.remove('translate-x-10', 'opacity-0')); setTimeout(() => { toast.classList.add('opacity-0', 'translate-x-full'); setTimeout(() => toast.remove(), 300); }, 2500); }
