// POS and Stock camera scanner helpers extracted from app.js in v8.2.6.
// Physical/HID barcode scanner routing remains in app.js/scanner.js.
// Depends on app globals at use time: Quagga, showToast, vc7226LooksLikeBarcode, handlePhysicalScan.

// v8.2.6: Terminal camera scanner removed. Physical/HID scanner remains active on Terminal.

// v8.2.6: Change PIN helpers moved to settings.js.

// v8.2.6: Inventory stock adjustment/export moved to inventory-actions.js.

let invScannerRunning = false;

function startInvScanner() {
    const container = document.getElementById('scanner-preview-container');
    const camArea = document.getElementById('inv-cam-area');
    if (!container || !camArea) return;

    // Show the preview container
    container.classList.remove('hidden');
    camArea.innerHTML = '';

    if (invScannerRunning) return;
    invScannerRunning = true;

    Quagga.init({
        inputStream: {
            type: 'LiveStream',
            target: camArea,
            constraints: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        },
        locator: { patchSize: 'medium', halfSample: true },
        numOfWorkers: navigator.hardwareConcurrency || 2,
        decoder: {
            readers: [
                'ean_reader', 'ean_8_reader', 'code_128_reader',
                'code_39_reader', 'upc_reader', 'upc_e_reader',
                'codabar_reader', 'i2of5_reader'
            ]
        },
        locate: true
    }, function(err) {
        if (err) {
            invScannerRunning = false;
            container.classList.add('hidden');
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showToast('Camera permission denied', 'error');
            } else if (err.name === 'NotFoundError') {
                showToast('No camera found', 'error');
            } else {
                showToast('Camera error: ' + (err.message || err), 'error');
            }
            return;
        }
        Quagga.start();
        showToast('Scanner active — aim at barcode', 'success');
    });

    let lastScanned = '';
    let lastScannedTime = 0;

    Quagga.onDetected(function(result) {
        const code = result.codeResult.code;
        const now = Date.now();
        // Debounce: ignore same code within 2 seconds
        if (code === lastScanned && now - lastScannedTime < 2000) return;
        lastScanned = code;
        lastScannedTime = now;

        const barcodeField = document.getElementById('p-barcode');
        if (barcodeField) {
            barcodeField.value = code;
            showToast('Barcode scanned: ' + code, 'success');
        }
        stopInvScanner();
    });
}

function stopInvScanner() {
    if (!invScannerRunning) return;
    try { Quagga.stop(); } catch(e) {}
    invScannerRunning = false;
    const container = document.getElementById('scanner-preview-container');
    const camArea = document.getElementById('inv-cam-area');
    if (container) container.classList.add('hidden');
    if (camArea) camArea.innerHTML = '';
}
