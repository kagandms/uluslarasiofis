import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

function createStaffDom() {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    return { dom, document: dom.window.document, root: dom.window.document.getElementById('staff-applications-manager') };
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
            total_pages: Math.ceil(totalItems / pageSize)
        }
    };
}

const QUEUE_ITEM = {
    id: 'app-001', student_number: 'STU-001', first_name: 'Ayşe', last_name: 'Yılmaz',
    application_type: 'renewal', status: 'under_review', submitted_at: '2026-09-29T10:00:00.000Z',
    updated_at: '2026-09-30T10:00:00.000Z',
    assigned_staff: { staff_id: 'staff-001', display_name: 'Reviewer One' }
};

test('applications workspace is prominent and opening it loads a queue without disturbing existing views', async (context) => {
    const { dom, document, root } = createStaffDom();
    installDocument(context, document);
    const requests = [];
    const api = {
        async queryApplications(query) {
            requests.push(query);
            return createQueuePayload([QUEUE_ITEM]);
        },
        async readApplicationDetail() {
            return {
                application: {
                    ...QUEUE_ITEM, email: 'ayse@example.edu', phone: '+905551112233',
                    passport_number: 'P123456', nationality: 'Turkish', date_of_birth: '2001-01-01',
                    is_under_18: false, address_evidence_type: 'undertaking', fingerprint_status: 'registered',
                    fingerprint_code: 'FP-123', declaration_version: 'accuracy-v1',
                    declaration_accepted_at: '2026-09-28T10:00:00.000Z',
                    contact_acknowledgement_accepted_current: true,
                    contact_acknowledgement_accepted_at: '2026-09-28T11:00:00.000Z'
                },
                assignment: QUEUE_ITEM.assigned_staff,
                documents: [
                    { code: 'passport', label_key: 'documentPassport', required: true, revision_number: 3,
                        review_status: 'approved', revision_status: 'approved', upload_status: 'finalized',
                        scan_status: 'clean', cleanup_status: null, filename: 'passport.pdf' }
                ]
            };
        }
    };
    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);

    const homeAction = document.querySelector('.home-actions [data-workspace-view="applications"]');
    const navigationButton = document.querySelector('.workspace-nav [data-workspace-view="applications"]');
    assert.ok(homeAction);
    assert.ok(navigationButton);
    assert.equal(homeAction.querySelector('strong')?.textContent, 'İkamet Başvuruları');
    assert.ok(document.querySelector('#view-applications'));
    assert.equal(document.querySelectorAll('.home-actions [data-workspace-view]')[0], homeAction);

    homeAction.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.getElementById('workspace-title').textContent.trim(), 'İkamet Başvuruları');
    assert.equal(document.getElementById('view-applications').hidden, false);
    assert.equal(requests.length, 1);
    assert.match(root.textContent, /STU-001/);
    assert.match(root.textContent, /Reviewer One/);
    assert.ok(root.querySelector('th')?.textContent.includes('Öğrenci No'));
    assert.ok(root.querySelector('[data-action="open-detail"]'));

    navigationButton.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.getElementById('view-applications').hidden, false);
    assert.equal(requests.length, 2);
    document.querySelector('[data-workspace-view="ykn"]').click();
    assert.equal(document.getElementById('view-ykn').hidden, false);
    document.querySelector('[data-workspace-view="cover"]').click();
    assert.equal(document.getElementById('view-cover').hidden, false);
    document.querySelector('[data-workspace-view="teblig"]').click();
    assert.equal(document.getElementById('view-teblig').hidden, false);
});

test('applications manager shows loading, empty, and safe recoverable error states', async (context) => {
    const { dom, document, root } = createStaffDom();
    installDocument(context, document);
    let releaseQueue;
    let shouldWait = true;
    let queueError = null;
    const api = {
        queryApplications() {
            if (queueError) throw queueError;
            if (shouldWait) {
                shouldWait = false;
                return new Promise((resolve) => { releaseQueue = resolve; });
            }
            return Promise.resolve(createQueuePayload([]));
        },
        async readApplicationDetail() { throw new Error('not used'); }
    };
    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);

    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    assert.match(root.textContent, /yükleniyor/i);
    releaseQueue(createQueuePayload([]));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(root.textContent, /Görüntülenecek başvuru bulunamadı/);

    queueError = Object.assign(new Error('raw database error'), { status: 500 });
    document.querySelector('.workspace-nav [data-workspace-view="applications"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(root.textContent, /Başvurular yüklenemedi/);
    assert.doesNotMatch(root.textContent, /raw database error/);
});

