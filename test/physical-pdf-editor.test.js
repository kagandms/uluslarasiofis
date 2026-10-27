import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { splitPdfPages } from '../src/services/split-pdf-pages.js';
import { mergeDocumentsToPdf } from '../src/services/pdfMergerService.js';
import { renderPhysicalIntakes } from '../src/staff/physical-intake-view.js';
import { createPhysicalIntakeRepository } from '../src/server/repositories/d1/physical-intake-repository.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { createOpaqueSessionToken, hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';

function createReceiptFixture() {
    const database = new TestD1Database();
    database.exec(`CREATE TABLE physical_intakes(id TEXT PRIMARY KEY,current_pdf_id TEXT,lock_version INTEGER,
        updated_at TEXT,deleted_at TEXT,status TEXT,processing_closed_at TEXT,legacy_status TEXT);
        CREATE TABLE audit_events(id TEXT PRIMARY KEY,event_type TEXT,actor_type TEXT,actor_staff_id TEXT,
        request_id TEXT,safe_metadata_json TEXT,created_at TEXT);
        INSERT INTO physical_intakes VALUES('receipt','current-pdf',3,'2026-10-07',NULL,'under_review',NULL,NULL);`);
    return { database, repository: createPhysicalIntakeRepository(database) };
}

async function withMockImageCodec(jpegBytes, work) {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
    let decodeCount = 0;
    globalThis.createImageBitmap = async () => ({ width: 2400, height: 3400, close() { decodeCount += 1; } });
    globalThis.document = { createElement: () => ({
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob(callback, mediaType) { callback(new Blob([jpegBytes], { type: mediaType })); }
    }) };
    try {
        return await work(() => decodeCount);
    } finally {
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
        else delete globalThis.document;
        if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap);
        else delete globalThis.createImageBitmap;
    }
}

test('shows only the current PDF with open, delete, download and edit actions', () => {
    const dom = new JSDOM('<main></main>');
    const root = dom.window.document.querySelector('main');
    let editCount = 0;
    let deleteCount = 0;
    const handlers = { preparePdf: () => { editCount += 1; }, deletePdf: () => { deleteCount += 1; } };
    const detail = { intake: { id: 'receipt', current_pdf_id: 'current', status: 'under_review' },
        files: [{ id: 'old', revision_number: 1, byte_size: 10 },
            { id: 'current', revision_number: 3, byte_size: 20, scan_status: 'clean' }], allowed_transitions: [] };

    renderPhysicalIntakes(root, { view: 'detail', detail }, handlers);
    const row = root.querySelector('.physical-pdf-history li');
    const actions = [...row.querySelectorAll('a,button')];
    actions.find(node => node.textContent === 'Düzenle').click();
    actions.find(node => node.textContent === 'Sil').click();

    assert.equal(root.querySelectorAll('.physical-pdf-history li').length, 1);
    assert.deepEqual(actions.map(node => node.textContent), ['PDF’i Aç', 'Sil', 'İndir', 'Düzenle']);
    assert.equal(root.textContent.includes('QR / Fotoğraf ile PDF Hazırla'), false);
    assert.equal(root.querySelector('a[href*="/files/old/"]'), null);
    assert.equal(editCount, 1);
    assert.equal(deleteCount, 1);
    dom.window.close();
});

test('a removed current PDF does not expose an older revision and offers PDF Ekle', () => {
    const dom = new JSDOM('<main></main>');
    const root = dom.window.document.querySelector('main');
    const detail = { intake: { id: 'receipt', current_pdf_id: null, status: 'under_review' },
        files: [{ id: 'old', byte_size: 10 }], allowed_transitions: [] };

    renderPhysicalIntakes(root, { view: 'detail', detail }, { preparePdf: () => {} });

    assert.equal(root.querySelectorAll('.physical-pdf-history li').length, 0);
    assert.ok([...root.querySelectorAll('button')].some(node => node.textContent === 'PDF Ekle'));
    dom.window.close();
});

