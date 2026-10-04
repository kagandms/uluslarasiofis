import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeStaffArchiveManager } from '../src/staff/archiveManager.js';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');
const TEST_PASSWORD = 'Test-only passphrase 2026';
const PASSWORD_HASH = await deriveStaffPasswordHash(TEST_PASSWORD);

function createStaffDom() {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    return {
        dom,
        document: dom.window.document,
        applicationsRoot: dom.window.document.getElementById('staff-applications-manager'),
        archiveRoot: dom.window.document.getElementById('staff-archive-manager')
    };
}

function installDocument(context, document) {
    const previousDocument = globalThis.document;
    globalThis.document = document;
    context.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        document.defaultView.close();
    });
}

function createQueuePayload(items, page = 1, pageSize = 25, totalItems = items.length) {
    return {
        items,
        pagination: {
            page,
            page_size: pageSize,
            total_items: totalItems,
            total_pages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize)
        }
    };
}

const COMPLETED_ITEM = {
    id: 'app-completed-001', student_number: 'STU-001', first_name: 'Zeynep', last_name: 'Demir',
    application_type: 'renewal', status: 'completed', submitted_at: '2026-09-20T10:00:00.000Z',
    updated_at: '2026-09-25T14:30:00.000Z'
};

const CANCELLED_ITEM = {
    id: 'app-cancelled-002', student_number: 'STU-002', first_name: 'Murat', last_name: 'Çelik',
    application_type: 'initial', status: 'cancelled', submitted_at: '2026-09-22T09:15:00.000Z',
    updated_at: '2026-09-23T11:00:00.000Z'
};

const REJECTED_ITEM = {
    id: 'app-rejected-003', student_number: 'STU-003', first_name: 'Ali', last_name: 'Öztürk',
    application_type: 'initial', status: 'rejected', submitted_at: '2026-09-21T08:00:00.000Z',
    updated_at: '2026-09-24T16:45:00.000Z'
};

test('archive workspace is accessible in navigation without disturbing active applications or other views', async (context) => {
    const { document, applicationsRoot, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const archiveQueries = [];
    const applicationQueries = [];

    const archiveApi = {
        async queryApplications(query) {
            archiveQueries.push(query);
            return createQueuePayload([COMPLETED_ITEM, CANCELLED_ITEM]);
        },
        async readApplicationDetail() { throw new Error('not used'); }
    };
    const appApi = {
        async queryApplications(query) {
            applicationQueries.push(query);
            return createQueuePayload([{ ...COMPLETED_ITEM, status: 'under_review' }]);
        },
        async readApplicationDetail() { throw new Error('not used'); }
    };

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(applicationsRoot, appApi);
    initializeStaffArchiveManager(archiveRoot, archiveApi);

    const archiveHomeAction = document.querySelector('.home-actions [data-workspace-view="archive"]');
    const archiveNavButton = document.querySelector('.workspace-nav [data-workspace-view="archive"]');
    const appHomeAction = document.querySelector('.home-actions [data-workspace-view="applications"]');
    const appNavButton = document.querySelector('.workspace-nav [data-workspace-view="applications"]');

    assert.ok(archiveHomeAction, 'Archive home action button must exist');
    assert.ok(archiveNavButton, 'Archive nav button must exist');
    assert.equal(archiveHomeAction.querySelector('strong')?.textContent, 'Arşiv');
    assert.ok(document.getElementById('view-archive'), '#view-archive panel must exist');

    // First open active applications
    appHomeAction.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.getElementById('workspace-title').textContent.trim(), 'İkamet Başvuruları');
    assert.equal(document.getElementById('view-applications').hidden, false);
    assert.equal(document.getElementById('view-archive').hidden, true);
    assert.equal(applicationQueries.length, 1);
    assert.equal(archiveQueries.length, 0);

    // Switch to Archive
    archiveNavButton.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.getElementById('workspace-title').textContent.trim(), 'Arşiv');
    assert.equal(document.getElementById('view-archive').hidden, false);
    assert.equal(document.getElementById('view-applications').hidden, true);
    assert.equal(archiveQueries.length, 1);
    assert.equal(archiveQueries[0].status, 'archive_all', 'Archive queries start with terminal filter');
    assert.match(archiveRoot.textContent, /STU-001/);
    assert.match(archiveRoot.textContent, /STU-002/);

    // Switch back to Applications
    appNavButton.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.getElementById('workspace-title').textContent.trim(), 'İkamet Başvuruları');
    assert.equal(document.getElementById('view-applications').hidden, false);
    assert.equal(document.getElementById('view-archive').hidden, true);

    // Return to Home, then click Archive from Home
    document.getElementById('btn-workspace-home').click();
    assert.equal(document.getElementById('workspace-content').hidden, true);
    assert.equal(document.getElementById('home-screen').hidden, false);

    archiveHomeAction.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.getElementById('workspace-title').textContent.trim(), 'Arşiv');
    assert.equal(document.getElementById('view-archive').hidden, false);
});

