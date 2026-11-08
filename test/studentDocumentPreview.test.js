import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRealScannerFixture, portalRequest, createSyntheticDraft, finalizeSyntheticFile } from './helpers/scanner-real-fixture.js';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 synthetic preview body');
const BASE = '/api/public/applications/current/documents';

test('owner can preview a current uploaded file inline, sandboxed and uncached', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    await finalizeSyntheticFile({ context, app, bytes: PDF_BYTES });

    const response = await portalRequest(context, `${BASE}/passport/preview`, { cookie: app.cookie });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.match(response.headers.get('Content-Disposition'), /^inline;/);
    assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF_BYTES);
});

test('preview needs the owner session, a known document and a scan state that is not unsafe or failed', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    const { file } = await finalizeSyntheticFile({ context, app, bytes: PDF_BYTES });

    assert.equal((await portalRequest(context, `${BASE}/passport/preview`)).status, 401);
    assert.equal((await portalRequest(context, `${BASE}/no_such_document/preview`, { cookie: app.cookie })).status, 404);
    assert.equal((await portalRequest(context, `${BASE}/residence_card/preview`, { cookie: app.cookie })).status, 404);

    context.database.prepare("UPDATE document_revision_files SET scan_status = 'failed' WHERE id = ?").bind(file.id).run();
    assert.equal((await portalRequest(context, `${BASE}/passport/preview`, { cookie: app.cookie })).status, 404);
    context.database.prepare("UPDATE document_revision_files SET scan_status = 'unsafe' WHERE id = ?").bind(file.id).run();
    assert.equal((await portalRequest(context, `${BASE}/passport/preview`, { cookie: app.cookie })).status, 404);
});

test('another applicant cannot preview someone else\'s file', async () => {
    const context = await createRealScannerFixture();
    const owner = await createSyntheticDraft(context);
    await finalizeSyntheticFile({ context, app: owner, bytes: PDF_BYTES });
    const other = await createSyntheticDraft(context);

    assert.equal((await portalRequest(context, `${BASE}/passport/preview`, { cookie: other.cookie })).status, 404);
});
