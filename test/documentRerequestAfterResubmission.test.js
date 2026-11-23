/**
 * Tests repeated staff document resubmission requests across multiple student
 * replacement and ClamAV scan cycles, plus staff UI rendering for both viewable
 * clean replacements and pending-scan replacements.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { SCANNER_POLICY_VERSION } from '../src/server/domain/scanner-policy.js';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const SCANNER_SECRET = 'test_scanner_secret_0123456789abcdefghijklmnopqrstuvwxyz';
const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const environment = {
        DB: database,
        APP_ENV: 'test',
        STAFF_SHARED_USERNAME: 'reviewer-1',
        SCANNER_SECRET,
        R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        R2_BUCKET_NAME: 'private-documents',
        R2_ACCESS_KEY_ID: 'test-access-key',
        R2_SECRET_ACCESS_KEY: 'test-secret-key',
        DOCUMENTS: {
            async head(key) {
                const stored = objects.get(key);
                if (!stored) return null;
                return { size: stored.bytes.byteLength, etag: stored.etag, httpMetadata: stored.httpMetadata };
            },
            async put(key, body, options = {}) {
                const bytes = body instanceof Uint8Array ? new Uint8Array(body) : new Uint8Array(body);
                objects.set(key, {
                    bytes,
                    etag: `etag-${key}`,
                    httpMetadata: options.httpMetadata ?? { contentType: 'application/pdf' }
                });
            },
            async get(key, options = {}) {
                const stored = objects.get(key);
                if (!stored) return null;
                if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== stored.etag) return null;
                return {
                    size: stored.bytes.byteLength,
                    etag: stored.etag,
                    httpMetadata: stored.httpMetadata,
                    body: new Response(stored.bytes).body,
                    async arrayBuffer() {
                        return stored.bytes.buffer.slice(
                            stored.bytes.byteOffset,
                            stored.bytes.byteOffset + stored.bytes.byteLength
                        );
                    }
                };
            },
            async delete(key) {
                objects.delete(key);
            }
        }
    };
    return { database, environment, objects };
}

function buildRequest(path, { method = 'GET', body, cookie, headers: extraHeaders = {}, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin, ...extraHeaders });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaff(environment, database, id = 'reviewer-1', token = 'rerequest-reviewer-token-0000000000000000') {
    environment.STAFF_SHARED_USERNAME = id;
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', 'Reviewer', 'reviewer')
    `).bind(id, id, id).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(
        crypto.randomUUID(),
        id,
        await hashSessionToken(token),
        new Date(Date.now() + 60_000).toISOString()
    ).run();
    return `staff_session=${token}`;
}

async function seedOwnerSession(database, applicationId, token = 'rerequest-owner-token-0000000000000000000') {
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(
        crypto.randomUUID(),
        applicationId,
        await hashSessionToken(token),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    ).run();
    return `application_session=${token}`;
}

async function seedApplication(database, { id = crypto.randomUUID(), studentNumber = 'STU-REREQ-01', status = 'under_review' } = {}) {
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(`student-${id}`, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (id, student_id, application_type, status, is_under_18, address_evidence_type, document_policy_version)
        VALUES (?, ?, 'initial', ?, 0, 'rental_contract', 1)
    `).bind(id, `student-${id}`, status).run();
    return id;
}

async function seedInitialCleanDocument(database, applicationId, code = 'passport') {
    const requirement = await database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = 'initial' AND code = ? AND is_active = 1
    `).bind(code).first();
    const documentRecordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, 'initial', 'pending')
    `).bind(documentRecordId, applicationId, requirement.id).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'submitted', 1, 'student')
    `).bind(revisionId, documentRecordId).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status
        ) VALUES (?, ?, 0, ?, 'passport-v1.pdf', 'application/pdf', 24, 'finalized', 'clean')
    `).bind(fileId, revisionId, `quarantine/${crypto.randomUUID()}`).run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status, completed_at)
        VALUES (?, ?, ?, ?, 'completed', ?)
    `).bind(
        crypto.randomUUID(),
        fileId,
        crypto.randomUUID(),
        new Date(Date.now() + 60_000).toISOString(),
        new Date().toISOString()
    ).run();
    return { documentRecordId, revisionId, fileId };
}

async function scanQueuedFileClean(environment, expectedFileId) {
    const authHeaders = { Authorization: `Bearer ${SCANNER_SECRET}` };
    const claimResponse = await worker.fetch(buildRequest('/api/scanner/claim', {
        method: 'POST',
        headers: authHeaders,
        body: { runner_id: 'runner-test-1' }
    }), environment);
    assert.equal(claimResponse.status, 200);
    const { job } = await claimResponse.json();
    assert.ok(job, 'Expected a queued scan job for the replacement file.');
    assert.equal(job.file_id, expectedFileId);

    const leaseHeaders = { ...authHeaders, 'X-Scan-Lease': job.lease_token };
    const contentResponse = await worker.fetch(buildRequest(`/api/scanner/jobs/${job.id}/content`, {
        method: 'GET',
        headers: leaseHeaders
    }), environment);
    assert.equal(contentResponse.status, 200);
    const sha256 = contentResponse.headers.get('X-Content-SHA256');
    const objectEtag = contentResponse.headers.get('X-Object-ETag');
    assert.ok(sha256);
    assert.ok(objectEtag);

    const nowIso = new Date().toISOString();
    const resultResponse = await worker.fetch(buildRequest(`/api/scanner/jobs/${job.id}/result`, {
        method: 'POST',
        headers: leaseHeaders,
        body: {
            file_id: job.file_id,
            revision_id: job.revision_id,
            storage_key: job.storage_key,
            byte_size: job.byte_size,
            object_etag: objectEtag,
            sha256,
            outcome: 'clean',
            result_code: 'scanned',
            engine_version: '1.4.2',
            signature_version: '27500',
            signature_updated_at: nowIso,
            scanned_at: nowIso,
            full_scan: true,
            policy_version: SCANNER_POLICY_VERSION
        }
    }), environment);
    assert.equal(resultResponse.status, 200);
    const resultPayload = await resultResponse.json();
    assert.equal(resultPayload.recorded, true);
}

async function uploadReplacementAsStudent(environment, database, ownerCookie, code, filename, byteSize) {
    const eligibilityResponse = await worker.fetch(buildRequest('/api/public/applications/current/documents/resubmission-eligibility', {
        cookie: ownerCookie
    }), environment);
    assert.equal(eligibilityResponse.status, 200);
    const eligibility = await eligibilityResponse.json();
    assert.ok(eligibility.documents.some((item) => item.code === code), `Expected ${code} to be eligible for resubmission.`);

    const intentResponse = await worker.fetch(buildRequest('/api/public/applications/current/documents/resubmission-upload-intent', {
        method: 'POST',
        cookie: ownerCookie,
        body: { code, filename, media_type: 'application/pdf', byte_size: byteSize }
    }), environment);
    assert.equal(intentResponse.status, 201);
    const { upload } = await intentResponse.json();

    const replacementFile = database.prepare(`
        SELECT files.id, files.storage_key FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id
        WHERE intents.id = ?
    `).bind(upload.intent_id).first();
    assert.ok(replacementFile);

    const payloadBytes = new Uint8Array(byteSize).fill(0x25);
    await environment.DOCUMENTS.put(replacementFile.storage_key, payloadBytes, {
        httpMetadata: { contentType: 'application/pdf' }
    });

    const finalizeResponse = await worker.fetch(buildRequest('/api/public/applications/current/documents/resubmission-finalize', {
        method: 'POST',
        cookie: ownerCookie,
        body: { intent_id: upload.intent_id }
    }), environment);
    assert.equal(finalizeResponse.status, 200);
    const finalized = await finalizeResponse.json();
    return { fileId: replacementFile.id, finalized };
}

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

test('staff can request resubmission, student uploads replacement, scanner marks clean, and cycle repeats 3 times', async () => {
    const { database, environment } = createEnvironment();
    const applicationId = await seedApplication(database, { studentNumber: 'STU-REREQ-3X' });
    await seedInitialCleanDocument(database, applicationId, 'passport');
    const staffCookie = await seedStaff(environment, database);
    const ownerCookie = await seedOwnerSession(database, applicationId);

    const initialDetailResponse = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}`, {
        cookie: staffCookie
    }), environment);
    assert.equal(initialDetailResponse.status, 200);
    const initialDetail = await initialDetailResponse.json();
    const initialPassport = initialDetail.documents.find((item) => item.code === 'passport');
    assert.equal(initialPassport.revision_number, 1);
    assert.equal(initialPassport.access_available, true);
    assert.equal(initialPassport.can_request_resubmission, true);

    for (let cycle = 1; cycle <= 3; cycle += 1) {
        const requestResponse = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}/documents/passport/request-resubmission`, {
            method: 'POST',
            cookie: staffCookie,
            body: { expected_revision_number: cycle, reason: `${cycle}. kez net kopya yükleyin.` }
        }), environment);
        assert.equal(requestResponse.status, 200, `Cycle ${cycle} request-resubmission should return 200.`);
        const requestPayload = await requestResponse.json();
        assert.equal(requestPayload.application_status, 'resubmission_required');
        assert.equal(requestPayload.document_status, 'resubmission_required');

        const { fileId, finalized } = await uploadReplacementAsStudent(
            environment,
            database,
            ownerCookie,
            'passport',
            `passport-v${cycle + 1}.pdf`,
            20 + cycle
        );
        assert.equal(finalized.document.revision_number, cycle + 1);
        assert.equal(finalized.document.scan_status, 'pending');

        const pendingDetailResponse = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}`, {
            cookie: staffCookie
        }), environment);
        assert.equal(pendingDetailResponse.status, 200);
        const pendingDetail = await pendingDetailResponse.json();
        const pendingPassport = pendingDetail.documents.find((item) => item.code === 'passport');
        assert.equal(pendingPassport.revision_number, cycle + 1);
        assert.equal(pendingPassport.scan_status, 'pending');
        assert.equal(pendingPassport.access_available, false);
        assert.equal(pendingPassport.can_request_resubmission, false);
        assert.equal(pendingPassport.file_id, fileId);

        await scanQueuedFileClean(environment, fileId);

        const cleanDetailResponse = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}`, {
            cookie: staffCookie
        }), environment);
        assert.equal(cleanDetailResponse.status, 200);
        const cleanDetail = await cleanDetailResponse.json();
        const cleanPassport = cleanDetail.documents.find((item) => item.code === 'passport');
        assert.equal(cleanDetail.application.status, 'under_review');
        assert.equal(cleanPassport.revision_number, cycle + 1);
        assert.equal(cleanPassport.revision_status, 'submitted');
        assert.equal(cleanPassport.review_status, 'pending');
        assert.equal(cleanPassport.scan_status, 'clean');
        assert.equal(cleanPassport.access_available, true);
        assert.equal(cleanPassport.can_request_resubmission, true);
    }

    const fourthRequest = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}/documents/passport/request-resubmission`, {
        method: 'POST',
        cookie: staffCookie,
        body: { expected_revision_number: 4, reason: '4. kez yeniden yükleme isteği.' }
    }), environment);
    assert.equal(fourthRequest.status, 200);
});

test('missing document requested first can be re-requested again after student upload and clean scan', async () => {
    const { database, environment } = createEnvironment();
    const applicationId = await seedApplication(database, { studentNumber: 'STU-REREQ-MISSING' });
    const staffCookie = await seedStaff(environment, database);
    const ownerCookie = await seedOwnerSession(database, applicationId, 'rerequest-missing-owner-00000000000000000');

    const firstRequest = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}/documents/passport/request-resubmission`, {
        method: 'POST',
        cookie: staffCookie,
        body: { expected_revision_number: null, reason: 'Pasaport belgesini yükleyin.' }
    }), environment);
    assert.equal(firstRequest.status, 200);

    const { fileId } = await uploadReplacementAsStudent(environment, database, ownerCookie, 'passport', 'passport-v1.pdf', 32);
    await scanQueuedFileClean(environment, fileId);

    const detailResponse = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}`, {
        cookie: staffCookie
    }), environment);
    const detail = await detailResponse.json();
    const passport = detail.documents.find((item) => item.code === 'passport');
    assert.equal(passport.revision_number, 1);
    assert.equal(passport.access_available, true);
    assert.equal(passport.can_request_resubmission, true);

    const secondRequest = await worker.fetch(buildRequest(`/api/staff/applications/${applicationId}/documents/passport/request-resubmission`, {
        method: 'POST',
        cookie: staffCookie,
        body: { expected_revision_number: 1, reason: 'Pasaport fotoğraf sayfası okunaklı değil.' }
    }), environment);
    assert.equal(secondRequest.status, 200);
});

test('staff detail UI renders Yeniden Yükleme İste button for a viewable submitted replacement document', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const submittedRequests = [];
    const queueItem = {
        id: 'app-rereq-ui',
        student_number: 'STU-UI-1',
        passport_number: 'P999001',
        first_name: 'Deniz',
        last_name: 'Kaya',
        application_type: 'initial',
        status: 'under_review',
        submitted_at: '2026-11-20T10:00:00.000Z',
        updated_at: '2026-11-23T10:00:00.000Z'
    };
    const api = {
        async queryApplications() {
            return { items: [queueItem], pagination: { page: 1, page_size: 25, total_items: 1, total_pages: 1 } };
        },
        async readApplicationDetail() {
            return {
                application: queueItem,
                allowed_status_transitions: [],
                documents: [{
                    code: 'passport',
                    label_key: 'documentPassport',
                    required: true,
                    revision_number: 2,
                    review_status: 'pending',
                    revision_status: 'submitted',
                    upload_status: 'finalized',
                    scan_status: 'clean',
                    cleanup_status: null,
                    filename: 'passport-v2.pdf',
                    access_available: true,
                    can_approve: true,
                    can_unapprove: false,
                    can_request_resubmission: true,
                    student_message: 'İlk yükleme bulanıktı.'
                }]
            };
        },
        async requestDocumentResubmission(...args) {
            submittedRequests.push(args);
        }
    };

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    const requestButton = root.querySelector('[data-action="request-document-resubmission"]');
    assert.ok(requestButton, 'Yeniden Yükleme İste button must render for viewable clean replacement.');
    assert.equal(requestButton.textContent, 'Yeniden Yükleme İste');
    assert.ok(root.querySelector('[data-action="approve-document"]'));
    assert.ok(root.querySelector('[data-action="preview-document"]'));
    assert.equal(root.querySelector('.staff-application-document-scan-pending-note'), null);

    requestButton.click();
    const form = root.querySelector('.staff-resubmission-form');
    form.querySelector('textarea').value = 'İkinci yükleme de kesik görünüyor.';
    form.dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(submittedRequests, [['app-rereq-ui', 'passport', 2, 'İkinci yükleme de kesik görünüyor.']]);
});

test('staff detail UI shows a clear Turkish reason while replacement scan is pending instead of silently hiding the button', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const queueItem = {
        id: 'app-pending-scan-ui',
        student_number: 'STU-UI-2',
        passport_number: 'P999002',
        first_name: 'Ege',
        last_name: 'Demir',
        application_type: 'initial',
        status: 'resubmission_required',
        submitted_at: '2026-11-20T10:00:00.000Z',
        updated_at: '2026-11-23T10:00:00.000Z'
    };
    const api = {
        async queryApplications() {
            return { items: [queueItem], pagination: { page: 1, page_size: 25, total_items: 1, total_pages: 1 } };
        },
        async readApplicationDetail() {
            return {
                application: queueItem,
                allowed_status_transitions: [],
                documents: [{
                    code: 'passport',
                    label_key: 'documentPassport',
                    required: true,
                    revision_number: 2,
                    review_status: 'pending',
                    revision_status: 'submitted',
                    upload_status: 'finalized',
                    scan_status: 'pending',
                    cleanup_status: null,
                    filename: 'passport-v2.pdf',
                    file_id: 'pending-replacement-file-id',
                    access_available: false,
                    can_approve: false,
                    can_unapprove: false,
                    can_request_resubmission: false,
                    student_message: 'İlk yükleme bulanıktı.'
                }]
            };
        }
    };

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(root.querySelector('[data-action="request-document-resubmission"]'), null);
    assert.ok(root.querySelector('[data-action="scan-document"]'));
    const pendingNote = root.querySelector('.staff-application-document-scan-pending-note');
    assert.ok(pendingNote, 'Expected explicit pending-scan explanation when resubmission button is withheld.');
    assert.equal(
        pendingNote.textContent,
        'Yeni dosyanın güvenlik taraması bekleniyor; tarama bitince yeniden isteyebilirsiniz.'
    );
});