test('archive keeps terminal filters and adds the Silinen view', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const queries = [];
    const api = {
        async queryApplications(query) {
            queries.push(query);
            return createQueuePayload(query.status === 'deleted'
                ? [{ ...COMPLETED_ITEM, status: 'deleted', deletion_state: 'soft_deleted' }]
                : [COMPLETED_ITEM]);
        },
        async readApplicationDetail() { throw new Error('not used'); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);

    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    // Verify initial query is terminal
    assert.equal(queries.length, 1);
    assert.equal(queries[0].status, 'archive_all');
    assert.equal(queries[0].page, 1);

    // Check filter options
    const statusSelect = archiveRoot.querySelector('[name="status"]');
    assert.ok(statusSelect, 'Status select must exist');
    const options = [...statusSelect.querySelectorAll('option')].map((opt) => [opt.value, opt.textContent.trim()]);
    assert.deepEqual(options, [
        ['archive_all', 'Tümü'],
        ['deleted', 'Silinen'],
        ['completed', 'Tamamlandı'],
        ['cancelled', 'İptal edildi'],
        ['rejected', 'Reddedildi']
    ]);
    statusSelect.value = 'deleted';
    statusSelect.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).status, 'deleted', 'changing the filter immediately requests deleted applications');
    assert.match(archiveRoot.textContent, /Silinen/);

    // Active statuses must NOT be present
    const disallowedValues = ['all', 'new', 'under_review', 'resubmission_required', 'approved', 'migration', 'submitted'];
    for (const disallowed of disallowedValues) {
        assert.equal(options.some(([val]) => val === disallowed), false, `Archive must not offer active filter: ${disallowed}`);
    }

    const submitFilter = async (statusValue) => {
        const select = archiveRoot.querySelector('[name="status"]');
        select.value = statusValue;
        archiveRoot.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setImmediate(resolve));
    };

    // Filter by Tamamlandı
    await submitFilter('completed');
    assert.equal(queries.at(-1).status, 'completed');
    assert.equal(queries.at(-1).page, 1);

    // Filter by İptal edildi
    await submitFilter('cancelled');
    assert.equal(queries.at(-1).status, 'cancelled');
    assert.equal(queries.at(-1).page, 1);

    // Filter by Reddedildi
    await submitFilter('rejected');
    assert.equal(queries.at(-1).status, 'rejected');
    assert.equal(queries.at(-1).page, 1);

    // Filter back to Tümü
    await submitFilter('archive_all');
    assert.equal(queries.at(-1).status, 'archive_all');
    assert.equal(queries.at(-1).page, 1);
});

test('archive search and filter resets pagination to page 1 and paginates consistently with server results', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const queries = [];
    const api = {
        async queryApplications(query) {
            queries.push(query);
            return createQueuePayload([COMPLETED_ITEM], query.page, query.page_size, 55);
        },
        async readApplicationDetail() { throw new Error('not used'); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);

    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    // Page 1 initial
    assert.equal(queries.at(-1).page, 1);
    assert.equal(archiveRoot.querySelector('[data-action="previous-page"]').disabled, true);
    assert.equal(archiveRoot.querySelector('[data-action="next-page"]').disabled, false);
    assert.match(archiveRoot.textContent, /Sayfa 1 \/ 3 · 55 başvuru/);

    // Go to Page 2
    archiveRoot.querySelector('[data-action="next-page"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).page, 2);
    assert.equal(archiveRoot.querySelector('[data-action="previous-page"]').disabled, false);
    assert.equal(archiveRoot.querySelector('[data-action="next-page"]').disabled, false);
    assert.match(archiveRoot.textContent, /Sayfa 2 \/ 3 · 55 başvuru/);

    // Go to Page 3
    archiveRoot.querySelector('[data-action="next-page"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).page, 3);
    assert.equal(archiveRoot.querySelector('[data-action="previous-page"]').disabled, false);
    assert.equal(archiveRoot.querySelector('[data-action="next-page"]').disabled, true);
    assert.match(archiveRoot.textContent, /Sayfa 3 \/ 3 · 55 başvuru/);

    // Submitting search MUST reset page to 1
    const searchInput = archiveRoot.querySelector('[name="q"]');
    searchInput.value = 'Zeynep';
    archiveRoot.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).q, 'Zeynep');
    assert.equal(queries.at(-1).page, 1, 'Search submit must reset page to 1');

    // Advance to page 2 again
    archiveRoot.querySelector('[data-action="next-page"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).page, 2);

    // Changing filter MUST also reset page to 1
    archiveRoot.querySelector('[name="status"]').value = 'completed';
    archiveRoot.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).status, 'completed');
    assert.equal(queries.at(-1).page, 1, 'Filter change must reset page to 1');
});

