const STORAGE_KEY_PATTERN = /^quarantine\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Creates a private R2 storage adapter that never emits object URLs.
 * @param {R2Bucket} bucket Private R2 binding available only to the Worker.
 * @param {() => string} [createId] UUID source used for opaque object keys.
 * @returns {object} Private object operations for document services.
 */
export function createR2DocumentStorage(bucket, createId = () => crypto.randomUUID()) {
    if (!bucket) throw new TypeError('A private R2 bucket binding is required.');

    function assertStorageKey(key) {
        if (typeof key !== 'string' || !STORAGE_KEY_PATTERN.test(key)) {
            const error = new TypeError('Storage key is outside the private quarantine namespace.');
            error.code = 'INVALID_STORAGE_KEY';
            throw error;
        }
    }

    return Object.freeze({
        createQuarantineKey() {
            const id = createId();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
                throw new TypeError('Storage key generator must return a UUID.');
            }
            return `quarantine/${id}`;
        },
        async put(key, body, contentType) {
            assertStorageKey(key);
            return bucket.put(key, body, { httpMetadata: { contentType } });
        },
        async get(key) {
            assertStorageKey(key);
            return bucket.get(key);
        },
        async head(key) {
            assertStorageKey(key);
            return bucket.head(key);
        },
        async delete(key) {
            assertStorageKey(key);
            return bucket.delete(key);
        }
    });
}
