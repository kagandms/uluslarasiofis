// bridge.js
// İkamet Portalı (Web Sayfası) ile Eklenti (Background) arasında köprü görevi görür.
(() => {
    if (window !== window.top) return;
    const BRIDGE_VERSION = '1.2.34';
    const isStaffRoute = () => window.location.pathname === '/yetkili'
        || window.location.pathname.startsWith('/yetkili/');
    if (!isStaffRoute()) return;
    if (window.__YKN_BRIDGE_LOADED__ && window.__YKN_BRIDGE_VERSION__ === BRIDGE_VERSION) return;
    window.__YKN_BRIDGE_LOADED__ = true;
    window.__YKN_BRIDGE_VERSION__ = BRIDGE_VERSION;

    const isContextInvalidated = (error) => /extension context invalidated/i.test(String(error?.message || error || ''));

    async function hasStaffSession() {
        try {
            const response = await fetch('/api/session', {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    const reportBridgeFailure = (payload, error) => {
        const invalidated = isContextInvalidated(error);
        const requiresLogin = error?.code === 'STAFF_SESSION_REQUIRED';
        const message = requiresLogin
            ? 'Yetkili oturumu gerekli. Yeniden giriş yapıp tekrar deneyin.'
            : (invalidated
                ? 'Eklenti güncellendi veya yeniden yüklendi. Bu sayfayı yenileyin ve tekrar deneyin.'
                : 'Eklenti arka planına ulaşılamadı. Eklentinin açık ve güncel olduğundan emin olun.');
        window.postMessage({
            source: 'EXTENSION',
            type: 'EVENT',
            action: 'REQUEST_FAILED',
            requestId: payload?.requestId,
            error: message,
            code: requiresLogin ? 'STAFF_SESSION_REQUIRED' : (invalidated ? 'EXTENSION_CONTEXT_INVALIDATED' : 'BRIDGE_UNAVAILABLE'),
            recoverable: requiresLogin || invalidated
        }, window.location.origin);
    };

    function reportMissingStaffSession(payload) {
        const error = new Error('Staff session is required.');
        error.code = 'STAFF_SESSION_REQUIRED';
        reportBridgeFailure(payload, error);
    }

// Sayfa yüklendiğinde portala eklenti köprüsünün hazır olduğunu bildir
void hasStaffSession().then((isAuthenticated) => {
    if (!isAuthenticated || !isStaffRoute()) return;
    window.postMessage({ source: 'EXTENSION', type: 'PONG', ready: true }, window.location.origin);
});

// Web sayfasından gelen mesajları dinle ve arka plana ilet
window.addEventListener('message', async (event) => {
    // Sadece aynı pencereden ve özel tipli mesajları kabul et
    if (event.source !== window
        || event.origin !== window.location.origin
        || !isStaffRoute()
        || !event.data
        || event.data.source !== 'WEB_APP') {
        return;
    }

    const payload = event.data.payload;
    if (!payload || !payload.action) return;

    // Portal handshake / PING kontrolü
    if (payload.action === 'PING') {
        try {
            if (!await hasStaffSession()) {
                reportMissingStaffSession(payload);
                return;
            }
            // Eski content-script bağlamı, eklenti yenilense bile PING'i alabilir.
            // Runtime'a erişebildiğimizi doğrulamadan köprüyü hazır bildirmeyelim.
            if (typeof chrome === 'undefined' || !chrome?.runtime?.id) {
                throw new Error('Extension context invalidated');
            }
            window.postMessage({
                source: 'EXTENSION',
                type: 'PONG',
                ready: true,
                requestId: payload.requestId
            }, window.location.origin);
        } catch (error) {
            reportBridgeFailure(payload, error);
        }
        return;
    }
    
    // Mesajı eklenti arka planına gönder
    try {
        if (!await hasStaffSession() || !isStaffRoute()) {
            reportMissingStaffSession(payload);
            return;
        }
        if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
            reportBridgeFailure(payload, new Error('Extension context invalidated'));
            return;
        }

        chrome.runtime.sendMessage({
            source: 'IKAMET_PORTAL',
            action: payload.action,
            ...payload
        }, (response) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
                reportBridgeFailure(payload, chrome.runtime.lastError);
                return;
            }

            // Arka plandan gelen yanıtı web sayfasına geri gönder (opsiyonel)
            window.postMessage({
                source: 'EXTENSION',
                type: 'RESPONSE',
                action: payload.action,
                requestId: payload.requestId,
                response: response
            }, window.location.origin);
        });
    } catch (err) {
        reportBridgeFailure(payload, err);
    }
});

// Arka plandan gelen olayları (örn. arama sonuçları) dinle ve web sayfasına ilet
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.source === 'APPLY_TOPKAPI' && isStaffRoute()) {
            void hasStaffSession().then((isAuthenticated) => {
                if (!isAuthenticated || !isStaffRoute()) return;
                window.postMessage({
                    source: 'EXTENSION',
                    type: 'EVENT',
                    action: request.action,
                    requestId: request.requestId,
                    data: request.data,
                    error: request.error
                }, window.location.origin);
            });
        }
    });
}
})();
