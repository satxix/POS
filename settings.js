// PIN/settings helpers extracted from app.js in v8.1.7.
// Depends on app globals: hashPin, STORED_PIN_HASH, PIN_KEY, closeModal, showToast.

const STOCK_PIN_REQUIRED_KEY = 'villacart_stock_pin_required';

function isStockPinRequired() {
    return localStorage.getItem(STOCK_PIN_REQUIRED_KEY) !== 'false';
}

function updateStockPinToggle() {
    const required = isStockPinRequired();
    const button = document.getElementById('stock-pin-toggle');
    const icon = document.getElementById('stock-pin-toggle-icon');
    const label = document.getElementById('stock-pin-toggle-label');
    if (!button) return;

    button.setAttribute('aria-pressed', required ? 'true' : 'false');
    button.title = required
        ? 'Stock PIN is required on this device'
        : 'Stock PIN is off on this device';
    button.classList.toggle('bg-primary/10', required);
    button.classList.toggle('text-primary', required);
    button.classList.toggle('bg-secondary/10', !required);
    button.classList.toggle('text-secondary', !required);
    if (icon) icon.textContent = required ? 'lock' : 'lock_open';
    if (label) label.textContent = required ? 'Stock PIN: On' : 'Stock PIN: Off';
}

function toggleStockPinRequirement() {
    const required = !isStockPinRequired();
    localStorage.setItem(STOCK_PIN_REQUIRED_KEY, required ? 'true' : 'false');
    updateStockPinToggle();
    showToast(
        required
            ? 'Stock PIN required on this device'
            : 'Stock PIN turned off on this device',
        'success'
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateStockPinToggle, { once: true });
} else {
    updateStockPinToggle();
}

// --- Change PIN Logic ---
let newPinBuffer = '';
let newPinConfirmBuffer = '';
let newPinStage = 'enter'; // 'enter' or 'confirm'

function openChangePinModal() {
    newPinBuffer = ''; newPinConfirmBuffer = ''; newPinStage = 'enter';
    document.getElementById('change-pin-msg').innerText = 'Enter your new 4-digit PIN';
    updateNewPinDots('');
    closeModal('change-pin-modal');
    document.getElementById('change-pin-modal').classList.replace('hidden', 'flex');
}

function pressNewPin(num) {
    if (newPinStage === 'enter') {
        if (newPinBuffer.length < 4) { newPinBuffer += num; updateNewPinDots(newPinBuffer); if (newPinBuffer.length === 4) setTimeout(advanceNewPin, 150); }
    } else {
        if (newPinConfirmBuffer.length < 4) { newPinConfirmBuffer += num; updateNewPinDots(newPinConfirmBuffer); if (newPinConfirmBuffer.length === 4) setTimeout(confirmNewPin, 150); }
    }
}

function clearNewPin() {
    if (newPinStage === 'enter') { newPinBuffer = ''; updateNewPinDots(''); }
    else { newPinConfirmBuffer = ''; updateNewPinDots(''); }
}

function updateNewPinDots(buf) {
    for (let i = 0; i < 4; i++) {
        const dot = document.getElementById(`new-dot-${i}`);
        if (dot) dot.classList.toggle('bg-primary', i < buf.length);
    }
}

function advanceNewPin() {
    newPinStage = 'confirm';
    document.getElementById('change-pin-msg').innerText = 'Confirm your new PIN';
    updateNewPinDots('');
}

function confirmNewPin() {
    if (newPinBuffer === newPinConfirmBuffer) {
        hashPin(newPinBuffer).then(hash => {
            STORED_PIN_HASH = hash;
            localStorage.setItem(PIN_KEY, hash);
            closeModal('change-pin-modal');
            showToast('PIN changed successfully', 'success');
        });
    } else {
        showToast('PINs do not match', 'error');
        newPinBuffer = ''; newPinConfirmBuffer = ''; newPinStage = 'enter';
        document.getElementById('change-pin-msg').innerText = 'Enter your new 4-digit PIN';
        updateNewPinDots('');
    }
}
