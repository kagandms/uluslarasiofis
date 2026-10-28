const PRINT_KEY_PATTERN = /^print\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertPrintKey(key) {
    if (typeof key !== 'string' || !PRINT_KEY_PATTERN.test(key)) throw new TypeError('Invalid print storage key.');
}

export function createPrintStorage(bucket) {
    if (!bucket) throw new TypeError('A private print bucket binding is required.');

    return Object.freeze({
        put(key, body, options) {
            assertPrintKey(key);
            return bucket.put(key, body, options);
        },
        head(key) {
            assertPrintKey(key);
            return bucket.head(key);
        },
        get(key) {
            assertPrintKey(key);
            return bucket.get(key);
        },
        async delete(key) {
            assertPrintKey(key);
            await bucket.delete(key);
        }
    });
}
