import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentStorage } from '../src/server/storage/documentStorage.js';
import {
    createKeyring, createKeyringFromEnvironment, decryptObject, encryptObject, ENCRYPTION_OVERHEAD_BYTES
} from '../src/server/storage/encryptedObject.js';
import { createRemoteDocumentStorage } from '../src/server/storage/remoteDocumentStorage.js';

const KEY_A = 'quarantine/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY_B = 'quarantine/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MASTER_1 = Buffer.alloc(32, 7).toString('base64');
const MASTER_2 = Buffer.alloc(32, 9).toString('base64');
const PLAINTEXT = new TextEncoder().encode('passport-bytes-that-must-never-reach-the-host');

function keyring(keys = { 1: MASTER_1 }, currentKeyId = 1) {
    return createKeyring({ keys, currentKeyId });
}

/** In-memory S3-compatible host: stores whatever bytes it is given and records every request. */
function createFakeHost({ failWith = null, ignoreConditionals = false } = {}) {
    const objects = new Map();
    const requests = [];
    let counter = 0;
    const fetcher = async (request) => {
        const url = new URL(request.url);
        const key = decodeURIComponent(url.pathname.replace(/^\/documents\//, ''));
        const body = new Uint8Array(await request.arrayBuffer());
        requests.push({ method: request.method, key, authorization: request.headers.get('authorization') });
        if (failWith) return new Response('nope', { status: failWith });
        if (request.method === 'PUT') {
            if (!ignoreConditionals && request.headers.get('if-none-match') === '*' && objects.has(key)) {
                return new Response(null, { status: 412 });
            }
            counter += 1;
            const etag = `"etag-${counter}"`;
            objects.set(key, { body, etag, meta: request.headers.get('x-amz-meta-goc-content-type') });
            return new Response(null, { status: 200, headers: { etag } });
        }
        if (request.method === 'DELETE') {
            objects.delete(key);
            return new Response(null, { status: 204 });
        }
        const stored = objects.get(key);
        if (!stored) return new Response(null, { status: 404 });
        const headers = {
            etag: stored.etag, 'content-length': String(stored.body.length), 'x-amz-meta-goc-content-type': stored.meta
        };
        if (request.method === 'GET') {
            const ifMatch = request.headers.get('if-match');
            if (ifMatch && ifMatch !== stored.etag) return new Response(null, { status: 412 });
            return new Response(stored.body, { status: 200, headers });
        }
        return new Response(null, { status: 200, headers });
    };
    return { objects, requests, fetcher };
}

function createStorage(host, overrides = {}) {
    return createRemoteDocumentStorage({
        endpoint: 'http://127.0.0.1:9000', bucketName: 'documents', accessKeyId: 'test-access', secretAccessKey: 'test-secret',
        keyring: keyring(), fetcher: host.fetcher, createId: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ...overrides
    });
}

test('encrypted objects round-trip, grow by the fixed overhead and use a fresh IV every time', async () => {
    const ring = keyring();
    const first = await encryptObject({ keyring: ring, storageKey: KEY_A, plaintext: PLAINTEXT });
    const second = await encryptObject({ keyring: ring, storageKey: KEY_A, plaintext: PLAINTEXT });
    assert.equal(first.length, PLAINTEXT.length + ENCRYPTION_OVERHEAD_BYTES);
    assert.notDeepEqual(first, second);
    assert.deepEqual(await decryptObject({ keyring: ring, storageKey: KEY_A, data: first }), PLAINTEXT);
});

test('an encrypted object fails to decrypt under another storage key, another master key, or after tampering', async () => {
    const sealed = await encryptObject({ keyring: keyring(), storageKey: KEY_A, plaintext: PLAINTEXT });
    await assert.rejects(decryptObject({ keyring: keyring(), storageKey: KEY_B, data: sealed }), { code: 'DOCUMENT_DECRYPTION_FAILED' });
    await assert.rejects(decryptObject({ keyring: keyring({ 1: MASTER_2 }), storageKey: KEY_A, data: sealed }), { code: 'DOCUMENT_DECRYPTION_FAILED' });
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 1;
    await assert.rejects(decryptObject({ keyring: keyring(), storageKey: KEY_A, data: tampered }), { code: 'DOCUMENT_DECRYPTION_FAILED' });
    await assert.rejects(decryptObject({ keyring: keyring(), storageKey: KEY_A, data: new Uint8Array(5) }), { code: 'DOCUMENT_FORMAT_INVALID' });
});

test('objects written under an older key id still decrypt after the current key changes', async () => {
    const oldRing = keyring({ 1: MASTER_1 }, 1);
    const sealed = await encryptObject({ keyring: oldRing, storageKey: KEY_A, plaintext: PLAINTEXT });
    const rotated = keyring({ 1: MASTER_1, 2: MASTER_2 }, 2);
    assert.deepEqual(await decryptObject({ keyring: rotated, storageKey: KEY_A, data: sealed }), PLAINTEXT);
    const newer = await encryptObject({ keyring: rotated, storageKey: KEY_A, plaintext: PLAINTEXT });
    assert.equal(newer[5], 2);
    await assert.rejects(decryptObject({ keyring: oldRing, storageKey: KEY_A, data: newer }), { code: 'DOCUMENT_KEY_UNKNOWN' });
});

test('keyring configuration rejects malformed keys and a missing current key', () => {
    assert.throws(() => createKeyring({ keys: { 1: 'short' }, currentKeyId: 1 }), { code: 'ENCRYPTION_CONFIGURATION_ERROR' });
    assert.throws(() => createKeyring({ keys: { 1: MASTER_1 }, currentKeyId: 2 }), { code: 'ENCRYPTION_CONFIGURATION_ERROR' });
    assert.throws(() => createKeyringFromEnvironment({}), { code: 'ENCRYPTION_CONFIGURATION_ERROR' });
    const ring = createKeyringFromEnvironment({ DOCUMENT_ENCRYPTION_KEYS: JSON.stringify({ 3: MASTER_1 }), DOCUMENT_ENCRYPTION_KEY_ID: '3' });
    assert.equal(ring.currentKeyId, 3);
});

test('remote storage keeps only ciphertext on the host and returns plaintext with R2-compatible fields', async () => {
    const host = createFakeHost();
    const storage = createStorage(host);
    const stored = await storage.put(KEY_A, PLAINTEXT, 'application/pdf');
    assert.equal(stored.key, KEY_A);
    const onHost = host.objects.get(KEY_A).body;
    assert.equal(Buffer.from(onHost).includes(Buffer.from(PLAINTEXT)), false);
    assert.equal(onHost.length, PLAINTEXT.length + ENCRYPTION_OVERHEAD_BYTES);
    assert.ok(host.requests.every((request) => request.authorization?.startsWith('AWS4-HMAC-SHA256')));

    const head = await storage.head(KEY_A);
    assert.equal(head.size, PLAINTEXT.length);
    assert.equal(head.httpMetadata.contentType, 'application/pdf');
    assert.equal(head.etag, 'etag-1');

    const object = await storage.get(KEY_A, { etagMatches: head.etag });
    assert.equal(object.size, PLAINTEXT.length);
    assert.equal(object.etag, head.etag);
    assert.deepEqual(new Uint8Array(await object.arrayBuffer()), PLAINTEXT);
    assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()), PLAINTEXT);
});

