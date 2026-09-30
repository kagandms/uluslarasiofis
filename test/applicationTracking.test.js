import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, environment: { DB: database } };
}

function createRequest(path, { method = 'GET', cookie } = {}) {
    const headers = new Headers({ Origin: 'https://portal.test' });
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, { method, headers });
}

async function createApplicant(environment, studentNumber, applicationType = 'initial') {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            student_number: studentNumber,
            application_type: applicationType,
            email: `${studentNumber}@example.edu`,
            phone: '+905551112233'
        })
    }), environment, {});
    return response.headers.get('Set-Cookie').split(';')[0];
}

async function readTracking(environment, cookie, search = '') {
    return worker.fetch(createRequest(`/api/public/applications/current/tracking${search}`, { cookie }), environment, {});
}

async function seedDocument(database, applicationId, applicationType, code, { reviewStatus = 'pending', revisionStatus = 'submitted' } = {}) {
    const requirement = database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = ? AND code = ? AND is_active = 1
    `).bind(applicationType, code).first();
    assert.ok(requirement, `expected active requirement ${code}`);
    const recordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, ?, ?)
    `).bind(recordId, applicationId, requirement.id, applicationType, reviewStatus).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, ?, 1, 'student')
    `).bind(revisionId, recordId, revisionStatus).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status
        ) VALUES (?, ?, 0, ?, ?, 'application/pdf', 10, 'finalized', 'pending')
    `).bind(fileId, revisionId, `quarantine/${crypto.randomUUID()}`, `${code}.pdf`).run();
}

test('tracking UI and persisted application statuses have translations in all supported locales', () => {
    const requiredMessages = [
        'trackingSessionUnavailableHeading', 'trackingSessionUnavailableText', 'trackingDraftHeading',
        'trackingDraftText', 'trackingLoading', 'trackingLoadError', 'trackingDocumentsHeading',
        'trackingApplicationDetails', 'trackingStatusLabel', 'trackingStatusUnknown', 'trackingCreatedAt', 'trackingUpdatedAt', 'trackingSubmittedAt',
        'trackingViewAction', 'trackingReturnToApplication', 'trackingStartNewApplication',
        'applicationStatus_draft', 'applicationStatus_submitted', 'applicationStatus_under_review',
        'applicationStatus_resubmission_required', 'applicationStatus_approved_for_processing',
        'applicationStatus_sent_to_migration', 'applicationStatus_migration_approved',
        'applicationStatus_completed', 'applicationStatus_cancelled', 'applicationStatus_rejected',
        'trackingDocumentStatus_not_uploaded', 'trackingDocumentStatus_waiting_review',
        'trackingDocumentStatus_under_review', 'trackingDocumentStatus_approved',
        'trackingDocumentStatus_resubmission_required'
    ];

    for (const locale of SUPPORTED_LOCALES) {
        for (const key of requiredMessages) {
            assert.ok(PUBLIC_MESSAGES[locale][key], `${locale} is missing ${key}`);
        }
    }
});

test('tracking is owner-session scoped and returns only the student-safe application DTO', async () => {
    const { environment, database } = createEnvironment();
    const studentACookie = await createApplicant(environment, 'TRACK-A');
    await createApplicant(environment, 'TRACK-B', 'renewal');
    const studentAId = database.prepare(`
        SELECT applications.id FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE students.student_number = 'TRACK-A'
    `).first().id;
    await database.prepare(`
        UPDATE applications SET status = 'submitted', submitted_at = '2026-09-30T09:00:00.000Z',
            updated_at = '2026-09-30T10:00:00.000Z'
        WHERE id = ?
    `).bind(studentAId).run();

    const response = await readTracking(environment, studentACookie, '?application_id=TRACK-B&student_number=TRACK-B');
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(payload.application, {
        student_number: 'TRACK-A',
        status: 'submitted',
        application_type: 'initial',
        created_at: payload.application.created_at,
        updated_at: '2026-09-30T10:00:00.000Z',
        submitted_at: '2026-09-30T09:00:00.000Z'
    });
    assert.ok(Date.parse(payload.application.created_at));
    assert.ok(payload.documents.every(({ status }) => status === 'not_uploaded'));
    assert.doesNotMatch(JSON.stringify(payload), /application_id|student_id|document_record_id|revision_id|file_id|requirement_id|storage_key|token_hash|staff_id|https?:\/\//i);
});

test('tracking rejects missing, expired, revoked, or non-GET sessions', async () => {
    const { environment, database } = createEnvironment();
    const unauthenticated = await readTracking(environment, null, '?student_number=TRACK-SECRET');
    const cookie = await createApplicant(environment, 'TRACK-SESSION');
    const token = cookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(new Date(Date.now() - 1000).toISOString(), await hashSessionToken(token)).run();
    const expired = await readTracking(environment, cookie);

    const renewedCookie = await createApplicant(environment, 'TRACK-REVOKED');
    await database.prepare('UPDATE application_sessions SET revoked_at = ? WHERE token_hash = ?')
        .bind(new Date().toISOString(), await hashSessionToken(renewedCookie.split('=')[1])).run();
    const revoked = await readTracking(environment, renewedCookie);
    const wrongMethod = await worker.fetch(createRequest('/api/public/applications/current/tracking', {
        method: 'POST', cookie: renewedCookie
    }), environment, {});
    const bodySelectorRequest = new Request('https://portal.test/api/public/applications/current/tracking', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', Cookie: renewedCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: 'other-app', student_number: 'OTHER-STUDENT' })
    });
    const bodySelector = await worker.fetch(bodySelectorRequest, environment, {});

    assert.equal(unauthenticated.status, 401);
    assert.equal(expired.status, 401);
    assert.equal(revoked.status, 401);
    assert.equal(wrongMethod.status, 405);
    assert.equal(bodySelector.status, 405);
});

