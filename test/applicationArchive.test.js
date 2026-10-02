import assert from 'node:assert/strict';
import { BlobReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { test } from 'node:test';
import { downloadApplicationArchive, ARCHIVE_LIMITS } from '../src/staff/applicationArchive.js';
import { readDocumentAccessMessage } from '../src/staff/documentAccessMessages.js';

function createManifest(size = 5) {
    return { total_source_bytes: size, files: [{ code: 'passport', expected_revision_number: 4,
        object_identity: 'a'.repeat(64), media_type: 'application/pdf', byte_size: size, entry_name: '01-passport.pdf' }] };
}

test('document access explanations distinguish pending, unsafe, failed and other access gates', () => {
    assert.equal(readDocumentAccessMessage({ scan_status: 'pending' }), 'Belge güvenlik kontrolü bekleniyor.');
    assert.equal(readDocumentAccessMessage({ scan_status: 'unsafe' }), 'Belge güvenli bulunmadı ve erişime kapatıldı.');
    assert.equal(readDocumentAccessMessage({ scan_status: 'failed' }), 'Belge güvenlik kontrolü tamamlanamadı.');
    assert.equal(readDocumentAccessMessage({ scan_status: 'clean', cleanup_status: 'pending' }), 'Belge güvenli erişime uygun değil.');
    assert.equal(readDocumentAccessMessage({ scan_status: null }), 'Belge güvenli erişime uygun değil.');
});

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

test('streaming picker saves a real source above the Blob limit without accumulating source bytes', async () => {
    const order = [];
    let closed = false;
    let consumed = 0;
    const sourceSize = ARCHIVE_LIMITS.blobBytes + 1024 * 1024;
    const chunkSize = 256 * 1024;
    const writable = new WritableStream({ write() {}, close() { closed = true; } });
    const window = { isSecureContext: true, showSaveFilePicker() {
        order.push('picker');
        return Promise.resolve({ async createWritable() { return writable; } });
    } };
    const manifest = createManifest(sourceSize);
    const response = new Response(new ReadableStream({
        pull(controller) {
            if (consumed >= sourceSize) {
                controller.close();
                return;
            }
            const nextSize = Math.min(chunkSize, sourceSize - consumed);
            consumed += nextSize;
            controller.enqueue(new Uint8Array(nextSize));
        }
    }));
    await downloadApplicationArchive({ applicationId: 'app-1', window,
        async getManifest() { order.push('manifest'); return manifest; },
        async fetchFile() { return response; } });

    assert.deepEqual(order, ['picker', 'manifest']);
    assert.equal(consumed, sourceSize);
    assert.equal(closed, true);
    assert.ok(sourceSize > ARCHIVE_LIMITS.blobBytes);
});

test('streaming mode rejects a manifest above its source limit before requesting file bytes', async () => {
    let requested = false;
    let createdWritable = false;
    const window = { isSecureContext: true, showSaveFilePicker: async () => ({
        async createWritable() { createdWritable = true; return new WritableStream(); }
    }) };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window,
        manifest: createManifest(ARCHIVE_LIMITS.streamedBytes + 1),
        fetchFile: async () => { requested = true; return new Response(); } }), /tek tek/i);
    assert.equal(requested, false);
    assert.equal(createdWritable, false);
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

test('streaming mode treats writable close failure as failure and never reports success', async () => {
    let closeAttempted = false;
    const writable = new WritableStream({
        write() {},
        close() { closeAttempted = true; throw new Error('disk close failed'); }
    });
    const window = { isSecureContext: true, showSaveFilePicker: async () => ({ async createWritable() { return writable; } }) };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window, manifest: createManifest(),
        fetchFile: async () => new Response(new Uint8Array([1, 2, 3, 4, 5])) }), /close failed/i);
    assert.equal(closeAttempted, true);
});

test('streaming mode rejects excess source bytes before closing or saving the ZIP', async () => {
    let closed = false;
    let aborted = false;
    const writable = new WritableStream({ write() {}, close() { closed = true; }, abort() { aborted = true; } });
    const window = { isSecureContext: true, showSaveFilePicker: async () => ({ async createWritable() { return writable; } }) };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window, manifest: createManifest(4),
        fetchFile: async () => new Response(new Uint8Array([1, 2, 3, 4, 5])) }), /sınırı aştı/i);
    assert.equal(closed, false);
    assert.equal(aborted, true);
});

test('an empty current-document manifest reports that no secure current files are available', async () => {
    let requested = false;
    const window = { document: { createElement() { throw new Error('unexpected download'); } } };
    await assert.rejects(downloadApplicationArchive({ applicationId: 'app-1', window,
        manifest: { total_source_bytes: 0, files: [] }, fetchFile: async () => { requested = true; } }), /güvenli güncel belge bulunamadı/i);
    assert.equal(requested, false);
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
