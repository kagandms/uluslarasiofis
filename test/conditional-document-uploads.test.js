import { readSubmissionReadiness } from '../src/server/services/submissionReadiness.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRealScannerFixture, createSyntheticDraft, finalizeSyntheticFile, portalRequest } from './helpers/scanner-real-fixture.js';
import { listApplicationDocumentPolicies } from '../src/server/domain/documentPolicy.js';
import { readDocumentConditionSql } from '../src/server/repositories/d1/document-condition-sql.js';

const SCENARIOS = [
    { address_evidence_type: 'rental_contract', codes: ['address_rental_contract'] },
    { address_evidence_type: 'own_home', codes: ['address_title_deed', 'address_numbering', 'address_dask'] },
    { address_evidence_type: 'dormitory', codes: ['address_dormitory', 'dormitory_tax_certificate', 'dormitory_signature_circular'] },
    { address_evidence_type: 'hotel', codes: ['address_hotel'] },
    { address_evidence_type: 'undertaking', host_is_married: 'yes', host_is_turkish: 'yes', codes: ['home_utility_bill', 'host_spouse_undertaking', 'host_population_record'] },
    { application_type: 'transition', address_evidence_type: 'rental_contract', fingerprint_status: 'registered', fingerprint_code: 'FP-SYNTHETIC', codes: ['address_rental_contract', 'uets'] },
    { application_type: 'renewal', address_evidence_type: 'residence_certificate', codes: ['address_residence_certificate', 'uets'] },
    { address_evidence_type: 'undertaking', host_is_married: 'no', host_is_turkish: 'no', codes: ['home_utility_bill'] },
    { insurance_basis: 'system_verified', codes: ['health_insurance'] },
    { insurance_basis: 'bilateral_agreement', codes: ['health_insurance'] },
    { date_of_birth: '2012-01-01', minor_parents_identified: 'no', minor_family_status: 'divorced',
        codes: ['minor_consent'] }
];

async function applyScenario(context, app, scenario) {
    const current = await portalRequest(context, '/api/public/applications/current', { cookie: app.cookie });
    const { codes, ...answers } = scenario;
    if (Object.hasOwn(answers, 'date_of_birth')) answers.residence_application_date = '2026-10-23';
    const response = await portalRequest(context, '/api/public/applications/current', { cookie: app.cookie, method: 'PATCH',
        body: { lock_version: (await current.json()).application.lock_version, ...answers } });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).application;
}

for (const scenario of SCENARIOS) {
    test(`new conditional documents can create an intent, finalize and queue scanning: ${scenario.codes.join(', ')}`, async () => {
        const context = await createRealScannerFixture();
        const app = await createSyntheticDraft(context);
        await applyScenario(context, app, scenario);

        for (const code of scenario.codes) {
            await finalizeSyntheticFile({ context, app, bytes: Buffer.from('%PDF synthetic'), code });
        }
        assert.equal(context.database.prepare('PRAGMA foreign_key_check').all().results.length, 0);
    });
}

test('current upload intents reject obsolete residence-card requirements and accept biometric photographs', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    const card = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
        cookie: app.cookie, method: 'POST', body: { code: 'residence_card', filename: 'card.pdf', media_type: 'application/pdf', byte_size: 4 }
    });
    assert.equal(card.status, 404);
    const photograph = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
        cookie: app.cookie, method: 'POST', body: { code: 'photographs', filename: 'photos.pdf', media_type: 'application/pdf', byte_size: 4 }
    });
    assert.notEqual(photograph.status, 404);
});

test('minors upload separate consent without unrelated family or parent documents', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    await applyScenario(context, app, { date_of_birth: '2012-01-01',
        minor_family_status: 'both_parents', minor_parents_identified: 'yes', codes: [] });

    for (const code of ['minor_family_evidence', 'birth_certificate_under18', 'parent_permit_copy']) {
        const response = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
            cookie: app.cookie, method: 'POST', body: { code, filename: 'parent-document.pdf', media_type: 'application/pdf', byte_size: 4 }
        });
        assert.equal(response.status, 404, code);
    }
    for (const code of ['minor_consent']) {
        const response = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
            cookie: app.cookie, method: 'POST', body: { code, filename: 'parent-document.pdf', media_type: 'application/pdf', byte_size: 4 }
        });
        assert.equal(response.status, 201, code);
    }
});

test('atomic persistence guards agree with the policy for every conditional document in each scenario', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    for (const scenario of SCENARIOS) {
        await applyScenario(context, app, scenario);
        const application = context.database.prepare('SELECT * FROM applications WHERE id=?').bind(app.applicationId).first();
        const policies = listApplicationDocumentPolicies(application);
        for (const policy of policies) {
            const matches = context.database.prepare(`SELECT id FROM applications WHERE id=? ${readDocumentConditionSql(policy.conditional_rule)}`)
                .bind(app.applicationId).first();
            assert.ok(matches, policy.code);
        }
    }
    assert.throws(() => readDocumentConditionSql('unknown'), TypeError);
});

test('registered address is a complete alternative without rental, undertaking or dormitory requirements', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    await applyScenario(context, app, { application_type: 'renewal', address_evidence_type: 'residence_certificate' });
    const readiness = await readSubmissionReadiness(app.applicationId, context.environment, 'student-information-accuracy-v1');
    assert.equal(readiness.missing_fields.includes('address_evidence_type'), false);
    const response = await portalRequest(context, '/api/public/applications/current/documents', { cookie: app.cookie });
    const { requirements } = await response.json();
    assert.deepEqual(requirements.map(({ code }) => code).sort(), [
        'residence_application_form', 'passport', 'photographs', 'student_certificate', 'health_insurance',
        'residence_permit_fee', 'uets', 'address_residence_certificate'
    ].sort());
});



test('DASK is optional and Turkish-host population record cannot be uploaded for a foreign host', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    await applyScenario(context, app, { address_evidence_type: 'own_home' });
    const readiness = await readSubmissionReadiness(app.applicationId, context.environment, 'student-information-accuracy-v1');
    assert.equal(readiness.missing_documents.includes('address_dask'), false);
    await applyScenario(context, app, { address_evidence_type: 'undertaking', host_is_turkish: 'no', host_is_married: 'no' });
    for (const code of ['host_population_record', 'address_dask', 'host_spouse_undertaking']) {
        const response = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
            cookie: app.cookie, method: 'POST', body: { code, filename: 'outside-branch.pdf', media_type: 'application/pdf', byte_size: 4 }
        });
        assert.equal(response.status, 404, code);
    }
});
