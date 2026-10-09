import { ApiError } from './errors.js';

/**
 * Check the explicit operator switch; missing or malformed values fail closed.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @returns {boolean} Whether new print work is enabled.
 */
export function isPrintEnabled(environment) {
    return environment.PRINT_ENABLED === 'true';
}

/**
 * Gate all print work while preserving status and authenticated recovery.
 * @param {string} pathname API request path.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @returns {void}
 * @throws {ApiError} When print work is disabled.
 */
export function requirePrintRequestEnabled(pathname, environment) {
    if (isPrintEnabled(environment)) return;
    if (pathname.startsWith('/api/public/print/')) {
        if (['/api/public/print/status', '/api/public/print/jobs/status'].includes(pathname)) return;
        throwPrintDisabled();
    }
    if (['/api/staff/print/upload-intents'].includes(pathname)
        || /^\/api\/staff\/print\/jobs\/[0-9a-f-]{36}\/finalize$/i.test(pathname)) throwPrintDisabled();
    if (!pathname.startsWith('/api/printer/')) return;
    if (['/api/printer/heartbeat', '/api/printer/reconcile'].includes(pathname)) return;
    if (/^\/api\/printer\/jobs\/[A-Za-z0-9_-]{1,64}\/result$/.test(pathname)) return;
    throwPrintDisabled();
}

function throwPrintDisabled() {
    throw new ApiError(503, 'PRINT_DISABLED', 'Yazdırma şu anda kapalı.', true);
}
