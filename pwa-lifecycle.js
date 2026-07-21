// PWA resume and print-return repaint helpers extracted from app.js in v8.2.4.
// Logic unchanged. This helps recover from Android/TWA black-screen and print-helper returns.
// Depends on app globals at event time: refreshActiveNavigationFromDOM, updateTodayBadge, updateSyncUI, renderFavorites, updateCartUI, vcStartupMark.

// v7.2.37: Android/PWA resume repaint guard.
// Some WebView/TWA sessions return from background as a black compositor
// frame until the user taps/back-navigates. This local-only repaint nudges
// the browser to redraw the visible screen without doing Firestore reads.
let vc7230LastResumeRepaintAt = 0;
function vc7230VisibleScreenId() {
    const visible = Array.from(document.querySelectorAll('.screen-transition[id^="screen-"]'))
        .find(el => !el.classList.contains('hidden'));
    return visible && visible.id ? visible.id.replace('screen-', '') : 'pos';
}

function vc7230ResumeRepaint(reason) {
    const now = Date.now();
    if (now - vc7230LastResumeRepaintAt < 700) return;
    vc7230LastResumeRepaintAt = now;
    try {
        const id = vc7230VisibleScreenId();
        document.documentElement.classList.add('vc-pwa-resume-repaint');
        document.body.classList.add('vc-pwa-resume-repaint');

        requestAnimationFrame(() => {
            try {
                const screen = document.getElementById('screen-' + id) || document.getElementById('screen-pos');
                if (screen) screen.classList.remove('hidden');
                refreshActiveNavigationFromDOM();
                updateTodayBadge();
                if (typeof updateSyncUI === 'function') updateSyncUI();
                if (id === 'pos') {
                    if (typeof renderFavorites === 'function') renderFavorites();
                    if (typeof updateCartUI === 'function') updateCartUI();
                }
                if (typeof vcStartupMark === 'function') vcStartupMark('pwa-resume-repaint', { reason, screen: id });
            } catch(e) {
                console.warn('PWA resume repaint inner failed', reason, e);
            }
            setTimeout(() => {
                document.documentElement.classList.remove('vc-pwa-resume-repaint');
                document.body.classList.remove('vc-pwa-resume-repaint');
            }, 180);
        });
    } catch(e) {
        console.warn('PWA resume repaint failed', reason, e);
    }
}

window.addEventListener('pageshow', () => vc7230ResumeRepaint('pageshow'));
window.addEventListener('focus', () => vc7230ResumeRepaint('focus'));
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') vc7230ResumeRepaint('visible');
});

function vc7285HandlePrintReturn(reason) {
    if (!window.__villacartPrintIntentAt) return;
    if (Date.now() - window.__villacartPrintIntentAt > 120000) {
        window.__villacartPrintIntentAt = 0;
        return;
    }
    setTimeout(() => {
        try {
            vc7230ResumeRepaint('print-return-' + reason);
            const visible = vc7230VisibleScreenId();
            const screen = document.getElementById('screen-' + visible) || document.getElementById('screen-pos');
            if (screen) screen.classList.remove('hidden');
            if (typeof refreshActiveNavigationFromDOM === 'function') refreshActiveNavigationFromDOM();
            if (typeof updateSyncUI === 'function') updateSyncUI();
            if (typeof vcStartupMark === 'function') vcStartupMark('print-return-repaint', { reason, screen: visible });
        } catch (error) {
            console.warn('Print return repaint failed', reason, error);
        }
    }, 250);
    setTimeout(() => { window.__villacartPrintIntentAt = 0; }, 1500);
}

window.addEventListener('focus', () => vc7285HandlePrintReturn('focus'));
window.addEventListener('pageshow', () => vc7285HandlePrintReturn('pageshow'));
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') vc7285HandlePrintReturn('visible');
});
