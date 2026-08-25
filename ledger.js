// Villacart shared credit helpers v8.3.26
// Single source for open/settled credit status used by Ledger and Notifications.
(function(){
  if (window.VillacartCreditUtils && window.VillacartCreditUtils.version === 'v8.3.26') return;

  function norm(value) {
    return String(value == null ? '' : value).trim().toUpperCase();
  }

  function isCreditSettlement(tx) {
    if (!tx) return false;
    const id = norm(tx.id);
    const type = norm(tx.type);
    const notes = norm(tx.notes);
    return !!(
      tx.settlementFor ||
      tx.creditRef ||
      tx.relatedCreditId ||
      notes.includes('CR-') ||
      notes.includes('PARTIAL:') ||
      notes.includes('PAYMENT') ||
      notes.includes('SETTLEMENT') ||
      notes.includes('PAID CREDIT') ||
      (type === 'SA' && notes.includes('CR-')) ||
      (id.startsWith('SA-') && notes.includes('CR-'))
    );
  }

  function settlementCreditIds(tx) {
    const ids = new Set();
    ['settlementFor', 'creditRef', 'relatedCreditId'].forEach(key => {
      if (tx && tx[key]) ids.add(norm(tx[key]));
    });
    const notes = norm(tx && tx.notes);
    const matches = notes.match(/CR-[A-Z0-9-]+/g) || [];
    matches.forEach(id => ids.add(id));
    return ids;
  }

  function hasZeroBalanceMarker(tx) {
    return ['balance', 'balanceDue', 'remaining', 'amountDue'].some(key => {
      if (!tx || tx[key] === undefined || tx[key] === null || tx[key] === '') return false;
      const n = Number(tx[key]);
      return !Number.isNaN(n) && n === 0;
    });
  }

  function hasIntrinsicSettledState(creditTx) {
    if (!creditTx) return false;
    if (creditTx.paid === true || creditTx.settled === true) return true;
    const status = norm(creditTx.status);
    if (status === 'PAID' || status === 'SETTLED') return true;
    return hasZeroBalanceMarker(creditTx);
  }

  function timestampValue(tx) {
    const value = new Date(tx && (tx.timestamp || tx.createdAt || tx.settledAt) || 0).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function creditStateIndex(allTx) {
    const transactions = Array.isArray(allTx) ? allTx : [];
    const settlementByCreditId = new Map();

    transactions.forEach(tx => {
      if (!tx || !isCreditSettlement(tx)) return;
      if (norm(tx.notes).includes('PARTIAL:')) return;

      settlementCreditIds(tx).forEach(creditId => {
        const current = settlementByCreditId.get(creditId);
        if (!current || timestampValue(tx) >= timestampValue(current)) {
          settlementByCreditId.set(creditId, tx);
        }
      });
    });

    return {
      settlementByCreditId,
      isCreditSettled(creditTx) {
        if (hasIntrinsicSettledState(creditTx)) return true;
        const id = norm(creditTx && creditTx.id);
        return !!id && settlementByCreditId.has(id);
      },
      settlementFor(creditTx) {
        const id = norm(creditTx && creditTx.id);
        return id ? (settlementByCreditId.get(id) || null) : null;
      }
    };
  }

  function isCreditSettled(creditTx, allTx) {
    return creditStateIndex(allTx).isCreditSettled(creditTx);
  }

  function uniqueCredits(allTx) {
    const map = new Map();
    (Array.isArray(allTx) ? allTx : []).forEach(tx => {
      if (tx && tx.id && norm(tx.type) === 'CR' && !isCreditSettlement(tx)) map.set(tx.id, tx);
    });
    return Array.from(map.values());
  }

  function openCredits(allTx) {
    const tx = Array.isArray(allTx) ? allTx : [];
    const index = creditStateIndex(tx);
    return uniqueCredits(tx).filter(cr => !index.isCreditSettled(cr));
  }

  function settledCredits(allTx) {
    const tx = Array.isArray(allTx) ? allTx : [];
    const index = creditStateIndex(tx);
    return uniqueCredits(tx).filter(cr => index.isCreditSettled(cr));
  }

  window.VillacartCreditUtils = {
    version: 'v8.3.26',
    norm,
    isCreditSettlement,
    settlementCreditIds,
    creditStateIndex,
    isCreditSettled,
    openCredits,
    settledCredits
  };
})();

// Base Ledger controller and credit-payment actions.
// Loaded before app.js so the later responsive Ledger render guards continue
// to wrap renderLedger in their established order.

function switchLedgerTab(tab) {
  activeLedgerTab = tab;
  document.querySelectorAll('[id^="tab-"]').forEach(button => {
    const isActive = button.id === 'tab-' + tab;
    button.classList.toggle('ledger-tab-active', isActive);
    button.classList.toggle('text-on-surface-variant', !isActive);
  });
  renderLedger();
}

function renderLedger() {
  const container = document.getElementById('ledger-content');
  const summary = document.getElementById('ledger-summary-container');
  if (!container || !summary) return;
  let html = '';
  let summaryHtml = '';

  if (activeLedgerTab === 'cash') {
    const sales = state.transactions
      .filter(transaction => transaction.type === 'SA' || (transaction.notes && transaction.notes.includes('CR-')))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const total = sales.reduce((sum, transaction) => sum + transaction.total, 0);
    summaryHtml = `<div class="bg-primary p-6 rounded-3xl text-white shadow-lg"><p class="text-[10px] font-bold uppercase opacity-70 tracking-widest mb-1">Total Cash Sales</p><h3 class="text-2xl font-black">₱${total.toLocaleString()}</h3></div>`;
    html = sales.map(transaction => `<div class="bg-surface border border-border-subtle p-5 rounded-3xl flex justify-between items-center shadow-sm hover:shadow-md transition-all"><div><div class="flex items-center gap-2"><p class="font-black text-sm text-primary">${transaction.id}</p>${(transaction.notes && transaction.notes.includes('CR-')) ? '<span class="text-[7px] bg-secondary text-white px-2 py-0.5 rounded-full uppercase font-bold">Settlement</span>' : ''}${isPendingSync('transactions', transaction.id) ? '<span class="text-[7px] bg-orange-500 text-white px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>' : ''}</div><p class="text-[10px] text-on-surface-variant font-bold mt-1">${new Date(transaction.timestamp).toLocaleDateString()} ${new Date(transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div><div class="flex items-center gap-3"><p class="font-black text-xl text-secondary">₱${transaction.total.toLocaleString()}</p><button onclick="viewTxDetails('${transaction.id}')" class="w-10 h-10 flex items-center justify-center bg-primary-container text-primary rounded-xl active-scale"><span class="material-symbols-outlined">visibility</span></button></div></div>`).join('') || '<div class="col-span-full flex flex-col items-center justify-center py-20 opacity-40"><span class="material-symbols-outlined text-[48px] mb-3">point_of_sale</span><p class="font-black text-xs uppercase tracking-widest">No sales recorded yet</p></div>';
  } else if (activeLedgerTab === 'credit') {
    const credits = state.transactions
      .filter(transaction => transaction.type === 'CR' && !transaction.paid)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const grouped = credits.reduce((groups, transaction) => {
      const rawName = transaction.customer || 'Guest';
      const normalizedKey = rawName.trim().toLowerCase();
      if (!groups[normalizedKey]) groups[normalizedKey] = { displayName: titleCase(rawName), items: [], total: 0 };
      groups[normalizedKey].items.push(transaction);
      groups[normalizedKey].total += transaction.total;
      return groups;
    }, {});
    const totalBalance = credits.reduce((sum, transaction) => sum + transaction.total, 0);
    summaryHtml = `<div class="bg-orange-600 p-6 rounded-3xl text-white shadow-lg"><p class="text-[10px] font-bold uppercase opacity-70 tracking-widest mb-1">Total Outstanding Credits</p><h3 class="text-2xl font-black">₱${totalBalance.toLocaleString()}</h3></div>`;
    if (Object.keys(grouped).length === 0) {
      html = '<div class="col-span-full text-center py-20 opacity-30 font-black uppercase text-xs">No credits</div>';
    } else {
      html = Object.entries(grouped).map(([, data]) => `<div class="space-y-4"><div class="bg-white border-2 border-orange-500/20 p-5 rounded-3xl shadow-sm"><div class="flex justify-between items-start mb-4"><div class="min-w-0 flex-1"><h3 class="text-base font-black text-primary uppercase truncate">${data.displayName}</h3><p class="text-[10px] font-bold text-on-surface-variant">${data.items.length} Pending Tickets</p></div><div class="text-right"><p class="text-[10px] font-black text-orange-600 uppercase">Total</p><p class="text-2xl font-black text-orange-600 tracking-tighter">₱${data.total.toLocaleString()}</p></div></div><button onclick="payFullBalance('${data.displayName.replace(/'/g, "\\'")}')" class="w-full bg-secondary text-white py-3.5 rounded-2xl font-black text-xs uppercase shadow-lg active-scale">Pay Full Balance</button></div><div class="space-y-2 pl-3 border-l-2 border-border-subtle">${data.items.map(transaction => `<div class="bg-surface border border-border-subtle p-3.5 rounded-2xl flex justify-between items-center text-xs"><div class="min-w-0 flex-1"><div class="flex items-center gap-1.5"><p class="font-black text-primary/60 truncate">${transaction.id}</p>${isPendingSync('transactions', transaction.id) ? '<span class="text-[6px] bg-orange-500 text-white px-1.5 rounded uppercase">Pending</span>' : ''}</div><p class="opacity-50 font-bold">${new Date(transaction.timestamp).toLocaleDateString()}</p></div><div class="flex items-center gap-2"><p class="font-black text-on-surface mr-1">₱${transaction.total.toLocaleString()}</p><button onclick="payIndividualTicket('${transaction.id}')" class="bg-secondary text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase active-scale shadow-sm">Pay</button><button onclick="viewTxDetails('${transaction.id}')" class="w-8 h-8 flex items-center justify-center bg-primary/5 text-primary rounded-xl"><span class="material-symbols-outlined text-[18px]">visibility</span></button></div></div>`).join('')}</div></div>`).join('');
    }
  } else if (activeLedgerTab === 'expense') {
    const expenses = state.transactions
      .filter(transaction => transaction.type === 'EX')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const totalExpenses = expenses.reduce((sum, transaction) => sum + transaction.total, 0);
    summaryHtml = `<div class="bg-error p-6 rounded-3xl text-white shadow-lg"><p class="text-[10px] font-bold uppercase opacity-70 tracking-widest mb-1">Total Expenses</p><h3 class="text-2xl font-black">₱${totalExpenses.toLocaleString()}</h3></div>`;
    html = expenses.map(transaction => `<div class="bg-surface border border-border-subtle p-5 rounded-3xl flex justify-between items-center shadow-sm hover:shadow-md transition-all"><div><div class="flex items-center gap-2"><p class="font-black text-sm text-error">${transaction.id}</p>${transaction.category ? `<span class="text-[7px] bg-error/10 text-error px-2 py-0.5 rounded-full uppercase font-bold">${transaction.category}</span>` : ''}${isPendingSync('transactions', transaction.id) ? '<span class="text-[7px] bg-orange-500 text-white px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>' : ''}</div><p class="text-xs font-bold text-on-surface mt-1 truncate max-w-[150px]">${transaction.desc || transaction.notes || 'Expense'}</p></div><div class="flex items-center gap-3"><p class="font-black text-xl text-error">₱${transaction.total.toLocaleString()}</p><button onclick="viewTxDetails('${transaction.id}')" class="w-10 h-10 flex items-center justify-center bg-primary-container text-primary rounded-xl active-scale"><span class="material-symbols-outlined">visibility</span></button></div></div>`).join('') || '<div class="col-span-full text-center py-20 opacity-30 font-black uppercase text-xs">No records</div>';
  }

  summary.innerHTML = summaryHtml;
  container.innerHTML = html;
}

function buildCreditSettlementBreakdown(ticket) {
  const items = JSON.parse(JSON.stringify(Array.isArray(ticket && ticket.items) ? ticket.items : []));
  const itemSubtotal = items.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
  const total = Number(ticket && ticket.total) || 0;
  const subtotal = Number(ticket && ticket.subtotal) || itemSubtotal || (total + (Number(ticket && ticket.discount) || 0));
  const discount = Math.max(0, Number(ticket && ticket.discount) || (subtotal - total));
  return {
    id: ticket && ticket.id ? ticket.id : '',
    timestamp: ticket && ticket.timestamp ? ticket.timestamp : '',
    businessDate: ticket && ticket.businessDate ? ticket.businessDate : '',
    items,
    subtotal,
    discount,
    total
  };
}

async function payIndividualTicket(id) {
  const ticket = state.transactions.find(transaction => transaction.id === id);
  if (!ticket) return;
  const amountText = prompt(`Ticket ${id} — Balance: ₱${ticket.total.toLocaleString()}\n\nEnter amount to pay (or leave blank for full amount):`);
  if (amountText === null) return;
  const amount = amountText === '' ? ticket.total : parseFloat(amountText);
  if (isNaN(amount) || amount <= 0) {
    showToast('Invalid amount', 'error');
    return;
  }
  const isPartial = amount < ticket.total;
  const settlementId = nextTransactionId('SA');
  if (isPartial) {
    const remaining = ticket.total - amount;
    const settlement = { id: settlementId, type: 'SA', total: amount, timestamp: new Date().toISOString(), items: [], customer: ticket.customer, paid: true, cashReceived: amount, change: 0, notes: `Partial: ${ticket.id}` };
    ticket.total = remaining;
    ticket._offline = true;
    await directSync('transactions', ticket);
    queueTransaction(settlement);
    showToast(`Partial payment ₱${amount.toLocaleString()} recorded`, 'success');
  } else {
    const creditBreakdown = [buildCreditSettlementBreakdown(ticket)];
    ticket.paid = true;
    ticket._offline = true;
    const settlement = { id: settlementId, type: 'SA', total: ticket.total, subtotal: creditBreakdown[0].subtotal, discount: creditBreakdown[0].discount, creditBreakdown, timestamp: new Date().toISOString(), items: [], customer: ticket.customer, paid: true, cashReceived: ticket.total, change: 0, notes: ticket.id };
    await directSync('transactions', ticket);
    queueTransaction(settlement);
    showToast('Ticket paid', 'success');
  }
  lastTransactionId = settlementId;
  viewReceipt(settlementId);
  renderLedger();
}

let vc873PayFullBalanceBusy = false;

function vc873CreditPaymentTransactions() {
  if (typeof vc710AllTransactionsForLocalViews === 'function') {
    return vc710AllTransactionsForLocalViews();
  }
  const merged = new Map();
  (Array.isArray(state.archiveTransactions) ? state.archiveTransactions : []).forEach(transaction => {
    if (transaction && transaction.id) merged.set(transaction.id, { ...transaction, _archiveOnly: true });
  });
  (Array.isArray(state.transactions) ? state.transactions : []).forEach(transaction => {
    if (transaction && transaction.id) merged.set(transaction.id, transaction);
  });
  return Array.from(merged.values());
}

function vc873SetPayFullButtonsBusy(isBusy) {
  document.querySelectorAll('.vc5629-pay-full, button[onclick^="payFullBalance("]').forEach(button => {
    if (!button.dataset.vc873PayLabel) button.dataset.vc873PayLabel = button.innerHTML;
    button.disabled = !!isBusy;
    button.classList.toggle('opacity-60', !!isBusy);
    button.innerHTML = isBusy ? 'Preparing Payment...' : button.dataset.vc873PayLabel;
  });
}

async function payFullBalance(customerName) {
  if (vc873PayFullBalanceBusy) {
    showToast('Full-balance payment is already preparing', 'info');
    return;
  }
  const normalizedName = String(customerName || '').trim().toLowerCase();
  const allTransactions = vc873CreditPaymentTransactions();
  const creditIndex = window.VillacartCreditUtils && typeof window.VillacartCreditUtils.creditStateIndex === 'function'
    ? window.VillacartCreditUtils.creditStateIndex(allTransactions)
    : null;
  const credits = allTransactions.filter(transaction => transaction && transaction.type === 'CR'
    && transaction.customer
    && transaction.customer.trim().toLowerCase() === normalizedName
    && (creditIndex ? !creditIndex.isCreditSettled(transaction) : !transaction.paid));
  if (credits.length === 0) {
    showToast('No open credit tickets found for this customer', 'info');
    return;
  }
  const totalToPay = credits.reduce((sum, transaction) => sum + (Number(transaction.total) || 0), 0);
  if (!confirm(`Collect full payment of ₱${totalToPay.toLocaleString()} for ${credits.length} ticket(s)?`)) return;

  vc873PayFullBalanceBusy = true;
  vc873SetPayFullButtonsBusy(true);
  try {
    const creditBreakdown = credits
      .map(buildCreditSettlementBreakdown)
      .sort((a, b) => String(a.timestamp || a.businessDate || '').localeCompare(String(b.timestamp || b.businessDate || '')));
    const liveById = new Map((Array.isArray(state.transactions) ? state.transactions : [])
      .filter(transaction => transaction && transaction.id)
      .map(transaction => [transaction.id, transaction]));

    // Loaded backup tickets remain local-only. A new settlement closes them in
    // local views, but only live operational credit documents are updated.
    for (const ticket of credits) {
      const liveTicket = liveById.get(ticket.id);
      if (!liveTicket) continue;
      liveTicket.paid = true;
      liveTicket._offline = true;
      await directSync('transactions', liveTicket);
    }

    const settlementId = nextTransactionId('SA');
    const settlementSubtotal = creditBreakdown.reduce((sum, ticket) => sum + (Number(ticket.subtotal) || 0), 0);
    const settlementDiscount = creditBreakdown.reduce((sum, ticket) => sum + (Number(ticket.discount) || 0), 0);
    const settlement = { id: settlementId, type: 'SA', customer: customerName, total: totalToPay, subtotal: settlementSubtotal, discount: settlementDiscount, creditBreakdown, timestamp: new Date().toISOString(), items: [], notes: credits.map(ticket => ticket.id).join(', '), paid: true, cashReceived: totalToPay, change: 0 };
    queueTransaction(settlement);
    renderLedger();
    showToast(`Balance paid for ${credits.length} ticket(s)`, 'success');
    lastTransactionId = settlement.id;
    viewReceipt(settlement.id);
  } catch (error) {
    console.error('Pay full balance failed:', error);
    showToast('Could not complete full-balance payment', 'error');
  } finally {
    vc873PayFullBalanceBusy = false;
    vc873SetPayFullButtonsBusy(false);
  }
}

// v8.3.22: Pure credit/settlement integrity helpers extracted from app.js.
    function vc530DeletedSet() {
        return new Set();
    }

    function vc530SaveDeletedSet(set) {
        try { localStorage.removeItem('villacart_deleted_transactions'); } catch(e) {}
    }

    function vc530Norm(value) {
        return String(value || '').trim().toUpperCase();
    }

    function vc530IsSettlement(t) {
        if (!t) return false;
        const id = vc530Norm(t.id);
        const type = vc530Norm(t.type);
        const notes = vc530Norm(t.notes);
        return !!(
            t.settlementFor ||
            t.creditRef ||
            t.relatedCreditId ||
            (type === 'SA' && notes.includes('CR-')) ||
            (id.startsWith('SA-') && notes.includes('CR-')) ||
            notes.includes('SETTLEMENT') ||
            notes.includes('PAID CREDIT')
        );
    }

    function vc530CreditIdFromSettlement(t) {
        if (!t) return null;
        if (t.settlementFor) return t.settlementFor;
        if (t.creditRef) return t.creditRef;
        if (t.relatedCreditId) return t.relatedCreditId;
        const notes = String(t.notes || '');
        const match = notes.match(/CR-[A-Z0-9-]+/i);
        return match ? match[0].toUpperCase() : null;
    }

    function vc530IsCreditSale(t) {
        return !!t && vc530Norm(t.type) === 'CR' && !vc530IsSettlement(t);
    }

    function vc530CleanTransactions() {
        const deleted = vc530DeletedSet();
        return (state.transactions || []).filter(t => t && t.id && !deleted.has(t.id));
    }

    function vc530FindSettlementForCredit(creditId) {
        if (!creditId) return null;
        const target = vc530Norm(creditId);
        return vc530CleanTransactions()
            .filter(vc530IsSettlement)
            .find(t => vc530Norm(vc530CreditIdFromSettlement(t)) === target || vc530Norm(t.notes).includes(target));
    }

    function vc530CreditIsSettled(creditTx) {
        if (!creditTx) return false;
        if (creditTx.paid === true || creditTx.settled === true) return true;
        const status = vc530Norm(creditTx.status);
        if (status === 'PAID' || status === 'SETTLED') return true;
        if (Number(creditTx.balance) === 0 || Number(creditTx.balanceDue) === 0 || Number(creditTx.remaining) === 0) return true;
        return !!vc530FindSettlementForCredit(creditTx.id);
    }

    // Link future settlements to their original CR transaction where possible.
    function vc530AttachSettlementLink(transaction) {
        if (!transaction || !vc530IsSettlement(transaction) || transaction.settlementFor) return transaction;
        const creditId = vc530CreditIdFromSettlement(transaction);
        if (creditId) {
            transaction.settlementFor = creditId;
            transaction.linkType = 'creditSettlement';
        }
        return transaction;
    }
