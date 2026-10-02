import assert from 'node:assert/strict';
import { BlobReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { test } from 'node:test';
import { downloadApplicationArchive, ARCHIVE_LIMITS } from '../src/staff/applicationArchive.js';

function createManifest(size = 5) {
    return { total_source_bytes: size, files: [{ code: 'passport', expected_revision_number: 4,
        object_identity: 'a'.repeat(64), media_type: 'application/pdf', byte_size: size, entry_name: '01-passport.pdf' }] };
}

test('fallback archive is a valid STORE zip with stable code names and no source filenames', async () => {
    const downloads = [];
    const window = { URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:archive'; }, revokeObjectURL() {} },
        document: { createElement() { return { click() {}, remove() {} }; }, body: { append() {} } } };
    const result = await downloadApplicationArchive({ applicationId: 'app-1', window, manifest: createManifest(),
        fetchFile: async () => new Response(new Uint8Array([1, 2, 3, 4, 5])) });

    const reader = new ZipReader(new BlobReader(downloads[0]));
    const entries = await reader.getEntries();
    const payload = await entries[0].getData(new Uint8ArrayWriter());
    await reader.close();
    assert.equal(result.status, 'saved');
    assert.equal(entries[0].filename, '01-passport.pdf');
    assert.equal(entries[0].compressionMethod, 0);
    assert.deepEqual([...payload], [1, 2, 3, 4, 5]);
    assert.equal(ARCHIVE_LIMITS.blobBytes, 32 * 1024 * 1024);
});

test('fallback aborts and produces no download when streamed bytes do not match manifest', async () => {
    let created = false;
    const window = { URL: { createObjectURL() { created = true; return 'blob:archive'; }, revokeObjectURL() {} },
        document: { createElement() { return { click() {}, remove() {} }; }, body: { append() {} } } };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window, manifest: createManifest(),
        fetchFile: async () => new Response(new Uint8Array([1, 2])) }), /boyut|kesildi/i);
    assert.equal(created, false);
});

test('fallback refuses totals above its limit before requesting file bytes', async () => {
    let requested = false;
    const window = { document: { createElement() { throw new Error('unexpected download'); } } };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window,
        manifest: createManifest(ARCHIVE_LIMITS.blobBytes + 1), fetchFile: async () => { requested = true; } }), /tek tek/i);
    assert.equal(requested, false);
});

test('streaming picker is invoked during the click path and accepts the larger stream limit', async () => {
    const chunks = [];
    const order = [];
    const writable = new WritableStream({ write(chunk) { chunks.push(chunk); } });
    const window = { isSecureContext: true, showSaveFilePicker() {
        order.push('picker');
        return Promise.resolve({ async createWritable() { return writable; } });
    } };
    const manifest = createManifest(ARCHIVE_LIMITS.blobBytes + 1);
    manifest.files[0].byte_size = 0;
    manifest.total_source_bytes = 0;
    manifest.files[0].entry_name = '01-passport.pdf';
    await downloadApplicationArchive({ applicationId: 'app-1', window,
        async getManifest() { order.push('manifest'); return manifest; },
        async fetchFile() { return new Response(new Uint8Array()); } });

    assert.deepEqual(order, ['picker', 'manifest']);
    assert.ok(chunks.length > 0);
});

test('streaming failure aborts the file save and never reports success', async () => {
    let aborted = false;
    let saved = false;
    const writable = new WritableStream({ abort() { aborted = true; }, close() { saved = true; } });
    const window = { isSecureContext: true, showSaveFilePicker: async () => ({ async createWritable() { return writable; } }) };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window, manifest: createManifest(),
        fetchFile: async () => new Response(new Uint8Array([1])) }));
    assert.equal(aborted, true);
    assert.equal(saved, false);
});

test('user cancellation at the file picker requests no manifest and creates no archive', async () => {
    let requested = false;
    const window = { isSecureContext: true,
        showSaveFilePicker: async () => { throw new DOMException('Canceled', 'AbortError'); } };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window,
        getManifest: async () => { requested = true; return createManifest(0); }, fetchFile: async () => new Response() }),
    { name: 'AbortError' });
    assert.equal(requested, false);
});

test('in-progress cancellation aborts the private-file request and emits no downloadable ZIP', async () => {
    const controller = new AbortController();
    let created = false;
    const window = { URL: { createObjectURL() { created = true; return 'blob:archive'; } } };
    const pending = downloadApplicationArchive({ applicationId: 'app-1', window, manifest: createManifest(),
        signal: controller.signal,
        fetchFile: async (_id, _file, signal) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
        }) });
    await Promise.resolve();
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(created, false);
});
