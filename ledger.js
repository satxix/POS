// Villacart shared credit helpers v8.0.56
// Single source for open/settled credit status used by Ledger and Notifications.
(function(){
  if (window.VillacartCreditUtils && window.VillacartCreditUtils.version === 'v8.0.56') return;

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

  function isCreditSettled(creditTx, allTx) {
    if (!creditTx) return false;
    if (creditTx.paid === true || creditTx.settled === true) return true;
    const status = norm(creditTx.status);
    if (status === 'PAID' || status === 'SETTLED') return true;
    if (hasZeroBalanceMarker(creditTx)) return true;

    const target = norm(creditTx.id);
    if (!target) return false;
    return (Array.isArray(allTx) ? allTx : []).some(tx => {
      if (!tx || tx.id === creditTx.id || !isCreditSettlement(tx)) return false;
      const notes = norm(tx.notes);
      if (notes.includes('PARTIAL:')) return false;
      return settlementCreditIds(tx).has(target);
    });
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
    return uniqueCredits(tx).filter(cr => !isCreditSettled(cr, tx));
  }

  function settledCredits(allTx) {
    const tx = Array.isArray(allTx) ? allTx : [];
    return uniqueCredits(tx).filter(cr => isCreditSettled(cr, tx));
  }

  window.VillacartCreditUtils = {
    version: 'v8.0.56',
    norm,
    isCreditSettlement,
    settlementCreditIds,
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
    ticket.paid = true;
    ticket._offline = true;
    const settlement = { id: settlementId, type: 'SA', total: ticket.total, timestamp: new Date().toISOString(), items: JSON.parse(JSON.stringify(ticket.items || [])), customer: ticket.customer, paid: true, cashReceived: ticket.total, change: 0, notes: ticket.id };
    await directSync('transactions', ticket);
    queueTransaction(settlement);
    showToast('Ticket paid', 'success');
  }
  lastTransactionId = settlementId;
  viewReceipt(settlementId);
  renderLedger();
}

async function payFullBalance(customerName) {
  const normalizedName = customerName.trim().toLowerCase();
  const credits = state.transactions.filter(transaction => transaction.type === 'CR'
    && transaction.customer
    && transaction.customer.trim().toLowerCase() === normalizedName
    && !transaction.paid);
  if (credits.length === 0) return;
  const totalToPay = credits.reduce((sum, transaction) => sum + transaction.total, 0);
  if (!confirm(`Collect full payment of ₱${totalToPay.toLocaleString()}?`)) return;
  const aggregatedItems = {};
  for (const ticket of credits) {
    if (ticket.items && Array.isArray(ticket.items)) {
      ticket.items.forEach(item => {
        const key = `${item.id}-${item.type}-${ticket.id}`;
        if (aggregatedItems[key]) aggregatedItems[key].qty += item.qty;
        else aggregatedItems[key] = { ...item, originalTicketId: ticket.id };
      });
    }
    ticket.paid = true;
    ticket._offline = true;
    await directSync('transactions', ticket);
  }
  const settlementId = nextTransactionId('SA');
  const settlement = { id: settlementId, type: 'SA', customer: customerName, total: totalToPay, timestamp: new Date().toISOString(), items: Object.values(aggregatedItems), notes: credits.map(ticket => ticket.id).join(', '), paid: true, cashReceived: totalToPay, change: 0 };
  queueTransaction(settlement);
  renderLedger();
  showToast('Balance paid', 'success');
  lastTransactionId = settlementId;
  viewReceipt(settlementId);
}