test('saved PDF pages can be reordered, removed and combined with a new page', async () => {
    const original = await PDFDocument.create();
    [100, 200, 300].forEach(width => original.addPage([width, 400]));
    const added = await PDFDocument.create();
    added.addPage([500, 400]);

    const pages = await splitPdfPages(await original.save());
    const result = await mergeDocumentsToPdf([pages[2], pages[0], { bytes: await added.save(), name: 'new.pdf' }]
        .map(page => ({ ...page, mediaType: 'application/pdf' })), undefined, { rasterizePdfs: false });
    const edited = await PDFDocument.load(result.bytes);

    assert.deepEqual(pages.map(page => page.name), ['Sayfa-001.pdf', 'Sayfa-002.pdf', 'Sayfa-003.pdf']);
    assert.deepEqual(edited.getPages().map(page => page.getWidth()), [300, 100, 500]);
    assert.equal((await PDFDocument.load(await original.save())).getPageCount(), 3);
});

test('reports the actual output ratio and accepts source PDF when it is already under YÖKSİS limit', async () => {
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage([595, 842]);
    const bytes = await sourcePdf.save();
    const result = await mergeDocumentsToPdf([
        { bytes, name: 'student.pdf', mediaType: 'application/pdf' }
    ], undefined, { rasterizePdfs: false });

    assert.equal(result.metrics.inputBytes, bytes.length);
    assert.equal(result.metrics.outputBytes, result.bytes.length);
    assert.equal(result.metrics.ratio, result.bytes.length / bytes.length);
    assert.equal(result.metrics.targetReached, true);
    assert.equal(result.metrics.yoksisLimitReached, true);
    assert.equal(result.metrics.compressionPercent, null);
    assert.equal(result.metrics.warning, null);
});

test('re-encodes server-validated phone JPEGs before embedding them in the PDF', async () => {
    const jpegBytes = new Uint8Array(await readFile(new URL('../header_logo.jpg', import.meta.url)));

    await withMockImageCodec(jpegBytes, async readDecodeCount => {
        const result = await mergeDocumentsToPdf([{
            bytes: jpegBytes,
            name: 'Telefondan_test.jpg',
            mediaType: 'image/jpeg',
            isValidatedTransferPhoto: true
        }]);
        const mergedPdf = await PDFDocument.load(result.bytes);

        assert.equal(mergedPdf.getPageCount(), 1);
        assert.ok(readDecodeCount() > 0);
    });
});

test('compresses phone JPEGs at the initial staged level and keeps the output below YÖKSİS limit', async () => {
    const jpegBytes = new Uint8Array(await readFile(new URL('../header_logo.jpg', import.meta.url)));
    const qualities = [];
    const sourceBytes = new Uint8Array(jpegBytes.length * 3);
    sourceBytes.set(jpegBytes);
    sourceBytes.set(jpegBytes, jpegBytes.length);
    sourceBytes.set(jpegBytes, jpegBytes.length * 2);
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
    globalThis.createImageBitmap = async () => ({ width: 2400, height: 3400, close() {} });
    globalThis.document = { createElement: () => ({
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob(callback, mediaType, quality) { qualities.push(quality); callback(new Blob([jpegBytes], { type: mediaType })); }
    }) };

    try {
        const result = await mergeDocumentsToPdf([{ bytes: sourceBytes, size: sourceBytes.length, name: 'phone.jpg',
            mediaType: 'image/jpeg', isValidatedTransferPhoto: true }]);

        assert.ok(qualities.length > 0);
        assert.equal(qualities[0], 0.72);
        assert.equal(result.metrics.targetReached, true);
        assert.equal(result.metrics.yoksisLimitReached, true);
        assert.equal(result.metrics.compressionPercent, 40);
        assert.ok(result.metrics.outputBytes <= 9 * 1024 * 1024);
    } finally {
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
        else delete globalThis.document;
        if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap);
        else delete globalThis.createImageBitmap;
    }
});

