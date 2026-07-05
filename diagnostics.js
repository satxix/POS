(function(){
  async function readCount(name){
    if (typeof db === 'undefined' || !db) return {name, ok:false, count:null, error:'db not ready'};
    try {
      const snap = await db.collection(name).limit(50).get({source:'server'});
      return {name, ok:true, count:snap.size, empty:snap.empty, fromCache:!!snap.metadata.fromCache};
    } catch(e) {
      return {name, ok:false, count:null, error:e.message || String(e)};
    }
  }

  async function collect(){
    const transactions = await readCount('transactions');
    const inventory = await readCount('inventory');
    const businessDays = await readCount('businessDays');
    const report = {
      at: new Date().toISOString(),
      online: navigator.onLine,
      firebaseReady: typeof firebase !== 'undefined',
      dbReady: typeof db !== 'undefined' && !!db,
      firebaseProjectId: (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase.app().options.projectId : null,
      firestore: { transactions, inventory, businessDays },
      memory: {
        transactions: (window.state && Array.isArray(state.transactions)) ? state.transactions.length : null,
        inventory: (window.state && Array.isArray(state.inventory)) ? state.inventory.length : null,
        businessDays: (window.state && Array.isArray(state.businessDays)) ? state.businessDays.length : null
      },
      offlineQueue: Array.isArray(window.offlineQueue) ? offlineQueue.length : null,
      pendingQueue: Array.isArray(window.offlineQueue) ? offlineQueue.map(q => ({
        type: q.type,
        table: q.table,
        id: q.data && q.data.id,
        queuedAt: q.ts ? new Date(q.ts).toISOString() : null
      })) : [],
      syncErrorMsg: typeof syncErrorMsg !== 'undefined' ? (syncErrorMsg || null) : null,
      startup: window.__villacartStartup || null,
      optionalLibraries: {
        quaggaLoaded: typeof Quagga !== 'undefined',
        chartLoaded: typeof Chart !== 'undefined',
        html2canvasLoaded: typeof html2canvas !== 'undefined'
      },
      serviceWorker: navigator.serviceWorker ? {
        controller: !!navigator.serviceWorker.controller,
        controllerScript: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null
      } : null,
      scannerDebug: window.__villacartScannerDebug || null,
      lastSnapshots: {
        transactions: window.__villacartLastTransactionsSnapshot || null,
        businessDays: window.__villacartLastBusinessDaysSnapshot || null
      }
    };
    window.__vc558LastReport = report;
    return report;
  }

  function card(label, value, sub, cls){
    return '<div class="vc558-card '+(cls||'')+'"><label>'+label+'</label><strong>'+value+'</strong><small>'+(sub||'')+'</small></div>';
  }

  async function run(){
    const grid = document.getElementById('vc558-grid');
    const log = document.getElementById('vc558-log');
    if (grid) grid.innerHTML = card('Checking','...','Please wait','vc558-warn');

    let r = await collect();

    const txFs = r.firestore.transactions.count;
    const txMem = r.memory.transactions;
    const mismatch = Number(txFs) > 0 && Number(txMem) === 0;

    if (grid) {
      grid.innerHTML = [
        card('DB', r.dbReady ? 'Ready' : 'No', r.dbReady ? 'Firestore object exists' : 'db missing', r.dbReady ? 'vc558-ok' : 'vc558-bad'),
        card('Firestore Tx', txFs === null ? 'Err' : txFs, r.firestore.transactions.error || 'transactions collection', r.firestore.transactions.ok ? 'vc558-ok' : 'vc558-bad'),
        card('Memory Tx', txMem === null ? 'N/A' : txMem, mismatch ? 'Firestore has tx but app memory is empty' : 'state.transactions', mismatch ? 'vc558-bad' : 'vc558-ok'),
        card('Queue', r.offlineQueue === null ? 'N/A' : r.offlineQueue, 'offline queue', r.offlineQueue > 0 ? 'vc558-warn' : 'vc558-ok'),
        card('Inventory FS', r.firestore.inventory.count === null ? 'Err' : r.firestore.inventory.count, r.firestore.inventory.error || 'inventory collection', r.firestore.inventory.ok ? 'vc558-ok' : 'vc558-bad'),
        card('Inventory Mem', r.memory.inventory === null ? 'N/A' : r.memory.inventory, 'state.inventory', r.memory.inventory > 0 ? 'vc558-ok' : 'vc558-warn'),
        card('Business Days', r.firestore.businessDays.count === null ? 'Err' : r.firestore.businessDays.count, r.firestore.businessDays.error || 'businessDays collection', r.firestore.businessDays.ok ? 'vc558-ok' : 'vc558-bad'),
        card('Online', r.online ? 'Yes' : 'No', r.syncErrorMsg || 'browser online status', r.online ? 'vc558-ok' : 'vc558-bad')
      ].join('');
    }
    if (log) log.textContent = JSON.stringify(r, null, 2);
  }

  function openPanel(){
    var panel = document.getElementById('vc558-diag-panel');
    if (panel) panel.classList.add('vc-open');
    // The current diagnostics handler below performs the one authoritative
    // check. Do not also run this legacy checker.
  }
  function closePanel(){
    var panel = document.getElementById('vc558-diag-panel');
    if (panel) panel.classList.remove('vc-open');
  }
  function copyReport(){
    var text = JSON.stringify(window.__vc558LastReport || {}, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function(){
        if (typeof showToast === 'function') showToast('Diagnostics copied','success');
      }).catch(function(){ alert(text); });
    } else alert(text);
  }

  window.villacartDiagnostics = collect;
  window.vc558OpenDiagnostics = openPanel;

  function bind(){
    var btn = document.getElementById('vc558-diag-btn');
    var close = document.getElementById('vc558-close');
    var runBtn = document.getElementById('vc558-run');
    var copyBtn = document.getElementById('vc558-copy');
    if (btn) btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); openPanel(); }, true);
    if (close) close.addEventListener('click', function(e){ e.preventDefault(); closePanel(); });
    if (runBtn) runBtn.addEventListener('click', function(e){ e.preventDefault(); run(); });
    if (copyBtn) copyBtn.addEventListener('click', function(e){ e.preventDefault(); copyReport(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

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

  async function vc559HydrateFromFirestore(){
    if (!vc559HasState()) throw new Error('App state is not ready yet.');
    const tx = await vc559ReadCollection('transactions');
    const inv = await vc559ReadCollection('inventory');
    const bd = await vc559ReadCollection('businessDays');

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

    try { if (typeof renderLedger === 'function') renderLedger(); } catch(e) { console.warn(e); }
    try { if (typeof renderInventory === 'function') renderInventory(); } catch(e) { console.warn(e); }
    try { if (typeof renderFavorites === 'function') renderFavorites(); } catch(e) { console.warn(e); }
    try { if (typeof renderPOS === 'function') renderPOS(); } catch(e) { console.warn(e); }
    try { if (typeof renderInsights === 'function') renderInsights(); } catch(e) { console.warn(e); }
    try { if (typeof renderBusinessCalendar === 'function') renderBusinessCalendar(); } catch(e) { console.warn(e); }
    try { if (typeof updateBusinessDayUI === 'function') updateBusinessDayUI(); } catch(e) { console.warn(e); }

    window.__vc559LastHydrate = {at:new Date().toISOString(), tx:tx.count, inventory:inv.count, businessDays:bd.count};
    return window.__vc559LastHydrate;
  }

  async function vc559Collect(){
    const transactions = await vc559ReadCollection('transactions');
    const inventory = await vc559ReadCollection('inventory');
    const businessDays = await vc559ReadCollection('businessDays');
    const report = {
      at: new Date().toISOString(),
      online: navigator.onLine,
      firebaseReady: typeof firebase !== 'undefined',
      dbReady: typeof db !== 'undefined' && !!db,
      firebaseProjectId: (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase.app().options.projectId : null,
      stateReady: vc559HasState(),
      firestore: {
        transactions: {name:'transactions', ok:transactions.ok, count:transactions.count, empty:transactions.empty, fromCache:!!transactions.fromCache, ids:(transactions.docs || []).map(d => d.id).sort(), error:transactions.error || null},
        inventory: {name:'inventory', ok:inventory.ok, count:inventory.count, empty:inventory.empty, fromCache:!!inventory.fromCache, error:inventory.error || null},
        businessDays: {name:'businessDays', ok:businessDays.ok, count:businessDays.count, empty:businessDays.empty, fromCache:!!businessDays.fromCache, error:businessDays.error || null}
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
      startup: window.__villacartStartup || null,
      optionalLibraries: {
        quaggaLoaded: typeof Quagga !== 'undefined',
        chartLoaded: typeof Chart !== 'undefined',
        html2canvasLoaded: typeof html2canvas !== 'undefined'
      },
      serviceWorker: navigator.serviceWorker ? {
        controller: !!navigator.serviceWorker.controller,
        controllerScript: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null
      } : null
    };
    window.__vc559LastReport = report;
    return report;
  }

  function vc559Card(label, value, sub, cls){
    return '<div class="vc558-card '+(cls||'')+'"><label>'+label+'</label><strong>'+value+'</strong><small>'+(sub||'')+'</small></div>';
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

    const r = await vc559Collect();
    if (hydrateResult) r.hydrateResult = hydrateResult;

    const txFs = r.firestore.transactions.count;
    const txMem = r.memory.transactions;
    const mismatch = Number(txFs) > 0 && Number(txMem) !== Number(txFs);

    if (grid) {
      grid.innerHTML = [
        vc559Card('DB', r.dbReady ? 'Ready' : 'No', r.dbReady ? 'Firestore object exists' : 'db missing', r.dbReady ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('State', r.stateReady ? 'Ready' : 'No', r.stateReady ? 'App state is accessible' : 'state not ready', r.stateReady ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('Firestore Tx', txFs === null ? 'Err' : txFs, r.firestore.transactions.error || 'transactions collection', r.firestore.transactions.ok ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('Memory Tx', txMem === null ? 'N/A' : txMem, mismatch ? 'Does not match Firestore count' : 'state.transactions', mismatch ? 'vc558-bad' : 'vc558-ok'),
        vc559Card('Queue', r.offlineQueue === null ? 'N/A' : r.offlineQueue, 'offline queue', r.offlineQueue > 0 ? 'vc558-warn' : 'vc558-ok'),
        vc559Card('Inventory FS', r.firestore.inventory.count === null ? 'Err' : r.firestore.inventory.count, r.firestore.inventory.error || 'inventory collection', r.firestore.inventory.ok ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('Inventory Mem', r.memory.inventory === null ? 'N/A' : r.memory.inventory, 'state.inventory', r.memory.inventory > 0 ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Business Days', r.firestore.businessDays.count === null ? 'Err' : r.firestore.businessDays.count, r.firestore.businessDays.error || 'businessDays collection', r.firestore.businessDays.ok ? 'vc558-ok' : 'vc558-bad'),
        vc559Card('POS Visible', (() => { const m = r.startup && Array.isArray(r.startup.marks) ? r.startup.marks.find(x => x && x.name === 'pos-screen-shown') : null; return m ? (m.msSinceScriptStart + 'ms') : 'N/A'; })(), r.startup ? 'pos-screen-shown timing' : 'not recorded', r.startup ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Background Ready', r.startup && r.startup.marks && r.startup.marks.length ? (r.startup.marks[r.startup.marks.length - 1].msSinceScriptStart + 'ms') : 'N/A', r.startup ? ('last: ' + (r.startup.lastMark || 'unknown')) : 'not recorded', r.startup ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Optional Libs', (r.optionalLibraries && r.optionalLibraries.chartLoaded ? 'Chart ' : '') + (r.optionalLibraries && r.optionalLibraries.html2canvasLoaded ? 'Image ' : '') || 'Deferred', 'Quagga: ' + (r.optionalLibraries && r.optionalLibraries.quaggaLoaded ? 'loaded' : 'not loaded'), 'vc558-ok'),
        vc559Card('Scanner', r.scannerDebug && r.scannerDebug.lastBarcodeAttempt ? r.scannerDebug.lastBarcodeAttempt : 'No scan', r.scannerDebug ? ((r.scannerDebug.lastBarcodeResult || 'waiting') + ' / input: ' + (r.scannerDebug.lastInputValue || '').slice(0, 24)) : 'debug not ready', r.scannerDebug && r.scannerDebug.lastBarcodeResult && r.scannerDebug.lastBarcodeResult.indexOf('matched:') === 0 ? 'vc558-ok' : 'vc558-warn')
      ].join('');
    }
    if (log) log.textContent = JSON.stringify(r, null, 2);
  }

  async function vc559Copy(){
    const text = JSON.stringify(window.__vc559LastReport || window.__vc558LastReport || {}, null, 2);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        if (typeof showToast === 'function') showToast('Diagnostics copied','success');
        else alert('Diagnostics copied');
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
        if (typeof showToast === 'function') showToast('Diagnostics copied','success');
        else alert('Diagnostics copied');
      } else {
        alert(text);
      }
    }
  }

  function vc559Bind(){
    const runBtn = document.getElementById('vc558-run');
    const copyBtn = document.getElementById('vc558-copy');
    if (runBtn) {
      runBtn.textContent = 'Load Firestore';
      runBtn.replaceWith(runBtn.cloneNode(true));
      const newRun = document.getElementById('vc558-run');
      newRun.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); vc559Run(true); }, true);
    }
    if (copyBtn) {
      copyBtn.replaceWith(copyBtn.cloneNode(true));
      const newCopy = document.getElementById('vc558-copy');
      newCopy.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); vc559Copy(); }, true);
    }
    const btn = document.getElementById('vc558-diag-btn');
    if (btn) btn.addEventListener('click', function(){ setTimeout(function(){ vc559Run(false); }, 120); }, true);
  }

  window.villacartDiagnostics = vc559Collect;
  window.villacartLoadFirestoreNow = vc559HydrateFromFirestore;

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
    const badge = candidates.find(el => /v5\.6\.1|v\d+\.\d+\.\d+/.test(el.textContent || ''));
    if (!badge || badge.__vc561Bound) return;

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
