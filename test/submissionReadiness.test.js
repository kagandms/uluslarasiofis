import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listDocumentPolicies } from '../src/server/domain/documentPolicy.js';
import { evaluateSubmissionReadiness } from '../src/server/services/submissionReadiness.js';

const CURRENT_DECLARATION = 'student-information-accuracy-v1';

function createApplication(overrides = {}) {
    return {
        id: 'internal-application-id',
        status: 'draft',
        student_number: '2026123456',
        application_type: 'initial',
        student_email: 'student@example.edu',
        student_phone: '+905551112233',
        first_name: 'Ayşe',
        last_name: 'Yılmaz',
        passport_number: 'P123456',
        nationality: 'Turkish',
        date_of_birth: '2000-01-01',
        is_under_18: 0,
        address_evidence_type: 'rental_contract',
        fingerprint_status: 'registered',
        fingerprint_code: 'FP-A/42',
        contact_acknowledgement_accepted_current: 1,
        declaration_version: CURRENT_DECLARATION,
        declaration_accepted_at: '2026-09-30T10:00:00.000Z',
        ...overrides
    };
}

function createReadyDocuments(application) {
    const policies = listDocumentPolicies(
        application.application_type,
        application.is_under_18 === 1,
        application.address_evidence_type
    );
    return policies.map((policy) => ({
        code: policy.code,
        has_active_requirement: true,
        is_required: true,
        has_current_revision: true,
        revision_status: 'submitted',
        upload_status: 'finalized',
        scan_status: 'pending',
        cleanup_status: null,
        upload_intent_status: 'completed'
    }));
}

function evaluate(application = createApplication(), documents = createReadyDocuments(application)) {
    const policies = listDocumentPolicies(
        application.application_type,
        application.is_under_18 === 1,
        application.address_evidence_type
    );
    return evaluateSubmissionReadiness(application, policies, documents, {
        declarationVersion: CURRENT_DECLARATION
    });
}

test('complete persisted application and current finalized required documents are ready', () => {
    const readiness = evaluate();

    assert.deepEqual(readiness, {
        status: 'ready',
        reason_codes: [],
        missing_fields: [],
        missing_documents: []
    });
});

test('a finalized current document requiring resubmission is not ready', () => {
    const application = createApplication();
    const documents = createReadyDocuments(application);
    const rejectedDocument = documents[0];
    rejectedDocument.revision_status = 'resubmission_required';

    const readiness = evaluate(application, documents);

    assert.equal(readiness.status, 'not_ready');
    assert.ok(readiness.missing_documents.includes(rejectedDocument.code));
});

test('an approved current finalized revision remains ready', () => {
    const application = createApplication();
    const documents = createReadyDocuments(application);
    documents[0].revision_status = 'approved';

    assert.equal(evaluate(application, documents).status, 'ready');
});

test('incomplete application fields, acknowledgement, declaration, fingerprint and address choice are not ready', () => {
    const readiness = evaluate(createApplication({
        student_email: 'invalid-email',
        student_phone: 'bad',
        first_name: ' ',
        date_of_birth: 'not-a-date',
        is_under_18: null,
        address_evidence_type: null,
        fingerprint_status: 'not_registered',
        fingerprint_code: null,
        contact_acknowledgement_accepted_current: 0,
        declaration_version: 'old-version'
    }), []);

    assert.equal(readiness.status, 'not_ready');
    assert.ok(readiness.missing_fields.includes('student_email'));
    assert.ok(readiness.missing_fields.includes('student_phone'));
    assert.ok(readiness.missing_fields.includes('first_name'));
    assert.ok(readiness.missing_fields.includes('date_of_birth'));
    assert.ok(readiness.missing_fields.includes('is_under_18'));
    assert.ok(readiness.missing_fields.includes('address_evidence_type'));
    assert.ok(readiness.missing_fields.includes('fingerprint_status'));
    assert.ok(readiness.missing_fields.includes('contact_acknowledgement'));
    assert.ok(readiness.missing_fields.includes('declaration'));
});

test('a missing declaration acceptance is not ready', () => {
    const readiness = evaluate(createApplication({ declaration_version: null, declaration_accepted_at: null }));

    assert.ok(readiness.missing_fields.includes('declaration'));
    assert.ok(readiness.reason_codes.includes('DECLARATION_REQUIRED'));
});

test('only the selected address branch and its undertaking dependencies are required', () => {
    const application = createApplication({ address_evidence_type: 'undertaking' });
    const documents = createReadyDocuments(application).filter((document) => document.code !== 'host_identity_copy');
    const readiness = evaluate(application, documents);

    assert.deepEqual(readiness.missing_documents, ['host_identity_copy']);
});

test('renewal requires current UETS while initial applications do not', () => {
    const initial = createApplication();
    assert.equal(evaluate(initial, createReadyDocuments(initial).filter(({ code }) => code !== 'uets')).status, 'ready');

    const renewal = createApplication({ application_type: 'renewal' });
    const readiness = evaluate(renewal, createReadyDocuments(renewal).filter(({ code }) => code !== 'uets'));
    assert.deepEqual(readiness.missing_documents, ['uets']);
});

test('under-18 applications require the birth certificate and adults do not', () => {
    const minor = createApplication({ is_under_18: 1 });
    const readiness = evaluate(minor, createReadyDocuments(minor).filter(({ code }) => code !== 'birth_certificate_under18'));
    assert.deepEqual(readiness.missing_documents, ['birth_certificate_under18']);

    const adult = createApplication();
    assert.equal(evaluate(adult, createReadyDocuments(adult).filter(({ code }) => code !== 'birth_certificate_under18')).status, 'ready');
});

test('incomplete, stale, deleted, cleanup-pending or unsafe current document states are not ready', () => {
    const application = createApplication();
    const cases = [
        ['abandoned upload intent', { has_current_revision: false, upload_status: 'intent', upload_intent_status: 'pending' }],
        ['historical revision', { has_current_revision: false }],
        ['deleted revision', { has_current_revision: false, upload_status: null }],
        ['cleanup pending', { cleanup_status: 'pending' }],
        ['unsafe upload', { scan_status: 'unsafe' }]
    ];

    for (const [label, change] of cases) {
        const documents = createReadyDocuments(application);
        Object.assign(documents[0], change);
        const readiness = evaluate(application, documents);
        assert.equal(readiness.status, 'not_ready', label);
        assert.ok(readiness.missing_documents.includes(documents[0].code), label);
    }
});

test('not-ready reasons contain stable public codes and no internal identifiers', () => {
    const readiness = evaluate(createApplication({ status: 'submitted' }));

    assert.equal(readiness.status, 'not_ready');
    assert.ok(readiness.reason_codes.includes('APPLICATION_NOT_DRAFT'));
    assert.doesNotMatch(JSON.stringify(readiness), /internal-application-id|storage_key|session_hash/i);
});
