import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationWizard, renderFingerprintSection, renderStudentDocumentRequirements } from '../src/public/applicationWizard.js';

function createRoot() {
    const document = new JSDOM('<!doctype html><html lang="tr"><body><section></section></body></html>').window.document;
    return { document, root: document.querySelector('section') };
}

test('registered fingerprint state shows the dedicated code input and preserves a safe code value', () => {
    const { document, root } = createRoot();
    renderFingerprintSection(root, { fingerprint_status: 'registered', fingerprint_code: 'FP-A/42' });

    const codeInput = root.querySelector('input[name="fingerprint_code"]');
    const registeredChoice = root.querySelector('input[name="fingerprint_status"][value="registered"]');

    assert.ok(codeInput);
    assert.equal(codeInput.type, 'text');
    assert.equal(codeInput.maxLength, 128);
    assert.equal(codeInput.value, 'FP-A/42');
    assert.equal(registeredChoice.checked, true);
    assert.equal(registeredChoice.required, true);
    assert.equal(root.textContent.includes('parmak izi kaydınız'), true);
    document.defaultView.close();
});

test('not-registered fingerprint state shows the required action without inventing a code', () => {
    const { document, root } = createRoot();
    renderFingerprintSection(root, { fingerprint_status: 'not_registered', fingerprint_code: null });

    assert.equal(root.querySelector('input[name="fingerprint_code"]'), null);
    assert.equal(root.querySelector('input[name="fingerprint_status"][value="not_registered"]').checked, true);
    assert.match(root.textContent, /Göç İdaresi sisteminde parmak izi kaydınız bulunmuyorsa, başvurunun ilerleyen aşamasından önce Göç İdaresi’nde parmak izi işleminizi tamamlamanız gerekir\./);
    document.defaultView.close();
});

test('registered fingerprint state with no code remains an explicit incomplete action', () => {
    const { document, root } = createRoot();
    renderFingerprintSection(root, { fingerprint_status: 'registered', fingerprint_code: null });

    assert.ok(root.querySelector('input[name="fingerprint_code"]'));
    assert.match(root.textContent, /kodu girilmedi/i);
    document.defaultView.close();
});

test('under-18 review requirements show the required birth certificate and current upload state', () => {
    const { document, root } = createRoot();
    renderStudentDocumentRequirements(root, [{
        code: 'birth_certificate_under18', is_required: true, upload_status: null,
        revision_number: null, review_status: null, revision_status: null,
        scan_status: null, filename: null
    }]);

    assert.match(root.textContent, /Doğum belgesi/);
    assert.match(root.textContent, /Zorunlu/);
    assert.match(root.textContent, /Henüz yüklenmedi/);
    assert.equal(root.querySelector('input[type="file"]'), null);
    document.defaultView.close();
});

test('wizard saves under-18 and fingerprint state before loading the server requirement set', async () => {
    const { document, root } = createRoot();
    const window = document.defaultView;
    const application = {
        status: 'draft', application_type: 'initial', student_number: '2026123999',
        student_email: 'student@example.edu', student_phone: '+905551112233',
        is_under_18: null, fingerprint_status: null, fingerprint_code: null
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async updateCurrentApplication(fields) {
            Object.assign(application, fields);
            return { ...application };
        },
        async readCurrentStudentDocumentRequirements() {
            const requirements = [{ code: 'fingerprint', is_required: true }];
            if (application.is_under_18) requirements.push({ code: 'birth_certificate_under18', is_required: true });
            return { requirements };
        },
        async uploadStudentDocument() { throw new Error('not used'); }
    };

    const state = await initializeApplicationWizard(root, api);
    const ageChoice = root.querySelector('select[name="is_under_18"]');
    ageChoice.value = 'true';
    const registeredChoice = root.querySelector('input[name="fingerprint_status"][value="registered"]');
    registeredChoice.checked = true;
    registeredChoice.dispatchEvent(new window.Event('change', { bubbles: true }));
    const codeInput = root.querySelector('input[name="fingerprint_code"]');
    codeInput.value = 'AB/FP-7';
    ageChoice.value = 'true';
    root.querySelector('#application-step-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.step, 2);
    assert.equal(application.is_under_18, true);
    assert.equal(application.fingerprint_status, 'registered');
    assert.equal(application.fingerprint_code, 'AB/FP-7');
    assert.equal(state.requirements.some(({ code }) => code === 'birth_certificate_under18'), true);
    assert.equal(root.textContent.includes('Doğum belgesi'), true);
    window.close();
});
