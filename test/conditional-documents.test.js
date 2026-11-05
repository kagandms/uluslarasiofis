import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import { listApplicationDocumentPolicies, listDocumentPolicies, readDocumentPolicy } from '../src/server/domain/documentPolicy.js';
import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS, listMissingDocumentAnswers, listRequiredDocumentAnswers, readAccommodationType } from '../src/shared/document-conditions.js';
import { evaluateSubmissionReadiness } from '../src/server/services/submissionReadiness.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { withTestApplicationPrivacyNotice, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import worker from '../src/server/worker.js';

function readCodes(application) {
    return listDocumentPolicies(application.application_type, application.is_under_18 === 1, application)
        .filter(({ required }) => required).map(({ code }) => code);
}

const ADULT = Object.freeze({ application_type: 'initial', is_under_18: 0 });

test('public document guidance requests four biometric photos in every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
        assert.match(PUBLIC_MESSAGES[locale].documentPhotographs, /4/);
        assert.match(SESSION3_MESSAGES[locale].documentPhotographsHelp, /4/);
    }
});

test('current applications request the official form documents without a residence-card upload', () => {
    for (const application_type of ['initial', 'renewal']) {
        const codes = readCodes({ ...ADULT, application_type, insurance_basis: 'system_verified' });
        assert.equal(codes.includes('photographs'), false);
        assert.equal(codes.includes('residence_card'), false);
        assert.ok(codes.includes('health_insurance'));
        assert.ok(codes.includes('student_certificate'));
        assert.equal(codes.includes('uets'), application_type === 'renewal');
    }
    assert.ok(readCodes({ ...ADULT, insurance_basis: 'bilateral_agreement' }).includes('health_insurance'));
    assert.ok(readCodes({ ...ADULT, insurance_basis: 'system_verified' }).includes('health_insurance'));
});

test('system-verified health insurance proof is required for every application type', () => {
    for (const application_type of ['initial', 'renewal', 'transition']) {
        const policy = listDocumentPolicies(application_type, false, {
            ...ADULT, insurance_basis: 'system_verified'
        }).find(({ code }) => code === 'health_insurance');
        assert.equal(policy?.required, true, application_type);
    }
});

test('each accommodation branch requires only its selected address documents', () => {
    const expected = { rental_contract: ['address_rental_contract'], own_home: ['address_title_deed', 'address_numbering'],
        dormitory: ['address_dormitory', 'dormitory_tax_certificate', 'dormitory_signature_circular'],
        hotel: ['address_hotel'], undertaking: ['address_undertaking', 'host_residence_certificate', 'home_utility_bill'],
        residence_certificate: ['address_residence_certificate'] };
    for (const accommodation_type of ACCOMMODATION_TYPES) {
        const application = { ...ADULT, accommodation_type, host_is_married: 'no', host_is_turkish: 'no' };
        for (const application_type of ['initial', 'renewal']) {
            const codes = readCodes({ ...application, application_type });
            for (const code of expected[accommodation_type]) assert.ok(codes.includes(code), code);
            assert.equal(codes.includes('address_residence_certificate'), accommodation_type === 'residence_certificate');
            assert.equal(codes.includes('home_utility_bill'), accommodation_type === 'undertaking');
        }
    }
});

test('transition route UETS requires an existing fingerprint code regardless of age', () => {
    const application = { ...ADULT, application_type: 'renewal', application_route: 'transition',
        accommodation_type: 'rental_contract', fingerprint_status: 'registered', fingerprint_code: 'FP-123' };
    const codes = listApplicationDocumentPolicies(application).filter(({ required }) => required).map(({ code }) => code);
    for (const code of ['address_rental_contract', 'uets']) assert.ok(codes.includes(code), code);
    assert.equal(codes.includes('home_utility_bill'), false);
    assert.equal(codes.includes('address_residence_certificate'), false);
    assert.equal(listApplicationDocumentPolicies({ ...application, fingerprint_code: '' }).some(({ code }) => code === 'uets'), false);
    assert.equal(listApplicationDocumentPolicies({ ...application, is_under_18: 1 }).some(({ code }) => code === 'uets'), true);
});

test('married hosts require spouse undertaking and host identity copy is not requested', () => {
    const application = { ...ADULT, accommodation_type: 'undertaking', host_is_married: 'yes' };
    assert.ok(readCodes(application).includes('host_spouse_undertaking'));
    assert.equal(readCodes({ ...application, host_is_married: 'no' }).includes('host_spouse_undertaking'), false);
    assert.equal(readCodes({ ...application, accommodation_type: 'hotel' }).includes('host_spouse_undertaking'), false);
    assert.equal(readDocumentPolicy('host_identity_copy', 'initial', false, application), null);
});

test('all minors require separate consent without unrelated family evidence', () => {
    const minor = { ...ADULT, is_under_18: 1, minor_parents_identified: 'no', minor_family_status: 'divorced' };
    const codes = readCodes(minor);
    assert.ok(codes.includes('minor_consent'));
    for (const code of ['birth_certificate_under18', 'minor_family_evidence', 'parent_permit_copy']) {
        assert.equal(readDocumentPolicy(code, 'initial', true, minor), null);
    }
    assert.equal(readCodes({ ...minor, is_under_18: 0 }).includes('minor_consent'), false);
});

test('renewal requires UETS for applicants under 18 as well', () => {
    const minorRenewal = { ...ADULT, application_type: 'renewal', is_under_18: 1 };
    assert.ok(readCodes(minorRenewal).includes('uets'));
    assert.ok(readCodes({ ...minorRenewal, is_under_18: 0 }).includes('uets'));
});

