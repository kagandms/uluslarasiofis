import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createR2DocumentStorage } from '../src/server/storage/r2DocumentStorage.js';

test('R2 storage uses generated quarantine keys without student identifiers or public URLs', async () => {
    const storedObjects = new Map();
    const bucket = {
        async put(key, value, options) {
            storedObjects.set(key, { value, options });
            return { key };
        },
        async get(key) {
            const storedObject = storedObjects.get(key);
            return storedObject ? { key, body: storedObject.value, httpMetadata: storedObject.options.httpMetadata } : null;
        },
        async head(key) {
            return storedObjects.has(key) ? { key } : null;
        },
        async delete(key) {
            storedObjects.delete(key);
        }
    };
    const storage = createR2DocumentStorage(bucket, () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const key = storage.createQuarantineKey();

    assert.equal(key, 'quarantine/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.doesNotMatch(key, /student|passport|2026/i);
    await storage.put(key, new Uint8Array([1, 2, 3]), 'application/pdf');
    assert.deepEqual(await storage.head(key), { key });
    assert.equal((await storage.get(key)).key, key);
    assert.equal('url' in (await storage.get(key)), false);
    await storage.delete(key);
    assert.equal(await storage.get(key), null);
});

test('R2 storage rejects keys outside the generated private quarantine prefix', async () => {
    const storage = createR2DocumentStorage({});

    await assert.rejects(storage.get('students/2026123456/passport.pdf'), { code: 'INVALID_STORAGE_KEY' });
});
