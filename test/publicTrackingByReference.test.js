import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderStatusSummary } from '../src/server/domain/chatbotStatusText.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { readPublicTrackingByReference } from '../src/server/routes/applicationTrackingRoutes.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { withTestApplicationPrivacyNotice, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return {
        database,
        repositories: createD1Repositories(database),
        environment: withTestApplicationPrivacyNotice({ DB: database })
    };
}

async function createApplicant(environment, studentNumber, applicationType = 'initial') {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
        body: JSON.stringify(withTestApplicationPrivacyNoticeVersion({
            student_number: studentNumber,
            application_type: applicationType,
            email: `${studentNumber}@example.edu`,
            phone: '+905551112233'
        }))
    }), environment, {});
    assert.equal(response.status, 201);
    return databaseRowForStudent(environment.DB, studentNumber);
}

function databaseRowForStudent(database, studentNumber) {
    return database.prepare(`
        SELECT applications.id, applications.reference_number
        FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE students.normalized_student_number = ?
        ORDER BY applications.created_at DESC, applications.id DESC
        LIMIT 1
    `).bind(studentNumber.trim().toUpperCase()).first();
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
    return recordId;
}

test('readPublicTrackingByReference returns strict public DTO when a non-draft application is found', async () => {
    const { database, repositories, environment } = createEnvironment();
    const { id: applicationId, reference_number: referenceNumber } = await createApplicant(environment, 'REF-FOUND-1', 'renewal');

    await database.prepare(`
        UPDATE applications
        SET status = 'under_review',
            submitted_at = '2026-10-01T09:00:00.000Z',
            updated_at = '2026-10-01T10:00:00.000Z',
            first_name = 'HiddenFirst',
            last_name = 'HiddenLast',
            passport_number = 'HIDDEN-PASS-1',
            student_email = 'hidden@example.edu',
            student_phone = '+905559998877'
        WHERE id = ?
    `).bind(applicationId).run();
    await seedDocument(database, applicationId, 'renewal', 'passport', { reviewStatus: 'approved', revisionStatus: 'approved' });
    await seedDocument(database, applicationId, 'renewal', 'student_certificate', { reviewStatus: 'pending', revisionStatus: 'submitted' });

    const result = await readPublicTrackingByReference(repositories, `  ${referenceNumber.toLowerCase()}  `);
    const serialized = JSON.stringify(result);

    assert.equal(result.found, true);
    assert.deepEqual(Object.keys(result.application).sort(), [
        'application_type', 'created_at', 'status', 'submitted_at', 'updated_at'
    ]);
    assert.equal(result.application.status, 'under_review');
    assert.equal(result.application.application_type, 'renewal');
    assert.equal(result.documents.find((doc) => doc.code === 'passport')?.status, 'approved');
    assert.equal(result.documents.find((doc) => doc.code === 'student_certificate')?.status, 'waiting_review');
    assert.doesNotMatch(
        serialized,
        /HiddenFirst|HiddenLast|HIDDEN-PASS-1|hidden@example|\+905559998877|REF-FOUND-1|ITU-|student_id|application_id|storage_key/
    );

    const routeResponse = await worker.fetch(new Request('https://portal.test/api/public/applications/tracking-lookup', {
        method: 'POST',
        headers: {
            Origin: 'https://portal.test',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.61'
        },
        body: JSON.stringify({ reference_number: referenceNumber.toLowerCase() })
    }), environment, {});
    const routePayload = await routeResponse.json();
    assert.equal(routeResponse.status, 200);
    assert.deepEqual(
        { found: routePayload.found, application: routePayload.application, documents: routePayload.documents },
        result
    );
});

test('readPublicTrackingByReference returns indistinguishable not-found result for unknown, draft, and invalid references', async () => {
    const { repositories, environment } = createEnvironment();
    const { reference_number: draftReference } = await createApplicant(environment, 'REF-DRAFT-1');

    const unknownResult = await readPublicTrackingByReference(repositories, 'ITU-7K9M-4X2P');
    const draftResult = await readPublicTrackingByReference(repositories, draftReference);
    const malformedResult = await readPublicTrackingByReference(repositories, 'NOT-A-VALID-CODE');
    const nonStringResult = await readPublicTrackingByReference(repositories, null);

    const expectedNotFound = { found: false, application: null, documents: [] };
    assert.deepEqual(unknownResult, expectedNotFound);
    assert.deepEqual(draftResult, expectedNotFound);
    assert.deepEqual(malformedResult, expectedNotFound);
    assert.deepEqual(nonStringResult, expectedNotFound);
});

test('readPublicTrackingByReference includes rejection reason and document message while chatbot status summary never leaks them', async () => {
    const { database, repositories, environment } = createEnvironment();
    const { id: applicationId, reference_number: referenceNumber } = await createApplicant(environment, 'REF-REJECTED-1', 'initial');

    await repositories.staff.createFirstAdmin({
        id: 'staff-1',
        username: 'reviewer1',
        passwordHash: 'test-hash',
        displayName: 'Reviewer One',
        createdAt: '2026-10-01T00:00:00.000Z',
        requestId: 'req-seed-1'
    });

    await database.prepare(`
        UPDATE applications
        SET status = 'rejected',
            submitted_at = '2026-10-01T09:00:00.000Z',
            updated_at = '2026-10-02T10:00:00.000Z'
        WHERE id = ?
    `).bind(applicationId).run();

    const rejectedRecordId = await seedDocument(database, applicationId, 'initial', 'passport', {
        reviewStatus: 'resubmission_required',
        revisionStatus: 'resubmission_required'
    });
    const rejectionCanary = 'SECRET-REJECTION-REASON-991';
    const docMessageCanary = 'SECRET-STUDENT-DOC-MESSAGE-882';

    await database.prepare(`
        INSERT INTO application_notes (id, application_id, author_type, author_staff_id, visibility, body, created_at)
        VALUES (?, ?, 'staff', ?, 'student', ?, ?)
    `).bind(crypto.randomUUID(), applicationId, 'staff-1', rejectionCanary, '2026-10-02T10:05:00.000Z').run();

    await database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, author_staff_id, visibility, body, created_at)
        VALUES (?, ?, ?, 'staff', ?, 'student', ?, ?)
    `).bind(crypto.randomUUID(), applicationId, rejectedRecordId, 'staff-1', docMessageCanary, '2026-10-02T10:06:00.000Z').run();

    const result = await readPublicTrackingByReference(repositories, referenceNumber);

    assert.equal(result.found, true);
    assert.equal(result.application.status, 'rejected');
    assert.equal(result.application.rejection_reason, rejectionCanary);
    assert.equal(result.documents.find((doc) => doc.code === 'passport')?.student_message, docMessageCanary);

    for (const language of ['tr', 'en', 'ru', 'tk', 'ar']) {
        const summary = renderStatusSummary(result, language);
        assert.equal(summary.includes(rejectionCanary), false, `${language} summary leaked rejection reason`);
        assert.equal(summary.includes(docMessageCanary), false, `${language} summary leaked document message`);
        assert.equal(summary.includes(referenceNumber), false, `${language} summary leaked reference number`);
        assert.ok(summary.includes('/basvurum/'), `${language} summary must direct to /basvurum/`);
    }
});
