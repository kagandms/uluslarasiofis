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
        residence_application_date: '2026-10-23', academic_year_start_date: '2026-09-01',
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

test('first application requests common documents including photographs without obsolete card uploads', async (context) => {
    const { root, document, state, application } = await createWizard();
    context.after(() => document.defaultView.close());
    assert.equal(state.step, 1);
    assert.equal(root.querySelector('[name="has_residence_card"]'), null);
    await submitStep(root);
    assert.equal(state.step, 2);
    assert.equal(root.querySelector('[data-document-code="residence_card"]'), null);
    assert.ok(root.querySelector('[data-document-code="photographs"]'));
    assert.ok(root.querySelector('[data-document-code="health_insurance"]'));
    assert.equal(application.has_residence_card, undefined);
});

test('host question appears only for host accommodation and other answers survive rerender', async (context) => {
    const { root, document, application } = await createWizard();
    context.after(() => document.defaultView.close());
    assert.equal(root.querySelector('[name="host_is_married"]'), null);

    await changeValue(root, 'address_evidence_type', 'undertaking');
    assert.ok(root.querySelector('[name="host_is_married"]'));
    assert.ok(root.querySelector('[name="host_is_turkish"]'));
    assert.equal(root.querySelector('button[type="submit"]').disabled, true);
    await changeValue(root, 'host_is_married', 'yes');
    assert.equal(application.host_is_married, 'yes');
    assert.equal(root.querySelector('button[type="submit"]').disabled, true);
    await changeValue(root, 'host_is_turkish', 'yes');
    assert.equal(application.host_is_turkish, 'yes');
    assert.equal(root.querySelector('button[type="submit"]').disabled, false);
    await changeValue(root, 'address_evidence_type', 'dormitory');
    assert.equal(root.querySelector('[name="host_is_married"]'), null);
    assert.equal(root.querySelector('[name="host_is_turkish"]'), null);
    assert.equal(root.querySelector('[name="has_residence_card"]'), null);
    assert.equal(root.querySelector('button[type="submit"]').disabled, false);
});

test('minors need a separate notarized consent without obsolete family or insurance questions', async (context) => {
    const { root, document, application, state } = await createWizard();
    context.after(() => document.defaultView.close());
    await changeValue(root, 'date_of_birth', '2012-01-01');
    assert.equal(root.querySelector('[name="minor_family_status"]'), null);
    assert.equal(root.querySelector('[name="insurance_basis"]'), null);
    assert.equal(application.is_under_18, true);
    await submitStep(root);
    assert.equal(state.step, 2);
    assert.ok(root.querySelector('[data-document-code="minor_consent"]'));
    assert.match(root.textContent, /Noter onaylı muvafakatname/);
});

test('registered address is a standalone alternative with no lease or dorm documents', async (context) => {
    const { root, document, state } = await createWizard();
    context.after(() => document.defaultView.close());
    await changeValue(root, 'address_evidence_type', 'residence_certificate');
    await submitStep(root);
    assert.equal(state.step, 2);
    assert.ok(root.querySelector('[data-document-code="address_residence_certificate"]'));
    assert.equal(root.querySelector('[data-document-code="address_rental_contract"]'), null);
    assert.equal(root.querySelector('[data-document-code="address_dormitory"]'), null);
});
