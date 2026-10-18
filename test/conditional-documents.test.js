import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { listDocumentPolicies, readDocumentPolicy } from '../src/server/domain/documentPolicy.js';
import { ACCOMMODATION_TYPES, listMissingDocumentAnswers, listRequiredDocumentAnswers, readAccommodationType } from '../src/shared/document-conditions.js';
import { evaluateSubmissionReadiness } from '../src/server/services/submissionReadiness.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import worker from '../src/server/worker.js';

function readCodes(application) {
    return listDocumentPolicies(application.application_type, application.is_under_18 === 1, application)
        .filter(({ required }) => required).map(({ code }) => code);
}

const ADULT = Object.freeze({ application_type: 'initial', is_under_18: 0 });

test('current applications request the official form documents without a residence-card upload', () => {
    for (const application_type of ['initial', 'renewal']) {
        const codes = readCodes({ ...ADULT, application_type, insurance_basis: 'system_verified' });
        assert.ok(codes.includes('photographs'));
        assert.equal(codes.includes('residence_card'), false);
        assert.equal(codes.includes('health_insurance'), false);
        assert.ok(codes.includes('student_certificate'));
        assert.equal(codes.includes('uets'), application_type === 'renewal');
    }
    assert.ok(readCodes({ ...ADULT, insurance_basis: 'bilateral_agreement' }).includes('health_insurance'));
});

test('renewal adds residence registration and bill independently to every accommodation branch', () => {
    const expected = { rental_contract: ['address_rental_contract'], own_home: ['address_title_deed', 'address_numbering'],
        dormitory: ['address_dormitory'], hotel: ['address_hotel', 'address_hotel_receipt'], undertaking: ['address_undertaking', 'host_residence_certificate'] };
    for (const accommodation_type of ACCOMMODATION_TYPES) {
        const application = { ...ADULT, accommodation_type, host_is_married: 'no' };
        const initial = readCodes(application);
        const renewal = readCodes({ ...application, application_type: 'renewal' });
        for (const code of expected[accommodation_type]) assert.ok(initial.includes(code), code);
        assert.equal(initial.includes('address_residence_certificate'), false);
        assert.equal(initial.includes('home_utility_bill'), false);
        assert.ok(renewal.includes('address_residence_certificate'));
        assert.ok(renewal.includes('home_utility_bill'));
    }
});

test('married hosts require spouse undertaking and host identity copy is not requested', () => {
    const application = { ...ADULT, accommodation_type: 'undertaking', host_is_married: 'yes' };
    assert.ok(readCodes(application).includes('host_spouse_undertaking'));
    assert.equal(readCodes({ ...application, host_is_married: 'no' }).includes('host_spouse_undertaking'), false);
    assert.equal(readCodes({ ...application, accommodation_type: 'hotel' }).includes('host_spouse_undertaking'), false);
    assert.equal(readDocumentPolicy('host_identity_copy', 'initial', false, application), null);
});

test('minor consent applies to every minor while family evidence follows the stated family situation', () => {
    const minor = { ...ADULT, is_under_18: 1, minor_parents_identified: 'no', minor_family_status: 'divorced' };
    const codes = readCodes(minor);
    for (const code of ['birth_certificate_under18', 'minor_consent', 'minor_family_evidence']) assert.ok(codes.includes(code));
    const bothParents = readCodes({ ...minor, minor_parents_identified: 'yes', minor_family_status: 'both_parents' });
    assert.ok(bothParents.includes('minor_consent'));
    assert.equal(bothParents.includes('birth_certificate_under18'), false);
    assert.equal(bothParents.includes('minor_family_evidence'), false);
    assert.equal(readDocumentPolicy('parent_permit_copy', 'initial', true, { minor_parents_identified: 'yes' }).required, false);
    for (const minor_family_status of ['divorced', 'deceased', 'single_parent', 'absent']) {
        assert.ok(readCodes({ ...minor, minor_family_status }).includes('minor_family_evidence'));
    }
    const adult = readCodes({ ...minor, is_under_18: 0 });
    assert.equal(adult.some((code) => code.startsWith('minor_') || code === 'birth_certificate_under18'), false);
});

test('renewal omits UETS for applicants under 18', () => {
    const minorRenewal = { ...ADULT, application_type: 'renewal', is_under_18: 1 };
    assert.equal(readCodes(minorRenewal).includes('uets'), false);
    assert.ok(readCodes({ ...minorRenewal, is_under_18: 0 }).includes('uets'));
});

test('unanswered and invalid conditional questions block server readiness even with no missing document uploads', () => {
    const application = { ...ADULT, accommodation_type: 'undertaking', is_under_18: 1 };
    const missing = listMissingDocumentAnswers(application);
    assert.deepEqual(missing, ['host_is_married', 'minor_family_status', 'minor_parents_identified', 'insurance_basis']);
    const result = evaluateSubmissionReadiness(application, [], [], { declarationVersion: 'test' });
    missing.forEach((field) => assert.ok(result.missing_fields.includes(field)));
    assert.equal(result.status, 'not_ready');
    assert.equal(readAccommodationType({ address_evidence_type: 'rental_contract', accommodation_type: 'hotel' }), 'hotel');
    assert.equal(readAccommodationType({ address_evidence_type: 'rental_contract' }), 'rental_contract');
    assert.deepEqual(listRequiredDocumentAnswers({ ...ADULT, application_type: 'renewal' }), ['insurance_basis']);
});

function createRequest(path, options = {}) {
    return new Request(`https://portal.test${path}`, {
        method: options.method || 'GET', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
}

async function createDraft() {
    const DB = new TestD1Database();
    applyAllMigrations(DB);
    const environment = { DB };
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
    assert.ok(codes.includes('address_hotel_receipt'));
    assert.ok(codes.includes('health_insurance'));
    assert.equal(codes.includes('residence_card'), false);
    assert.ok(codes.includes('photographs'));
    assert.equal(codes.includes('home_utility_bill'), false);
    const invalid = await worker.fetch(createRequest('/api/public/applications/current', { method: 'PATCH', cookie,
        body: { lock_version: saved.lock_version, host_is_married: 'maybe' } }), environment, {});
    assert.equal(invalid.status, 400);
    assert.equal(environment.DB.prepare('SELECT host_is_married FROM applications').first().host_is_married, null);
});

test('insurance proof is requested only for bilateral coverage, while other coverage paths require no upload', () => {
    assert.equal(readDocumentPolicy('health_insurance', 'initial', false, { insurance_basis: 'system_verified' }), null);
    assert.equal(readDocumentPolicy('health_insurance', 'renewal', false, { insurance_basis: 'gss_pending' }), null);
    assert.equal(readDocumentPolicy('health_insurance', 'initial', false, { insurance_basis: 'bilateral_agreement' }).required, true);
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
    assert.ok(readCodes(draft).includes('photographs'));
    assert.equal(DB.prepare('SELECT count(*) AS count FROM applications').first().count, 2);
    assert.ok(DB.prepare('SELECT count(*) AS count FROM document_requirements').first().count > requirementsBefore);
    assert.equal(DB.prepare('PRAGMA foreign_key_check').all().results.length, 0);
});
