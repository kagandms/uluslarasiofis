import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentStorage } from '../src/server/storage/documentStorage.js';
import { createR2DocumentStorage, createStorageSigningFailure } from '../src/server/storage/r2DocumentStorage.js';

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
    const storage = createR2DocumentStorage(bucket, { createId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
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


test('R2 upload and read capabilities are method-bound, object-bound, and short-lived', async () => {
    const signingTime = new Date('2026-09-29T12:00:00.000Z');
    const storage = createR2DocumentStorage({}, {
        accountId: '0123456789abcdef0123456789abcdef',
        bucketName: 'private-documents',
        accessKeyId: 'PUBLIC-KEY-ID-FOR-TESTS',
        secretAccessKey: 'NEVER-RETURN-THIS-SECRET',
        now: () => signingTime
    });
    const firstKey = 'quarantine/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondKey = 'quarantine/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const upload = await storage.createUploadCapability(firstKey, { contentType: 'application/pdf' });
    const read = await storage.createReadCapability(firstKey);
    const anotherObject = await storage.createReadCapability(secondKey);
    const uploadUrl = new URL(upload.url);
    const readUrl = new URL(read.url);

    assert.equal(upload.method, 'PUT');
    assert.equal(upload.expiresInSeconds, 300);
    assert.equal(upload.expiresAt, '2026-09-29T12:05:00.000Z');
    assert.equal(uploadUrl.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(uploadUrl.searchParams.get('X-Amz-Date'), '20260929T120000Z');
    assert.equal(read.method, 'GET');
    assert.equal(readUrl.searchParams.get('X-Amz-Expires'), '300');
    assert.notEqual(upload.url, read.url);
    assert.notEqual(read.url, anotherObject.url);
    assert.match(uploadUrl.pathname, /private-documents\/quarantine\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/);
    assert.match(upload.requiredHeaders['content-type'], /^application\/pdf$/);
    assert.match(uploadUrl.searchParams.get('X-Amz-SignedHeaders'), /content-type/);
    assert.equal(uploadUrl.searchParams.get('X-Amz-Credential').startsWith('PUBLIC-KEY-ID-FOR-TESTS/'), true);
    assert.equal(Object.hasOwn(upload, 'accessKeyId'), false);
    assert.equal(Object.hasOwn(upload, 'secretAccessKey'), false);
    assert.doesNotMatch(JSON.stringify([upload, read, anotherObject]), /NEVER-RETURN-THIS-SECRET/);
    assert.match(uploadUrl.hostname, /r2\.cloudflarestorage\.com$/);
    assert.doesNotMatch(upload.url, /r2\.dev|r2\.cloudflarestorage\.com\.workers\.dev|pub-/i);
});

test('R2 signing diagnostics preserve the failure stage and redact credentials and signed URLs', () => {
    const accessKeyId = 'TEST-ACCESS-KEY-PRIVATE';
    const secretAccessKey = 'TEST-SECRET-KEY-PRIVATE';
    const signedUrl = 'https://private.r2.example.test/quarantine/object?X-Amz-Signature=private-signature';
    const cause = new TypeError(`Signing failed for ${accessKeyId} ${secretAccessKey} ${signedUrl}`);
    cause.code = 'TEST_SIGNING_FAILURE';
    cause.stack = `TypeError: ${cause.message}\n    at signer (${signedUrl})\n    ${secretAccessKey}`;

    const failure = createStorageSigningFailure(cause, 'getSignedUrl', [accessKeyId, secretAccessKey]);
    const diagnostics = failure.storageSigningDiagnostics;
    const serialized = JSON.stringify(diagnostics);

    assert.equal(failure.name, 'TypeError');
    assert.equal(failure.code, 'TEST_SIGNING_FAILURE');
    assert.equal(diagnostics.storageSigningStage, 'getSignedUrl');
    assert.equal(diagnostics.errorName, 'TypeError');
    assert.equal(diagnostics.errorCode, 'TEST_SIGNING_FAILURE');
    assert.match(diagnostics.errorMessage, /Signing failed/);
    assert.match(diagnostics.errorStack, /at signer/);
    assert.doesNotMatch(serialized, /TEST-ACCESS-KEY-PRIVATE|TEST-SECRET-KEY-PRIVATE|private\.r2\.example\.test|private-signature/);
});

test('R2 signed capabilities reject expiry outside the documented 30 to 300 second range', async () => {
    const storage = createR2DocumentStorage({}, {
        accountId: '0123456789abcdef0123456789abcdef',
        bucketName: 'private-documents',
        accessKeyId: 'PUBLIC-KEY-ID-FOR-TESTS',
        secretAccessKey: 'NEVER-RETURN-THIS-SECRET'
    });
    const key = storage.createQuarantineKey();

    for (const expiresInSeconds of [0, 29, 301, 3600, 30.5, '60']) {
        await assert.rejects(
            storage.createReadCapability(key, { expiresInSeconds }),
            { code: 'INVALID_CAPABILITY_EXPIRY' }
        );
    }
    assert.equal((await storage.createReadCapability(key, { expiresInSeconds: 30 })).expiresInSeconds, 30);
    assert.equal((await storage.createReadCapability(key, { expiresInSeconds: 300 })).expiresInSeconds, 300);
});

test('application-facing storage facade requires private bindings and has no public URL fallback', async () => {
    await assert.rejects(async () => createDocumentStorage({}), { code: 'STORAGE_CONFIGURATION_ERROR' });
    const storage = createDocumentStorage({ DOCUMENTS: {} });
    const key = storage.createQuarantineKey();

    assert.match(key, /^quarantine\/[0-9a-f-]{36}$/i);
    assert.equal('publicUrl' in storage, false);
    assert.equal('url' in (await storage.createReadCapability(key).catch(() => ({}))), false);
});
