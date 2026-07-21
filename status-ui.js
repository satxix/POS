// Status, queue badge, and navigation UI helpers extracted from app.js in v8.2.3.
// Loaded before app.js so later app.js compatibility patches can still wrap these functions.
// Depends on app globals at call time: syncErrorMsg, isSyncing, offlineQueue, syncNow.

function updateSyncUI() {
    const pill = document.getElementById('sync-pill');
    const dot = document.getElementById('sync-dot');
    const text = document.getElementById('sync-text');
    const spinner = document.getElementById('sync-spinner');
    const errLabel = document.getElementById('sync-error-label');
    if (!pill) return;
    
    if (syncErrorMsg) {
        errLabel.classList.remove('hidden');
        errLabel.innerText = syncErrorMsg;
        pill.classList.add('ring-2', 'ring-red-500/50');
    } else {
        errLabel.classList.add('hidden');
        pill.classList.remove('ring-2', 'ring-red-500/50');
    }

    if (!navigator.onLine) {
        pill.classList.replace('bg-white/10', 'bg-red-500/20'); pill.classList.replace('border-white/20', 'border-red-500/40');
        dot.classList.replace('bg-green-400', 'bg-red-500'); text.innerText = "Offline"; spinner.classList.add('hidden'); return;
    }
    if (isSyncing) { 
        dot.classList.add('hidden'); 
        spinner.classList.remove('hidden'); 
        spinner.classList.add('animate-spin-custom'); 
        text.innerText = "Syncing..."; 
    }
    else { 
        pill.classList.remove('bg-red-500/20', 'border-red-500/40'); 
        pill.classList.add('bg-white/10', 'border-white/20'); 
        dot.classList.remove('hidden'); 
        dot.classList.replace('bg-red-500', 'bg-green-400'); 
        spinner.classList.add('hidden'); 
        text.innerText = "Online"; 
    }
    updateQueueBadge();
}

function updateQueueBadge() {
    const badge = document.getElementById('queue-badge');
    if (badge) { if (offlineQueue.length > 0) { badge.innerText = offlineQueue.length; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); } }
}

function isPendingSync(table, id) {
    return Array.isArray(offlineQueue) && offlineQueue.some(task => task && task.table === table && task.data && task.data.id === id);
}

window.addEventListener('online', () => { updateSyncUI(); syncNow(); });
window.addEventListener('offline', () => { updateSyncUI(); });


// v5.6.1 UI Polish helpers
function updateActiveNavigation(screen) {
    document.querySelectorAll('.nav-item').forEach(btn => {
        const isActive = btn.dataset.screen === screen;
        btn.classList.toggle('nav-active', isActive);
        btn.classList.toggle('text-primary', isActive);
        btn.classList.toggle('text-on-surface-variant', !isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
}

function updateTodayBadge() {
    const syncPill = document.getElementById('sync-pill');
    const syncTimestamp = document.getElementById('sync-timestamp');
    const now = new Date();
    const dateText = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (syncPill && !syncPill.dataset.vcPolished) {
        syncPill.dataset.vcPolished = 'true';
        syncPill.title = `Today • ${dateText}`;
    }
    if (syncTimestamp && !syncTimestamp.dataset.vcDateAdded) {
        syncTimestamp.dataset.vcDateAdded = 'true';
        syncTimestamp.innerText = `Today • ${dateText} • Last Synced: --:--`;
    }
}

function applyUIPolish() {
    updateTodayBadge();
    document.querySelectorAll('button').forEach(btn => btn.classList.add('vc-touch-polish'));
    const active = document.querySelector('.screen-transition:not(.hidden)');
    if (active && active.id && active.id.startsWith('screen-')) {
        updateActiveNavigation(active.id.replace('screen-', ''));
    } else {
        updateActiveNavigation('pos');
    }
}


// v5.6.1 UI Polish Fix: keep active nav synced on mobile/tablet
function refreshActiveNavigationFromDOM() {
    const visibleScreen = Array.from(document.querySelectorAll('[id^="screen-"]'))
        .find(el => !el.classList.contains('hidden'));
    if (visibleScreen && visibleScreen.id) {
        updateActiveNavigation(visibleScreen.id.replace('screen-', ''));
    }
}

document.addEventListener('click', (event) => {
    const navBtn = event.target.closest('.nav-item[data-screen]');
    if (!navBtn) return;
    updateActiveNavigation(navBtn.dataset.screen);
    setTimeout(refreshActiveNavigationFromDOM, 80);
});
