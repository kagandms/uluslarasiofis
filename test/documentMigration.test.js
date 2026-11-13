import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { createDocumentStorage } from '../src/server/storage/documentStorage.js';
import { createDualDocumentStorage } from '../src/server/storage/dualDocumentStorage.js';
import { createKeyring } from '../src/server/storage/encryptedObject.js';
import { createRemoteDocumentStorage } from '../src/server/storage/remoteDocumentStorage.js';
import { migrateDocumentBatch } from '../src/server/services/documentMigrationService.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';

const MASTER = Buffer.alloc(32, 3).toString('base64');
const key = (n) => `quarantine/${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const bytes = (text) => new TextEncoder().encode(text);

function createFakeHost() {
    const objects = new Map();
    let counter = 0;
    let down = false;
    const fetcher = async (request) => {
        if (down) throw new Error('host unreachable');
        const objectKey = decodeURIComponent(new URL(request.url).pathname.replace(/^\/documents\//, ''));
        const body = new Uint8Array(await request.arrayBuffer());
        if (request.method === 'PUT') {
            if (request.headers.get('if-none-match') === '*' && objects.has(objectKey)) return new Response(null, { status: 412 });
            counter += 1;
            objects.set(objectKey, { body, etag: `"e${counter}"`, meta: request.headers.get('x-amz-meta-goc-content-type') });
            return new Response(null, { status: 200, headers: { etag: `"e${counter}"` } });
        }
        if (request.method === 'DELETE') { objects.delete(objectKey); return new Response(null, { status: 204 }); }
        const stored = objects.get(objectKey);
        if (!stored) return new Response(null, { status: 404 });
        const headers = { etag: stored.etag, 'content-length': String(stored.body.length), 'x-amz-meta-goc-content-type': stored.meta };
        return request.method === 'GET' ? new Response(stored.body, { headers }) : new Response(null, { headers });
    };
    return { objects, fetcher, setDown: (value) => { down = value; } };
}

function createRemote(host) {
    return createRemoteDocumentStorage({
        endpoint: 'http://127.0.0.1:9000', bucketName: 'documents', accessKeyId: 'a', secretAccessKey: 'b',
        keyring: createKeyring({ keys: { 1: MASTER }, currentKeyId: 1 }), fetcher: host.fetcher
    });
}

/** R2-like bucket with list pagination, get and put; records any delete so tests can prove none happens. */
function createFakeBucket(entries) {
    const objects = new Map(entries.map(([objectKey, value, contentType]) => [objectKey, { bytes: value, contentType }]));
    const bucket = {
        objects, deletes: [],
        async list({ prefix, limit, cursor }) {
            const keys = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort();
            const start = cursor ? Number(cursor) : 0;
            const page = keys.slice(start, start + limit);
            const truncated = start + limit < keys.length;
            return { objects: page.map((name) => ({ key: name, size: objects.get(name).bytes.length })), truncated, cursor: truncated ? String(start + limit) : undefined };
        },
        async get(name) {
            const entry = objects.get(name);
            return entry ? { arrayBuffer: async () => entry.bytes.slice().buffer, httpMetadata: { contentType: entry.contentType } } : null;
        },
        async put(name, value, options) { objects.set(name, { bytes: value, contentType: options?.httpMetadata?.contentType }); return { key: name, size: value.length }; },
        async head(name) {
            const entry = objects.get(name);
            return entry ? { key: name, size: entry.bytes.length, etag: `r2-${name}`, httpMetadata: { contentType: entry.contentType } } : null;
        },
        async delete(target) { bucket.deletes.push(target); [].concat(target).forEach((name) => objects.delete(name)); }
    };
    return bucket;
}

test('migration copies every R2 object across pages, verifies by hash, and never deletes from R2', async () => {
    const host = createFakeHost();
    const bucket = createFakeBucket([1, 2, 3, 4, 5].map((n) => [key(n), bytes(`document-${n}`), n % 2 ? 'application/pdf' : 'image/png']));
    const remote = createRemote(host);
    let cursor = null;
    const totals = { copied: 0, failed: 0, pages: 0 };
    do {
        const batch = await migrateDocumentBatch({ bucket, remote, limit: 2, cursor });
        totals.copied += batch.copied; totals.failed += batch.failed.length; totals.pages += 1;
        cursor = batch.next_cursor;
        if (batch.done) assert.equal(cursor, null);
    } while (cursor);
    assert.deepEqual(totals, { copied: 5, failed: 0, pages: 3 });
    assert.equal(host.objects.size, 5);
    assert.deepEqual(bucket.deletes, []);
    for (const [name, original] of bucket.objects) {
        const migrated = await remote.get(name);
        assert.deepEqual(new Uint8Array(await migrated.arrayBuffer()), original.bytes);
        assert.equal(migrated.httpMetadata.contentType, original.contentType);
    }
});

test('migration is idempotent, reports a remote size mismatch, and a dry run writes nothing', async () => {
    const host = createFakeHost();
    const remote = createRemote(host);
    const bucket = createFakeBucket([[key(1), bytes('one'), 'application/pdf'], [key(2), bytes('two'), 'application/pdf']]);
    const dry = await migrateDocumentBatch({ bucket, remote, dryRun: true });
    assert.deepEqual([dry.would_copy, dry.copied, host.objects.size], [2, 0, 0]);
    assert.equal((await migrateDocumentBatch({ bucket, remote })).copied, 2);
    const again = await migrateDocumentBatch({ bucket, remote });
    assert.deepEqual([again.copied, again.already_present], [0, 2]);
    await remote.put(key(3), bytes('short'), 'application/pdf');
    bucket.objects.set(key(3), { bytes: bytes('a-much-longer-source'), contentType: 'application/pdf' });
    const mismatch = await migrateDocumentBatch({ bucket, remote });
    assert.deepEqual(mismatch.failed, [{ key: key(3), reason: 'REMOTE_SIZE_MISMATCH' }]);
});

test('a copy that fails read-back verification is removed and reported', async () => {
    const host = createFakeHost();
    const remote = createRemote(host);
    const corrupting = { ...remote, async get(name) {
        const object = await remote.get(name);
        return object ? { ...object, arrayBuffer: async () => bytes('tampered').buffer } : null;
    } };
    const bucket = createFakeBucket([[key(1), bytes('original'), 'application/pdf']]);
    const result = await migrateDocumentBatch({ bucket, remote: corrupting });
    assert.deepEqual(result.failed, [{ key: key(1), reason: 'VERIFY_FAILED' }]);
    assert.equal(host.objects.size, 0);
    assert.equal(bucket.objects.size, 1);
});

test('oversized objects and an unreachable host are reported per object without stopping the batch', async () => {
    const host = createFakeHost();
    const remote = createRemote(host);
    const bucket = createFakeBucket([[key(1), bytes('0123456789'), 'application/pdf'], [key(2), bytes('ok'), 'application/pdf']]);
    const large = await migrateDocumentBatch({ bucket, remote, maxObjectBytes: 5 });
    assert.deepEqual(large.failed, [{ key: key(1), reason: 'OBJECT_TOO_LARGE' }]);
    assert.equal(large.copied, 1);
    host.setDown(true);
    const down = await migrateDocumentBatch({ bucket: createFakeBucket([[key(9), bytes('x'), 'application/pdf']]), remote });
    assert.deepEqual(down.failed, [{ key: key(9), reason: 'STORAGE_UNAVAILABLE' }]);
});

test('dual storage reads migrated and legacy objects, writes new ones to the remote, and blocks overwrites of legacy keys', async () => {
    const host = createFakeHost();
    const remote = createRemote(host);
    const bucket = createFakeBucket([[key(1), bytes('legacy-doc'), 'application/pdf']]);
    const legacyStorage = createDocumentStorage({ DOCUMENTS: bucket });
    const dual = createDualDocumentStorage({ remote, legacy: legacyStorage });

    assert.equal((await dual.head(key(1))).size, 10);
    assert.equal(await new TextDecoder().decode(await (await dual.get(key(1))).arrayBuffer()), 'legacy-doc');
    assert.ok(await dual.putIfAbsent(key(2), bytes('new-doc'), 'application/pdf'));
    assert.equal(bucket.objects.has(key(2)), true, 'new objects are mirrored to R2 until a backup exists');
    assert.equal(host.objects.has(key(2)), true);
    assert.equal(await dual.putIfAbsent(key(1), bytes('overwrite'), 'application/pdf'), null);
    assert.equal(await dual.head(key(404)), null);

    host.setDown(true);
    assert.equal(await new TextDecoder().decode(await (await dual.get(key(1))).arrayBuffer()), 'legacy-doc');
    assert.equal(new TextDecoder().decode(await (await dual.get(key(2))).arrayBuffer()), 'new-doc', 'mirrored objects stay readable during a remote outage');
    await assert.rejects(dual.get(key(404)), { code: 'STORAGE_UNAVAILABLE' });
    host.setDown(false);
    await dual.deleteMany([key(1), key(2)]);
    assert.equal(await dual.head(key(1)), null);
    assert.equal(await dual.head(key(2)), null);
});

test('the migration route is administrator-only, same-origin and closed unless dual or remote storage is configured', async () => {
    const DB = new TestD1Database();
    applyAllMigrations(DB);
    const call = (environment, { origin = 'https://portal.test', body = {} } = {}) => worker.fetch(new Request('https://portal.test/api/staff/storage-migration/batch', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), environment, {});
    const environment = { DB, APP_ENV: 'test' };
    assert.equal((await call(environment, { origin: 'https://attacker.test' })).status, 403);
    assert.equal((await call(environment)).status, 401);
    assert.equal((await call(environment, { body: { surprise: true } })).status, 400);
    assert.equal((await call(environment, { body: { limit: 500 } })).status, 400);
});

test('dual storage removes the remote copy again when the R2 mirror write fails, and the retry succeeds', async () => {
    const host = createFakeHost();
    const remote = createRemote(host);
    const bucket = createFakeBucket([]);
    const realPut = bucket.put;
    let failOnce = true;
    bucket.put = async (...args) => { if (failOnce) { failOnce = false; throw new Error('r2 down'); } return realPut(...args); };
    const dual = createDualDocumentStorage({ remote, legacy: createDocumentStorage({ DOCUMENTS: bucket }) });
    await assert.rejects(dual.putIfAbsent(key(7), bytes('doc'), 'application/pdf'));
    assert.equal(host.objects.size, 0);
    assert.ok(await dual.putIfAbsent(key(7), bytes('doc'), 'application/pdf'));
    assert.equal(host.objects.size, 1);
    assert.equal(bucket.objects.has(key(7)), true);
});