test('increases image compression from 40 to 45 when the first merged PDF exceeds the safe limit', async () => {
    const jpegBytes = new Uint8Array(await readFile(new URL('../header_logo.jpg', import.meta.url)));
    const qualities = [];
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
    globalThis.createImageBitmap = async () => ({ width: 2400, height: 3400, close() {} });
    globalThis.document = { createElement: () => ({
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob(callback, mediaType, quality) {
            qualities.push(quality);
            const size = quality > 0.7 ? 3_300_000 : 2_000_000;
            const compressed = new Uint8Array(size);
            compressed.set(jpegBytes);
            callback(new Blob([compressed], { type: mediaType }));
        }
    }) };

    try {
        const files = Array.from({ length: 3 }, (_, index) => ({
            bytes: jpegBytes,
            name: `synthetic-page-${index + 1}.jpg`,
            mediaType: 'image/jpeg'
        }));
        const result = await mergeDocumentsToPdf(files);
        const mergedPdf = await PDFDocument.load(result.bytes);

        assert.deepEqual(qualities, [0.72, 0.72, 0.72, 0.66, 0.66, 0.66]);
        assert.equal(result.metrics.compressionPercent, 45);
        assert.ok(result.metrics.outputBytes <= 9 * 1024 * 1024);
        assert.equal(mergedPdf.getPageCount(), 3);
    } finally {
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
        else delete globalThis.document;
        if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap);
        else delete globalThis.createImageBitmap;
    }
});

test('reads Blob content instead of mistaking Blob.bytes() for an image payload', async () => {
    const jpegBytes = await readFile(new URL('../header_logo.jpg', import.meta.url));
    const phonePhoto = new Blob([jpegBytes], { type: 'image/jpeg' });
    Object.defineProperty(phonePhoto, 'isValidatedTransferPhoto', { value: true });

    await withMockImageCodec(jpegBytes, async () => {
        const result = await mergeDocumentsToPdf([phonePhoto]);
        const mergedPdf = await PDFDocument.load(result.bytes);

        assert.equal(mergedPdf.getPageCount(), 1);
    });
});

test('preserves a small PDF without requiring the browser raster renderer', async () => {
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage([595, 842]);
    const bytes = await sourcePdf.save();
    const priorWindow = globalThis.window;
    delete globalThis.window;

    try {
        const result = await mergeDocumentsToPdf([{ bytes, name: 'student.pdf', mediaType: 'application/pdf' }]);
        const mergedPdf = await PDFDocument.load(result.bytes);

        assert.equal(result.metrics.targetReached, true);
        assert.equal(result.metrics.rasterizedPdfs, false);
        assert.equal(mergedPdf.getPageCount(), 1);
    } finally {
        if (priorWindow) globalThis.window = priorWindow;
    }
});

test('rejects unreadable saved PDFs instead of opening an empty editor', async () => {
    const bytes = new TextEncoder().encode('invalid-pdf');

    const operation = splitPdfPages(bytes);

    await assert.rejects(operation, /Kayıt korunuyor/);
});

test('removes only the expected current PDF and audits the change atomically', async () => {
    const { database, repository } = createReceiptFixture();
    const input = { id: 'receipt', fileId: 'current-pdf', version: 3, now: '2026-10-07T18:00:00Z',
        staffId: 'staff', requestId: 'request' };

    const changed = await repository.removeCurrentPdf(input);

    assert.equal(changed, true);
    assert.equal(database.prepare('SELECT current_pdf_id FROM physical_intakes').first().current_pdf_id, null);
    assert.equal(database.prepare('SELECT lock_version FROM physical_intakes').first().lock_version, 4);
    assert.equal(database.prepare('SELECT event_type FROM audit_events').first().event_type, 'physical_intake.pdf_removed');
});

test('rejects stale PDF removal without changing the pointer or writing an audit', async () => {
    const { database, repository } = createReceiptFixture();

    const changed = await repository.removeCurrentPdf({ id: 'receipt', fileId: 'old-pdf', version: 2,
        now: '2026-10-07T18:00:00Z', staffId: 'staff', requestId: 'request' });

    assert.equal(changed, false);
    assert.equal(database.prepare('SELECT current_pdf_id FROM physical_intakes').first().current_pdf_id, 'current-pdf');
    assert.equal(database.prepare('SELECT count(*) AS count FROM audit_events').first().count, 0);
});