test('applications manager submits filters, changes pages, renders detail safely, and returns to the queue', async (context) => {
    const { dom, document, root } = createStaffDom();
    installDocument(context, document);
    const queries = [];
    const api = {
        async queryApplications(query) {
            queries.push(query);
            return createQueuePayload([QUEUE_ITEM], query.page, query.page_size, 30);
        },
        async readApplicationDetail(applicationId) {
            assert.equal(applicationId, 'app-001');
            return {
                application: {
                    ...QUEUE_ITEM, email: 'ayse@example.edu', phone: '+905551112233',
                    passport_number: 'P123456', nationality: 'Turkish', date_of_birth: '2001-01-01',
                    is_under_18: false, address_evidence_type: 'undertaking', fingerprint_status: 'registered',
                    fingerprint_code: 'FP-123', declaration_version: 'accuracy-v1',
                    declaration_accepted_at: '2026-09-28T10:00:00.000Z',
                    contact_acknowledgement_accepted_current: true,
                    contact_acknowledgement_accepted_at: '2026-09-28T11:00:00.000Z'
                },
                assignment: QUEUE_ITEM.assigned_staff,
                documents: [
                    { code: 'passport', label_key: 'documentPassport', required: true, revision_number: 3,
                        review_status: 'approved', revision_status: 'approved', upload_status: 'finalized',
                        scan_status: 'clean', cleanup_status: null, filename: 'passport.pdf' },
                    { code: 'address_undertaking', label_key: 'documentAddressUndertaking', required: true,
                        revision_number: null, review_status: null, revision_status: null,
                        upload_status: null, scan_status: null, cleanup_status: null, filename: null }
                ]
            };
        }
    };
    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    root.querySelector('[name="q"]').value = 'Ayşe Yılmaz';
    root.querySelector('[name="status"]').value = 'under_review';
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).q, 'Ayşe Yılmaz');
    assert.equal(queries.at(-1).status, 'under_review');
    assert.equal(queries.at(-1).page, 1);

    root.querySelector('[data-action="next-page"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queries.at(-1).page, 2);
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(root.textContent, /P123456/);
    assert.match(root.textContent, /FP-123/);
    assert.match(root.textContent, /passport\.pdf/);
    assert.match(root.textContent, /Onaylandı/);
    assert.match(root.textContent, /Yüklenmemiş/);
    assert.ok(root.querySelector('[data-action="back-to-queue"]'));
    assert.equal(root.querySelectorAll('[data-action*="approve"], [data-action*="assign"], [data-action*="download"], [data-action*="preview"]').length, 0);
    root.querySelector('[data-action="back-to-queue"]').click();
    assert.ok(root.querySelector('[data-action="open-detail"]'));
});

