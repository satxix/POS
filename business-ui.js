// --- Villacart Business UI module ---
// v8.1.3: Archive safety display helpers extracted from app.js. Backup/load/Firestore actions remain in app.js.

    function archiveFormatDateTime(value) {
        if (!value) return 'Never';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return 'Unknown';
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function updateArchiveMeta(patch) {
        state.archiveMeta = { ...(state.archiveMeta || {}), ...(patch || {}), updatedAt: new Date().toISOString() };
        if (typeof saveLocalArchive === 'function') saveLocalArchive();
        renderArchiveSafety();
    }

    function renderArchiveSafety() {
        const panel = document.getElementById('vc728-archive-safety');
        if (!panel) return;
        const meta = state.archiveMeta || {};
        const txCount = Array.isArray(state.archiveTransactions) ? state.archiveTransactions.length : 0;
        const dayCount = Array.isArray(state.archiveBusinessDays) ? state.archiveBusinessDays.length : 0;
        const gcashCount = Array.isArray(state.archiveGcashRecords) ? state.archiveGcashRecords.length : 0;
        const lastExport = archiveFormatDateTime(meta.lastExportAt);
        const lastLoad = archiveFormatDateTime(meta.lastLoadAt);
        const loadFile = meta.lastLoadFile ? ' • ' + String(meta.lastLoadFile) : '';
        const exportScope = meta.lastArchiveBefore ? 'Before ' + String(meta.lastArchiveBefore) : 'No archive export yet';
        panel.innerHTML = '<div class="flex items-start gap-3">' +
            '<div class="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">verified_user</span></div>' +
            '<div class="min-w-0 flex-1">' +
                '<div class="flex flex-wrap items-center gap-2">' +
                    '<p class="text-[10px] font-black uppercase tracking-[0.22em] text-primary/70">Backup Safety</p>' +
                    '<span class="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase">Local archive only</span>' +
                '</div>' +
                '<p class="mt-1 text-xs font-bold text-on-surface-variant">Loaded archives stay on this device and are not written back to Firestore.</p>' +
                '<div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-bold">' +
                    '<div class="rounded-2xl bg-white/80 border border-border-subtle p-3"><span class="block uppercase text-[9px] tracking-widest text-on-surface-variant">Last export</span><strong class="text-primary">' + lastExport + '</strong><span class="block text-on-surface-variant mt-1">' + exportScope + '</span></div>' +
                    '<div class="rounded-2xl bg-white/80 border border-border-subtle p-3"><span class="block uppercase text-[9px] tracking-widest text-on-surface-variant">Last local load</span><strong class="text-primary">' + lastLoad + '</strong><span class="block text-on-surface-variant mt-1 truncate">' + (loadFile || 'No file loaded') + '</span></div>' +
                    '<div class="rounded-2xl bg-white/80 border border-border-subtle p-3"><span class="block uppercase text-[9px] tracking-widest text-on-surface-variant">Local archive stored</span><strong class="text-primary">' + txCount + ' tx / ' + dayCount + ' day(s) / ' + gcashCount + ' GCash</strong><span class="block text-on-surface-variant mt-1">Keep original JSON files safe</span></div>' +
                '</div>' +
                '<div class="mt-3 flex flex-wrap items-center gap-2">' +
                    '<button type="button" onclick="clearLoadedArchiveData()" class="px-3 py-2 rounded-2xl bg-error/10 text-error text-[10px] font-black uppercase tracking-wider border border-error/10 active-scale">Delete loaded backup data</button>' +
                    '<span class="text-[10px] font-bold text-on-surface-variant">This clears local archive history on this device only.</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

window.vc728RenderArchiveSafety = renderArchiveSafety;
setTimeout(renderArchiveSafety, 300);

// Business-day header display helpers moved from app.js in v8.3.17.
    // v5.6.1 Brand Header Controller
    function vc545FormatToday() {
        const now = new Date();
        const mobile = window.innerWidth < 620;
        return mobile
            ? `Today • ${now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' })}`
            : `Today • ${now.toLocaleDateString(undefined, { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}`;
    }

    function vc545RefreshTodayLine() {
        const el = document.getElementById('vc-today-line');
        if (el) el.innerText = vc545FormatToday();
    }

    function vc545NormalizeHeaderStatus() {
        const day = document.getElementById('business-day-pill');
        const dayText = document.getElementById('business-day-text');
        if (day && dayText) {
            const raw = (dayText.innerText || '').trim().toUpperCase();
            day.classList.remove('open','closed','none','waiting');
            if (raw.includes('OPEN')) {
                dayText.innerText = 'Open';
                day.classList.add('open');
            } else if (raw.includes('CLOSED')) {
                dayText.innerText = 'Closed';
                day.classList.add('closed');
            } else {
                dayText.innerText = 'Waiting';
                day.classList.add('waiting');
            }
        }

        const sync = document.getElementById('sync-pill');
        const syncText = document.getElementById('sync-text');
        if (sync && syncText) {
            const online = navigator.onLine;
            sync.classList.toggle('offline', !online);
            syncText.innerText = online ? 'Online' : 'Offline';
        }

        vc545RefreshTodayLine();
    }

    // v5.6.1 Premium Header Text Normalizer
    function vc547PremiumHeaderText() {
        const dayText = document.getElementById('business-day-text');
        if (dayText) {
            const raw = (dayText.innerText || '').toUpperCase();
            if (raw.includes('OPEN')) dayText.innerText = 'OPEN';
            else if (raw.includes('CLOSED')) dayText.innerText = 'CLOSED';
            else dayText.innerText = 'WAITING';
        }

        const syncText = document.getElementById('sync-text');
        if (syncText) syncText.innerText = navigator.onLine ? 'ONLINE' : 'OFFLINE';

        const dateLine = document.getElementById('vc-today-line');
        if (dateLine) {
            const now = new Date();
            dateLine.innerText = window.innerWidth < 620
                ? now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' })
                : `Today • ${now.toLocaleDateString(undefined, { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}`;
        }
    }

    // v5.6.1 Ultra Compact Header Date Line
    function vc548UpdateCompactDate() {
        const copy = document.querySelector('.vc-brand-copy');
        if (!copy) return;
        const now = new Date();
        const syncEl = document.getElementById('sync-timestamp');
        let sync = '--:--';
        if (syncEl && syncEl.innerText) {
            const match = syncEl.innerText.match(/(\d{1,2}:\d{2})/);
            if (match) sync = match[1];
        }
        const date = window.innerWidth < 500
            ? now.toLocaleDateString(undefined, { day:'2-digit', month:'short' })
            : now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
        copy.setAttribute('data-date-line', `${date} • Sync ${sync}`);
    }

    // v5.6.1 Stable Header Controller
    function vc551GetTodayBusinessDay() {
        try {
            if (typeof getCurrentBusinessDay === 'function') return getCurrentBusinessDay();
        } catch(e) {}
        try {
            const today = new Date();
            const code = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
            if (state && Array.isArray(state.businessDays)) {
                return state.businessDays.find(b => b.date === code && b.status === 'OPEN') || null;
            }
        } catch(e) {}
        return null;
    }

    function vc551RefreshHeader() {
        const date = document.getElementById('vc551-date');
        if (date) {
            const now = new Date();
            date.innerText = window.innerWidth < 620
                ? `Today • ${now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short' })}`
                : `Today • ${now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' })}`;
        }

        const dayPill = document.getElementById('vc551-day-pill');
        const dayText = document.getElementById('vc551-day-text');
        if (dayPill && dayText) {
            dayPill.classList.remove('waiting','closed','open');
            const bd = vc551GetTodayBusinessDay();
            if (bd && String(bd.status || '').toUpperCase() === 'CLOSED') {
                dayText.innerText = 'CLOSED';
                dayPill.classList.add('closed');
            } else if (bd) {
                dayText.innerText = 'OPEN';
                dayPill.classList.add('open');
            } else {
                dayText.innerText = 'WAITING';
                dayPill.classList.add('waiting');
            }
        }

        const syncPill = document.getElementById('vc551-sync-pill');
        const syncText = document.getElementById('vc551-sync-text');
        if (syncPill && syncText) {
            syncPill.classList.toggle('offline', !navigator.onLine);
            syncText.innerText = navigator.onLine ? 'ONLINE' : 'OFFLINE';
        }

        const alertDot = document.getElementById('vc551-notif-dot');
        const oldDot = document.getElementById('notif-dot');
        if (alertDot && oldDot) alertDot.classList.toggle('hidden', oldDot.classList.contains('hidden'));
        if (typeof renderHeaderLowStockTicker === 'function') renderHeaderLowStockTicker();
    }

    function vc551DebouncedHeader() {
        clearTimeout(window.__vc551HeaderTimer);
        window.__vc551HeaderTimer = setTimeout(vc551RefreshHeader, 80);
    }
