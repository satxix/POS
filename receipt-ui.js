// --- Villacart Receipt UI module ---
// v8.1.1: Extracted from app.js. Print behavior is intentionally unchanged.
// v8.7.9: Long Share Image receipts are exported as readable numbered images.

    let vc8044ReceiptPrintBusy = false;
    let vc8044ReceiptPrintResetTimer = null;
    let vc854ReceiptIntentCache = {
        key: '',
        url: '',
        promise: null
    };

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

    function vc854ResetReceiptPrintOnResume() {
        if (document.visibilityState && document.visibilityState !== 'visible') return;
        if (vc8044ReceiptPrintResetTimer) {
            clearTimeout(vc8044ReceiptPrintResetTimer);
            vc8044ReceiptPrintResetTimer = null;
        }
        vc8044SetReceiptPrintBusy(false);
    }

    document.addEventListener('visibilitychange', vc854ResetReceiptPrintOnResume);
    window.addEventListener('pageshow', vc854ResetReceiptPrintOnResume);

    function vc854ReceiptIntentKey(receiptText, receiptTitle) {
        return `${receiptTitle || ''}\u0000${receiptText || ''}`;
    }

    function vc872NormalizeCreditTicket(ticket) {
        const items = Array.isArray(ticket && ticket.items) ? ticket.items.map(item => ({ ...item })) : [];
        const itemSubtotal = items.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
        const total = Number(ticket && ticket.total) || 0;
        const subtotal = Number(ticket && ticket.subtotal) || itemSubtotal || (total + (Number(ticket && ticket.discount) || 0));
        const discount = Math.max(0, Number(ticket && ticket.discount) || (subtotal - total));
        return {
            id: String((ticket && ticket.id) || ''),
            timestamp: (ticket && ticket.timestamp) || '',
            businessDate: (ticket && ticket.businessDate) || '',
            items,
            subtotal,
            discount,
            total
        };
    }

    function vc872SettlementCreditIds(tx) {
        const ids = [];
        const add = value => {
            const id = String(value || '').trim();
            if (id && id.startsWith('CR-') && !ids.includes(id)) ids.push(id);
        };
        (Array.isArray(tx && tx.creditBreakdown) ? tx.creditBreakdown : []).forEach(ticket => add(ticket && ticket.id));
        [tx && tx.settlementFor, tx && tx.creditRef, tx && tx.relatedCreditId].forEach(add);
        const matches = String((tx && tx.notes) || '').match(/CR-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) || [];
        matches.forEach(add);
        return ids;
    }

    function vc872PrepareReceiptTransaction(tx) {
        if (!tx || tx.type !== 'SA' || !(tx.creditBreakdown || String(tx.notes || '').includes('CR-'))) return tx;
        // A partial payment does not settle the original ticket, so its current
        // remaining balance cannot be used as a historical itemized receipt.
        if (!tx.creditBreakdown && String(tx.notes || '').trim().toLowerCase().startsWith('partial:')) return tx;
        let breakdown = Array.isArray(tx.creditBreakdown)
            ? tx.creditBreakdown.map(vc872NormalizeCreditTicket)
            : [];
        if (!breakdown.length) {
            const all = (state.transactions || []).concat(state.archiveTransactions || []);
            const byId = new Map(all.filter(record => record && record.id).map(record => [String(record.id), record]));
            breakdown = vc872SettlementCreditIds(tx)
                .map(id => byId.get(id))
                .filter(Boolean)
                .map(vc872NormalizeCreditTicket);
        }
        breakdown.sort((a, b) => String(a.timestamp || a.businessDate || '').localeCompare(String(b.timestamp || b.businessDate || '')));
        return breakdown.length ? { ...tx, creditBreakdown: breakdown } : tx;
    }

    window.vc872PrepareReceiptTransaction = vc872PrepareReceiptTransaction;

    function vc854BuildReceiptIntentUrl(receiptText, receiptTitle) {
        const key = vc854ReceiptIntentKey(receiptText, receiptTitle);
        if (vc854ReceiptIntentCache.key === key) {
            if (vc854ReceiptIntentCache.url) return Promise.resolve(vc854ReceiptIntentCache.url);
            if (vc854ReceiptIntentCache.promise) return vc854ReceiptIntentCache.promise;
        }

        const html = buildOpenEscposIntentHtml(receiptText, receiptTitle);
        const payload = JSON.stringify([html]);
        const promise = gzipBase64String(payload).then(compressed => {
            const encoded = encodeURIComponent(compressed);
            // Target the installed Open ESC/POS Print Service directly so Android
            // does not need to resolve the print-intent handler on every receipt.
            const url = `intent://#Intent;scheme=print-intent;package=com.farminos.print;S.content=${encoded};end`;
            if (vc854ReceiptIntentCache.key === key) {
                vc854ReceiptIntentCache.url = url;
                vc854ReceiptIntentCache.promise = null;
            }
            return url;
        }).catch(error => {
            if (vc854ReceiptIntentCache.key === key) {
                vc854ReceiptIntentCache.url = '';
                vc854ReceiptIntentCache.promise = null;
            }
            throw error;
        });

        vc854ReceiptIntentCache = { key, url: '', promise };
        return promise;
    }

    function vc854GetReceiptPrintData() {
        const found = (state.transactions || []).find(t => t.id === lastTransactionId)
            || (state.archiveTransactions || []).find(t => t.id === lastTransactionId);
        const tx = vc872PrepareReceiptTransaction(found);
        const receiptEl = document.getElementById('receipt-content');
        if (!tx && !receiptEl) return null;
        return {
            tx,
            receiptText: tx ? buildThermalReceiptText(tx) : receiptEl.innerText,
            receiptTitle: lastTransactionId ? `Villacart Receipt ${lastTransactionId}` : 'Villacart Receipt'
        };
    }

    function vc854PrimeReceiptPrintIntent() {
        if (!isAndroidRuntime()) return;
        const printData = vc854GetReceiptPrintData();
        if (!printData) return;
        vc854BuildReceiptIntentUrl(printData.receiptText, printData.receiptTitle).catch(error => {
            console.warn('Receipt print preparation failed:', error);
        });
    }

    async function printWithOpenEscposIntent(receiptText, receiptTitle) {
        if (!isAndroidRuntime()) return false;
        const intentUrl = await vc854BuildReceiptIntentUrl(receiptText, receiptTitle);
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
        const printData = vc854GetReceiptPrintData();
        if (!printData) {
            vc8044SetReceiptPrintBusy(false);
            if (typeof showToast === 'function') showToast('Receipt not ready', 'error');
            return;
        }
        const { receiptText, receiptTitle } = printData;
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
        const found = (state.transactions || []).find(t => t.id === lastTransactionId) || (state.archiveTransactions || []).find(t => t.id === lastTransactionId);
        const tx = vc872PrepareReceiptTransaction(found);
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

    function vc879ReceiptPagePlan(receiptEl) {
        const rect = receiptEl.getBoundingClientRect();
        const width = Math.max(1, Math.ceil(Math.max(rect.width || 0, receiptEl.scrollWidth || 0)));
        const height = Math.max(1, Math.ceil(Math.max(rect.height || 0, receiptEl.scrollHeight || 0)));
        const maxPages = 20;
        const preferredHeight = Math.max(1200, width * 5, Math.ceil(height / maxPages));
        if (height <= preferredHeight * 1.15) return { rect, width, height, ranges: [{ top: 0, height }] };

        const rootTop = rect.top;
        const candidateNodes = Array.from(receiptEl.children);
        const itemsList = receiptEl.querySelector('#rec-items-list');
        if (itemsList) candidateNodes.push(...Array.from(itemsList.children));
        const breakpoints = Array.from(new Set(candidateNodes.map(node => {
            const nodeRect = node.getBoundingClientRect();
            return Math.round(nodeRect.bottom - rootTop + (receiptEl.scrollTop || 0));
        }).filter(value => value > 0 && value < height))).sort((a, b) => a - b);

        const ranges = [];
        let top = 0;
        while (top < height) {
            const idealBottom = Math.min(height, top + preferredHeight);
            let bottom = idealBottom;
            if (idealBottom < height) {
                const minimumUsefulBottom = top + (preferredHeight * 0.58);
                const safeBreaks = breakpoints.filter(value => value >= minimumUsefulBottom && value <= idealBottom - 8);
                if (safeBreaks.length) bottom = safeBreaks[safeBreaks.length - 1];
                if (height - bottom < preferredHeight * 0.22) bottom = height;
            }
            if (bottom <= top) bottom = Math.min(height, top + preferredHeight);
            ranges.push({ top, height: Math.ceil(bottom - top) });
            top = bottom;
        }
        return { rect, width, height, ranges };
    }

    async function vc879RenderReceiptImages(receiptEl, onProgress) {
        const plan = vc879ReceiptPagePlan(receiptEl);
        const blobs = [];
        for (let index = 0; index < plan.ranges.length; index += 1) {
            if (typeof onProgress === 'function') onProgress(index + 1, plan.ranges.length);
            const range = plan.ranges[index];
            const captureStage = document.createElement('div');
            const receiptClone = receiptEl.cloneNode(true);
            const computed = window.getComputedStyle(receiptEl);
            captureStage.setAttribute('aria-hidden', 'true');
            captureStage.style.cssText = `position:fixed;left:-10000px;top:0;width:${plan.width}px;height:${range.height}px;overflow:hidden;background:#fff;pointer-events:none;z-index:-1;`;
            receiptClone.removeAttribute('id');
            receiptClone.scrollTop = 0;
            receiptClone.scrollLeft = 0;
            receiptClone.style.setProperty('display', 'block', 'important');
            receiptClone.style.setProperty('position', 'absolute', 'important');
            receiptClone.style.setProperty('left', '0', 'important');
            receiptClone.style.setProperty('top', `${-range.top}px`, 'important');
            receiptClone.style.setProperty('flex', 'none', 'important');
            receiptClone.style.setProperty('box-sizing', computed.boxSizing || 'border-box', 'important');
            receiptClone.style.setProperty('width', `${plan.width}px`, 'important');
            receiptClone.style.setProperty('min-height', '0', 'important');
            receiptClone.style.setProperty('height', 'auto', 'important');
            receiptClone.style.setProperty('max-height', 'none', 'important');
            receiptClone.style.setProperty('overflow', 'visible', 'important');
            receiptClone.style.setProperty('padding', computed.padding, 'important');
            receiptClone.style.setProperty('background', '#ffffff', 'important');
            captureStage.appendChild(receiptClone);
            document.body.appendChild(captureStage);
            try {
                await new Promise(resolve => requestAnimationFrame(resolve));
                const canvas = await html2canvas(captureStage, {
                    scale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
                    width: plan.width,
                    height: range.height,
                    backgroundColor: '#ffffff',
                    useCORS: true,
                    logging: false
                });
                blobs.push(await canvasToPngBlob(canvas));
            } finally {
                captureStage.remove();
            }
            // Yield briefly so Android can repaint the progress label between pages.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return blobs;
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
            const blobs = await vc879RenderReceiptImages(receiptEl, (page, total) => {
                if (shareBtn && total > 1) {
                    shareBtn.innerHTML = `<span class="material-symbols-outlined text-[20px] animate-spin-custom">sync</span> Image ${page}/${total}`;
                }
            });
            const totalImages = blobs.length;
            const digits = Math.max(2, String(totalImages).length);
            const fileNames = blobs.map((blob, index) => {
                const part = String(index + 1).padStart(digits, '0');
                const suffix = totalImages > 1 ? `_${part}-of-${String(totalImages).padStart(digits, '0')}` : '';
                return `Villacart_Receipt_${tx.id}${suffix}.png`;
            });
            const files = typeof File === 'function'
                ? blobs.map((blob, index) => new File([blob], fileNames[index], { type: 'image/png' }))
                : [];
            const canShareFile = typeof File === 'function' && navigator.share && navigator.canShare;
            let canShareAllFiles = false;
            try { canShareAllFiles = !!(canShareFile && navigator.canShare({ files })); } catch (error) {}
            if (canShareAllFiles) {
                    try {
                        await navigator.share({ files, title: `Receipt ${tx.id}`, text: `Villacart receipt ${tx.id}` });
                        showToast(totalImages > 1 ? `${totalImages} receipt images shared` : 'Shared', 'success');
                        return;
                    } catch (shareError) {
                        if (shareError && shareError.name === 'AbortError') {
                            showToast('Share cancelled', 'info');
                            return;
                        }
                    }
            }
            blobs.forEach((blob, index) => downloadBlob(blob, fileNames[index]));
            showToast(totalImages > 1 ? `${totalImages} receipt images downloaded` : 'Receipt image downloaded', 'success');
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
        // Prepare the compressed direct-print payload while the cashier reviews
        // the receipt, so tapping Print can hand off to the helper immediately.
        vc854PrimeReceiptPrintIntent();
    }

    function renderReceiptItems(items) {
        if (!items || !items.length) return '';
        return items.map(i => `<div class="flex justify-between gap-2 py-0.5"><span class="w-1/2 min-w-0 break-words">${escapeHTML(i.name)}</span><span class="w-1/4 text-center">${escapeHTML(i.qty)}</span><span class="w-1/4 text-right whitespace-nowrap">${formatCurrency((Number(i.price) || 0) * (Number(i.qty) || 0))}</span></div>`).join('');
    }

    function viewReceipt(id) {
        const tx = vc872PrepareReceiptTransaction(findReceiptTransaction(id));
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
        tx = vc872PrepareReceiptTransaction(tx);
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
        if (Array.isArray(tx.creditBreakdown) && tx.creditBreakdown.length > 0) {
            tx.creditBreakdown.forEach(ticket => {
                const ticketDate = ticket.timestamp || ticket.businessDate;
                const dateLabel = ticketDate ? new Date(ticketDate.length === 10 ? ticketDate + 'T00:00:00' : ticketDate).toLocaleDateString() : '';
                html += `<div class="mt-4 mb-1.5 border-b border-black pb-0.5 flex justify-between gap-2"><span class="font-bold uppercase text-[10px]">Ticket: ${escapeHTML(ticket.id || 'Credit')}</span><span class="text-[9px] font-bold">${escapeHTML(dateLabel)}</span></div>`;
                html += renderReceiptItems(ticket.items || []);
                html += `<div class="mt-1.5 pt-1.5 border-t border-black/30 space-y-0.5 text-[10px]"><div class="flex justify-between"><span>Subtotal</span><span>${formatCurrency(ticket.subtotal)}</span></div>`;
                if ((Number(ticket.discount) || 0) > 0) html += `<div class="flex justify-between"><span>Discount</span><span>-${formatCurrency(ticket.discount)}</span></div>`;
                html += `<div class="flex justify-between font-black"><span>Ticket Total</span><span>${formatCurrency(ticket.total)}</span></div></div>`;
            });
            const originalSubtotal = tx.creditBreakdown.reduce((sum, ticket) => sum + (Number(ticket.subtotal) || 0), 0);
            const totalDiscount = tx.creditBreakdown.reduce((sum, ticket) => sum + (Number(ticket.discount) || 0), 0);
            html += `<div class="mt-4 pt-2 border-t-2 border-black space-y-1 font-bold"><div class="flex justify-between"><span>Original Subtotal</span><span>${formatCurrency(originalSubtotal)}</span></div>`;
            if (totalDiscount > 0) html += `<div class="flex justify-between"><span>Total Discounts</span><span>-${formatCurrency(totalDiscount)}</span></div>`;
            html += `</div>`;
        } else if (tx.items && tx.items.length > 0) {
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

    function closeSuccessAndNewSale() {
        const modal = document.getElementById('mod-success');
        if (modal) {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }
        if (typeof resetTerminalForNewSale === 'function') resetTerminalForNewSale();
    }

    // Inline HTML actions must remain explicit globals after the UI was split
    // into separate scripts. This also avoids depending on script load order.
    window.printReceiptFromSuccess = printReceiptFromSuccess;
    window.closeSuccessAndNewSale = closeSuccessAndNewSale;
