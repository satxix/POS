// --- Villacart Receipt UI module ---
// v8.1.1: Extracted from app.js. Print behavior is intentionally unchanged.

    let vc8044ReceiptPrintBusy = false;
    let vc8044ReceiptPrintResetTimer = null;

    function vc8044SetReceiptPrintBusy(isBusy) {
        vc8044ReceiptPrintBusy = !!isBusy;
        const buttons = document.querySelectorAll('button[onclick="printThermalReceipt()"]');
        buttons.forEach(btn => {
            if (!btn.dataset.originalPrintHtml) btn.dataset.originalPrintHtml = btn.innerHTML;
            btn.disabled = vc8044ReceiptPrintBusy;
            btn.classList.toggle('opacity-70', vc8044ReceiptPrintBusy);
            btn.classList.toggle('pointer-events-none', vc8044ReceiptPrintBusy);
            btn.innerHTML = vc8044ReceiptPrintBusy
                ? '<span class="material-symbols-outlined text-[20px] animate-spin-custom">sync</span> Preparing...'
                : btn.dataset.originalPrintHtml;
        });
    }

    function vc8044ScheduleReceiptPrintReset(delay = 4500) {
        if (vc8044ReceiptPrintResetTimer) clearTimeout(vc8044ReceiptPrintResetTimer);
        vc8044ReceiptPrintResetTimer = setTimeout(() => {
            vc8044ReceiptPrintResetTimer = null;
            vc8044SetReceiptPrintBusy(false);
        }, delay);
    }

    async function printWithOpenEscposIntent(receiptText, receiptTitle) {
        if (!isAndroidRuntime()) return false;
        const html = buildOpenEscposIntentHtml(receiptText, receiptTitle);
        const payload = JSON.stringify([html]);
        const encoded = encodeURIComponent(await gzipBase64String(payload));
        const intentUrl = `intent://#Intent;scheme=print-intent;S.content=${encoded};end`;
        window.__villacartPrintIntentAt = Date.now();
        if (typeof vcStartupMark === 'function') vcStartupMark('print-intent-opened');
        window.location.href = intentUrl;
        return true;
    }

    async function printThermalReceipt() {
        if (vc8044ReceiptPrintBusy) {
            if (typeof showToast === 'function') showToast('Print is already preparing...', 'info');
            return;
        }
        vc8044SetReceiptPrintBusy(true);
        vc8044ScheduleReceiptPrintReset();
        const tx = (state.transactions || []).find(t => t.id === lastTransactionId) || (state.archiveTransactions || []).find(t => t.id === lastTransactionId);
        const receiptEl = document.getElementById('receipt-content');
        if (!tx && !receiptEl) {
            vc8044SetReceiptPrintBusy(false);
            if (typeof showToast === 'function') showToast('Receipt not ready', 'error');
            return;
        }
        const receiptText = tx ? buildThermalReceiptText(tx) : receiptEl.innerText;
        const receiptTitle = lastTransactionId ? `Villacart Receipt ${lastTransactionId}` : 'Villacart Receipt';
        try {
            const opened = await printWithOpenEscposIntent(receiptText, receiptTitle);
            if (opened) {
                if (typeof showToast === 'function') showToast('Sending to ESC/POS printer...', 'info');
                vc8044ScheduleReceiptPrintReset(6500);
                return;
            }
        } catch (error) {
            console.warn('Open ESC/POS intent print failed, using browser print fallback:', error);
        }
        try {
            printBrowserThermalReceipt();
        } finally {
            vc8044ScheduleReceiptPrintReset(3000);
        }
    }

    function printBrowserThermalReceipt() {
        const tx = (state.transactions || []).find(t => t.id === lastTransactionId) || (state.archiveTransactions || []).find(t => t.id === lastTransactionId);
        const receiptEl = document.getElementById('receipt-content');
        if (!tx && !receiptEl) {
            if (typeof showToast === 'function') showToast('Receipt not ready', 'error');
            return;
        }
        const receiptText = tx ? buildThermalReceiptText(tx) : receiptEl.innerText;
        const receiptTitle = lastTransactionId ? `Villacart Receipt ${lastTransactionId}` : 'Villacart Receipt';
        const printHTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(receiptTitle)}</title>
