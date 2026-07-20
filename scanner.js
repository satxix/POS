// Villacart POS scanner helper utilities
(function(window) {
    'use strict';

    function vc7226LooksLikeBarcode(value) {
        const text = String(value || '').trim();
        return text.length >= 3 && /^[0-9A-Za-z._-]+$/.test(text);
    }

    function vc7227NormalizeBarcode(value) {
        return String(value == null ? '' : value).trim().replace(/s+/g, '');
    }

    function vc7228ScannerDebug(type, data) {
        try {
            const dbg = window.__villacartScannerDebug;
            if (!dbg || !Array.isArray(dbg.events)) return;
            const entry = {
                at: new Date().toISOString(),
                type,
                ...(data || {})
            };
            dbg.events.push(entry);
            if (dbg.events.length > 25) dbg.events.shift();
        } catch(e) {}
    }

    function vc7228RecentlyHandled(code) {
        const dbg = window.__villacartScannerDebug;
        const clean = vc7227NormalizeBarcode(code);
        return !!(dbg && dbg.lastBarcodeAttempt === clean && dbg.lastHandledAt && Date.now() - dbg.lastHandledAt < 900);
    }

    function vc7228MarkHandled(code, result) {
        try {
            const dbg = window.__villacartScannerDebug;
            if (!dbg) return;
            dbg.lastBarcodeAttempt = vc7227NormalizeBarcode(code);
            dbg.lastBarcodeResult = result || '';
            dbg.lastHandledAt = Date.now();
            vc7228ScannerDebug('handled', { code: dbg.lastBarcodeAttempt, result: dbg.lastBarcodeResult });
        } catch(e) {}
    }

    const api = Object.freeze({
        vc7226LooksLikeBarcode,
        vc7227NormalizeBarcode,
        vc7228ScannerDebug,
        vc7228RecentlyHandled,
        vc7228MarkHandled
    });

    window.VillacartScanner = api;
    Object.assign(window, api);
})(window);
