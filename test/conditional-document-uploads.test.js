import { readSubmissionReadiness } from '../src/server/services/submissionReadiness.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRealScannerFixture, createSyntheticDraft, finalizeSyntheticFile, portalRequest } from './helpers/scanner-real-fixture.js';
import { listDocumentPolicies } from '../src/server/domain/documentPolicy.js';
import { readDocumentConditionSql } from '../src/server/repositories/d1/document-condition-sql.js';

const SCENARIOS = [
    { address_evidence_type: 'rental_contract', codes: ['photographs'] },
    { address_evidence_type: 'own_home', codes: ['address_title_deed', 'address_numbering'] },
    { address_evidence_type: 'dormitory', codes: ['address_dormitory'] },
    { address_evidence_type: 'hotel', codes: ['address_hotel', 'address_hotel_receipt'] },
    { address_evidence_type: 'undertaking', host_is_married: 'yes', codes: ['host_spouse_undertaking'] },
    { application_type: 'renewal', address_evidence_type: 'rental_contract', codes: ['address_residence_certificate', 'home_utility_bill'] },
    { address_evidence_type: 'undertaking', host_is_married: 'no', codes: [] },
    { insurance_basis: 'bilateral_agreement', codes: ['health_insurance'] },
    { date_of_birth: '2012-01-01', minor_entry_type: 'other', minor_parents_identified: 'no', minor_family_status: 'divorced',
        codes: ['birth_certificate_under18', 'minor_consent', 'minor_family_evidence'] }
];

async function applyScenario(context, app, scenario) {
    const current = await portalRequest(context, '/api/public/applications/current', { cookie: app.cookie });
    const { codes, ...answers } = scenario;
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

test('upload intent rejects a residence-card document and keeps photos available', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    const card = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
        cookie: app.cookie, method: 'POST', body: { code: 'residence_card', filename: 'card.pdf', media_type: 'application/pdf', byte_size: 4 }
    });
    assert.equal(card.status, 404);
    const photograph = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
        cookie: app.cookie, method: 'POST', body: { code: 'photographs', filename: 'photos.pdf', media_type: 'application/pdf', byte_size: 4 }
    });
    assert.equal(photograph.status, 201);
});

test('student-visa minors cannot upload parental consent or conditional parent evidence', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    await applyScenario(context, app, { date_of_birth: '2012-01-01', minor_entry_type: 'student_visa', codes: [] });

    for (const code of ['minor_consent', 'minor_family_evidence', 'birth_certificate_under18']) {
        const response = await portalRequest(context, '/api/public/applications/current/documents/upload-intent', {
            cookie: app.cookie, method: 'POST', body: { code, filename: 'parent-document.pdf', media_type: 'application/pdf', byte_size: 4 }
        });
        assert.equal(response.status, 404, code);
    }
});

test('atomic persistence guards agree with the policy for every conditional document in each scenario', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    for (const scenario of SCENARIOS) {
        await applyScenario(context, app, scenario);
        const application = context.database.prepare('SELECT * FROM applications WHERE id=?').bind(app.applicationId).first();
        const policies = listDocumentPolicies(application.application_type, application.is_under_18 === 1, application);
        for (const policy of policies) {
            const matches = context.database.prepare(`SELECT id FROM applications WHERE id=? ${readDocumentConditionSql(policy.conditional_rule)}`)
                .bind(app.applicationId).first();
            assert.ok(matches, policy.code);
        }
    }
    assert.throws(() => readDocumentConditionSql('unknown'), TypeError);
});

test('a saved legacy residence-certificate choice cannot replace selecting accommodation on a current renewal draft', async () => {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    await applyScenario(context, app, { application_type: 'renewal', address_evidence_type: 'residence_certificate' });
    const readiness = await readSubmissionReadiness(app.applicationId, context.environment, 'student-information-accuracy-v1');
    assert.ok(readiness.missing_fields.includes('address_evidence_type'));
});


