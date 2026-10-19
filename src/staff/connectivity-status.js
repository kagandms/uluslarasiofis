const CONNECTIVITY_PROBE_TIMEOUT_MS = 4_000;
const OFFLINE_RETRY_COOLDOWN_MS = 15_000;

function updateUploadAvailability({ button, isReachable, previousPresentation }) {
    if (!button) return previousPresentation;
    if (!isReachable && !previousPresentation && !button.disabled) {
        const savedPresentation = { opacity: button.style.opacity, title: button.title };
        button.disabled = true;
        button.style.opacity = '0.5';
        button.title = 'Portal bağlantısı doğrulanamadı';
        return savedPresentation;
    }
    if (isReachable && previousPresentation) {
        button.disabled = false;
        button.style.opacity = previousPresentation.opacity;
        button.title = previousPresentation.title;
        return null;
    }
    return previousPresentation;
}

function createReachabilityState(button, notify) {
    let isReachable = true;
    let previousPresentation = null;
    return {
        get isReachable() { return isReachable; },
        update(nextReachability) {
            const wasReachable = isReachable;
            isReachable = nextReachability;
            previousPresentation = updateUploadAvailability({ button, isReachable, previousPresentation });
            if (wasReachable === isReachable) return;
            notify(isReachable
                ? 'Portal bağlantısı yeniden kuruldu.'
                : 'Portal bağlantısı doğrulanamadı. İnternet bağlantınızı kontrol edin.',
            isReachable ? 'success' : 'warning');
        }
    };
}

function createConnectivityProbe({ fetcher, windowObject, reachability }) {
    let pendingProbe = null;
    let retryAfter = 0;
    let shouldRecheck = false;
    let checkConnectivity;
    checkConnectivity = (reason = 'recovery') => {
        if (pendingProbe) {
            if (reason === 'network-change') shouldRecheck = true;
            return pendingProbe;
        }
        if (reason === 'recovery' && (reachability.isReachable || Date.now() < retryAfter)) {
            return Promise.resolve(reachability.isReachable);
        }
        pendingProbe = fetcher(new URL('/', windowObject.location.href), {
            method: 'HEAD',
            cache: 'no-store',
            credentials: 'omit',
            signal: AbortSignal.timeout(CONNECTIVITY_PROBE_TIMEOUT_MS)
        })
            .then(() => {
                if (shouldRecheck) return true;
                retryAfter = 0;
                reachability.update(true);
                return true;
            })
            .catch(() => {
                if (shouldRecheck) return false;
                retryAfter = Date.now() + OFFLINE_RETRY_COOLDOWN_MS;
                reachability.update(false);
                return false;
            })
            .finally(() => {
                pendingProbe = null;
                if (!shouldRecheck) return;
                shouldRecheck = false;
                void checkConnectivity('network-change');
            });
        return pendingProbe;
    };
    return checkConnectivity;
}

function registerConnectivityEvents(root, checkConnectivity) {
    root.addEventListener('online', () => { void checkConnectivity('network-change'); });
    root.addEventListener('offline', () => { void checkConnectivity('network-change'); });
    root.addEventListener('focus', () => { void checkConnectivity(); });
    root.document.addEventListener('visibilitychange', () => {
        if (root.document.visibilityState === 'visible') void checkConnectivity();
    });
}

/**
 * Tracks portal reachability without trusting the browser's online heuristic.
 * @param {{root: Document, fetcher: typeof fetch, notify: (message: string, type: string) => void}} options Browser dependencies and notification handler.
 * @returns {Promise<boolean>} Whether the initial portal probe reached the server.
 * @throws {TypeError} If a required browser dependency is missing.
 */
export function initializeConnectivityStatus({ root, fetcher, notify }) {
    const windowObject = root.defaultView;
    const reachability = createReachabilityState(root.getElementById('btn-upload'), notify);
    const checkConnectivity = createConnectivityProbe({ fetcher, windowObject, reachability });
    registerConnectivityEvents(windowObject, checkConnectivity);
    return checkConnectivity('startup');
}