test('stale late requests do not overwrite newer search results', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const resolvers = [];
    const api = {
        queryApplications(query) {
            return new Promise((resolve) => {
                resolvers.push({ query, resolve });
            });
        },
        async readApplicationDetail() { throw new Error('not used'); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);

    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolvers.length, 1);

    // User rapidly searches for "Murat"
    const searchInput = archiveRoot.querySelector('[name="q"]');
    searchInput.value = 'Murat';
    archiveRoot.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolvers.length, 2);

    // Fast second request finishes first
    resolvers[1].resolve(createQueuePayload([CANCELLED_ITEM]));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /STU-002/);
    assert.doesNotMatch(archiveRoot.textContent, /STU-001/);

    // Slow first request finally finishes later with older data
    resolvers[0].resolve(createQueuePayload([COMPLETED_ITEM]));
    await new Promise((resolve) => setImmediate(resolve));

    // The newer result must NOT be overwritten by the stale result
    assert.match(archiveRoot.textContent, /STU-002/);
    assert.doesNotMatch(archiveRoot.textContent, /STU-001/);
});

test('late detail responses cannot replace the current archive view or another application', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const detailResolvers = [];
    const api = {
        async queryApplications() { return createQueuePayload([COMPLETED_ITEM, CANCELLED_ITEM]); },
        readApplicationDetail(applicationId) {
            return new Promise((resolve) => detailResolvers.push({ applicationId, resolve }));
        }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);
    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    archiveRoot.querySelector('[data-action="open-detail"]').click();
    archiveRoot.querySelector('[data-action="back-to-queue"]').click();
    assert.ok(archiveRoot.querySelector('[data-action="open-detail"]'));
    detailResolvers[0].resolve({ application: COMPLETED_ITEM, documents: [] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(archiveRoot.querySelector('[data-action="open-detail"]'), 'late detail must not replace the queue');

    archiveRoot.querySelectorAll('[data-action="open-detail"]')[0].click();
    archiveRoot.querySelector('[data-action="back-to-queue"]').click();
    archiveRoot.querySelectorAll('[data-action="open-detail"]')[1].click();
    detailResolvers[2].resolve({ application: CANCELLED_ITEM, documents: [] });
    await new Promise((resolve) => setImmediate(resolve));
    detailResolvers[1].resolve({ application: COMPLETED_ITEM, documents: [] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /STU-002/);
    assert.doesNotMatch(archiveRoot.textContent, /STU-001/);
});

test('late query and preview responses cannot update an exited or newly queried workspace', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    let releaseQueue;
    let releasePreview;
    const queries = [];
    const api = {
        queryApplications(query) {
            queries.push(query);
            if (!releaseQueue) return new Promise((resolve) => { releaseQueue = resolve; });
            return Promise.resolve(createQueuePayload([COMPLETED_ITEM]));
        },
        async readApplicationDetail() {
            return { application: COMPLETED_ITEM, documents: [{
                code: 'passport', label_key: 'documentPassport', revision_number: 1,
                review_status: 'pending', revision_status: 'submitted', upload_status: 'finalized',
                scan_status: 'clean', cleanup_status: 'none', filename: 'passport.pdf', access_available: true
            }] };
        },
        createPreviewCapability() { return new Promise((resolve) => { releasePreview = resolve; }); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);
    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    document.querySelector('.workspace-nav [data-workspace-view="applications"]').click();
    releaseQueue(createQueuePayload([COMPLETED_ITEM]));
    await new Promise((resolve) => setImmediate(resolve));
    assert.doesNotMatch(archiveRoot.textContent, /STU-001/);

    document.querySelector('.workspace-nav [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="preview-document"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="back-to-queue"]').click();
    const search = archiveRoot.querySelector('[name="q"]');
    search.value = 'latest';
    archiveRoot.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    releasePreview({
        method: 'GET', url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/private?fixture=synthetic',
        expires_at: new Date(Date.now() + 60_000).toISOString(), media_type: 'application/pdf', filename: 'passport.pdf'
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(archiveRoot.querySelector('#staff-document-preview'), null);
    assert.equal(queries.at(-1).q, 'latest');
});

test('late detail and preview responses are discarded when leaving the archive workspace', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    let releaseFirstDetail;
    let releasePreview;
    let detailCalls = 0;
    const detail = { application: COMPLETED_ITEM, documents: [{
        code: 'passport', label_key: 'documentPassport', revision_number: 1,
        review_status: 'pending', revision_status: 'submitted', upload_status: 'finalized',
        scan_status: 'clean', cleanup_status: 'none', filename: 'passport.pdf', access_available: true
    }] };
    const api = {
        async queryApplications() { return createQueuePayload([COMPLETED_ITEM]); },
        readApplicationDetail() {
            detailCalls += 1;
            if (detailCalls === 1) return new Promise((resolve) => { releaseFirstDetail = resolve; });
            return Promise.resolve(detail);
        },
        createPreviewCapability() { return new Promise((resolve) => { releasePreview = resolve; }); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);
    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="open-detail"]').click();
    document.querySelector('.workspace-nav [data-workspace-view="applications"]').click();
    releaseFirstDetail(detail);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(archiveRoot.querySelector('[data-action="open-detail"]'));
    assert.equal(archiveRoot.querySelector('.staff-archive-summary'), null);

    document.querySelector('.workspace-nav [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="preview-document"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    document.querySelector('.workspace-nav [data-workspace-view="applications"]').click();
    releasePreview({
        method: 'GET', url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/private?fixture=synthetic',
        expires_at: new Date(Date.now() + 60_000).toISOString(), media_type: 'application/pdf', filename: 'passport.pdf'
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(archiveRoot.querySelector('#staff-document-preview'), null);
    assert.ok(archiveRoot.querySelector('[data-action="open-detail"]'));
    assert.equal(archiveRoot.querySelector('.staff-archive-summary'), null);
});

test('archive queue and detail expose one read-only ZIP action using the selected application id', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const manifestRequests = [];
    const order = [];
    document.defaultView.showSaveFilePicker = () => {
        order.push('picker');
        return Promise.resolve({ async createWritable() { return new WritableStream(); } });
    };
    const api = {
        async queryApplications() { return createQueuePayload([COMPLETED_ITEM]); },
        async readApplicationDetail() { order.push('detail'); return { application: COMPLETED_ITEM, documents: [] }; },
        async createArchiveManifest(applicationId) {
            order.push('manifest');
            manifestRequests.push(applicationId);
            return { total_source_bytes: 0, files: [] };
        },
        async readArchiveFile() { throw new Error('not used for empty manifest'); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);
    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    const queueZip = archiveRoot.querySelector('[data-action="download-application-archive"]');
    assert.ok(queueZip, 'queue row must offer ZIP download');
    assert.equal(queueZip.textContent, 'Belgeleri ZIP indir');
    queueZip.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(manifestRequests, [COMPLETED_ITEM.id]);
    assert.deepEqual(order, ['detail', 'manifest'], 'manifest must be validated before opening save picker');
    assert.match(archiveRoot.textContent, /güvenli güncel belge bulunamadı/i);

    archiveRoot.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    const detailZip = archiveRoot.querySelector('[data-action="download-application-archive"]');
    assert.ok(detailZip, 'terminal detail must offer ZIP download');
    detailZip.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(manifestRequests, [COMPLETED_ITEM.id, COMPLETED_ITEM.id]);
    assert.deepEqual(order, ['detail', 'manifest', 'detail', 'manifest']);
    assert.match(archiveRoot.textContent, /güvenli güncel belge bulunamadı/i);
    assert.equal(archiveRoot.querySelector('[data-action="application-status-transition"]'), null);
    assert.equal(archiveRoot.querySelector('[data-action="approve-document"]'), null);
});

test('archive ZIP actions from queue and detail cancel the correct application stream', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const applicationIds = [];
    let abortCount = 0;
    const manifest = { total_source_bytes: 5, files: [{ code: 'passport', expected_revision_number: 1,
        object_identity: 'a'.repeat(64), media_type: 'application/pdf', byte_size: 5, entry_name: '01-passport.pdf' }] };
    const api = {
        async queryApplications() { return createQueuePayload([COMPLETED_ITEM]); },
        async readApplicationDetail() { return { application: COMPLETED_ITEM, documents: [] }; },
        async createArchiveManifest(applicationId) { applicationIds.push(applicationId); return manifest; },
        readArchiveFile(applicationId, _file, signal) {
            applicationIds.push(applicationId);
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
                abortCount += 1;
                reject(new DOMException('Canceled', 'AbortError'));
            }, { once: true }));
        }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);
    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="download-application-archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    const queueCancel = archiveRoot.querySelector('[data-action="download-application-archive"]');
    assert.equal(queueCancel.textContent, 'ZIP’i iptal et');
    queueCancel.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /eksik arşiv sunulmadı/);

    archiveRoot.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="download-application-archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="download-application-archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(applicationIds, [COMPLETED_ITEM.id, COMPLETED_ITEM.id, COMPLETED_ITEM.id, COMPLETED_ITEM.id]);
    assert.equal(abortCount, 2);
    assert.match(archiveRoot.textContent, /eksik arşiv sunulmadı/);
});

test('archive ZIP close failure never displays the completed-download message', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const writable = new WritableStream({ write() {}, close() { throw new Error('disk close failed'); } });
    document.defaultView.showSaveFilePicker = async () => ({ async createWritable() { return writable; } });
    document.defaultView.isSecureContext = true;
    const api = {
        async queryApplications() { return createQueuePayload([COMPLETED_ITEM]); },
        async readApplicationDetail() { return { application: COMPLETED_ITEM, documents: [] }; },
        async createArchiveManifest() {
            return { total_source_bytes: 5, files: [{ code: 'passport', expected_revision_number: 1,
                object_identity: 'a'.repeat(64), media_type: 'application/pdf', byte_size: 5, entry_name: '01-passport.pdf' }] };
        },
        async readArchiveFile() { return new Response(new Uint8Array([1, 2, 3, 4, 5])); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);
    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="download-application-archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.doesNotMatch(archiveRoot.textContent, /ZIP indirme tamamlandı\./);
    assert.match(archiveRoot.textContent, /ZIP hazırlanamadı/);
    assert.doesNotMatch(archiveRoot.textContent, /tek tek indirebilirsiniz/);
});

test('archive ZIP reports pending safety review clearly without requesting or skipping documents', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    let manifestRequested = false;
    const api = {
        async queryApplications() { return createQueuePayload([COMPLETED_ITEM]); },
        async readApplicationDetail() { return { application: COMPLETED_ITEM, documents: [{
            code: 'passport', revision_number: 1, scan_status: 'pending', access_available: false
        }] }; },
        async createArchiveManifest() { manifestRequested = true; return { total_source_bytes: 0, files: [] }; },
        async readArchiveFile() { throw new Error('must not download a pending document'); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);
    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    archiveRoot.querySelector('[data-action="download-application-archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /Belge güvenlik kontrolü bekleniyor\./);
    assert.equal(manifestRequested, false);
});

test('user fields and search input render safely as text and never execute HTML/XSS or leak into URL/localStorage/console', async (context) => {
    const { dom, document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const maliciousPayload = '<img src=x onerror="window.__archiveXss=true"><script>window.__archiveXss=true</script>';
    const maliciousItem = {
        id: 'app-xss-999',
        student_number: maliciousPayload,
        first_name: maliciousPayload,
        last_name: maliciousPayload,
        application_type: 'renewal',
        status: 'completed',
        submitted_at: '2026-09-20T10:00:00.000Z',
        updated_at: '2026-09-25T14:30:00.000Z'
    };

    const initialUrl = dom.window.location.href;
    const initialLocalStorage = { ...dom.window.localStorage };

    const api = {
        async queryApplications() {
            return createQueuePayload([maliciousItem]);
        },
        async readApplicationDetail() {
            return {
                application: {
                    ...maliciousItem,
                    email: maliciousPayload,
                    phone: maliciousPayload,
                    passport_number: maliciousPayload,
                    nationality: maliciousPayload,
                    date_of_birth: '2000-01-01',
                    is_under_18: false,
                    address_evidence_type: maliciousPayload,
                    fingerprint_status: maliciousPayload,
                    fingerprint_code: maliciousPayload,
                    declaration_version: maliciousPayload,
                    declaration_accepted_at: '2026-09-20T10:00:00.000Z',
                    contact_acknowledgement_accepted_current: true,
                    contact_acknowledgement_accepted_at: '2026-09-20T10:00:00.000Z'
                },
                documents: [
                    {
                        code: 'passport',
                        label_key: 'documentPassport',
                        required: true,
                        revision_number: 1,
                        review_status: 'approved',
                        revision_status: 'approved',
                        upload_status: 'finalized',
                        scan_status: 'clean',
                        cleanup_status: null,
                        filename: maliciousPayload,
                        access_available: true,
                        student_message: maliciousPayload
                    }
                ]
            };
        }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);

    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    // Verify queue view XSS safety
    assert.equal(dom.window.__archiveXss, undefined, 'Queue view must not execute XSS');
    assert.equal(archiveRoot.querySelectorAll('img').length, 0, 'No img element injected in queue');
    assert.equal(archiveRoot.querySelectorAll('script').length, 0, 'No script element injected in queue');
    assert.equal(archiveRoot.querySelectorAll('[onerror]').length, 0, 'No onerror attribute injected in queue');

    // Open detail
    archiveRoot.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    // Verify detail view XSS safety
    assert.equal(dom.window.__archiveXss, undefined, 'Detail view must not execute XSS');
    assert.equal(archiveRoot.querySelectorAll('img[onerror]').length, 0);
    assert.equal(archiveRoot.querySelectorAll('script').length, 0);
    assert.equal(archiveRoot.querySelectorAll('[onerror]').length, 0);

    // Verify privacy: no PII or query written to URL or localStorage
    assert.equal(dom.window.location.href, initialUrl, 'URL must not be updated with search query or PII');
    assert.deepEqual({ ...dom.window.localStorage }, initialLocalStorage, 'localStorage must not contain query or PII');
});

test('archive displays loading, empty, and session expired / generic error states properly', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    let releaseQueue;
    let shouldWait = true;
    let queueError = null;

    const api = {
        queryApplications() {
            if (queueError) return Promise.reject(queueError);
            if (shouldWait) {
                shouldWait = false;
                return new Promise((resolve) => { releaseQueue = resolve; });
            }
            return Promise.resolve(createQueuePayload([]));
        },
        async readApplicationDetail() { throw new Error('not used'); }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);

    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    // 1. Loading state
    assert.match(archiveRoot.textContent, /yükleniyor/i);

    // 2. Empty state
    releaseQueue(createQueuePayload([]));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /Görüntülenecek arşiv kaydı bulunamadı/);

    // 3. Generic server error state with retry button
    queueError = Object.assign(new Error('D1 database connection failed'), { status: 500 });
    document.querySelector('.workspace-nav [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /Arşiv kayıtları yüklenemedi/);
    assert.doesNotMatch(archiveRoot.textContent, /D1 database connection failed/);
    const retryBtn = archiveRoot.querySelector('[data-action="retry-queue"]');
    assert.ok(retryBtn, 'Retry button must exist for generic errors');

    // 4. Session expired 401 state (without retry button)
    queueError = Object.assign(new Error('Unauthorized'), { status: 401 });
    retryBtn.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /Yetkili oturumu sona erdi/);
    assert.equal(archiveRoot.querySelector('[data-action="retry-queue"]'), null, 'No retry button on session expiry');
});

test('archive application detail is strictly read-only with no approval, resubmission or transition controls', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);
    const previewRequests = [];
    let releasePreview;

    const api = {
        async queryApplications() { return createQueuePayload([COMPLETED_ITEM]); },
        async readApplicationDetail() {
            return {
                application: {
                    ...COMPLETED_ITEM,
                    email: 'zeynep@example.edu',
                    phone: '+905551234567',
                    passport_number: 'U12345678',
                    nationality: 'Uzbek',
                    date_of_birth: '2002-05-15',
                    is_under_18: false,
                    address_evidence_type: 'title_deed',
                    fingerprint_status: 'verified',
                    fingerprint_code: 'FP-987',
                    declaration_version: 'v1',
                    declaration_accepted_at: '2026-09-20T10:00:00.000Z',
                    contact_acknowledgement_accepted_current: true,
                    contact_acknowledgement_accepted_at: '2026-09-20T10:05:00.000Z'
                },
                allowed_status_transitions: ['under_review', 'completed'], // Present on backend DTO but archive MUST ignore them!
                documents: [
                    {
                        code: 'passport',
                        label_key: 'documentPassport',
                        required: true,
                        revision_number: 2,
                        review_status: 'approved',
                        revision_status: 'approved',
                        upload_status: 'finalized',
                        scan_status: 'clean',
                        cleanup_status: null,
                        filename: 'passport.pdf',
                        access_available: true,
                        can_approve: true, // Should be ignored by archive!
                        can_request_resubmission: true // Should be ignored by archive!
                    },
                    {
                        code: 'residence_card',
                        label_key: 'documentResidenceCard',
                        required: false,
                        revision_number: 1,
                        review_status: 'pending',
                        revision_status: 'submitted',
                        upload_status: 'finalized',
                        scan_status: 'pending',
                        cleanup_status: null,
                        filename: 'old-card.jpg',
                        access_available: false,
                        student_message: 'Lütfen güncel kartınızı yükleyin.'
                    }
                ]
            };
        },
        createPreviewCapability(applicationId, code) {
            previewRequests.push({ applicationId, code });
            return new Promise((resolve) => { releasePreview = resolve; });
        }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);

    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    archiveRoot.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    // Summary fields
    assert.match(archiveRoot.textContent, /U12345678/);
    assert.match(archiveRoot.textContent, /zeynep@example\.edu/);
    assert.match(archiveRoot.textContent, /FP-987/);
    assert.match(archiveRoot.textContent, /Tamamlandı/);

    // Read-only assertions: NO status change or review action buttons
    assert.equal(archiveRoot.querySelector('[data-action="application-status-transition"]'), null, 'No status transitions in archive');
    assert.equal(archiveRoot.querySelector('[data-action="approve-document"]'), null, 'No document approval in archive');
    assert.equal(archiveRoot.querySelector('[data-action="request-document-resubmission"]'), null, 'No resubmission request in archive');
    assert.equal(archiveRoot.querySelector('textarea[name="reason"]'), null, 'No resubmission reason textarea in archive');

    const actionTexts = [...archiveRoot.querySelectorAll('button, a')].map((el) => el.textContent.trim());
    assert.equal(actionTexts.includes('Onayla'), false);
    assert.equal(actionTexts.includes('Yeniden Yükleme İste'), false);
    assert.equal(actionTexts.includes('İşlem İçin Onayla'), false);
    assert.equal(actionTexts.includes('Başvuruyu Tamamla'), false);

    // Document statuses
    assert.match(archiveRoot.textContent, /passport\.pdf/);
    assert.match(archiveRoot.textContent, /old-card\.jpg/);
    assert.match(archiveRoot.textContent, /Öğrenciye iletilen neden: Lütfen güncel kartınızı yükleyin\./);

    // Archive documents remain previewable; bulk ZIP is the only download action.
    assert.equal(archiveRoot.querySelectorAll('[data-action="preview-document"]').length, 1);
    assert.equal(archiveRoot.querySelectorAll('[data-action="download-document"]').length, 0);
    assert.equal(archiveRoot.querySelector('[data-action="download-application-archive"]')?.textContent, 'Belgeleri ZIP indir');

    // Inaccessible document shows explanation and NO access controls
    assert.match(archiveRoot.textContent, /Belge güvenlik kontrolü bekleniyor\./);

    // Document preview modal test
    archiveRoot.querySelector('[data-action="preview-document"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /Önizleme hazırlanıyor/);
    assert.deepEqual(previewRequests, [{ applicationId: 'app-completed-001', code: 'passport' }]);

    releasePreview({
        method: 'GET',
        url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/private?fixture=synthetic',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        media_type: 'application/pdf',
        filename: 'passport.pdf'
    });
    await new Promise((resolve) => setImmediate(resolve));
    const iframe = archiveRoot.querySelector('#staff-document-preview iframe');
    assert.ok(iframe, 'Sandboxed iframe must be rendered for PDF');
    assert.equal(iframe.getAttribute('sandbox'), '');
    assert.equal(iframe.referrerPolicy, 'no-referrer');

    // Close preview
    archiveRoot.querySelector('[data-action="close-document-preview"]').click();
    assert.equal(archiveRoot.querySelector('#staff-document-preview'), null);

    // Back button returns to queue
    const backBtn = archiveRoot.querySelector('[data-action="back-to-queue"]');
    assert.ok(backBtn);
    backBtn.click();
    assert.ok(archiveRoot.querySelector('[data-action="open-detail"]'), 'Should return to queue table');
});

