import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeApplicationWizard } from '../src/public/applicationWizard.js';
import { listDocumentPolicies } from '../src/server/domain/documentPolicy.js';

async function createWizard(overrides = {}) {
    const document = new JSDOM('<!doctype html><html lang="tr"><body><section></section></body></html>').window.document;
    const application = { status: 'draft', application_type: 'initial', address_evidence_type: 'rental_contract',
        student_number: 'CONDITIONAL-UI', student_email: 'test@example.edu', student_phone: '+905551112233',
        first_name: 'Test', last_name: 'Student', passport_number: 'P1234', nationality: 'Turkish',
        date_of_birth: '2000-01-01', is_under_18: 0, fingerprint_status: 'registered', fingerprint_code: 'FP-1',
        insurance_basis: 'system_verified',
        contact_acknowledgement: { accepted_current: true }, declaration: { accepted_current: false }, ...overrides };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async updateCurrentApplication(patch) { Object.assign(application, patch); return { ...application }; },
        async readCurrentStudentDocumentRequirements() {
            return { requirements: listDocumentPolicies(application.application_type, Boolean(application.is_under_18), application) };
        }
    };
    const root = document.querySelector('section');
    const state = await initializeApplicationWizard(root, api);
    return { document, root, state, application };
}

async function changeValue(root, name, value) {
    const field = root.querySelector(`[name="${name}"]${name === 'address_evidence_type' ? `[value="${value}"]` : ''}`);
    if (field.type === 'radio') field.checked = true;
    else field.value = value;
    field.dispatchEvent(new root.ownerDocument.defaultView.Event('change', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

async function submitStep(root) {
    root.querySelector('form').dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

test('first application no longer asks for a residence card and requests biometric photos', async (context) => {
    const { root, document, state, application } = await createWizard();
    context.after(() => document.defaultView.close());
    assert.equal(state.step, 1);
    assert.equal(root.querySelector('[name="has_residence_card"]'), null);
    await submitStep(root);
    assert.equal(state.step, 2);
    assert.equal(root.querySelector('[data-document-code="residence_card"]'), null);
    assert.ok(root.querySelector('[data-document-code="photographs"]'));
    assert.equal(application.has_residence_card, undefined);
});

test('host question appears only for host accommodation and other answers survive rerender', async (context) => {
    const { root, document, application } = await createWizard();
    context.after(() => document.defaultView.close());
    assert.equal(root.querySelector('[name="host_is_married"]'), null);

    await changeValue(root, 'address_evidence_type', 'undertaking');
    assert.ok(root.querySelector('[name="host_is_married"]'));
    assert.equal(root.querySelector('button[type="submit"]').disabled, true);
    await changeValue(root, 'host_is_married', 'yes');
    assert.equal(application.host_is_married, 'yes');
    await changeValue(root, 'address_evidence_type', 'dormitory');
    assert.equal(root.querySelector('[name="host_is_married"]'), null);
    assert.equal(root.querySelector('[name="has_residence_card"]'), null);
    assert.equal(root.querySelector('button[type="submit"]').disabled, false);
});

test('minor entry choice reveals only the applicable questions and saves calculated age', async (context) => {
    const { root, document, application } = await createWizard();
    context.after(() => document.defaultView.close());
    assert.equal(root.querySelector('[name="minor_entry_type"]'), null);

    await changeValue(root, 'date_of_birth', '2012-01-01');
    assert.ok(root.querySelector('[name="minor_entry_type"]'));
    assert.equal(root.querySelector('[name="minor_family_status"]'), null);
    assert.ok(root.querySelector('[name="insurance_basis"]'));
    assert.equal(application.is_under_18, true);
    await changeValue(root, 'minor_entry_type', 'student_visa');
    assert.equal(root.querySelector('[name="minor_family_status"]'), null);
    assert.equal(root.querySelector('[name="minor_parents_identified"]'), null);
    await changeValue(root, 'minor_entry_type', 'other');
    for (const name of ['minor_family_status', 'minor_parents_identified']) assert.ok(root.querySelector(`[name="${name}"]`), name);
    await changeValue(root, 'minor_family_status', 'both_parents');
    await changeValue(root, 'minor_parents_identified', 'yes');
    await changeValue(root, 'insurance_basis', 'system_verified');
    assert.equal(root.querySelector('button[type="submit"]').disabled, false);
    await changeValue(root, 'date_of_birth', '2000-01-01');
    assert.equal(root.querySelector('[name="minor_family_status"]'), null);
    assert.equal(application.is_under_18, false);
});
