import { ApiError } from './errors.js';
import { isPrintEnabled } from './print-gate.js';

const MAX_UAT_WINDOW_MS = 15 * 60_000;
export const PRINT_UAT_SLOT_ID = 'staff-print-uat-v7';

/**
 * Read a bounded staff UAT policy; malformed settings fail closed.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @param {number} now Current epoch milliseconds.
 * @returns {Readonly<{startedAt: number, expiresAt: number, documentHash: string}>|null} Active policy.
 */
export function readPrintUatPolicy(environment, now = Date.now()) {
    if (environment.PRINT_ENABLED !== 'false' || environment.PRINT_UAT_ENABLED !== 'true') return null;
    const startedAt = parseUatTimestamp(environment.PRINT_UAT_STARTED_AT);
    const expiresAt = parseUatTimestamp(environment.PRINT_UAT_EXPIRES_AT);
    const documentHash = environment.PRINT_UAT_DOCUMENT_SHA256;
    if (!Number.isFinite(now) || !Number.isFinite(startedAt) || !Number.isFinite(expiresAt)
        || expiresAt <= startedAt || expiresAt - startedAt > MAX_UAT_WINDOW_MS
        || now < startedAt || now >= expiresAt
        || typeof documentHash !== 'string' || !/^[a-f0-9]{64}$/.test(documentHash)) return null;
    return Object.freeze({ startedAt, expiresAt, documentHash });
}

/**
 * Restrict staff UAT without changing production limits.
 * @param {Readonly<Record<string, unknown>>} input Browser upload settings.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @returns {void}
 * @throws {ApiError} When settings or the UAT window are invalid.
 */
export function requirePrintUatUpload(input, environment) {
    if (!requireActivePrintUatPolicy(environment)) return;
    if (input.media_type !== 'application/pdf' || input.copies !== 1 || input.paper_size !== 'A4'
        || input.color_mode !== 'monochrome' || input.duplex !== 'simplex') {
        throw new ApiError(400, 'PRINT_UAT_INPUT_INVALID', 'UAT yalnız tek sentetik PDF kopyasını kabul eder.');
    }
}

/**
 * Bind every v7 UAT attempt to one server-controlled slot, including later windows.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @returns {string|null} Server-controlled idempotency scope.
 * @throws {ApiError} When a configured UAT window has expired.
 */
export function readPrintUatIdempotencyScope(environment) {
    const policy = requireActivePrintUatPolicy(environment);
    if (!policy) return null;
    return PRINT_UAT_SLOT_ID;
}

/**
 * Recheck expiry immediately before a database transition.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @returns {string|null} Canonical UTC deadline for the database clock guard.
 * @throws {ApiError} When the configured window is no longer active.
 */
export function readPrintUatDeadline(environment) {
    const policy = requireActivePrintUatPolicy(environment);
    return policy ? new Date(policy.expiresAt).toISOString() : null;
}

/**
 * Verify the synthetic file before queueing and delivering its bytes to the Agent.
 * @param {Uint8Array} bytes Uploaded document bytes.
 * @param {Readonly<Record<string, unknown>>} environment Worker bindings.
 * @returns {Promise<void>}
 * @throws {ApiError} When content differs or the UAT window has expired.
 */
export async function requirePrintUatContent(bytes, environment) {
    const policy = requireActivePrintUatPolicy(environment);
    if (!policy) return;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    requireActivePrintUatPolicy(environment);
    const contentHash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (contentHash !== policy.documentHash) {
        throw new ApiError(415, 'PRINT_UAT_DOCUMENT_INVALID', 'UAT sentetik dosyası doğrulanamadı.');
    }
}

function requireActivePrintUatPolicy(environment) {
    const policy = readPrintUatPolicy(environment);
    if (!policy && !isPrintEnabled(environment) && environment.PRINT_UAT_ENABLED === 'true') {
        throw new ApiError(503, 'PRINT_DISABLED', 'Yazdırma şu anda kapalı.', true);
    }
    return policy;
}

function parseUatTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}
