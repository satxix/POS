// Payment modal UI polish extracted from app.js in v8.2.8.
// Handles cash quick-button selection and change/balance display only.
// Depends on cart.js globals at load time: setCash, setExact, calculateChange.

// v5.6.1 Cash amount selection polish
function markCashQuickAmount(value) {
    document.querySelectorAll('.cash-quick-btn').forEach(btn => {
        const isSelected = String(btn.dataset.cash) === String(value);
        btn.classList.toggle('cash-selected', isSelected);
        btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
    const cashInput = document.getElementById('cash-input');
    if (cashInput) cashInput.classList.toggle('cash-input-highlight', !!value);
}

const vcOriginalSetCash = typeof setCash === 'function' ? setCash : null;
if (vcOriginalSetCash && !window.__vcSetCashPatched) {
    window.__vcSetCashPatched = true;
    setCash = function(amount) {
        vcOriginalSetCash(amount);
        markCashQuickAmount(amount);
    };
}

const vcOriginalSetExact = typeof setExact === 'function' ? setExact : null;
if (vcOriginalSetExact && !window.__vcSetExactPatched) {
    window.__vcSetExactPatched = true;
    setExact = function() {
        vcOriginalSetExact();
        markCashQuickAmount('exact');
    };
}

document.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'cash-input') {
        document.querySelectorAll('.cash-quick-btn').forEach(btn => {
            btn.classList.remove('cash-selected');
            btn.setAttribute('aria-pressed', 'false');
        });
        event.target.classList.toggle('cash-input-highlight', event.target.value !== '');
    }
});


// v5.6.1 Change display polish
function polishChangeDisplay() {
    const totalEl = document.getElementById('rev-total');
    const cashEl = document.getElementById('cash-input');
    const changeDisplay = document.getElementById('change-display');
    const changeAmount = document.getElementById('change-amount');
    const statusLabel = document.getElementById('change-status-label');
    const confirmBtn = document.getElementById('confirm-checkout');
    if (!cashEl || !changeDisplay || !changeAmount) return;

    const payableText = totalEl ? totalEl.innerText.replace(/[₱,\s]/g, '') : '0';
    const total = parseFloat(payableText) || 0;
    const cash = parseFloat(cashEl.value) || 0;
    const diff = cash - total;

    changeDisplay.classList.remove('change-ok', 'change-short', 'change-pulse');
    void changeDisplay.offsetWidth;
    changeDisplay.classList.add('change-pulse');

    if (!cashEl.value) {
        if (statusLabel) statusLabel.innerText = 'Waiting for Payment';
        changeAmount.innerText = '₱0.00';
        if (confirmBtn) {
            confirmBtn.classList.remove('bg-secondary');
            confirmBtn.querySelector('span:last-child').innerText = 'Confirm Transaction';
        }
        return;
    }

    if (diff >= 0) {
        changeDisplay.classList.add('change-ok');
        if (statusLabel) statusLabel.innerText = 'Change to Give';
        changeAmount.innerText = `₱${diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (confirmBtn) {
            confirmBtn.classList.add('bg-secondary');
            const label = confirmBtn.querySelector('span:last-child');
            if (label) label.innerText = 'Complete Sale';
        }
    } else {
        changeDisplay.classList.add('change-short');
        if (statusLabel) statusLabel.innerText = 'Balance Remaining';
        changeAmount.innerText = `₱${Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (confirmBtn) {
            confirmBtn.classList.remove('bg-secondary');
            const label = confirmBtn.querySelector('span:last-child');
            if (label) label.innerText = 'Confirm Transaction';
        }
    }
}

const vcOriginalCalculateChange = typeof calculateChange === 'function' ? calculateChange : null;
if (vcOriginalCalculateChange && !window.__vcCalculateChangePatched) {
    window.__vcCalculateChangePatched = true;
    calculateChange = function() {
        vcOriginalCalculateChange();
        polishChangeDisplay();
    };
}

document.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'cash-input') {
        setTimeout(polishChangeDisplay, 0);
    }
});
