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