async function createApiFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const intakeId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const token = createOpaqueSessionToken();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role)
        VALUES('editor','test.editor','test.editor','test-only-hash','Synthetic Editor','reviewer')`).run();
    database.prepare(`INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at,last_seen_at)
        VALUES(?,'editor',?,?,?)`).bind(crypto.randomUUID(), await hashSessionToken(token),
        new Date(Date.now() + 60000).toISOString(), now).run();
    database.prepare(`INSERT INTO physical_intakes(id,student_number,first_name,last_name,application_type,status,
        submitted_at,updated_at,created_by_staff_id) VALUES(?,'','Synthetic','Student','initial','under_review',?,?,'editor')`)
        .bind(intakeId, now, now).run();
    database.prepare(`INSERT INTO physical_intake_files(id,intake_id,revision_number,storage_key,original_filename,
        byte_size,sha256,upload_status,uploaded_at,created_by_staff_id)
        VALUES(?,?,1,'physical/test.pdf','synthetic.pdf',10,?,'finalized',?,'editor')`)
        .bind(fileId, intakeId, 'a'.repeat(64), now).run();
    database.prepare('UPDATE physical_intakes SET current_pdf_id=? WHERE id=?').bind(fileId, intakeId).run();
    return { database, intakeId, fileId, cookie: `staff_session=${token}`,
        environment: { DB: database, DOCUMENTS: {}, APP_ENV: 'production', PHYSICAL_INTAKE_MODE: 'on', STAFF_SHARED_USERNAME: 'test.editor' } };
}

function createDeleteRequest(fixture, overrides = {}) {
    return new Request(`https://portal.test/api/staff/physical-intakes/${fixture.intakeId}/pdf`, {
        method: 'DELETE', headers: { Cookie: fixture.cookie, Origin: 'https://portal.test',
            'If-Match': '1', 'X-Pdf-Id': fixture.fileId, ...overrides }
    });
}

test('authenticated removal keeps the receipt and denies old PDF links', async () => {
    const fixture = await createApiFixture();

    const removed = await worker.fetch(createDeleteRequest(fixture), fixture.environment);
    const oldLink = await worker.fetch(new Request(`https://portal.test/api/staff/physical-intakes/${fixture.intakeId}/files/${fixture.fileId}/preview`,
        { headers: { Cookie: fixture.cookie } }), fixture.environment);

    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).removed, true);
    assert.equal(oldLink.status, 404);
    assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM physical_intakes').first().count, 1);
});

test('PDF removal denies missing sessions, cross-origin requests and stale versions', async () => {
    const fixture = await createApiFixture();

    const missingSession = await worker.fetch(createDeleteRequest(fixture, { Cookie: '' }), fixture.environment);
    const crossOrigin = await worker.fetch(createDeleteRequest(fixture, { Origin: 'https://other.test' }), fixture.environment);
    const stale = await worker.fetch(createDeleteRequest(fixture, { 'If-Match': '9' }), fixture.environment);

    assert.deepEqual([missingSession.status, crossOrigin.status, stale.status], [401, 403, 409]);
    assert.equal(fixture.database.prepare('SELECT current_pdf_id FROM physical_intakes').first().current_pdf_id, fixture.fileId);
});

test('PDF removal cannot change completed or deleted receipts', async () => {
    const fixture = await createApiFixture();
    fixture.database.prepare("UPDATE physical_intakes SET status='completed'").run();

    const completed = await worker.fetch(createDeleteRequest(fixture), fixture.environment);
    fixture.database.prepare("UPDATE physical_intakes SET status='under_review',deleted_at=?").bind(new Date().toISOString()).run();
    const deleted = await worker.fetch(createDeleteRequest(fixture), fixture.environment);

    assert.deepEqual([completed.status, deleted.status], [409, 409]);
    assert.equal(fixture.database.prepare('SELECT current_pdf_id FROM physical_intakes').first().current_pdf_id, fixture.fileId);
});
