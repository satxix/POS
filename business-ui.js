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