test('document preview is lazy, closable, expires safely, and downloads use application plus policy code', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const previewRequests = [];
    const releasePreviews = [];
    const api = {
        async queryApplications() { return createQueuePayload([QUEUE_ITEM]); },
        async readApplicationDetail() {
            return {
                application: { ...QUEUE_ITEM }, assignment: null,
                documents: [
                    { code: 'passport', label_key: 'documentPassport', required: true, revision_number: 2,
                        revision_status: 'submitted', upload_status: 'finalized', scan_status: 'clean',
                        cleanup_status: null, filename: 'passport.pdf', access_available: true, file_id: 'private-file-id' },
                    { code: 'residence_card', label_key: 'documentResidenceCard', required: true, revision_number: 1,
                        revision_status: 'submitted', upload_status: 'finalized', scan_status: 'clean',
                        cleanup_status: null, filename: 'residence-card.jpg', access_available: true },
                    { code: 'student_certificate', label_key: 'documentStudentCertificate', required: true,
                        revision_number: 1, revision_status: 'submitted', upload_status: 'finalized', scan_status: 'pending',
                        cleanup_status: 'none', filename: 'student-certificate.pdf', access_available: false, file_id: 'unavailable-file-id' }
                ]
            };
        },
        createPreviewCapability(applicationId, code) {
            previewRequests.push({ applicationId, code });
            return new Promise((resolve, reject) => { releasePreviews.push({ resolve, reject }); });
        }
    };
    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    const download = root.querySelector('[data-action="download-document"]');
    assert.ok(download);
    assert.equal(new URL(download.href).pathname, '/api/staff/applications/app-001/documents/passport/download');
    assert.doesNotMatch(download.href, /private-file-id|file_id/);
    assert.equal(root.querySelectorAll('[data-action="preview-document"]').length, 2);
    assert.equal(root.querySelectorAll('[data-action="download-document"]').length, 2);
    assert.match(root.textContent, /Belge güvenlik kontrolünden geçmedi/);
    assert.doesNotMatch(root.innerHTML, /private-file-id|unavailable-file-id|X-Amz-Signature|private\.r2\.example/);
    const actionLabels = [...root.querySelectorAll('button, a')].map((element) => element.textContent.trim());
    assert.equal(actionLabels.includes('Onayla'), false);
    assert.equal(actionLabels.includes('Yeniden gönderim iste'), false);
    assert.equal(actionLabels.includes('Ata'), false);
    assert.equal(actionLabels.includes('Üzerime al'), false);

    root.querySelector('[data-action="preview-document"]').click();
    assert.match(root.textContent, /Önizleme hazırlanıyor/);
    assert.deepEqual(previewRequests, [{ applicationId: 'app-001', code: 'passport' }]);
    assert.doesNotMatch(root.innerHTML, /X-Amz-Signature/);
    releasePreviews[0].resolve({
        method: 'GET', url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/private?X-Amz-Signature=capability-1',
        expires_at: new Date(Date.now() + 30_000).toISOString(), media_type: 'application/pdf', filename: 'passport.pdf'
    });
    await new Promise((resolve) => setImmediate(resolve));
    const frame = root.querySelector('#staff-document-preview iframe');
    assert.ok(frame);
    assert.equal(frame.getAttribute('sandbox'), '');
    assert.equal(frame.referrerPolicy, 'no-referrer');
    assert.match(frame.src, /capability-1/);

    root.querySelectorAll('[data-action="preview-document"]')[1].click();
    assert.match(root.textContent, /Önizleme hazırlanıyor/);
    assert.doesNotMatch(root.innerHTML, /capability-1/);
    releasePreviews[1].resolve({
        method: 'GET', url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/private?X-Amz-Signature=capability-2',
        expires_at: new Date(Date.now() + 200).toISOString(), media_type: 'image/jpeg', filename: 'residence-card.jpg'
    });
    await new Promise((resolve) => setImmediate(resolve));
    const image = root.querySelector('#staff-document-preview img');
    assert.ok(image);
    assert.equal(image.referrerPolicy, 'no-referrer');
    assert.match(image.src, /capability-2/);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.doesNotMatch(root.innerHTML, /capability-2/);
    assert.match(root.textContent, /Önizleme süresi doldu/);

    root.querySelector('[data-action="retry-document-preview"]').click();
    assert.equal(previewRequests.length, 3);
    releasePreviews[2].resolve({
        method: 'GET', url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/private?X-Amz-Signature=capability-3',
        expires_at: new Date(Date.now() + 30_000).toISOString(), media_type: 'image/jpeg', filename: 'residence-card.jpg'
    });
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="close-document-preview"]').click();
    assert.doesNotMatch(root.innerHTML, /capability-1|capability-2|capability-3/);
    assert.equal(root.querySelector('#staff-document-preview'), null);
});

test('document preview errors show safe recovery without provider details', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const api = {
        async queryApplications() { return createQueuePayload([QUEUE_ITEM]); },
        async readApplicationDetail() {
            return {
                application: { ...QUEUE_ITEM }, assignment: null,
                documents: [{ code: 'passport', label_key: 'documentPassport', required: true,
                    revision_number: 1, revision_status: 'submitted', upload_status: 'finalized',
                    scan_status: 'clean', cleanup_status: 'none', filename: 'passport.pdf', access_available: true }]
            };
        },
        async createPreviewCapability() {
            throw new Error('provider-secret https://signed.example.test/key?X-Amz-Signature=private');
        }
    };
    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="preview-document"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /Belge önizlemesi açılamadı/);
    assert.ok(root.querySelector('[data-action="retry-document-preview"]'));
    assert.doesNotMatch(root.textContent, /provider-secret|signed\.example|X-Amz-Signature/);
    assert.doesNotMatch(root.innerHTML, /provider-secret|signed\.example|X-Amz-Signature/);
});
