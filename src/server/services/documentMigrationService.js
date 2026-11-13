import { REMOTE_MAX_OBJECT_BYTES } from '../storage/storageLimits.js';

const DEFAULT_BATCH_SIZE = 8;
const MAX_BATCH_SIZE = 20;
const KEY_PREFIX = 'quarantine/';

async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function failureDetail(error) {
    return typeof error?.s3Code === 'string' && /^[A-Za-z]{3,64}$/.test(error.s3Code) ? error.s3Code : undefined;
}

function failureCode(error) {
    return typeof error?.code === 'string' && /^[A-Z_]{3,64}$/.test(error.code) ? error.code : 'MIGRATION_ERROR';
}

async function migrateObject({ bucket, remote, object, dryRun, maxObjectBytes }) {
    if (object.size > maxObjectBytes) return { status: 'skipped_large' };
    const existing = await remote.head(object.key);
    if (existing) {
        return existing.size === object.size
            ? { status: 'already_present' }
            : { status: 'failed', reason: 'REMOTE_SIZE_MISMATCH' };
    }
    if (dryRun) return { status: 'would_copy' };
    const source = await bucket.get(object.key);
    if (!source) return { status: 'failed', reason: 'SOURCE_MISSING' };
    let bytes = new Uint8Array(await source.arrayBuffer());
    const expectedHash = await sha256Hex(bytes);
    const contentType = source.httpMetadata?.contentType || 'application/octet-stream';
    const expectedLength = bytes.length;
    const stored = await remote.putIfAbsent(object.key, bytes, contentType);
    // Drop the plaintext before the read-back so the Worker never holds more copies than needed.
    bytes = null;
    if (!stored) return { status: 'already_present' };
    const copy = await remote.get(object.key);
    const copied = copy ? new Uint8Array(await copy.arrayBuffer()) : null;
    if (!copied || copied.length !== expectedLength || await sha256Hex(copied) !== expectedHash) {
        await remote.delete(object.key);
        return { status: 'failed', reason: 'VERIFY_FAILED' };
    }
    return { status: 'copied' };
}

/**
 * Copies one bounded batch of R2 student-document objects into the encrypted remote store.
 * It only reads R2 and never deletes or overwrites anything there. Every copy is read back through the
 * remote adapter (decrypted) and compared by SHA-256 with the source bytes; a mismatch removes the new copy.
 * The call is stateless and idempotent: pass the returned cursor to continue, repeat until done.
 * @param {object} input Source bucket (R2 binding), remote adapter, and options.
 * @param {R2Bucket} input.bucket Legacy R2 bucket with list/get.
 * @param {object} input.remote Encrypted remote document storage.
 * @param {number} [input.limit] Objects per call (1 to 20), kept small for Worker subrequest limits.
 * @param {string|null} [input.cursor] Cursor from the previous call.
 * @param {boolean} [input.dryRun] Count what would be copied without writing.
 * @param {number} [input.maxObjectBytes] Objects above this size are counted as skipped_large and stay in R2 only.
 * @returns {Promise<object>} Counts, failures (key and code only), next cursor and completion flag.
 */
export async function migrateDocumentBatch({
    bucket, remote, limit = DEFAULT_BATCH_SIZE, cursor = null, dryRun = false, maxObjectBytes = REMOTE_MAX_OBJECT_BYTES
}) {
    const batchSize = Math.min(Math.max(Number.isInteger(limit) ? limit : DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    const listing = await bucket.list({ prefix: KEY_PREFIX, limit: batchSize, ...(cursor ? { cursor } : {}) });
    const result = { scanned: 0, copied: 0, already_present: 0, would_copy: 0, skipped_large: 0, failed: [], next_cursor: null, done: true };
    for (const object of listing.objects) {
        result.scanned += 1;
        let outcome;
        try {
            outcome = await migrateObject({ bucket, remote, object, dryRun, maxObjectBytes });
        } catch (error) {
            outcome = { status: 'failed', reason: failureCode(error), detail: failureDetail(error) };
        }
        if (outcome.status === 'failed') {
            result.failed.push({ key: object.key, reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) });
        }
        else result[outcome.status] += 1;
    }
    if (listing.truncated) {
        result.next_cursor = listing.cursor;
        result.done = false;
    }
    return result;
}