test('tracking returns current policy requirements and localized-status keys for finalized document states', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await createApplicant(environment, 'TRACK-POLICY', 'renewal');
    const applicationId = database.prepare(`
        SELECT applications.id FROM applications JOIN students ON students.id = applications.student_id
        WHERE students.student_number = 'TRACK-POLICY'
    `).first().id;
    await database.prepare(`
        UPDATE applications SET is_under_18 = 1, address_evidence_type = 'undertaking' WHERE id = ?
    `).bind(applicationId).run();
    await seedDocument(database, applicationId, 'renewal', 'passport', { reviewStatus: 'pending', revisionStatus: 'submitted' });
    await seedDocument(database, applicationId, 'renewal', 'residence_card', { reviewStatus: 'under_review', revisionStatus: 'submitted' });
    await seedDocument(database, applicationId, 'renewal', 'health_insurance', { reviewStatus: 'approved', revisionStatus: 'approved' });
    await seedDocument(database, applicationId, 'renewal', 'student_certificate', { reviewStatus: 'resubmission_required', revisionStatus: 'resubmission_required' });

    const response = await readTracking(environment, cookie);
    const payload = await response.json();
    const statusByCode = Object.fromEntries(payload.documents.map(({ code, status }) => [code, status]));

    assert.equal(response.status, 200);
    assert.equal(statusByCode.passport, 'waiting_review');
    assert.equal(statusByCode.residence_card, 'under_review');
    assert.equal(statusByCode.health_insurance, 'approved');
    assert.equal(statusByCode.student_certificate, 'resubmission_required');
    assert.equal(statusByCode.uets, 'not_uploaded');
    assert.equal(statusByCode.address_undertaking, 'not_uploaded');
    assert.equal(statusByCode.host_residence_certificate, 'not_uploaded');
    assert.equal(statusByCode.host_identity_copy, 'not_uploaded');
    assert.equal(statusByCode.birth_certificate_under18, 'not_uploaded');
    assert.equal(statusByCode.address_rental_contract, undefined);
    assert.equal(statusByCode.fingerprint, undefined);
    assert.equal(payload.application.submitted_at, null);
    assert.ok(payload.documents.every(({ label_key, required }) => label_key.startsWith('document') && required === true));
    assert.ok(payload.documents.every(({ filename }) => filename === null || filename.endsWith('.pdf')));
    assert.doesNotMatch(JSON.stringify(payload), /quarantine|storage|https?:\/\//i);
});

test('tracking reflects initial and renewal policy branches without inactive legacy requirements', async () => {
    const { environment, database } = createEnvironment();
    const initialCookie = await createApplicant(environment, 'TRACK-INITIAL');
    const renewalCookie = await createApplicant(environment, 'TRACK-RENEWAL', 'renewal');
    await database.prepare(`
        INSERT INTO document_requirements (id, code, application_type, is_required, display_order, is_active)
        VALUES ('legacy-tracking-requirement', 'legacy_tracking_marker', 'renewal', 1, 99, 0)
    `).run();

    const initialResponse = await readTracking(environment, initialCookie);
    const renewalResponse = await readTracking(environment, renewalCookie);
    const initialCodes = (await initialResponse.json()).documents.map(({ code }) => code);
    const renewalCodes = (await renewalResponse.json()).documents.map(({ code }) => code);

    assert.equal(initialCodes.includes('uets'), false);
    assert.equal(renewalCodes.includes('uets'), true);
    assert.equal(renewalCodes.includes('legacy_tracking_marker'), false);
    assert.equal(renewalCodes.includes('passport_identity'), false);
});