test('unanswered and invalid conditional questions block server readiness even with no missing document uploads', () => {
    const application = { ...ADULT, accommodation_type: 'undertaking', is_under_18: 1 };
    const missing = listMissingDocumentAnswers(application);
    assert.deepEqual(missing, ['host_is_married', 'host_is_turkish']);
    const result = evaluateSubmissionReadiness(application, [], [], { declarationVersion: 'test' });
    missing.forEach((field) => assert.ok(result.missing_fields.includes(field)));
    assert.equal(result.status, 'not_ready');
    assert.equal(readAccommodationType({ address_evidence_type: 'rental_contract', accommodation_type: 'hotel' }), 'hotel');
    assert.equal(readAccommodationType({ address_evidence_type: 'rental_contract' }), 'rental_contract');
    assert.deepEqual(listRequiredDocumentAnswers({ ...ADULT, application_type: 'renewal' }), []);
});

function createRequest(path, options = {}) {
    const requestBody = path === '/api/public/applications' && options.method === 'POST'
        ? withTestApplicationPrivacyNoticeVersion(options.body || {}) : options.body;
    return new Request(`https://portal.test${path}`, {
        method: options.method || 'GET', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : {}) },
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {})
    });
}

async function createDraft() {
    const DB = new TestD1Database();
    applyAllMigrations(DB);
    const environment = withTestApplicationPrivacyNotice({ DB });
    const response = await worker.fetch(createRequest('/api/public/applications', { method: 'POST', body: {
        student_number: 'CONDITIONS-1', application_type: 'initial', email: 'test@example.edu', phone: '+905551112233'
    } }), environment, {});
    assert.equal(response.status, 201);
    return { environment, cookie: response.headers.get('Set-Cookie').split(';')[0], application: (await response.json()).application };
}

test('owner PATCH persists new accommodation and answers, survives reload and drives requirement API', async () => {
    const { environment, cookie, application } = await createDraft();
    const response = await worker.fetch(createRequest('/api/public/applications/current', { method: 'PATCH', cookie, body: {
        lock_version: application.lock_version, address_evidence_type: 'hotel', insurance_basis: 'bilateral_agreement'
    } }), environment, {});
    assert.equal(response.status, 200);
    const reloaded = await worker.fetch(createRequest('/api/public/applications/current', { cookie }), environment, {});
    const saved = (await reloaded.json()).application;
    assert.equal(saved.address_evidence_type, 'hotel');
    assert.equal(saved.insurance_basis, 'bilateral_agreement');
    const persisted = environment.DB.prepare('SELECT accommodation_type, address_evidence_type FROM applications').first();
    assert.equal(persisted.accommodation_type, 'hotel');
    assert.equal(persisted.address_evidence_type, null);
    const requirements = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie }), environment, {});
    const codes = (await requirements.json()).requirements.map(({ code }) => code);
    assert.ok(codes.includes('address_hotel'));
    assert.equal(codes.includes('address_hotel_receipt'), false);
    assert.ok(codes.includes('health_insurance'));
    assert.equal(codes.includes('residence_card'), false);
    assert.equal(codes.includes('photographs'), false);
    assert.equal(codes.includes('home_utility_bill'), false);
    const invalid = await worker.fetch(createRequest('/api/public/applications/current', { method: 'PATCH', cookie,
        body: { lock_version: saved.lock_version, host_is_married: 'maybe' } }), environment, {});
    assert.equal(invalid.status, 400);
    assert.equal(environment.DB.prepare('SELECT host_is_married FROM applications').first().host_is_married, null);
});

test('system-verified health insurance proof is required for every application type', () => {
    assert.equal(readDocumentPolicy('health_insurance', 'renewal', false, { insurance_basis: 'gss_pending' }).required, true);
    assert.equal(readDocumentPolicy('health_insurance', 'initial', false, { insurance_basis: 'bilateral_agreement' }).required, true);
    for (const applicationType of ['initial', 'renewal', 'transition']) {
        assert.equal(readDocumentPolicy('health_insurance', applicationType, false, {
            insurance_basis: 'system_verified'
        }).required, true, applicationType);
    }
});

test('forward migration preserves previously submitted policy and leaves data and foreign keys intact', () => {
    const DB = new TestD1Database();
    const directory = new URL('../migrations/', import.meta.url);
    readdirSync(directory).filter((file) => file.endsWith('.sql') && file < '0025').sort()
        .forEach((file) => DB.exec(readFileSync(new URL(file, directory), 'utf8')));
    DB.exec("INSERT INTO students (id,student_number,normalized_student_number) VALUES ('old','OLD','OLD'),('draft','DRAFT','DRAFT');");
    DB.exec("INSERT INTO applications (id,student_id,application_type,status) VALUES ('old','old','initial','submitted'),('draft','draft','initial','draft');");
    const requirementsBefore = DB.prepare('SELECT count(*) AS count FROM document_requirements').first().count;
    DB.exec(readFileSync(new URL('0025_conditional_student_documents.sql', directory), 'utf8'));
    const old = DB.prepare("SELECT * FROM applications WHERE id='old'").first();
    const draft = DB.prepare("SELECT * FROM applications WHERE id='draft'").first();
    assert.equal(old.document_policy_version, 1);
    assert.equal(draft.document_policy_version, 2);
    assert.ok(readCodes(old).includes('photographs'));
    assert.ok(readCodes({ ...draft, final_document_policy: 0 }).includes('photographs'));
    assert.equal(DB.prepare('SELECT count(*) AS count FROM applications').first().count, 2);
    assert.ok(DB.prepare('SELECT count(*) AS count FROM document_requirements').first().count > requirementsBefore);
    assert.equal(DB.prepare('PRAGMA foreign_key_check').all().results.length, 0);
});
