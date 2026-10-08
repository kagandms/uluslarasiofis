import { requireStaff } from '../auth/staffAuth.js';
import { isPrintEnabled, requirePrintRequestEnabled } from '../domain/print-gate.js';
import { readPrintUatPolicy } from '../domain/print-uat-policy.js';

/**
 * Require a real staff session for every browser print API during bounded UAT.
 * @param {Request} request Incoming API request.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @returns {Promise<void>}
 * @throws {ApiError} When printing is closed or staff authentication fails.
 */
export async function requirePrintRequestAccess(request, environment) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/public/print/status' || pathname === '/api/staff/print/uat/status') return;
    if (isPrintEnabled(environment) || !readPrintUatPolicy(environment)) {
        requirePrintRequestEnabled(pathname, environment);
        return;
    }
    if (pathname.startsWith('/api/public/print/')) {
        await requireStaff(request, environment, ['reviewer', 'admin']);
        return;
    }
    // Machine routes still pass through their existing PRINTER_SECRET authentication.
    if (pathname.startsWith('/api/printer/')) return;
    requirePrintRequestEnabled(pathname, environment);
}