test('remote storage returns null for missing objects, a stale ETag, and after delete', async () => {
    const storage = createStorage(createFakeHost());
    assert.equal(await storage.head(KEY_A), null);
    assert.equal(await storage.get(KEY_A), null);
    await storage.put(KEY_A, PLAINTEXT, 'image/png');
    assert.equal(await storage.get(KEY_A, { etagMatches: 'not-the-etag' }), null);
    await storage.delete(KEY_A);
    assert.equal(await storage.head(KEY_A), null);
    await storage.delete(KEY_A);
});

test('putIfAbsent is write-once even when the host ignores If-None-Match', async () => {
    for (const ignoreConditionals of [false, true]) {
        const storage = createStorage(createFakeHost({ ignoreConditionals }));
        assert.ok(await storage.putIfAbsent(KEY_A, PLAINTEXT, 'application/pdf'));
        assert.equal(await storage.putIfAbsent(KEY_A, new Uint8Array([1]), 'application/pdf'), null);
        assert.equal((await storage.head(KEY_A)).size, PLAINTEXT.length);
    }
});

test('an object copied to another storage key cannot be read there', async () => {
    const host = createFakeHost();
    const storage = createStorage(host);
    await storage.put(KEY_A, PLAINTEXT, 'application/pdf');
    host.objects.set(KEY_B, { ...host.objects.get(KEY_A) });
    await assert.rejects(storage.get(KEY_B), { code: 'DOCUMENT_DECRYPTION_FAILED' });
});

