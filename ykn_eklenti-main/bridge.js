// bridge.js
// İkamet Portalı (Web Sayfası) ile Eklenti (Background) arasında köprü görevi görür.
(() => {
    if (window !== window.top) return;
    if (window.__YKN_BRIDGE_LOADED__) return;
    window.__YKN_BRIDGE_LOADED__ = true;

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
        window.postMessage({
            source: 'EXTENSION',
            type: 'PONG',
            ready: true,
            requestId: payload.requestId
        }, '*');
        return;
    }
    
    // Mesajı eklenti arka planına gönder
    try {
        if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
            window.postMessage({
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'REQUEST_FAILED',
                requestId: payload.requestId,
                error: 'Eklenti arka planına ulaşılamadı. Eklentinin açık ve güncel olduğundan emin olun.'
            }, '*');
            return;
        }

        chrome.runtime.sendMessage({
            source: 'IKAMET_PORTAL',
            action: payload.action,
            ...payload
        }, (response) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
                console.error('Bridge -> Background Error:', chrome.runtime.lastError.message);
                window.postMessage({
                    source: 'EXTENSION',
                    type: 'EVENT',
                    action: 'REQUEST_FAILED',
                    requestId: payload.requestId,
                    error: 'Eklenti arka planına ulaşılamadı. Eklentinin açık ve güncel olduğundan emin olun.'
                }, '*');
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