test('backend route accepts cancelled and rejected status filters and preserves auth/validation', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const storedObjects = new Map();
    const environment = {
        DB: database,
        DOCUMENTS: {
            async put(key, body) { storedObjects.set(key, body); return { key }; },
            async get() { return null; },
            async head() { return null; },
            async delete() {}
        },
        ASSETS: { async fetch() { return new Response('ok'); } },
        STAFF_SHARED_USERNAME: 'admin',
        APP_ENV: 'test'
    };

    // Seed shared staff user and session
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role, is_active)
        VALUES ('staff-shared', 'admin', 'admin', ?, 'Shared Admin', 'reviewer', 1)
    `).bind(PASSWORD_HASH).run();

    const sessionToken = 'archive-test-session-token-0000000000000000000';
    const sessionTokenHash = await hashSessionToken(sessionToken);
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
    `).bind(
        'session-1',
        'staff-shared',
        sessionTokenHash,
        new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
    ).run();

    const insertApp = async (id, status) => {
        const studentId = `stu-${id}`;
        await database.prepare(`
            INSERT INTO students (id, student_number, normalized_student_number, created_at, updated_at)
            VALUES (?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
        `).bind(studentId, `NUM-${id}`, `num-${id}`).run();
        return database.prepare(`
            INSERT INTO applications (id, student_id, first_name, last_name, application_type, status, created_at, updated_at)
            VALUES (?, ?, 'Name', 'Surname', 'renewal', ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
        `).bind(id, studentId, status).run();
    };

    await insertApp('app-completed', 'completed');
    await insertApp('app-cancelled', 'cancelled');
    await insertApp('app-rejected', 'rejected');
    await insertApp('app-under-review', 'under_review');
    await insertApp('app-draft', 'draft');

    const cookie = `staff_session=${sessionToken}`;
    const query = (body, customHeaders = {}) => worker.fetch(new Request('https://portal.test/api/staff/applications/query', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://portal.test',
            ...customHeaders
        },
        body: JSON.stringify(body)
    }), environment, {});

    // Unauthenticated request fails closed
    const unauth = await worker.fetch(new Request('https://portal.test/api/staff/applications/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://portal.test' },
        body: JSON.stringify({ status: 'archive_all' })
    }), environment, {});
    assert.equal(unauth.status, 401);

    // Cross-origin request rejected
    const crossOrigin = await query({ status: 'archive_all' }, { Origin: 'https://evil.test' });
    assert.equal(crossOrigin.status, 403);

    // Terminal query returns completed, cancelled, rejected (excludes draft & active under_review)
    const terminalRes = await query({ status: 'archive_all' });
    assert.equal(terminalRes.status, 200);
    const terminalPayload = await terminalRes.json();
    assert.equal(terminalPayload.pagination.total_items, 3);
    assert.deepEqual(terminalPayload.items.map((i) => i.id).sort(), ['app-cancelled', 'app-completed', 'app-rejected']);

    // Cancelled query returns ONLY cancelled
    const cancelledRes = await query({ status: 'cancelled' });
    assert.equal(cancelledRes.status, 200);
    const cancelledPayload = await cancelledRes.json();
    assert.equal(cancelledPayload.pagination.total_items, 1);
    assert.equal(cancelledPayload.items[0].id, 'app-cancelled');
    assert.equal(cancelledPayload.items[0].status, 'cancelled');

    // Rejected query returns ONLY rejected
    const rejectedRes = await query({ status: 'rejected' });
    assert.equal(rejectedRes.status, 200);
    const rejectedPayload = await rejectedRes.json();
    assert.equal(rejectedPayload.pagination.total_items, 1);
    assert.equal(rejectedPayload.items[0].id, 'app-rejected');
    assert.equal(rejectedPayload.items[0].status, 'rejected');

    // Invalid status filter rejected
    const invalidStatus = await query({ status: 'invalid_or_sql_injection' });
    assert.equal(invalidStatus.status, 400);
    const invalidPayload = await invalidStatus.json();
    assert.equal(invalidPayload.error.code, 'VALIDATION_ERROR');

    // Add a soft-deleted application and verify archive_all includes it
    await insertApp('app-soft-deleted', 'submitted');
    await database.prepare(`
        INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at)
        VALUES ('app-soft-deleted', 'submitted', 'soft_deleted', 'staff-shared', '2026-09-02T00:00:00.000Z')
    `).run();

    const archiveAllWithDeleted = await query({ status: 'archive_all' });
    assert.equal(archiveAllWithDeleted.status, 200);
    const allPayload = await archiveAllWithDeleted.json();
    assert.equal(allPayload.pagination.total_items, 4);
    assert.deepEqual(allPayload.items.map((i) => i.id).sort(), ['app-cancelled', 'app-completed', 'app-rejected', 'app-soft-deleted']);
    const deletedItem = allPayload.items.find((i) => i.id === 'app-soft-deleted');
    assert.equal(deletedItem.deletion_state, 'soft_deleted');

    const deletedOnlyRes = await query({ status: 'deleted' });
    assert.equal(deletedOnlyRes.status, 200);
    const deletedOnlyPayload = await deletedOnlyRes.json();
    assert.equal(deletedOnlyPayload.pagination.total_items, 1);
    assert.equal(deletedOnlyPayload.items[0].id, 'app-soft-deleted');
});
