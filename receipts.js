(function(window) {
    'use strict';

    function thermalMoney(value) {
        const n = Number(value) || 0;
        const formatted = n.toLocaleString(undefined, {
            minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
            maximumFractionDigits: 2
        });
        // Use plain P for print clarity. Some budget ESC/POS drivers render the peso sign unevenly.
        return 'P' + formatted;
    }



    function thermalCleanText(text) {
        return String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    }



    function thermalFit(text, width) {
        const clean = thermalCleanText(text);
        if (clean.length <= width) return clean;
        if (width <= 3) return clean.slice(0, width);
        return clean.slice(0, width - 3) + '...';
    }



    function thermalLine(width = 32) {
        return '-'.repeat(width);
    }



    function thermalCenter(text, width = 32) {
        const clean = thermalFit(text, width);
        const left = Math.max(0, Math.floor((width - clean.length) / 2));
        return ' '.repeat(left) + clean;
    }



    function thermalRow(left, right, width = 32) {
        const r = thermalCleanText(right);
        const leftWidth = Math.max(1, width - r.length - 1);
        const l = thermalFit(left, leftWidth);
        return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
    }



    function thermalItemRows(name, qty, amount, width = 34) {
        // XP210/Open ESC-POS direct intent: bigger readable text with safe columns.
        // 34 columns keeps prices visible while making the font easier to read.
        const itemWidth = 16;
        const qtyWidth = 4;
        const priceWidth = width - itemWidth - qtyWidth;
        const cleanName = thermalCleanText(name) || 'Item';
        const line = thermalFit(cleanName, itemWidth).padEnd(itemWidth) +
            thermalFit(qty, qtyWidth).padStart(qtyWidth) +
            thermalFit(amount, priceWidth).padStart(priceWidth);
        return [line];
    }



    function buildThermalReceiptText(tx) {
        const width = 34;
        const lines = [];
        const isSettlement = tx && tx.notes && tx.notes.includes('CR-') && tx.type === 'SA';
        const title = isSettlement ? 'CREDIT PAYMENT' : (tx && tx.type === 'EX' ? 'EXPENSE RECORD' : 'OFFICIAL RECEIPT');
        const txDate = tx && tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : new Date().toLocaleDateString();

        lines.push(thermalCenter('VILLACART', width));
        lines.push(thermalCenter('Balagtas BMA San Rafael, Bulacan', width));
        lines.push(thermalLine(width));
        lines.push(thermalCenter(title, width));
        lines.push(thermalLine(width));
        lines.push(thermalRow('Date:', txDate, width));
        if (tx && tx.id) lines.push(thermalRow('Trans #:', tx.id, width));
        if (tx && tx.customer) lines.push(thermalRow('Customer:', tx.customer, width));
        lines.push(thermalLine(width));

        if (isSettlement) {
            lines.push('Settlement Breakdown');
            if (tx.items && tx.items.length) {
                tx.items.forEach(item => {
                    thermalItemRows(item.name, item.qty, thermalMoney(Number(item.price) * Number(item.qty)), width).forEach(line => lines.push(line));
                });
            } else if (tx.notes) {
                lines.push(thermalFit('Settled: ' + tx.notes, width));
            }
            lines.push(thermalLine(width));
            lines.push(thermalRow('TOTAL PAID:', thermalMoney(tx.total), width));
        } else if (tx && tx.items && tx.items.length) {
            lines.push('Item'.padEnd(16) + 'Qty'.padStart(4) + 'Price'.padStart(14));
            lines.push(thermalLine(width));
            tx.items.forEach(item => {
                const qty = Number(item.qty) || 0;
                const lineTotal = Number(item.price || 0) * qty;
                thermalItemRows(item.name, qty, thermalMoney(lineTotal), width).forEach(line => lines.push(line));
            });
            lines.push(thermalLine(width));
            const discount = Number(tx.discount) || 0;
            if (discount > 0) {
                const subtotal = Number(tx.subtotal) || (Number(tx.total) + discount);
                lines.push(thermalRow('Subtotal:', thermalMoney(subtotal), width));
                lines.push(thermalRow('Discount:', '-' + thermalMoney(discount), width));
            }
            lines.push(thermalRow('TOTAL:', thermalMoney(tx.total), width));
            if (tx.type === 'SA') {
                lines.push(thermalRow('Cash Received:', thermalMoney(tx.cashReceived || 0), width));
                lines.push(thermalRow('Change:', thermalMoney(tx.change || 0), width));
            } else if (tx.type === 'CR') {
                lines.push(thermalRow('Payment:', 'CREDIT', width));
            }
        } else {
            lines.push(thermalFit((tx && (tx.desc || tx.notes)) || 'Transaction', width));
            lines.push(thermalLine(width));
            lines.push(thermalRow('TOTAL:', thermalMoney(tx ? tx.total : 0), width));
        }

        lines.push(thermalLine(width));
        lines.push(thermalCenter('THANK YOU!', width));
        lines.push(thermalCenter('Please come again.', width));
        lines.push('');
        return lines.join('\n');
    }




    const { escapeHTML } = window.VillacartUtils || {};

    function isAndroidRuntime() {
        return /Android/i.test(navigator.userAgent || '');
    }



    async function gzipBase64String(text) {
        if (typeof CompressionStream === 'undefined') {
            throw new Error('CompressionStream not available');
        }
        const stream = new Blob([text], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
        const buffer = await new Response(stream).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }



    function buildOpenEscposIntentHtml(receiptText, receiptTitle) {
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(receiptTitle || 'Villacart Receipt')}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: 72mm; max-width: 72mm; }
pre {
  margin: 0;
  padding: 2mm 1mm 5mm 1mm;
  width: 70mm;
  max-width: 70mm;
  color: #000;
  background: #fff;
  font-family: monospace;
  font-size: 15px;
  line-height: 1.2;
  font-weight: 900;
  white-space: pre;
  overflow: visible;
}
</style>
</head>
<body><pre>${escapeHTML(receiptText)}</pre></body>
</html>`;
    }



    window.VillacartReceipts = Object.freeze({
        thermalMoney,
        thermalCleanText,
        thermalFit,
        thermalLine,
        thermalCenter,
        thermalRow,
        thermalItemRows,
        buildThermalReceiptText,
        isAndroidRuntime,
        gzipBase64String,
        buildOpenEscposIntentHtml
    });
})(window);
