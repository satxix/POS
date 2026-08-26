(function(){
  async function vc559ReadCollection(name){
    if (typeof db === 'undefined' || !db) return {name, ok:false, count:null, docs:[], error:'db not ready'};
    try {
      const docs = await readCollectionWithFirestoreRest(name);
      return {name, ok:true, count:docs.length, empty:docs.length === 0, fromCache:false, docs};
    } catch(e) {
      return {name, ok:false, count:null, docs:[], error:e.message || String(e)};
    }
  }

  function vc559HasState(){
    try { return typeof state !== 'undefined' && state; } catch(e) { return false; }
  }

  function vc559GetMem(){
    if (!vc559HasState()) return {transactions:null, inventory:null, businessDays:null};
    return {
      transactions: Array.isArray(state.transactions) ? state.transactions.length : null,
      inventory: Array.isArray(state.inventory) ? state.inventory.length : null,
      businessDays: Array.isArray(state.businessDays) ? state.businessDays.length : null
    };
  }

  function vc559SortTx(list){
    return (list || []).sort((a,b)=>new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0));
  }

  function vc559CloudSummary(result, includeIds){
    const docs = Array.isArray(result && result.docs) ? result.docs : [];
    return {
      name: result && result.name,
      ok: !!(result && result.ok),
      count: result ? result.count : null,
      empty: result ? result.empty : null,
      fromCache: !!(result && result.fromCache),
      ids: includeIds ? docs.map(d => d && d.id).filter(Boolean).sort().slice(0, 80) : [],
      idsTruncated: includeIds && docs.length > 80 ? docs.length - 80 : 0,
      error: result && result.error ? result.error : null
    };
  }

  function vc559LocalCloudPlaceholder(name){
    return { name, ok:null, count:null, empty:null, fromCache:false, ids:[], idsTruncated:0, error:null, skipped:true };
  }

  async function vc559HydrateFromFirestore(){
    if (!vc559HasState()) throw new Error('App state is not ready yet.');
    const [tx, inv, bd] = await Promise.all([
      vc559ReadCollection('transactions'),
      vc559ReadCollection('inventory'),
      vc559ReadCollection('businessDays')
    ]);

    if (tx.ok) {
      state.transactions = vc559SortTx(tx.docs);
      try { localStorage.setItem('villacart_transactions', JSON.stringify(state.transactions)); } catch(e) {}
    }
    if (inv.ok) {
      state.inventory = inv.docs;
      try { localStorage.setItem('villacart_inventory', JSON.stringify(state.inventory)); } catch(e) {}
    }
    if (bd.ok) {
      state.businessDays = bd.docs;
      try { localStorage.setItem('villacart_business_days', JSON.stringify(state.businessDays)); } catch(e) {}
    }

    try { if (typeof sync === 'function') sync(); } catch(e) { console.warn(e); }
    try { if (typeof window.vc7240AutoClosePreviousBusinessDays === 'function') window.vc7240AutoClosePreviousBusinessDays('diagnostics-hydrate'); } catch(e) { console.warn(e); }

    try { if (typeof renderLedger === 'function') renderLedger(); } catch(e) { console.warn(e); }
    try { if (typeof renderInventory === 'function') renderInventory(); } catch(e) { console.warn(e); }
    try { if (typeof renderFavorites === 'function') renderFavorites(); } catch(e) { console.warn(e); }
    try { if (typeof renderPOS === 'function') renderPOS(); } catch(e) { console.warn(e); }
    try { if (typeof renderInsights === 'function') renderInsights(); } catch(e) { console.warn(e); }
    try { if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar(); } catch(e) { console.warn(e); }
    try { if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI(); } catch(e) { console.warn(e); }

    window.__vc559LastCloudSummary = {
      at: new Date().toISOString(),
      transactions: vc559CloudSummary(tx, true),
      inventory: vc559CloudSummary(inv, false),
      businessDays: vc559CloudSummary(bd, true)
    };
    window.__vc559LastHydrate = {at:window.__vc559LastCloudSummary.at, tx:tx.count, inventory:inv.count, businessDays:bd.count};
    return window.__vc559LastHydrate;
  }

  function vc559ExtractVersion(value){
    const text = String(value || '');
    const match = text.match(/v=?([0-9]+\.[0-9]+\.[0-9]+)/i);
    return match ? ('v' + match[1]) : null;
  }

  function vc559VersionInfo(){
    const appScript = document.querySelector('script[src*="app.js"]');
    const styleLink = document.querySelector('link[href*="styles.css"]');
    const diagScript = document.querySelector('script[src*="diagnostics.js"]');
    const controllerScript = navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null;
    const expected = window.VILLACART_EXPECTED_VERSION || vc559ExtractVersion(appScript && appScript.src) || null;
    const info = {
      expectedVersion: expected,
      appVersion: window.VILLACART_APP_VERSION || null,
      appScriptVersion: vc559ExtractVersion(appScript && appScript.src),
      stylesVersion: vc559ExtractVersion(styleLink && styleLink.href),
      diagnosticsVersion: vc559ExtractVersion(diagScript && diagScript.src),
      serviceWorkerVersion: vc559ExtractVersion(controllerScript),
      serviceWorkerControllerScript: controllerScript,
      updateAvailable: !!window.__villacartUpdateAvailable
    };
    info.matches = [info.appVersion, info.appScriptVersion, info.stylesVersion, info.diagnosticsVersion, info.serviceWorkerVersion]
      .filter(Boolean)
      .every(v => !expected || v === expected);
    return info;
  }

  async function vc559Collect(options){
    const opts = options || {};
    let transactions = vc559LocalCloudPlaceholder('transactions');
    let inventory = vc559LocalCloudPlaceholder('inventory');
    let businessDays = vc559LocalCloudPlaceholder('businessDays');

    if (opts.useLastCloud && window.__vc559LastCloudSummary) {
      transactions = window.__vc559LastCloudSummary.transactions || transactions;
      inventory = window.__vc559LastCloudSummary.inventory || inventory;
      businessDays = window.__vc559LastCloudSummary.businessDays || businessDays;
    } else if (opts.readFirestore) {
      const results = await Promise.all([
        vc559ReadCollection('transactions'),
        vc559ReadCollection('inventory'),
        vc559ReadCollection('businessDays')
      ]);
      transactions = vc559CloudSummary(results[0], true);
      inventory = vc559CloudSummary(results[1], false);
      businessDays = vc559CloudSummary(results[2], true);
      window.__vc559LastCloudSummary = { at: new Date().toISOString(), transactions, inventory, businessDays };
    }

    let deviceApproval = window.__villacartDeviceApproval || null;
    if (typeof window.villacartGetDeviceApprovalInfo === 'function') {
      try { deviceApproval = await window.villacartGetDeviceApprovalInfo(); }
      catch(e) { deviceApproval = { error: e && e.message ? e.message : String(e) }; }
    }
    let durableStorage = null;
    if (window.VillacartStorage && typeof window.VillacartStorage.getStatus === 'function') {
      try { durableStorage = await window.VillacartStorage.getStatus(); }
      catch(e) { durableStorage = { ready:false, lastError:e && e.message ? e.message : String(e) }; }
    }

    const report = {
      at: new Date().toISOString(),
      online: navigator.onLine,
      firebaseReady: typeof firebase !== 'undefined',
      dbReady: typeof db !== 'undefined' && !!db,
      firebaseProjectId: (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase.app().options.projectId : null,
      auth: window.__villacartAuthStatus || null,
      authReady: !!(window.__villacartAuthStatus && window.__villacartAuthStatus.ready),
      authUid: window.__villacartAuthStatus && window.__villacartAuthStatus.uid ? window.__villacartAuthStatus.uid : null,
      deviceApproval,
      stateReady: vc559HasState(),
      firestore: {
        transactions,
        inventory,
        businessDays
      },
      memory: vc559GetMem(),
      offlineQueue: (typeof offlineQueue !== 'undefined' && Array.isArray(offlineQueue)) ? offlineQueue.length : null,
      pendingQueue: (typeof offlineQueue !== 'undefined' && Array.isArray(offlineQueue)) ? offlineQueue.map(q => ({
        type: q.type,
        table: q.table,
        id: q.data && q.data.id,
        queuedAt: q.ts ? new Date(q.ts).toISOString() : null
      })) : [],
      syncErrorMsg: typeof syncErrorMsg !== 'undefined' ? (syncErrorMsg || null) : null,
      lastHydrate: window.__vc559LastHydrate || null,
      durableStorage,
      storageHydration: window.__villacartStorageHydration || null,
      startup: window.__villacartStartup || null,
      optionalLibraries: {
        quaggaLoaded: typeof Quagga !== 'undefined',
        chartLoaded: typeof Chart !== 'undefined',
        html2canvasLoaded: typeof html2canvas !== 'undefined'
      },
      serviceWorker: navigator.serviceWorker ? {
        controller: !!navigator.serviceWorker.controller,
        controllerScript: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
        updateAvailable: !!window.__villacartUpdateAvailable
      } : null,
      versionInfo: vc559VersionInfo(),
      scannerDebug: window.__villacartScannerDebug || null,
      archiveStatus: (typeof state !== 'undefined' && state && state.archiveMeta) ? {
        lastDeleteStatus: state.archiveMeta.lastDeleteStatus || null,
        lastDeleteAttemptAt: state.archiveMeta.lastDeleteAttemptAt || null,
        lastDeleteAt: state.archiveMeta.lastDeleteAt || null,
        lastDeleteEligible: Number(state.archiveMeta.lastDeleteEligible) || 0,
        lastDeleteCompleted: Number(state.archiveMeta.lastDeleteCompleted) || 0,
        lastDeleteTable: state.archiveMeta.lastDeleteTable || null,
        lastDeleteError: state.archiveMeta.lastDeleteError || null
      } : null,
      localIntegrity: window.__vc881LastIntegrity || null,
      diagnosticsMode: opts.useLastCloud ? 'full-refresh-result' : (opts.readFirestore ? 'cloud-check' : 'local-check')
    };
    window.__vc559LastReport = report;
    return report;
  }

  function vc559Escape(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function vc559Card(label, value, sub, cls){
    return '<div class="vc558-card '+(cls||'')+'"><label>'+vc559Escape(label)+'</label><strong>'+vc559Escape(value)+'</strong><small>'+vc559Escape(sub||'')+'</small></div>';
  }

  // v8.8.2 Read-only local integrity audit. This code never calls Firestore,
  // changes a record, repairs data, or deletes anything.
  function vc881Number(value){
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function vc881RecordId(record){
    return String(record && record.id || '').trim();
  }

  function vc881AddIssue(issues, severity, category, title, detail, ids){
    const cleanIds = Array.from(new Set((ids || []).map(value => String(value || '').trim()).filter(Boolean))).sort();
    issues.push({ severity, category, title, detail, ids: cleanIds });
  }

  function vc881CheckDuplicateIds(list, label, issues){
    const counts = new Map();
    const missing = [];
    (Array.isArray(list) ? list : []).forEach((record, index) => {
      const id = vc881RecordId(record);
      if (!id) missing.push(label + ' row ' + (index + 1));
      else counts.set(id, (counts.get(id) || 0) + 1);
    });
    const duplicates = Array.from(counts.entries()).filter(entry => entry[1] > 1).map(entry => entry[0] + ' ×' + entry[1]);
    if (duplicates.length) vc881AddIssue(issues, 'error', 'Duplicate IDs', label + ' contains duplicate record IDs', 'Duplicate IDs can make editing, deleting, and syncing target the wrong record.', duplicates);
    if (missing.length) vc881AddIssue(issues, 'error', 'Missing IDs', label + ' contains records without IDs', 'Records without IDs cannot be synchronized reliably.', missing);
  }

  function vc881CheckTransactions(live, archive, issues){
    vc881CheckDuplicateIds(live, 'Live transactions', issues);
    vc881CheckDuplicateIds(archive, 'Loaded backup transactions', issues);
    const liveById = new Map();
    const archiveById = new Map();
    const merged = new Map();
    (archive || []).forEach(record => { const id = vc881RecordId(record); if (id) { archiveById.set(id, record); merged.set(id, record); } });
    (live || []).forEach(record => { const id = vc881RecordId(record); if (id) { liveById.set(id, record); merged.set(id, record); } });
    const invalidDates = [];
    const invalidAmounts = [];
    const calculationIssues = [];
    const settlementIssues = [];
    const missingReferences = [];
    const unpaidReferences = [];
    const fullSettlementsByCredit = new Map();
    const referencePattern = /CR-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g;

    merged.forEach((tx, id) => {
      if (!tx.timestamp || Number.isNaN(new Date(tx.timestamp).getTime())) invalidDates.push(id);
      const totalRaw = Number(tx.total);
      if (!Number.isFinite(totalRaw) || totalRaw < 0) invalidAmounts.push(id + ' total');
      const items = Array.isArray(tx.items) ? tx.items : [];
      const badItem = items.some(item => !Number.isFinite(Number(item.qty)) || Number(item.qty) < 0 || !Number.isFinite(Number(item.price)) || Number(item.price) < 0);
      if (badItem) invalidAmounts.push(id + ' item');

      const breakdown = Array.isArray(tx.creditBreakdown) ? tx.creditBreakdown : [];
      const noteText = String(tx.notes || '');
      const noteReferences = noteText.match(referencePattern) || [];
      const isSettlement = tx.type === 'SA' && (breakdown.length > 0 || noteReferences.length > 0);
      if (!isSettlement && items.length && (tx.type === 'SA' || tx.type === 'CR')) {
        const itemSubtotal = items.reduce((sum, item) => sum + (vc881Number(item.price) * vc881Number(item.qty)), 0);
        const savedSubtotal = vc881Number(tx.subtotal);
        const discount = Math.max(0, vc881Number(tx.discount));
        const subtotal = savedSubtotal > 0 ? savedSubtotal : itemSubtotal;
        const expectedTotal = subtotal - discount;
        const isPartialCredit = tx.type === 'CR' && totalRaw < expectedTotal - 0.011;
        if (!isPartialCredit && Math.abs(expectedTotal - totalRaw) > 0.011) calculationIssues.push(id);
        if (savedSubtotal > 0 && Math.abs(savedSubtotal - itemSubtotal) > 0.011) calculationIssues.push(id + ' subtotal');
      }

      if (breakdown.length) {
        const breakdownTotal = breakdown.reduce((sum, ticket) => sum + vc881Number(ticket && ticket.total), 0);
        if (Math.abs(breakdownTotal - vc881Number(tx.total)) > 0.011) settlementIssues.push(id + ' total');
        breakdown.forEach(ticket => {
          const ticketId = vc881RecordId(ticket);
          const subtotal = vc881Number(ticket && ticket.subtotal);
          const discount = Math.max(0, vc881Number(ticket && ticket.discount));
          if (subtotal > 0 && Math.abs((subtotal - discount) - vc881Number(ticket && ticket.total)) > 0.011) settlementIssues.push(id + ' → ' + (ticketId || 'unknown ticket'));
        });
      }

      if (isSettlement) {
        const references = [];
        breakdown.forEach(ticket => { const ref = vc881RecordId(ticket); if (ref) references.push(ref); });
        noteReferences.forEach(ref => references.push(ref));
        const isPartialSettlement = noteText.trim().toLowerCase().startsWith('partial:');
        Array.from(new Set(references)).forEach(ref => {
          if (!isPartialSettlement) {
            if (!fullSettlementsByCredit.has(ref)) fullSettlementsByCredit.set(ref, new Set());
            fullSettlementsByCredit.get(ref).add(id);
          }
          const liveCredit = liveById.get(ref);
          const archiveCredit = archiveById.get(ref);
          if (!liveCredit && !archiveCredit) missingReferences.push(id + ' → ' + ref);
          // Archive-only credits are intentionally not rewritten when a later
          // live settlement closes them. Only a live credit still marked open
          // is actionable here.
          else if (!isPartialSettlement && liveCredit && liveCredit.type === 'CR' && !liveCredit.paid) unpaidReferences.push(id + ' → ' + ref);
        });
      }
    });

    const repeatedFullSettlements = [];
    fullSettlementsByCredit.forEach((settlementIds, creditId) => {
      if (settlementIds.size > 1) repeatedFullSettlements.push(creditId + ' → ' + Array.from(settlementIds).sort().join(', '));
    });

    if (invalidDates.length) vc881AddIssue(issues, 'warning', 'Transactions', 'Transactions with missing or invalid dates', 'These records may appear under the wrong date or fail date filtering.', invalidDates);
    if (invalidAmounts.length) vc881AddIssue(issues, 'error', 'Transactions', 'Transactions with invalid or negative values', 'Review the total, quantity, and price fields for these records.', invalidAmounts);
    if (calculationIssues.length) vc881AddIssue(issues, 'error', 'Transactions', 'Subtotal, discount, and total do not agree', 'Partially paid credits are excluded from this calculation check.', calculationIssues);
    if (settlementIssues.length) vc881AddIssue(issues, 'error', 'Settlements', 'Settlement breakdown totals do not agree', 'The saved ticket breakdown does not add up to the settlement total.', settlementIssues);
    if (repeatedFullSettlements.length) vc881AddIssue(issues, 'warning', 'Settlements', 'Credit tickets appear in more than one full settlement', 'Review these credits before deleting or changing anything. Partial settlements are excluded.', repeatedFullSettlements);
    if (missingReferences.length) vc881AddIssue(issues, 'warning', 'Settlements', 'Referenced credit tickets are not loaded locally', 'This can be normal when an older backup is not loaded. The checker does not contact Firestore.', missingReferences);
    if (unpaidReferences.length) vc881AddIssue(issues, 'warning', 'Settlements', 'Full settlements reference live credits still marked open', 'Archive-only credit tickets are excluded from this warning.', unpaidReferences);
  }

  function vc881CheckGcash(live, archive, issues){
    vc881CheckDuplicateIds(live, 'Live GCash records', issues);
    vc881CheckDuplicateIds(archive, 'Loaded backup GCash records', issues);
    const invalid = [];
    const invalidDates = [];
    const missingCashOutReferences = [];
    (live || []).concat(archive || []).forEach(record => {
      const id = vc881RecordId(record) || 'GCash record without ID';
      if (record.type !== 'cashIn' && record.type !== 'cashOut') invalid.push(id + ' type');
      if (!Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) invalid.push(id + ' amount');
      if (!Number.isFinite(Number(record.fee)) || Number(record.fee) < 0) invalid.push(id + ' fee');
      if (!record.timestamp || Number.isNaN(new Date(record.timestamp).getTime())) invalidDates.push(id);
      if (record.type === 'cashOut' && !String(record.referenceNotes || record.notes || '').trim()) missingCashOutReferences.push(id);
    });
    if (invalid.length) vc881AddIssue(issues, 'error', 'GCash', 'GCash records with invalid values', 'Review the type, amount, and service-fee fields.', invalid);
    if (invalidDates.length) vc881AddIssue(issues, 'warning', 'GCash', 'GCash records with missing or invalid dates', 'These records may not appear in the correct history range.', invalidDates);
    if (missingCashOutReferences.length) vc881AddIssue(issues, 'warning', 'GCash', 'Cash Out records without reference or notes', 'Current Cash Out records require a reference; older records may predate that rule.', missingCashOutReferences);
  }

  function vc881CheckInventory(inventory, issues){
    vc881CheckDuplicateIds(inventory, 'Inventory', issues);
    const barcodes = new Map();
    const invalidValues = [];
    (inventory || []).forEach(product => {
      const id = vc881RecordId(product) || String(product && product.name || 'Product without ID');
      const barcode = String(product && product.barcode || '').trim();
      if (barcode) {
        if (!barcodes.has(barcode)) barcodes.set(barcode, []);
        barcodes.get(barcode).push(id);
      }
      ['stock', 'price', 'cost'].forEach(field => {
        if (product && product[field] !== undefined && (!Number.isFinite(Number(product[field])) || Number(product[field]) < 0)) invalidValues.push(id + ' ' + field);
      });
    });
    const duplicateBarcodes = [];
    const placeholderBarcodes = [];
    barcodes.forEach((ids, barcode) => {
      if (ids.length <= 1) return;
      const item = barcode + ' → ' + ids.join(', ');
      const looksLikePlaceholder = barcode.length <= 6 && /^(\d)\1+$/.test(barcode);
      (looksLikePlaceholder ? placeholderBarcodes : duplicateBarcodes).push(item);
    });
    if (duplicateBarcodes.length) vc881AddIssue(issues, 'warning', 'Inventory', 'Multiple products use the same barcode', 'A scanner may select the wrong product when barcodes are duplicated.', duplicateBarcodes);
    if (placeholderBarcodes.length) vc881AddIssue(issues, 'info', 'Inventory', 'Shared placeholder barcodes', 'These short repeated-digit barcodes look intentionally reused. They are listed for reference and do not make the audit fail.', placeholderBarcodes);
    if (invalidValues.length) vc881AddIssue(issues, 'error', 'Inventory', 'Products with invalid or negative values', 'Review stock, selling price, and cost price.', invalidValues);
  }

  function vc881CheckQueue(queue, issues){
    const invalid = [];
    const keys = new Map();
    (queue || []).forEach((task, index) => {
      const id = vc881RecordId(task && task.data);
      if (!task || !task.table || !task.type || !id) invalid.push('Queue row ' + (index + 1));
      else {
        const key = task.table + ' / ' + id;
        keys.set(key, (keys.get(key) || 0) + 1);
      }
    });
    const duplicates = Array.from(keys.entries()).filter(entry => entry[1] > 1).map(entry => entry[0] + ' ×' + entry[1]);
    if (invalid.length) vc881AddIssue(issues, 'error', 'Pending Sync', 'Malformed pending-sync entries', 'These entries cannot be sent to Firestore correctly.', invalid);
    if (duplicates.length) vc881AddIssue(issues, 'warning', 'Pending Sync', 'Duplicate pending operations for the same record', 'Only the newest operation for a record should normally remain queued.', duplicates);
    if ((queue || []).length) vc881AddIssue(issues, 'warning', 'Pending Sync', (queue || []).length + ' operation(s) are waiting', 'These are local pending operations; no sync was triggered by this check.', (queue || []).map(task => (task && task.table || 'unknown') + ' / ' + vc881RecordId(task && task.data)));
  }

  async function vc881AuditLocalData(){
    if (typeof vc860HydrateDurableStorage === 'function') {
      try { await vc860HydrateDurableStorage(); } catch(error) {}
    }
    const issues = [];
    const liveTransactions = vc559HasState() && Array.isArray(state.transactions) ? state.transactions : [];
    const archiveTransactions = vc559HasState() && Array.isArray(state.archiveTransactions) ? state.archiveTransactions : [];
    const liveGcash = vc559HasState() && Array.isArray(state.gcashRecords) ? state.gcashRecords : [];
    const archiveGcash = vc559HasState() && Array.isArray(state.archiveGcashRecords) ? state.archiveGcashRecords : [];
    const inventory = vc559HasState() && Array.isArray(state.inventory) ? state.inventory : [];
    const queue = typeof offlineQueue !== 'undefined' && Array.isArray(offlineQueue) ? offlineQueue : [];

    vc881CheckTransactions(liveTransactions, archiveTransactions, issues);
    vc881CheckGcash(liveGcash, archiveGcash, issues);
    vc881CheckInventory(inventory, issues);
    vc881CheckQueue(queue, issues);

    let storageStatus = null;
    if (window.VillacartStorage && typeof window.VillacartStorage.getStatus === 'function') {
      try { storageStatus = await window.VillacartStorage.getStatus(); }
      catch(error) { storageStatus = { ready:false, lastError:error && error.message ? error.message : String(error) }; }
    }
    if (!storageStatus || !storageStatus.ready || storageStatus.lastError) {
      vc881AddIssue(issues, 'error', 'Local Database', 'Local database is not healthy', storageStatus && storageStatus.lastError ? storageStatus.lastError : 'IndexedDB status is unavailable or not ready.', []);
    }
    const estimate = storageStatus && storageStatus.estimate;
    if (estimate && estimate.quota > 0) {
      const ratio = estimate.usage / estimate.quota;
      if (ratio >= 0.8) vc881AddIssue(issues, ratio >= 0.95 ? 'error' : 'warning', 'Local Database', 'Browser storage is nearly full', (ratio * 100).toFixed(1) + '% of the available browser storage is being used.', []);
    }

    const result = {
      at: new Date().toISOString(),
      mode: 'local-only-read-only',
      firestoreReads: 0,
      firestoreWrites: 0,
      checked: {
        liveTransactions: liveTransactions.length,
        archiveTransactions: archiveTransactions.length,
        liveGcashRecords: liveGcash.length,
        archiveGcashRecords: archiveGcash.length,
        inventory: inventory.length,
        pendingSync: queue.length
      },
      summary: {
        errors: issues.filter(issue => issue.severity === 'error').length,
        warnings: issues.filter(issue => issue.severity === 'warning').length,
        notes: issues.filter(issue => issue.severity === 'info').length,
        affectedReferences: issues.reduce((sum, issue) => sum + issue.ids.length, 0)
      },
      storageStatus,
      issues
    };
    window.__vc881LastIntegrity = result;
    if (window.__vc559LastReport) window.__vc559LastReport.localIntegrity = result;
    if (window.__vc558LastReport) window.__vc558LastReport.localIntegrity = result;
    return result;
  }

  function vc881EnsureReportUi(){
    let panel = document.getElementById('vc881-integrity-report');
    if (panel) return panel;
    const log = document.getElementById('vc558-log');
    if (!log) return null;
    const anchor = document.getElementById('vc881-toggle-tech') || log;
    anchor.insertAdjacentHTML('beforebegin', '<section id="vc881-integrity-report" class="vc881-integrity-report hidden"><div class="vc881-integrity-head"><div><h4>Local Data Integrity</h4><p>Read-only · local data only · zero Firestore usage</p></div><strong id="vc881-integrity-status">Not checked</strong></div><div id="vc881-integrity-counts" class="vc881-integrity-counts"></div><div id="vc881-integrity-issues" class="vc881-integrity-issues"></div></section>');
    return document.getElementById('vc881-integrity-report');
  }

  function vc881RenderIntegrity(result){
    const panel = vc881EnsureReportUi();
    if (!panel) return;
    panel.classList.remove('hidden');
    const status = document.getElementById('vc881-integrity-status');
    const counts = document.getElementById('vc881-integrity-counts');
    const list = document.getElementById('vc881-integrity-issues');
    const errors = result.summary.errors;
    const warnings = result.summary.warnings;
    const notes = result.summary.notes || 0;
    status.textContent = errors ? 'Needs review' : (warnings ? 'Review warnings' : 'All clear');
    status.className = errors ? 'vc881-status-error' : (warnings ? 'vc881-status-warning' : 'vc881-status-ok');
    counts.innerHTML = '<div><span>Errors</span><strong>'+errors+'</strong></div><div><span>Warnings</span><strong>'+warnings+'</strong></div><div><span>Notes</span><strong>'+notes+'</strong></div>';
    if (!result.issues.length) {
      list.innerHTML = '<div class="vc881-integrity-clear"><strong>No local integrity problem detected.</strong><span>No records were changed and Firestore was not contacted.</span></div>';
      return;
    }
    list.innerHTML = result.issues.map(issue => {
      const ids = issue.ids.length ? '<div class="vc881-integrity-ids">'+issue.ids.map(vc559Escape).join('<br>')+'</div>' : '';
      return '<article class="vc881-integrity-issue vc881-'+vc559Escape(issue.severity)+'"><div><span>'+vc559Escape(issue.category)+'</span><strong>'+vc559Escape(issue.title)+'</strong><p>'+vc559Escape(issue.detail)+'</p></div>'+ids+'</article>';
    }).join('');
  }

  async function vc881RunLocalIntegrity(){
    const button = document.getElementById('vc881-local-integrity');
    if (button) { button.disabled = true; button.textContent = 'Checking Local Data...'; button.classList.add('opacity-70'); }
    try {
      const result = await vc881AuditLocalData();
      vc881RenderIntegrity(result);
      if (typeof showToast === 'function') showToast(result.summary.errors ? 'Local data needs review' : (result.summary.warnings ? 'Local data check completed with warnings' : 'Local data check passed'), result.summary.errors ? 'error' : (result.summary.warnings ? 'info' : 'success'));
    } catch(error) {
      console.error('Local integrity check failed:', error);
      if (typeof showToast === 'function') showToast('Could not check local data', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Check Local Data'; button.classList.remove('opacity-70'); }
    }
  }

  function vc559LastStartupMark(startup){
    if (!startup || !Array.isArray(startup.marks) || !startup.marks.length) return null;
    return startup.marks[startup.marks.length - 1] || null;
  }

  function vc559PosVisibleMark(startup){
    return startup && Array.isArray(startup.marks) ? startup.marks.find(x => x && x.name === 'pos-screen-shown') : null;
  }

  function vc559Summary(report){
    const problems = [];
    if (!report.online) problems.push('Device is offline');
    if (!report.dbReady) problems.push('Firestore is not ready');
    if (report.offlineQueue > 0) problems.push(report.offlineQueue + ' pending sync item(s)');
    if (report.durableStorage && report.durableStorage.lastError) problems.push('Local storage error');
    if (report.versionInfo && !report.versionInfo.matches) problems.push('App/cache version mismatch');
    if (report.serviceWorker && report.serviceWorker.updateAvailable) problems.push('App update is waiting');
    if (report.archiveStatus && report.archiveStatus.lastDeleteError && report.archiveStatus.lastDeleteStatus !== 'verified') {
      problems.push('Backup cloud deletion is incomplete');
    }
    if (report.localIntegrity && report.localIntegrity.summary) {
      if (report.localIntegrity.summary.errors > 0) problems.push('Local data needs review');
      else if (report.localIntegrity.summary.warnings > 0) problems.push('Local data has warnings');
    }
    return problems.length ? problems.join(' · ') : 'No obvious issue detected';
  }

  async function vc559Run(hydrate){
    const grid = document.getElementById('vc558-grid');
    const log = document.getElementById('vc558-log');
    if (grid) grid.innerHTML = vc559Card(hydrate ? 'Loading' : 'Checking','...','Please wait','vc558-warn');

    let hydrateResult = null;
    if (hydrate) {
      try { hydrateResult = await vc559HydrateFromFirestore(); }
      catch(e) {
        if (log) log.textContent = 'Hydrate failed: ' + (e.message || e);
      }
    }

    let refreshedIntegrity = null;
    if (hydrateResult) {
      try { refreshedIntegrity = await vc881AuditLocalData(); }
      catch(error) { console.warn('Post-refresh local integrity check failed:', error); }
    }

    const r = await vc559Collect({ readFirestore: false, useLastCloud: !!hydrateResult });
    if (hydrateResult) r.hydrateResult = hydrateResult;
    if (refreshedIntegrity) r.localIntegrity = refreshedIntegrity;

    const txFs = r.firestore.transactions.count;
    const txMem = r.memory.transactions;
    const cloudSkipped = !!(r.firestore.transactions && r.firestore.transactions.skipped);
    const mismatch = !cloudSkipped && Number(txFs) > 0 && Number(txMem) !== Number(txFs);

    if (grid) {
      const posMark = vc559PosVisibleMark(r.startup);
      const lastMark = vc559LastStartupMark(r.startup);
      const versionText = r.versionInfo && r.versionInfo.matches ? 'Current' : 'Check';
      const storageEstimate = r.durableStorage && r.durableStorage.estimate ? r.durableStorage.estimate : null;
      const storageDetail = storageEstimate
        ? ((storageEstimate.usage / 1048576).toFixed(1) + ' MB used of ' + (storageEstimate.quota / 1048576).toFixed(0) + ' MB')
        : 'browser quota estimate unavailable';
      const integrity = r.localIntegrity && r.localIntegrity.summary ? r.localIntegrity.summary : null;
      const integrityValue = !integrity ? 'Not checked' : (integrity.errors ? 'Review' : (integrity.warnings ? 'Warnings' : 'Clear'));
      const integrityClass = !integrity ? 'vc558-warn' : (integrity.errors ? 'vc558-bad' : (integrity.warnings ? 'vc558-warn' : 'vc558-ok'));
      const versionReady = !!(r.versionInfo && r.versionInfo.matches && !(r.serviceWorker && r.serviceWorker.updateAvailable));
      const archive = r.archiveStatus || null;
      const archiveFailed = !!(archive && archive.lastDeleteError && archive.lastDeleteStatus !== 'verified');
      const archiveVerified = !!(archive && archive.lastDeleteStatus === 'verified');
      const archiveValue = archiveFailed ? 'Incomplete' : (archiveVerified ? 'Verified' : 'No failure');
      const archiveDetail = archiveFailed
        ? ((archive.lastDeleteCompleted || 0) + '/' + (archive.lastDeleteEligible || 0) + ' deleted' + (archive.lastDeleteTable ? ' · ' + archive.lastDeleteTable : '') + ' · ' + archive.lastDeleteError)
        : (archiveVerified ? ((archive.lastDeleteCompleted || 0) + ' cloud record(s) verified deleted') : 'No incomplete backup deletion recorded');
      const overallGood = !!(r.online && r.dbReady && r.offlineQueue === 0 && versionReady && !archiveFailed && !(integrity && integrity.errors));
      grid.innerHTML = [
        vc559Card('Overall', overallGood ? 'Good' : 'Check', vc559Summary(r), overallGood ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Project', r.firebaseProjectId || 'Unknown', r.dbReady ? 'Firestore connected' : 'Firestore not ready', r.dbReady ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('Auth', r.authReady ? 'Ready' : 'Not ready', r.authUid ? ('Anonymous ' + String(r.authUid).slice(0, 8) + '...') : ((r.auth && r.auth.error) || 'No anonymous user yet'), r.authReady ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Device ID', r.deviceApproval && r.deviceApproval.ready ? 'Ready' : 'Not ready', r.deviceApproval && r.deviceApproval.uid ? ('UID ' + String(r.deviceApproval.uid).slice(0, 12) + '... / copy report for full ID') : ((r.deviceApproval && r.deviceApproval.error) || 'Run after auth is ready'), r.deviceApproval && r.deviceApproval.ready ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Online', r.online ? 'Yes' : 'No', r.syncErrorMsg || 'device/browser status', r.online ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('Pending Sync', r.offlineQueue === null ? 'N/A' : r.offlineQueue, r.offlineQueue > 0 ? 'will sync when possible' : 'nothing waiting', r.offlineQueue > 0 ? 'vc558-warn' : 'vc558-ok'),
        vc559Card('Sales Local / Cloud', (txMem === null ? 'N/A' : txMem) + ' / ' + (cloudSkipped ? 'not checked' : (txFs === null ? 'Err' : txFs)), cloudSkipped ? 'local-only check; use Full Refresh for cloud count' : (mismatch ? 'counts do not match' : 'transactions'), mismatch ? 'vc558-warn' : 'vc558-ok'),
        vc559Card('Stock Local / Cloud', (r.memory.inventory === null ? 'N/A' : r.memory.inventory) + ' / ' + (cloudSkipped ? 'not checked' : (r.firestore.inventory.count === null ? 'Err' : r.firestore.inventory.count)), cloudSkipped ? 'local-only check' : (r.firestore.inventory.error || 'inventory items'), cloudSkipped || r.firestore.inventory.ok ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('Business Days', (r.memory.businessDays === null ? 'N/A' : r.memory.businessDays) + ' local / ' + (cloudSkipped ? 'not checked' : (r.firestore.businessDays.count === null ? 'Err' : r.firestore.businessDays.count)) + ' cloud', cloudSkipped ? 'local-only check' : (r.firestore.businessDays.error || 'calendar records'), cloudSkipped || r.firestore.businessDays.ok ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('POS Visible', posMark ? (posMark.msSinceScriptStart + 'ms') : 'N/A', posMark ? 'screen shown quickly' : 'not recorded', posMark ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Background Ready', lastMark ? (lastMark.msSinceScriptStart + 'ms') : 'N/A', lastMark ? ('last: ' + (r.startup.lastMark || lastMark.name || 'unknown')) : 'not recorded', lastMark ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Scanner', r.scannerDebug && r.scannerDebug.lastBarcodeAttempt ? r.scannerDebug.lastBarcodeAttempt : 'No scan', r.scannerDebug ? ((r.scannerDebug.lastBarcodeResult || 'waiting') + ' / input: ' + (r.scannerDebug.lastInputValue || '').slice(0, 24)) : 'debug not ready', r.scannerDebug && r.scannerDebug.lastBarcodeResult && r.scannerDebug.lastBarcodeResult.indexOf('matched:') === 0 ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Optional Tools', (r.optionalLibraries && r.optionalLibraries.chartLoaded ? 'Chart ' : '') + (r.optionalLibraries && r.optionalLibraries.html2canvasLoaded ? 'Image ' : '') || 'Deferred', 'Camera scanner: ' + (r.optionalLibraries && r.optionalLibraries.quaggaLoaded ? 'ready' : 'not loaded'), 'vc558-ok'),
        vc559Card('Local Database', r.durableStorage && r.durableStorage.ready ? 'IndexedDB' : 'Fallback', r.durableStorage && r.durableStorage.lastError ? r.durableStorage.lastError : storageDetail, r.durableStorage && r.durableStorage.ready && !r.durableStorage.lastError ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Local Integrity', integrityValue, integrity ? (integrity.errors + ' errors · ' + integrity.warnings + ' warnings · local only') : 'Tap Check Local Data', integrityClass),
        vc559Card('Backup Delete', archiveValue, archiveDetail, archiveFailed ? 'vc558-bad' : 'vc558-ok'),
        vc559Card('Version', versionText, r.versionInfo ? ('app ' + (r.versionInfo.appVersion || 'unknown') + ' / expected ' + (r.versionInfo.expectedVersion || 'unknown')) : 'version info missing', r.versionInfo && r.versionInfo.matches ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Update', r.serviceWorker && r.serviceWorker.updateAvailable ? 'Ready' : 'None', r.serviceWorker && r.serviceWorker.updateAvailable ? 'Tap Reload App below' : 'no waiting app update', r.serviceWorker && r.serviceWorker.updateAvailable ? 'vc558-warn' : 'vc558-ok')
      ].join('');
    }
    if (log) {
      const text = JSON.stringify(r, null, 2);
      log.textContent = text.length > 18000 ? text.slice(0, 18000) + '\n... diagnostics log truncated for performance; use Copy Report for full text ...' : text;
    }
    if (refreshedIntegrity) vc881RenderIntegrity(refreshedIntegrity);
    const reloadBtn = document.getElementById('vc559-reload');
    if (reloadBtn && !reloadBtn.disabled) {
      const updateWaiting = !!(r.serviceWorker && r.serviceWorker.updateAvailable);
      reloadBtn.textContent = updateWaiting ? 'Install Update / Reload' : 'Reload App';
      reloadBtn.classList.toggle('vc881-update-ready', updateWaiting);
    }
  }

  function vc559CompactReport(report){
    const r = report || {};
    const startup = r.startup || {};
    const marks = Array.isArray(startup.marks) ? startup.marks : [];
    const lastMark = marks.length ? marks[marks.length - 1] : null;
    const posMark = vc559PosVisibleMark(startup);
    const pending = Array.isArray(r.pendingQueue) ? r.pendingQueue.slice(0, 30) : [];
    return {
      at: r.at || new Date().toISOString(),
      online: r.online,
      firebaseReady: r.firebaseReady,
      dbReady: r.dbReady,
      firebaseProjectId: r.firebaseProjectId,
      authReady: r.authReady,
      authUid: r.authUid || (r.auth && r.auth.uid) || null,
      authMode: r.auth && r.auth.mode ? r.auth.mode : null,
      authIsAnonymous: r.auth && typeof r.auth.isAnonymous !== 'undefined' ? r.auth.isAnonymous : null,
      deviceApproval: r.deviceApproval || null,
      firestore: {
        transactions: r.firestore && r.firestore.transactions ? {
          ok: r.firestore.transactions.ok,
          count: r.firestore.transactions.count,
          skipped: r.firestore.transactions.skipped,
          error: r.firestore.transactions.error || null
        } : null,
        inventory: r.firestore && r.firestore.inventory ? {
          ok: r.firestore.inventory.ok,
          count: r.firestore.inventory.count,
          skipped: r.firestore.inventory.skipped,
          error: r.firestore.inventory.error || null
        } : null,
        businessDays: r.firestore && r.firestore.businessDays ? {
          ok: r.firestore.businessDays.ok,
          count: r.firestore.businessDays.count,
          skipped: r.firestore.businessDays.skipped,
          error: r.firestore.businessDays.error || null
        } : null
      },
      memory: r.memory || null,
      offlineQueue: r.offlineQueue,
      pendingQueue: pending,
      pendingQueueTruncated: Array.isArray(r.pendingQueue) && r.pendingQueue.length > pending.length ? r.pendingQueue.length - pending.length : 0,
      syncErrorMsg: r.syncErrorMsg || null,
      lastHydrate: r.lastHydrate || null,
      hydrateResult: r.hydrateResult || null,
      durableStorage: r.durableStorage || null,
      storageHydration: r.storageHydration || null,
      startup: {
        posVisibleMs: posMark ? posMark.msSinceScriptStart : null,
        lastMark: startup.lastMark || (lastMark && lastMark.name) || null,
        lastMarkMs: lastMark ? lastMark.msSinceScriptStart : null,
        recentMarks: marks.slice(-12).map(m => ({ name: m.name, msSinceScriptStart: m.msSinceScriptStart, error: m.error || null }))
      },
      optionalLibraries: r.optionalLibraries || null,
      serviceWorker: r.serviceWorker || null,
      versionInfo: r.versionInfo || null,
      scannerDebug: r.scannerDebug ? {
        lastInputValue: r.scannerDebug.lastInputValue || '',
        lastBarcodeAttempt: r.scannerDebug.lastBarcodeAttempt || '',
        lastBarcodeResult: r.scannerDebug.lastBarcodeResult || '',
        lastHandledAt: r.scannerDebug.lastHandledAt || null,
        appVersion: r.scannerDebug.appVersion || null
      } : null,
      archiveStatus: r.archiveStatus || null,
      localIntegrity: r.localIntegrity || window.__vc881LastIntegrity || null,
      diagnosticsMode: r.diagnosticsMode || null
    };
  }

  async function vc559Copy(){
    const report = window.__vc559LastReport || window.__vc558LastReport || {};
    const text = JSON.stringify(vc559CompactReport(report), null, 2);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        if (typeof showToast === 'function') showToast('Compact diagnostics copied','success');
        else alert('Compact diagnostics copied');
        return;
      }
      throw new Error('Clipboard API unavailable');
    } catch(e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch(err) {}
      document.body.removeChild(ta);
      if (ok) {
        if (typeof showToast === 'function') showToast('Compact diagnostics copied','success');
        else alert('Compact diagnostics copied');
      } else {
        alert(text);
      }
    }
  }

  function vc559Bind(){
    const runBtn = document.getElementById('vc558-run');
    const copyBtn = document.getElementById('vc558-copy');
    if (runBtn) {
      runBtn.textContent = 'Load Firestore / Full Refresh';
      runBtn.title = 'Reads Firestore and replaces local app data. Use only when local data looks stale.';
      runBtn.replaceWith(runBtn.cloneNode(true));
      const newRun = document.getElementById('vc558-run');
      newRun.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); vc559Run(true); }, true);
      if (!document.getElementById('vc559-check')) {
        newRun.insertAdjacentHTML('beforebegin', '<button id="vc559-check" type="button" class="vc558-action bg-white border border-border-subtle text-primary">Check Status</button>');
        const checkBtn = document.getElementById('vc559-check');
        checkBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); vc559Run(false); }, true);
      }
      if (!document.getElementById('vc881-local-integrity')) {
        newRun.insertAdjacentHTML('beforebegin', '<button id="vc881-local-integrity" type="button" class="vc558-action bg-white border border-border-subtle text-primary">Check Local Data</button>');
        const integrityBtn = document.getElementById('vc881-local-integrity');
        integrityBtn.title = 'Read-only check of data already stored on this device. Uses zero Firestore reads or writes.';
        integrityBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); vc881RunLocalIntegrity(); }, true);
      }
      if (!document.getElementById('vc559-reload')) {
        newRun.insertAdjacentHTML('afterend', '<button id="vc559-reload" type="button" class="vc558-action bg-white border border-border-subtle text-primary">Reload App</button>');
        const reloadBtn = document.getElementById('vc559-reload');
        reloadBtn.addEventListener('click', function(e){
          e.preventDefault();
          e.stopPropagation();
          reloadBtn.disabled = true;
          reloadBtn.textContent = 'Reloading...';
          reloadBtn.classList.add('opacity-70');
          const runReload = function(){ if (typeof window.vcReloadApp === 'function') window.vcReloadApp(); else window.location.reload(); };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function(){ setTimeout(runReload, 20); });
          else setTimeout(runReload, 20);
        }, true);
      }
    }
    if (copyBtn) {
      copyBtn.replaceWith(copyBtn.cloneNode(true));
      const newCopy = document.getElementById('vc558-copy');
      newCopy.textContent = 'Copy Report';
      newCopy.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); vc559Copy(); }, true);
    }
    const techBtn = document.getElementById('vc881-toggle-tech');
    if (techBtn && !techBtn.__vc881Bound) {
      techBtn.__vc881Bound = true;
      techBtn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        const log = document.getElementById('vc558-log');
        if (!log) return;
        const willShow = log.classList.contains('hidden');
        log.classList.toggle('hidden', !willShow);
        techBtn.textContent = willShow ? 'Hide Technical Report' : 'Show Technical Report';
      }, true);
    }
    const closeBtn = document.getElementById('vc558-close');
    if (closeBtn && !closeBtn.__vc559CloseBound) {
      closeBtn.__vc559CloseBound = true;
      closeBtn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        const panel = document.getElementById('vc558-diag-panel');
        if (panel) {
          panel.classList.remove('vc-open');
          panel.classList.remove('open');
        }
      }, true);
    }

    const panel = document.getElementById('vc558-diag-panel');
    if (panel && !panel.__vc559BackdropBound) {
      panel.__vc559BackdropBound = true;
      panel.addEventListener('click', function(e){
        if (e.target === panel) {
          panel.classList.remove('vc-open');
          panel.classList.remove('open');
        }
      }, true);
    }

    const btn = document.getElementById('vc558-diag-btn');
    if (btn && !btn.__vc559OpenBound) {
      btn.__vc559OpenBound = true;
      btn.addEventListener('click', function(){
        setTimeout(function(){ vc559Run(false); }, 120);
      }, true);
    }
  }

  window.villacartDiagnostics = vc559Collect;
  window.villacartLoadFirestoreNow = vc559HydrateFromFirestore;
  window.villacartCheckLocalIntegrity = vc881AuditLocalData;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vc559Bind);
  else vc559Bind();
})();