test('host outages and rejected credentials map to stable storage errors without leaking details', async () => {
    await assert.rejects(createStorage(createFakeHost({ failWith: 503 })).head(KEY_A), { code: 'STORAGE_UNAVAILABLE' });
    await assert.rejects(createStorage(createFakeHost({ failWith: 403 })).put(KEY_A, PLAINTEXT, 'application/pdf'), { code: 'STORAGE_CONFIGURATION_ERROR' });
    const broken = createStorage(createFakeHost(), { fetcher: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1'); } });
    await assert.rejects(broken.head(KEY_A), (error) => error.code === 'STORAGE_UNAVAILABLE' && !/ECONNREFUSED/.test(error.message));
});

test('remote storage refuses keys outside the quarantine namespace and browser-signed capabilities', async () => {
    const storage = createStorage(createFakeHost());
    await assert.rejects(storage.head('../secret'), { code: 'INVALID_STORAGE_KEY' });
    await assert.rejects(storage.createWriteOnceUploadCapability(KEY_A, {}), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.equal(storage.createQuarantineKey(), 'quarantine/cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    assert.throws(() => createRemoteDocumentStorage({ endpoint: 'http://127.0.0.1:9000' }), { code: 'STORAGE_CONFIGURATION_ERROR' });
});

test('the storage factory keeps R2 by default and selects encrypted remote storage only when configured', async () => {
    const bucket = { async put() { return {}; } };
    assert.equal(typeof createDocumentStorage({ DOCUMENTS: bucket }).createWriteOnceUploadCapability, 'function');
    const host = createFakeHost();
    const remote = createDocumentStorage({
        DOCUMENT_STORAGE_BACKEND: 'remote', DOCUMENT_STORE_ENDPOINT: 'http://127.0.0.1:9000', DOCUMENT_STORE_BUCKET: 'documents',
        DOCUMENT_STORE_ACCESS_KEY_ID: 'a', DOCUMENT_STORE_SECRET_ACCESS_KEY: 'b',
        DOCUMENT_ENCRYPTION_KEYS: JSON.stringify({ 1: MASTER_1 }), DOCUMENT_ENCRYPTION_KEY_ID: '1',
        DOCUMENT_STORE: { fetch: host.fetcher }
    });
    await remote.put(KEY_A, PLAINTEXT, 'application/pdf');
    assert.ok(host.objects.has(KEY_A));
    assert.throws(() => createDocumentStorage({ DOCUMENT_STORAGE_BACKEND: 'remote' }), { code: 'STORAGE_CONFIGURATION_ERROR' });
});

test('digest-derived physical registration keys and batch deletes work on both backends', async () => {
    const digestKey = 'quarantine/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d';
    const host = createFakeHost();
    const remote = createStorage(host);
    await remote.put(digestKey, PLAINTEXT, 'application/pdf');
    await remote.put(KEY_A, PLAINTEXT, 'image/jpeg');
    await remote.deleteMany([digestKey, KEY_A]);
    assert.equal(host.objects.size, 0);

    const deleted = [];
    const { createR2DocumentStorage } = await import('../src/server/storage/r2DocumentStorage.js');
    const r2 = createR2DocumentStorage({ async delete(keys) { deleted.push(keys); } });
    await r2.deleteMany([digestKey, KEY_A]);
    assert.deepEqual(deleted, [[digestKey, KEY_A]]);
    await assert.rejects(r2.deleteMany([digestKey, 'print/not-a-document']), { code: 'INVALID_STORAGE_KEY' });
});
