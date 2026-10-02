import { ApiError } from './errors.js';

export const SCANNER_POLICY_VERSION = 'clamav-full-v1';
export const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const RESULT_CODES = new Set(['scanned','malware','engine_unavailable','signature_stale','update_failed','scan_timeout',
    'scan_error','policy_blocked','download_failed','content_mismatch','unsupported_content']);
const RESULT_KEYS = new Set(['file_id','revision_id','storage_key','byte_size','object_etag','sha256','outcome',
    'result_code','engine_version','signature_version','signature_updated_at','scanned_at','full_scan','policy_version']);

/** Hashes scanner credentials or content. @param {Uint8Array|string} value Input. @returns {Promise<string>} SHA-256 hex. */
export async function hashScannerValue(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Checks an opaque machine identifier. @param {unknown} value Identifier. @returns {string} Safe identifier. @throws {ApiError} Invalid input. */
export function requireScannerIdentifier(value) {
    if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) return value;
    throw new ApiError(400, 'INVALID_SCANNER_INPUT', 'Tarama isteği doğrulanamadı.');
}

/** @returns {ApiError} Safe invalid-evidence error. */
function createInvalidResultError() {
    return new ApiError(400, 'INVALID_SCAN_RESULT', 'Tarama sonucu doğrulanamadı.');
}

/** @param {unknown} value UTC timestamp. @param {number} now Epoch milliseconds. @param {number} maxAge Maximum age. @returns {boolean} Within trusted time window. */
function isRecentTime(value, now, maxAge) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp <= now + 30_000 && timestamp >= now - maxAge;
}

/** @param {object} result Scan evidence. @param {number} now Epoch milliseconds. @returns {void} Validated engine evidence. @throws {ApiError} Incomplete or stale evidence. */
function requireEngineEvidence(result, now) {
    if (![result.engine_version,result.signature_version].every((value) => typeof value === 'string' && /^[\w.+-]{1,64}$/.test(value))) throw createInvalidResultError();
    if (!isRecentTime(result.signature_updated_at, now, 86_400_000)) throw createInvalidResultError();
    if ((result.outcome === 'clean' && result.full_scan !== true) || !/^[a-f0-9]{64}$/.test(result.sha256 || '')) throw createInvalidResultError();
    if (result.outcome === 'clean' && result.result_code !== 'scanned') throw createInvalidResultError();
    if (result.outcome === 'unsafe' && result.result_code !== 'malware') throw createInvalidResultError();
}

/** Validates a bounded result tied to exactly one job. @param {object} input Result, job and time. @returns {object} Valid result. @throws {ApiError} Invalid or mismatched evidence. */
export function validateScannerResult({ result, job, now }) {
    if (Object.keys(result).length !== RESULT_KEYS.size || Object.keys(result).some((key) => !RESULT_KEYS.has(key))) throw createInvalidResultError();
    if (!['clean','unsafe','failed'].includes(result.outcome) || !RESULT_CODES.has(result.result_code)) throw createInvalidResultError();
    if (result.policy_version !== SCANNER_POLICY_VERSION || typeof result.full_scan !== 'boolean') throw createInvalidResultError();
    if (!isRecentTime(result.scanned_at, Date.parse(now), 300_000)) throw createInvalidResultError();
    if (result.file_id !== job.file_id || result.revision_id !== job.revision_id
        || result.storage_key !== job.storage_key || result.byte_size !== job.byte_size) throw createInvalidResultError();
    if (result.outcome !== 'failed') {
        requireEngineEvidence(result, Date.parse(now));
        if (!job.content_sha256 || result.sha256 !== job.content_sha256 || result.object_etag !== job.object_etag) throw createInvalidResultError();
        return result;
    }
    if (['scanned','malware'].includes(result.result_code)) throw createInvalidResultError();
    for (const value of [result.engine_version,result.signature_version]) {
        if (value !== null && !(typeof value === 'string' && /^[\w.+-]{1,64}$/.test(value))) throw createInvalidResultError();
    }
    if (result.signature_updated_at !== null && !isRecentTime(result.signature_updated_at,Date.parse(now),365*86_400_000)) throw createInvalidResultError();
    if (result.sha256 !== null && result.sha256 !== job.content_sha256) throw createInvalidResultError();
    if (result.object_etag !== null && result.object_etag !== job.object_etag) throw createInvalidResultError();
    return result;
}