(function(){
  // v5.6.1 Hidden Diagnostics Shortcut
  // Tap the version badge 5 times to open diagnostics. Floating button stays hidden.
  let vc561VersionTapCount = 0;
  let vc561VersionTapTimer = null;

  function vc561ShowHint(text) {
    let hint = document.getElementById('vc561-hidden-diagnostics-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'vc561-hidden-diagnostics-hint';
      hint.className = 'vc-hidden-diagnostics-hint';
      document.body.appendChild(hint);
    }
    hint.textContent = text;
    hint.classList.add('show');
    clearTimeout(hint.__timer);
    hint.__timer = setTimeout(() => hint.classList.remove('show'), 1300);
  }

  function vc561OpenDiagnostics() {
    const panel =
      document.getElementById('vc558-diag-panel') ||
      document.getElementById('vc557-diag-modal') ||
      document.getElementById('vc-audit-modal');

    if (panel) {
      panel.classList.add('vc-open');
      panel.classList.add('open');
      try {
        if (typeof vc559Run === 'function') vc559Run(false);
        else if (typeof vc557RefreshDiagnostics === 'function') vc557RefreshDiagnostics(false);
        else if (typeof vc560RenderAudit === 'function') vc560RenderAudit();
      } catch(e) {}
      return;
    }

    vc561ShowHint('Diagnostics not available in this build');
  }

  function vc561BindVersionShortcut() {
    const candidates = Array.from(document.querySelectorAll('.vc551-version, .vc550-version, .vc-build-badge, [class*="version"], [class*="badge"]'));
    const badges = candidates.filter(el => /v5\.6\.1|v\d+\.\d+\.\d+/.test(el.textContent || ''));
    badges.forEach(badge => {
      if (badge.__vc561Bound) return;
      badge.__vc561Bound = true;
      badge.style.cursor = 'pointer';
      badge.title = 'Tap 5 times for diagnostics';

      badge.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        vc561VersionTapCount++;
        clearTimeout(vc561VersionTapTimer);
        vc561VersionTapTimer = setTimeout(() => vc561VersionTapCount = 0, 1800);

        if (vc561VersionTapCount < 5) {
          vc561ShowHint(`${5 - vc561VersionTapCount} more tap${5 - vc561VersionTapCount === 1 ? '' : 's'} for diagnostics`);
        } else {
          vc561VersionTapCount = 0;
          vc561OpenDiagnostics();
        }
      }, true);
    });
  }

  window.villacartOpenDiagnostics = vc561OpenDiagnostics;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', vc561BindVersionShortcut);
  } else {
    vc561BindVersionShortcut();
  }
  setTimeout(vc561BindVersionShortcut, 800);
  setTimeout(vc561BindVersionShortcut, 2000);
})();
