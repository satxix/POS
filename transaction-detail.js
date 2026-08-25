// Transaction detail modal view extracted from app.js in v8.2.1.
// Depends on app globals: state, lastTransactionId, escapeHTML, formatCurrency, closeModal.

function viewTxDetails(id) {
    const found = (state.transactions || []).find(t => t.id === id) || (state.archiveTransactions || []).find(t => t.id === id);
    const tx = typeof vc872PrepareReceiptTransaction === 'function' ? vc872PrepareReceiptTransaction(found) : found;
    if (!tx) return; lastTransactionId = id;
    document.getElementById('txmtitle').innerText = tx.id;
    let html = `<div class="p-4 bg-primary/5 rounded-2xl border border-primary/10 mb-5"><div class="flex justify-between text-xs mb-1.5"><span class="font-bold opacity-60">Date</span><span class="font-black">${escapeHTML(new Date(tx.timestamp).toLocaleString())}</span></div><div class="flex justify-between text-xs mb-1.5"><span class="font-bold opacity-60">Type</span><span class="font-black uppercase">${escapeHTML((tx.notes && tx.notes.includes('CR-')) ? 'Settlement' : tx.type)}</span></div>${tx.customer ? `<div class="flex justify-between text-xs"><span class="font-bold opacity-60">Customer</span><span class="font-black">${escapeHTML(tx.customer)}</span></div>` : ''}</div>`;
    if (Array.isArray(tx.creditBreakdown) && tx.creditBreakdown.length > 0) {
        html += `<div class="space-y-4 mb-5">${tx.creditBreakdown.map(ticket => {
            const rawDate = ticket.timestamp || ticket.businessDate || '';
            const parsedDate = rawDate ? new Date(String(rawDate).length === 10 ? rawDate + 'T00:00:00' : rawDate) : null;
            const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString() : '';
            const items = Array.isArray(ticket.items) ? ticket.items : [];
            const itemRows = items.length
                ? items.map(item => `<div class="flex justify-between gap-3 text-xs border-b border-border-subtle pb-2"><span class="min-w-0 flex-1 break-words">${escapeHTML(item.name || 'Item')} <strong>x${escapeHTML(item.qty)}</strong><span class="block text-[9px] opacity-55">${formatCurrency(item.price)} each</span></span><span class="font-black whitespace-nowrap">${formatCurrency((Number(item.price) || 0) * (Number(item.qty) || 0))}</span></div>`).join('')
                : `<p class="text-[10px] font-bold opacity-50 py-2">No item details saved for this ticket.</p>`;
            return `<section class="rounded-2xl border border-primary/10 bg-primary/[0.03] p-3"><div class="flex justify-between gap-2 border-b border-primary/10 pb-2 mb-2"><strong class="text-[11px] text-primary break-all">${escapeHTML(ticket.id || 'Credit Ticket')}</strong><span class="text-[10px] font-bold opacity-60 whitespace-nowrap">${escapeHTML(dateLabel)}</span></div><div class="space-y-2">${itemRows}</div><div class="mt-3 pt-2 border-t border-primary/10 space-y-1 text-[10px]"><div class="flex justify-between"><span>Subtotal</span><strong>${formatCurrency(ticket.subtotal)}</strong></div>${(Number(ticket.discount) || 0) > 0 ? `<div class="flex justify-between text-error"><span>Discount</span><strong>-${formatCurrency(ticket.discount)}</strong></div>` : ''}<div class="flex justify-between text-xs text-secondary"><span class="font-black">Ticket Total</span><strong>${formatCurrency(ticket.total)}</strong></div></div></section>`;
        }).join('')}</div>`;
    }
    else if (tx.items && tx.items.length > 0) html += `<div class="space-y-2 mb-5">${tx.items.map(item => `<div class="flex justify-between text-xs border-b border-border-subtle pb-2"><span>${escapeHTML(item.name)} x${escapeHTML(item.qty)}</span><span class="font-black">${formatCurrency(item.price * item.qty)}</span></div>`).join('')}</div>`;
    else if (tx.notes && tx.notes.includes('CR-')) html += `<div class="p-3 bg-surface-container/50 rounded-xl mb-5"><p class="text-[10px] font-bold text-on-surface-variant uppercase mb-1">Settled Tickets</p><p class="text-xs font-black text-primary">${escapeHTML(tx.notes)}</p></div>`;
    html += `<div class="flex justify-between items-center p-4 ${tx.type === 'EX' ? 'bg-error/10 text-error' : 'bg-secondary/10 text-secondary'} rounded-2xl"><span class="text-xs font-black">TOTAL</span><span class="text-2xl font-black">${formatCurrency(tx.total)}</span></div>`;
    const detail = document.getElementById('txdetail');
    detail.innerHTML = html;
    detail.scrollTop = 0;
    closeModal('mod-tx');
    document.getElementById('mod-tx').classList.replace('hidden', 'flex');
    requestAnimationFrame(() => { detail.scrollTop = 0; });
}
