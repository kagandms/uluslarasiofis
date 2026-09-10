// bridge.js
// İkamet Portalı (Web Sayfası) ile Eklenti (Background) arasında köprü görevi görür.
(() => {
    if (window !== window.top) return;
    const BRIDGE_VERSION = '1.2.31';
    if (window.__YKN_BRIDGE_LOADED__ && window.__YKN_BRIDGE_VERSION__ === BRIDGE_VERSION) return;
    window.__YKN_BRIDGE_LOADED__ = true;
    window.__YKN_BRIDGE_VERSION__ = BRIDGE_VERSION;

    const isContextInvalidated = (error) => /extension context invalidated/i.test(String(error?.message || error || ''));

    const reportBridgeFailure = (payload, error) => {
        const invalidated = isContextInvalidated(error);
        const message = invalidated
            ? 'Eklenti güncellendi veya yeniden yüklendi. Bu sayfayı yenileyin ve tekrar deneyin.'
            : 'Eklenti arka planına ulaşılamadı. Eklentinin açık ve güncel olduğundan emin olun.';
        window.postMessage({
            source: 'EXTENSION',
            type: 'EVENT',
            action: 'REQUEST_FAILED',
            requestId: payload?.requestId,
            error: message,
            code: invalidated ? 'EXTENSION_CONTEXT_INVALIDATED' : 'BRIDGE_UNAVAILABLE',
            recoverable: invalidated
        }, '*');
    };

console.log('[YKN Bridge] Aktif ve dinlemede.');

// Sayfa yüklendiğinde portala eklenti köprüsünün hazır olduğunu bildir
try {
    window.postMessage({
        source: 'EXTENSION',
        type: 'PONG',
        ready: true
    }, '*');
} catch (_) {}

// Web sayfasından gelen mesajları dinle ve arka plana ilet
window.addEventListener('message', (event) => {
    // Sadece aynı pencereden ve özel tipli mesajları kabul et
    if (event.source !== window || !event.data || event.data.source !== 'WEB_APP') {
        return;
    }

    const payload = event.data.payload;
    if (!payload || !payload.action) return;

    // Portal handshake / PING kontrolü
    if (payload.action === 'PING') {
        try {
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
            }, '*');
        } catch (error) {
            reportBridgeFailure(payload, error);
        }
        return;
    }
    
    // Mesajı eklenti arka planına gönder
    try {
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
                console.error('Bridge -> Background Error:', chrome.runtime.lastError.message);
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
            }, '*');
        });
    } catch (err) {
        console.error('Bridge sendMessage hatası:', err);
        reportBridgeFailure(payload, err);
    }
});

// Arka plandan gelen olayları (örn. arama sonuçları) dinle ve web sayfasına ilet
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.source === 'APPLY_TOPKAPI') {
            window.postMessage({
                source: 'EXTENSION',
                type: 'EVENT',
                action: request.action,
                requestId: request.requestId,
                data: request.data,
                error: request.error
            }, '*');
        }
    });
}
})();
