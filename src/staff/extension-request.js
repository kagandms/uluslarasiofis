/** Sends an action request to the browser extension over window.postMessage and resolves with its response. */
export function requestExtensionAction(view, action, payload = {}, timeoutMs = 45_000) {
    if (!view || typeof view.postMessage !== 'function' || typeof view.crypto?.randomUUID !== 'function') {
        return Promise.resolve({ state: 'unknown' });
    }
    const requestId = view.crypto.randomUUID();
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            view.clearTimeout(timer);
            view.removeEventListener('message', onMessage);
            resolve(result);
        };
        const onMessage = (event) => {
            if (event.source !== view || event.origin !== view.location.origin || event.data?.source !== 'EXTENSION'
                || event.data.requestId !== requestId) return;
            if (event.data.type === 'RESPONSE' && event.data.action === action) finish(event.data.response || { state: 'unknown' });
            else if (event.data.action === 'REQUEST_FAILED') finish({ state: 'unknown' });
        };
        const timer = view.setTimeout(() => finish({ state: 'unknown' }), timeoutMs);
        view.addEventListener('message', onMessage);
        try {
            view.postMessage({ source: 'WEB_APP', payload: { ...payload, action, requestId } }, view.location.origin);
        } catch {
            finish({ state: 'unknown' });
        }
    });
}
