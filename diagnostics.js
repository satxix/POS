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
    if (report.versionInfo && !report.versionInfo.matches) problems.push('App/cache version mismatch');
    if (report.serviceWorker && report.serviceWorker.updateAvailable) problems.push('App update is waiting');
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

    const r = await vc559Collect({ readFirestore: false, useLastCloud: !!hydrateResult });
    if (hydrateResult) r.hydrateResult = hydrateResult;

    const txFs = r.firestore.transactions.count;
    const txMem = r.memory.transactions;
    const cloudSkipped = !!(r.firestore.transactions && r.firestore.transactions.skipped);
    const mismatch = !cloudSkipped && Number(txFs) > 0 && Number(txMem) !== Number(txFs);

    if (grid) {
      const posMark = vc559PosVisibleMark(r.startup);
      const lastMark = vc559LastStartupMark(r.startup);
      const versionText = r.versionInfo && r.versionInfo.matches ? 'Current' : 'Check';
      grid.innerHTML = [
        vc559Card('Overall', (r.online && r.dbReady && r.offlineQueue === 0) ? 'Good' : 'Check', vc559Summary(r), (r.online && r.dbReady && r.offlineQueue === 0) ? 'vc558-ok' : 'vc558-warn'),
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
        vc559Card('Version', versionText, r.versionInfo ? ('app ' + (r.versionInfo.appVersion || 'unknown') + ' / expected ' + (r.versionInfo.expectedVersion || 'unknown')) : 'version info missing', r.versionInfo && r.versionInfo.matches ? 'vc558-ok' : 'vc558-warn'),
        vc559Card('Update', r.serviceWorker && r.serviceWorker.updateAvailable ? 'Ready' : 'None', r.serviceWorker && r.serviceWorker.updateAvailable ? 'Tap Reload App below' : 'no waiting app update', r.serviceWorker && r.serviceWorker.updateAvailable ? 'vc558-warn' : 'vc558-ok')
      ].join('');
    }
    if (log) {
      const text = JSON.stringify(r, null, 2);
      log.textContent = text.length > 18000 ? text.slice(0, 18000) + '\n... diagnostics log truncated for performance; use Copy Report for full text ...' : text;
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
      newCopy.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); vc559Copy(); }, true);
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