<style>
@page { size: 58mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body {
    width: 58mm;
    min-width: 58mm;
    max-width: 58mm;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    overflow: visible;
}
body {
    display: block;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}
#thermal-receipt {
    width: 54mm;
    max-width: 54mm;
    margin: 0;
    padding: 2mm 2mm 5mm;
    background: #fff;
    color: #000;
    font-family: "Courier New", Courier, monospace;
    font-size: 14px;
    line-height: 1.2;
    font-weight: 900;
    letter-spacing: 0;
    white-space: pre;
    overflow: visible;
}
@media print {
    html, body { width: 58mm; margin: 0; padding: 0; overflow: visible; }
    #thermal-receipt { width: 54mm; max-width: 54mm; margin: 0; white-space: pre; font-size: 14px; font-weight: 900; }
}
</style>
</head>
<body><pre id="thermal-receipt">${escapeHTML(receiptText)}</pre></body>
</html>`;

        const printWin = window.open('', '_blank', 'popup,width=420,height=640');
        if (!printWin) {
            if (typeof showToast === 'function') showToast('Popup blocked. Using normal print.', 'info');
            window.print();
            return;
        }
        printWin.document.open();
        printWin.document.write(printHTML);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => {
            try { printWin.print(); }
            catch (error) {
                console.error('Thermal print failed:', error);
                if (typeof showToast === 'function') showToast('Print window opened', 'info');
            }
        }, 350);
    }

    async function shareReceipt() {
        const tx = state.transactions.find(t => t.id === lastTransactionId) || (state.archiveTransactions || []).find(t => t.id === lastTransactionId);
        if (!tx) { showToast('Receipt not found', 'error'); return; }
        const receiptEl = document.getElementById('receipt-content');
        if (!receiptEl) { showToast('Receipt not ready', 'error'); return; }
        const shareBtn = document.getElementById('share-receipt-btn');
        const originalBtnHtml = shareBtn ? shareBtn.innerHTML : '';
        if (shareBtn) {
            shareBtn.disabled = true;
            shareBtn.innerHTML = `<span class="material-symbols-outlined text-[20px] animate-spin-custom">sync</span> Processing...`;
        }
        try {
            await ensureHtml2CanvasLoaded();
            if (typeof html2canvas !== 'function') throw new Error('Image tool not loaded.');
            const canvas = await html2canvas(receiptEl, {
                scale: Math.min(2, window.devicePixelRatio || 2),
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false
            });
            const blob = await canvasToPngBlob(canvas);
            const fileName = `Villacart_Receipt_${tx.id}.png`;
            const canShareFile = typeof File === 'function' && navigator.share && navigator.canShare;
            if (canShareFile) {
                const file = new File([blob], fileName, { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({ files: [file], title: `Receipt ${tx.id}`, text: `Villacart receipt ${tx.id}` });
                        showToast('Shared', 'success');
                        return;
                    } catch (shareError) {
                        if (shareError && shareError.name === 'AbortError') {
                            showToast('Share cancelled', 'info');
                            return;
                        }
                    }
                }
            }
            downloadBlob(blob, fileName);
            showToast('Receipt image downloaded', 'success');
        } catch (error) {
            console.error('Share receipt failed:', error);
            showToast('Could not create image', 'error');
        } finally {
            if (shareBtn) {
                shareBtn.disabled = false;
                shareBtn.innerHTML = originalBtnHtml;
            }
        }
    }

    function printTx() { if (!lastTransactionId) return; viewReceipt(lastTransactionId); closeModal('mod-tx'); }

    function findReceiptTransaction(id) {
        return (state.transactions || []).find(t => t.id === id)
            || (state.archiveTransactions || []).find(t => t.id === id)
            || null;
    }

    function resetReceiptModalScroll() {
        requestAnimationFrame(() => {
            const modal = document.getElementById('receipt-modal');
            const content = document.getElementById('receipt-content');
            if (modal) modal.scrollTop = 0;
            if (content) content.scrollTop = 0;
        });
    }

    function resetReceiptFields() {
        const byId = id => document.getElementById(id);
        if (byId('rec-items-list')) byId('rec-items-list').innerHTML = '';
        if (byId('rec-label-total')) byId('rec-label-total').innerText = 'TOTAL:';
        if (byId('rec-cash')) byId('rec-cash').innerText = formatCurrency(0);
        if (byId('rec-change')) byId('rec-change').innerText = formatCurrency(0);
        if (byId('rec-customer')) byId('rec-customer').innerText = 'N/A';
        if (byId('rec-set-customer')) byId('rec-set-customer').innerText = 'N/A';
    }

    function showReceiptModal() {
        const modal = document.getElementById('receipt-modal');
        if (modal) modal.classList.replace('hidden', 'flex');
        resetReceiptModalScroll();
    }

    function renderReceiptItems(items) {
        if (!items || !items.length) return '';
        return items.map(i => `<div class="flex justify-between gap-2 py-0.5"><span class="w-1/2 min-w-0 break-words">${escapeHTML(i.name)}</span><span class="w-1/4 text-center">${escapeHTML(i.qty)}</span><span class="w-1/4 text-right whitespace-nowrap">${formatCurrency((Number(i.price) || 0) * (Number(i.qty) || 0))}</span></div>`).join('');
    }

    function viewReceipt(id) {
        const tx = findReceiptTransaction(id);
        if (!tx) {
            showToast('Receipt not found', 'error');
            return;
        }
        lastTransactionId = id;
        resetReceiptFields();
        if (tx.notes && tx.notes.includes('CR-') && tx.type === 'SA') { buildSettlementRcpt(tx); return; }
        document.getElementById('receipt-title').innerText = 'OFFICIAL RECEIPT';
        document.getElementById('receipt-standard-fields').classList.remove('hidden');
        document.getElementById('receipt-settlement-fields').classList.add('hidden');
        document.getElementById('receipt-items-header').classList.remove('hidden');
        document.getElementById('receipt-settlement-header').classList.add('hidden');
        document.getElementById('rec-id').innerText = tx.id;
        document.getElementById('rec-date').innerText = new Date(tx.timestamp).toLocaleDateString();
        document.getElementById('rec-total').innerText = formatCurrency(tx.total);
        let receiptItemsHtml = tx.items && tx.items.length > 0 ? renderReceiptItems(tx.items) : `<div>${escapeHTML(tx.desc || tx.notes || '')}</div>`;
        if ((Number(tx.discount) || 0) > 0) {
            receiptItemsHtml += `<div class="mt-2 pt-2 border-t border-black/40 space-y-1"><div class="flex justify-between"><span class="font-bold">Subtotal</span><span>${formatCurrency(tx.subtotal || (Number(tx.total) + Number(tx.discount)))}</span></div><div class="flex justify-between"><span class="font-bold">Discount</span><span>-${formatCurrency(tx.discount)}</span></div></div>`;
        }
        document.getElementById('rec-items-list').innerHTML = receiptItemsHtml;
        document.getElementById('rec-cash-row').classList.toggle('hidden', tx.type !== 'SA');
        document.getElementById('rec-change-row').classList.toggle('hidden', tx.type !== 'SA');
        if (tx.type === 'SA') {
            document.getElementById('rec-cash').innerText = formatCurrency(tx.cashReceived || 0);
            document.getElementById('rec-change').innerText = formatCurrency(tx.change || 0);
        }
        document.getElementById('rec-customer-row').classList.toggle('hidden', !tx.customer);
        if (tx.customer) document.getElementById('rec-customer').innerText = tx.customer;
        showReceiptModal();
    }

    function buildSettlementRcpt(tx) {
        resetReceiptFields();
        document.getElementById('receipt-title').innerText = 'CREDIT SETTLEMENT';
        document.getElementById('receipt-standard-fields').classList.add('hidden');
        document.getElementById('receipt-settlement-fields').classList.remove('hidden');
        document.getElementById('receipt-items-header').classList.add('hidden');
        document.getElementById('receipt-settlement-header').classList.remove('hidden');
        document.getElementById('rec-set-customer').innerText = tx.customer || 'Guest';
        document.getElementById('rec-set-date').innerText = new Date(tx.timestamp).toLocaleDateString();
        document.getElementById('rec-label-total').innerText = 'TOTAL PAID:';
        document.getElementById('rec-total').innerText = formatCurrency(tx.total);
        const itemsList = document.getElementById('rec-items-list');
        let html = '';
        if (tx.items && tx.items.length > 0) {
            const ticketGroups = {};
            tx.items.forEach(item => {
                const ticketId = item.originalTicketId || tx.notes || 'Original Order';
                if (!ticketGroups[ticketId]) ticketGroups[ticketId] = [];
                ticketGroups[ticketId].push(item);
            });
            for (const ticketId in ticketGroups) {
                html += `<div class="mt-4 mb-1.5 border-b border-black pb-0.5"><span class="font-bold uppercase text-[10px]">Ticket: ${escapeHTML(ticketId)}</span></div>`;
                html += renderReceiptItems(ticketGroups[ticketId]);
            }
        } else {
            html = `<div class="p-2 bg-gray-50 border border-gray-200 rounded text-[9px]"><p class="font-mono break-all">Settled: ${escapeHTML(tx.notes)}</p></div>`;
        }
        itemsList.innerHTML = html;
        document.getElementById('rec-cash-row').classList.add('hidden');
        document.getElementById('rec-change-row').classList.add('hidden');
        document.getElementById('rec-customer-row').classList.add('hidden');
        showReceiptModal();
    }

    function printReceiptFromSuccess() { if (lastTransactionId) viewReceipt(lastTransactionId); closeModal('mod-success'); }
