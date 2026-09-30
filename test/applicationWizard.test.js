import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationWizard, renderFingerprintSection, renderStudentDocumentRequirements } from '../src/public/applicationWizard.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

function createRoot() {
    const document = new JSDOM('<!doctype html><html lang="tr"><body><section></section></body></html>').window.document;
    return { document, root: document.querySelector('section') };
}

function fillRequiredResidenceFields(root) {
    const fields = { first_name: 'Ayşe', last_name: 'Yılmaz', passport_number: 'P123456', nationality: 'Turkish', date_of_birth: '2000-01-01' };
    Object.entries(fields).forEach(([name, value]) => { root.querySelector(`[name="${name}"]`).value = value; });
}

function createFingerprintRequirements() {
    return ['passport', 'residence_card'].map((code) => ({
        code, required: true, label_key: code === 'passport' ? 'documentPassport' : 'documentResidenceCard',
        description_key: code === 'passport' ? 'documentPassportHelp' : 'documentResidenceCardHelp',
        accepted_media_types: ['application/pdf'], max_byte_size: 1024, filename: null, upload_status: null
    }));
}

async function createFingerprintWizard(fingerprintStatus, fingerprintCode = null, addressEvidenceType = 'rental_contract') {
    const { document, root } = createRoot();
    const application = {
        status: 'draft', application_type: 'initial', address_evidence_type: addressEvidenceType, student_number: 'S3-FP-1',
        student_email: 'student@example.edu', student_phone: '+905551112233',
        first_name: 'Ayşe', last_name: 'Yılmaz', passport_number: 'P123456', nationality: 'Turkish',
        date_of_birth: '2000-01-01', is_under_18: 0,
        contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: true, accepted_at: '2026-09-29T00:00:00.000Z' },
        fingerprint_status: fingerprintStatus, fingerprint_code: fingerprintCode,
        declaration: { current_version: 'ack-v1', content_key: 'studentInformationAccuracy', accepted_current: false }
    };
    const savedPatches = [];
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async updateCurrentApplication(fields) {
            savedPatches.push(fields);
            Object.assign(application, fields);
            if (application.fingerprint_status !== 'registered') application.fingerprint_code = null;
            else application.fingerprint_code = typeof application.fingerprint_code === 'string'
                ? application.fingerprint_code.trim() || null : null;
            return { ...application };
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: createFingerprintRequirements() }; }
    };
    const state = await initializeApplicationWizard(root, api);
    return { document, root, state, api, savedPatches };
}

async function submitWizard(root) {
    root.querySelector('#application-step-form').dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

async function advanceWizardToReview(root, state) {
    await submitWizard(root);
    await submitWizard(root);
    root.querySelector('[name="declaration_accepted"]').checked = true;
    await submitWizard(root);
    assert.equal(state.step, 4);
}

test('contact step keeps Continue disabled until valid contact fields and the separate acknowledgement are present', async () => {
    const { document, root } = createRoot();
    const application = {
        status: 'draft', application_type: 'initial', student_number: 'S3-CONTACT-1',
        student_email: 'student@example.edu', student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: false }
    };
    let acceptedVersion = null;
    const api = {
        async readCurrentApplication() { throw Object.assign(new Error('No current session.'), { code: 'APPLICATION_SESSION_REQUIRED' }); },
        async createApplicationDraft() { return { ...application }; },
        async acceptCurrentContactAcknowledgement(version) {
            acceptedVersion = version;
            application.contact_acknowledgement.accepted_current = true;
            return { ...application };
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };
    const state = await initializeApplicationWizard(root, api);
    const continueButton = root.querySelector('#application-step-form button[type="submit"]');
    root.querySelector('[name="student_number"]').value = 'S3-CONTACT-1';
    root.querySelector('[name="application_type"]').value = 'initial';
    const email = root.querySelector('[name="student_email"]');
    const phone = root.querySelector('[name="student_phone"]');
    const acknowledgement = root.querySelector('[name="contact_acknowledgement_accepted"]');

    assert.equal(root.querySelector('h2')?.textContent, 'İletişim Bilgileri');
    assert.equal(continueButton.disabled, true);
    assert.ok(acknowledgement);
    assert.equal(root.querySelector('[name="declaration_accepted"]'), null);

    email.value = 'student@example.edu';
    phone.value = '+905551112233';
    email.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueButton.disabled, true);

    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    assert.equal(continueButton.disabled, false);

    email.value = 'not-an-email';
    email.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueButton.disabled, true);
    email.value = 'student@example.edu';
    email.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    phone.value = '';
    phone.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueButton.disabled, true);
    phone.value = 'not a phone';
    phone.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueButton.disabled, true);
    phone.value = '+905551112233';
    phone.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueButton.disabled, false);

    await submitWizard(root);

    assert.equal(acceptedVersion, 'contact-reachability-v1');
    assert.equal(state.step, 1);
    assert.equal(state.application.contact_acknowledgement.accepted_current, true);
    document.defaultView.close();
});

test('contact submit handler rejects a programmatic submission after a required email is cleared', async () => {
    const { document, root } = createRoot();
    let createCalls = 0;
    const api = {
        async readCurrentApplication() { throw Object.assign(new Error('No current session.'), { code: 'APPLICATION_SESSION_REQUIRED' }); },
        async createApplicationDraft() { createCalls += 1; return {}; },
        async acceptCurrentContactAcknowledgement() { throw new Error('Must not accept an invalid contact step.'); }
    };
    const state = await initializeApplicationWizard(root, api);
    root.querySelector('[name="student_number"]').value = 'S3-CONTACT-2';
    root.querySelector('[name="application_type"]').value = 'initial';
    root.querySelector('[name="student_email"]').value = '';
    root.querySelector('[name="student_phone"]').value = '+905551112233';
    const acknowledgement = root.querySelector('[name="contact_acknowledgement_accepted"]');
    if (acknowledgement) acknowledgement.checked = true;

    await submitWizard(root);

    assert.equal(state.step, 0);
    assert.equal(createCalls, 0);
    document.defaultView.close();
});

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

test('not-registered fingerprint state saves but blocks Continue with the Migration Authority instruction', async () => {
    const { document, root, state } = await createFingerprintWizard('not_registered');

    assert.equal(root.querySelector('[name="fingerprint_code"]'), null);
    const continueButton = root.querySelector('#application-step-form button[type="submit"]');
    assert.equal(continueButton.disabled, true);
    assert.equal(root.querySelector('.fingerprint-fields [role="alert"]')?.textContent,
        'Devam edebilmek için önce Göç İdaresi’nde parmak izi işleminizi tamamlamalısınız.');
    await submitWizard(root);

    assert.equal(state.application.fingerprint_status, 'not_registered');
    assert.equal(state.step, 1);
    assert.equal(root.querySelector('.fingerprint-fields [role="alert"]')?.textContent,
        'Devam edebilmek için önce Göç İdaresi’nde parmak izi işleminizi tamamlamalısınız.');
    document.defaultView.close();
});

test('residence Continue is disabled when an ordinary required field is missing', async () => {
    const { document, root } = await createFingerprintWizard('registered', 'FP-A/42');
    const passportNumber = root.querySelector('[name="passport_number"]');
    passportNumber.value = '';
    passportNumber.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, true);
    document.defaultView.close();
});

test('residence step requires one address evidence branch and persists the selected choice', async () => {
    const { document, root, state, savedPatches } = await createFingerprintWizard('registered', 'FP-A/42', null);
    const choices = root.querySelectorAll('[name="address_evidence_type"]');
    const continueButton = root.querySelector('#application-step-form button[type="submit"]');

    assert.equal(choices.length, 3);
    assert.equal(continueButton.disabled, true);
    const undertaking = root.querySelector('[name="address_evidence_type"][value="undertaking"]');
    undertaking.checked = true;
    undertaking.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    assert.equal(continueButton.disabled, false);
    assert.equal(state.formValues.address_evidence_type, 'undertaking');
    await submitWizard(root);

    assert.equal(state.step, 2);
    assert.equal(savedPatches.at(-1).address_evidence_type, 'undertaking');
    assert.equal(state.application.address_evidence_type, 'undertaking');
    document.defaultView.close();
});

test('draft application type remains editable and is autosaved', async () => {
    const { document, root, state } = await createFingerprintWizard('registered', 'FP-A/42');
    const previous = root.querySelector('[data-action="previous"]');
    previous.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    const applicationType = root.querySelector('[name="application_type"]');

    assert.equal(applicationType.disabled, false);
    applicationType.value = 'renewal';
    applicationType.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await state.autosave.flush();

    assert.equal(state.application.application_type, 'renewal');
    document.defaultView.close();
});

test('not-registered blocking alert disappears when registration is changed to registered', async () => {
    const { document, root } = await createFingerprintWizard('not_registered');
    const registeredChoice = root.querySelector('[name="fingerprint_status"][value="registered"]');
    registeredChoice.checked = true;
    registeredChoice.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    assert.equal(root.querySelector('.fingerprint-fields [role="alert"]'), null);
    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, true);
    const codeInput = root.querySelector('[name="fingerprint_code"]');
    codeInput.value = 'FP-A/42';
    codeInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, false);
    document.defaultView.close();
});

test('selecting not-registered immediately shows the blocking alert and disables Continue', async () => {
    const { document, root } = await createFingerprintWizard('registered', 'FP-A/42');
    const notRegisteredChoice = root.querySelector('[name="fingerprint_status"][value="not_registered"]');
    notRegisteredChoice.checked = true;
    notRegisteredChoice.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, true);
    assert.equal(root.querySelector('.fingerprint-fields [role="alert"]')?.textContent,
        'Devam edebilmek için önce Göç İdaresi’nde parmak izi işleminizi tamamlamalısınız.');
    document.defaultView.close();
});

test('registered fingerprint with a valid code enables Continue until a required field is cleared', async () => {
    const { document, root } = await createFingerprintWizard('registered', 'FP-A/42');
    const continueButton = root.querySelector('#application-step-form button[type="submit"]');
    assert.equal(continueButton.disabled, false);

    const codeInput = root.querySelector('[name="fingerprint_code"]');
    codeInput.value = '';
    codeInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, true);

    codeInput.value = 'FP-A/42';
    codeInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, false);

    const firstName = root.querySelector('[name="first_name"]');
    firstName.value = '';
    firstName.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, true);
    document.defaultView.close();
});

test('resumed valid fingerprint and residence fields initialize Continue enabled', async () => {
    const { document, root } = await createFingerprintWizard('registered', 'FP-A/42');

    assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, false);
    document.defaultView.close();
});

test('registered fingerprint with missing or whitespace-only code cannot Continue', async () => {
    for (const code of [null, '   ']) {
        const { document, root, state } = await createFingerprintWizard('registered', code);
        assert.equal(root.querySelector('#application-step-form button[type="submit"]').disabled, true);
        await submitWizard(root);

        assert.equal(state.step, 1);
        assert.match(root.textContent, /Parmak izi kodu girilmedi/);
        document.defaultView.close();
    }
});

test('registered fingerprint with a non-empty code can Continue to passport and residence-card uploads', async () => {
    const { document, root, state } = await createFingerprintWizard('registered', 'FP-A/42');

    await submitWizard(root);

    assert.equal(state.step, 2);
    assert.equal(root.querySelector('[data-document-code="fingerprint"]'), null);
    assert.ok(root.querySelector('[data-document-code="passport"] input[type="file"]'));
    assert.ok(root.querySelector('[data-document-code="residence_card"] input[type="file"]'));
    document.defaultView.close();
});

test('not-registered fingerprint status blocks progression without adding a fingerprint document', async () => {
    const { document, root, state } = await createFingerprintWizard('not_registered');
    state.step = 2;
    document.dispatchEvent(new document.defaultView.CustomEvent('public:locale-changed', { detail: 'tr' }));

    assert.equal(root.querySelector('[data-document-code="fingerprint"]'), null);
    assert.ok(root.querySelector('[data-document-code="passport"] input[type="file"]'));
    document.defaultView.close();
});

test('under-18 review requirements show the required birth certificate and current upload state', () => {
    const { document, root } = createRoot();
    renderStudentDocumentRequirements(root, [{
        code: 'birth_certificate_under18', required: true, label_key: 'documentBirthCertificateUnder18',
        description_key: 'documentBirthCertificateUnder18Help', accepted_media_types: ['application/pdf'],
        max_byte_size: 10 * 1024 * 1024, upload_status: null,
        revision_number: null, review_status: null, revision_status: null,
        scan_status: null, filename: null
    }]);

    assert.match(root.textContent, /Doğum belgesi/);
    assert.match(root.textContent, /Zorunlu/);
    assert.match(root.textContent, /Henüz yüklenmedi/);
    assert.equal(root.querySelector('input[type="file"]'), null);
    document.defaultView.close();
});

test('finalized upload status is a success while non-finalized pending status stays neutral', () => {
    const { document, root } = createRoot();
    const requirement = {
        code: 'passport', required: true, label_key: 'documentPassport', description_key: 'documentPassportHelp',
        accepted_media_types: ['application/pdf'], max_byte_size: 1024, filename: 'passport.pdf',
        upload_status: 'finalized', scan_status: 'pending'
    };
    renderStudentDocumentRequirements(root, [requirement]);
    let status = root.querySelector('.document-upload-status');
    assert.equal(status.dataset.status, 'success');
    assert.ok(status.classList.contains('is-success'));
    assert.match(status.textContent, /Yüklendi/);
    assert.equal(status.getAttribute('aria-live'), 'polite');

    renderStudentDocumentRequirements(root, [{ ...requirement, upload_status: 'uploaded' }]);
    status = root.querySelector('.document-upload-status');
    assert.equal(status.dataset.status, 'pending');
    assert.equal(status.classList.contains('is-success'), false);
    document.defaultView.close();
});

test('under-18 select keeps its translated question separate from the required yes/no answers', async () => {
    const { document, root, state } = await createFingerprintWizard('registered', 'FP-A/42');
    state.application.is_under_18 = null;
    document.dispatchEvent(new document.defaultView.CustomEvent('public:locale-changed'));

    const select = root.querySelector('select[name="is_under_18"]');
    const question = select.closest('label').querySelector('span');
    const options = [...select.options];
    const continueButton = root.querySelector('#application-step-form button[type="submit"]');
    assert.equal(question.textContent, '18 yaşından küçük müsünüz?');
    assert.equal(options[0].textContent, 'Seçmek için tıklayınız');
    assert.equal(options[0].value, '');
    assert.equal(options[0].disabled, true);
    assert.equal(select.value, '');
    assert.equal(select.required, true);
    assert.equal(select.validity.valueMissing, true);
    assert.equal(continueButton.disabled, true);
    assert.equal(options.some(({ textContent }) => textContent === question.textContent), false);
    assert.deepEqual(options.slice(1).map(({ value, textContent }) => ({ value, textContent })), [
        { value: 'true', textContent: 'Evet' }, { value: 'false', textContent: 'Hayır' }
    ]);

    select.value = 'true';
    select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await state.autosave.flush();
    assert.equal(state.application.is_under_18, true);
    select.value = 'false';
    select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await state.autosave.flush();
    assert.equal(state.application.is_under_18, false);
    document.defaultView.close();
});

test('under-18 question and answer placeholder have complete translations in every supported locale', async () => {
    const { document, root, state } = await createFingerprintWizard('registered', 'FP-A/42');
    state.application.is_under_18 = null;
    const referenceKeys = Object.keys(PUBLIC_MESSAGES.tr).sort();

    for (const locale of SUPPORTED_LOCALES) {
        assert.deepEqual(Object.keys(PUBLIC_MESSAGES[locale]).sort(), referenceKeys);
        document.documentElement.lang = locale;
        document.dispatchEvent(new document.defaultView.CustomEvent('public:locale-changed'));
        const select = root.querySelector('select[name="is_under_18"]');
        const options = [...select.options];
        assert.equal(select.closest('label').querySelector('span').textContent, PUBLIC_MESSAGES[locale].under18Question);
        assert.equal(options[0].textContent, PUBLIC_MESSAGES[locale].under18SelectPlaceholder);
        assert.deepEqual(options.slice(1).map(({ textContent }) => textContent), [
            PUBLIC_MESSAGES[locale].yes, PUBLIC_MESSAGES[locale].no
        ]);
        assert.ok(options.every(({ textContent }) => !textContent.startsWith('under18')));
    }

    document.defaultView.close();
});

test('wizard saves under-18 and fingerprint state before loading the server requirement set', async () => {
    const { document, root } = createRoot();
    const window = document.defaultView;
    const application = {
        status: 'draft', application_type: 'initial', address_evidence_type: 'rental_contract', student_number: '2026123999',
        student_email: 'student@example.edu', student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: true },
        is_under_18: null, fingerprint_status: null, fingerprint_code: null
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async updateCurrentApplication(fields) {
            Object.assign(application, fields);
            return { ...application };
        },
        async readCurrentStudentDocumentRequirements() {
            const requirements = [{
                code: 'passport', required: true, label_key: 'documentPassport', description_key: 'documentPassportHelp',
                accepted_media_types: ['application/pdf'], max_byte_size: 10 * 1024 * 1024
            }];
            if (application.is_under_18) requirements.push({
                code: 'birth_certificate_under18', required: true, label_key: 'documentBirthCertificateUnder18',
                description_key: 'documentBirthCertificateUnder18Help', accepted_media_types: ['application/pdf'], max_byte_size: 10 * 1024 * 1024
            });
            return { requirements };
        },
        async putStudentDocumentDirect() { throw new Error('not used'); }
    };

    const state = await initializeApplicationWizard(root, api);
    fillRequiredResidenceFields(root);
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

test('wizard autosaves editable fields, requires the current acknowledgement, and resumes at the saved draft', async () => {
    const { document, root } = createRoot();
    const window = document.defaultView;
    const saved = {
        status: 'draft', application_type: 'initial', address_evidence_type: 'rental_contract', student_number: 'S3-WIZ-1', student_email: 'student@example.edu',
        student_phone: '+905551112233', first_name: '', last_name: '', passport_number: '', nationality: '', date_of_birth: '',
        contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: true },
        is_under_18: null, fingerprint_status: null, fingerprint_code: null,
        declaration: { current_version: 'ack-v1', content_key: 'studentInformationAcknowledgement', accepted_current: false, accepted_at: null }
    };
    const autosaved = [];
    let acceptedVersion = null;
    const policy = {
        code: 'passport', required: true, label_key: 'documentPassport', description_key: 'documentPassportHelp',
        accepted_media_types: ['application/pdf'], max_byte_size: 1024
    };
    const api = {
        async readCurrentApplication() { return { ...saved }; },
        async updateCurrentApplication(fields) { autosaved.push(fields); Object.assign(saved, fields); return { ...saved }; },
        async readCurrentStudentDocumentRequirements() { return { requirements: [policy] }; },
        async acceptCurrentApplicationDeclaration(version) {
            acceptedVersion = version;
            saved.declaration = { ...saved.declaration, accepted_version: version, accepted_at: '2026-09-29T00:00:00.000Z', accepted_current: true };
            return { ...saved };
        }
    };

    const state = await initializeApplicationWizard(root, api);
    const firstName = root.querySelector('[name="first_name"]');
    firstName.value = 'Ayşe';
    firstName.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(state.saveStatus, 'unsaved');
    assert.match(root.querySelector('[data-save-status]').textContent, /Kaydedilmemiş/);
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(autosaved.length, 1);
    assert.equal(saved.first_name, 'Ayşe');
    assert.equal(state.saveStatus, 'saved');

    fillRequiredResidenceFields(root);
    root.querySelector('[name="is_under_18"]').value = 'false';
    root.querySelector('[name="fingerprint_status"][value="registered"]').checked = true;
    root.querySelector('[name="fingerprint_status"][value="registered"]').dispatchEvent(new window.Event('change', { bubbles: true }));
    root.querySelector('[name="fingerprint_code"]').value = 'FP-A/42';
    root.querySelector('#application-step-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.step, 2);
    assert.equal(saved.first_name, 'Ayşe');

    root.querySelector('#application-step-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.step, 3);
    const checkbox = root.querySelector('[name="declaration_accepted"]');
    checkbox.checked = true;
    root.querySelector('#application-step-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(acceptedVersion, 'ack-v1');
    assert.equal(state.step, 4);
    assert.match(root.textContent, /Başvuru bilgilendirmesi mevcut sürüm için onaylandı/);

    const reloadedRoot = createRoot();
    const resumed = await initializeApplicationWizard(reloadedRoot.root, api);
    assert.equal(resumed.step, 1);
    assert.equal(reloadedRoot.root.querySelector('[name="first_name"]').value, 'Ayşe');
    reloadedRoot.document.defaultView.close();
    window.close();
});

test('wizard retries an ambiguous finalize on the same intent and exposes progress and replacement actions', async () => {
    const { document, root } = createRoot();
    const window = document.defaultView;
    const application = {
        status: 'draft', application_type: 'initial', address_evidence_type: 'rental_contract', student_number: 'S3-UP-1', student_email: 'student@example.edu',
        student_phone: '+905551112233', is_under_18: 0, fingerprint_status: 'not_registered', fingerprint_code: null,
        contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: true },
        declaration: { current_version: 'ack-v1', content_key: 'studentInformationAcknowledgement', accepted_current: false }
    };
    let intentCalls = 0;
    let finalizeCalls = 0;
    let releasePut;
    let rejectFinalize;
    let deleteCalls = 0;
    let requirements = [{
        code: 'passport', required: true, label_key: 'documentPassport', description_key: 'documentPassportHelp',
        accepted_media_types: ['application/pdf'], max_byte_size: 1024, filename: null, upload_status: null
    }];
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async updateCurrentApplication(fields) { Object.assign(application, fields); return { ...application }; },
        async readCurrentStudentDocumentRequirements() { return { requirements }; },
        async createStudentDocumentUploadIntent() { intentCalls += 1; return { upload: { intent_id: 'intent-1', method: 'PUT', url: 'https://r2.invalid', required_headers: {} } }; },
        putStudentDocumentDirect(upload, file, options) {
            options.onProgress(57);
            return new Promise((resolve) => { releasePut = resolve; });
        },
        async finalizeStudentDocumentUpload() {
            finalizeCalls += 1;
            if (finalizeCalls === 1) return new Promise((resolve, reject) => { rejectFinalize = reject; });
            requirements = [{ ...requirements[0], filename: 'replacement.pdf', upload_status: 'finalized', scan_status: 'pending', revision_number: 2 }];
            return { code: 'passport', revision_number: 2 };
        },
        async deleteStudentDocument() {
            deleteCalls += 1;
            requirements = [{ ...requirements[0], filename: null, cleanup_status: 'pending', upload_status: null, scan_status: null }];
            return { cleanup_status: 'pending' };
        }
    };

    const state = await initializeApplicationWizard(root, api);
    fillRequiredResidenceFields(root);
    root.querySelector('[name="is_under_18"]').value = 'false';
    const registered = root.querySelector('[name="fingerprint_status"][value="registered"]');
    registered.checked = true;
    registered.dispatchEvent(new window.Event('change', { bubbles: true }));
    root.querySelector('[name="fingerprint_code"]').value = 'FP-A/42';
    root.querySelector('#application-step-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.step, 2);
    const input = root.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['pdf'], 'passport.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.uploads.passport.state, 'uploading');
    let status = root.querySelector('[data-document-code="passport"] .document-upload-status');
    assert.equal(status.dataset.status, 'pending');
    assert.equal(status.classList.contains('is-success'), false);
    assert.equal(root.querySelector('progress').getAttribute('aria-valuenow'), '57');
    releasePut();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.uploads.passport.state, 'verifying');
    status = root.querySelector('[data-document-code="passport"] .document-upload-status');
    assert.equal(status.dataset.status, 'pending');
    assert.equal(status.classList.contains('is-success'), false);
    rejectFinalize(Object.assign(new Error('lost response'), { code: 'NETWORK_ERROR' }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.uploads.passport.state, 'unknown_finalize_result');
    status = root.querySelector('[data-document-code="passport"] .document-upload-status');
    assert.equal(status.dataset.status, 'error');
    assert.match(status.textContent, /Doğrulama yanıtı alınamadı/);
    assert.equal(intentCalls, 1);
    assert.equal(finalizeCalls, 1);

    root.querySelector('[data-action="document-retry"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.uploads.passport.state, 'complete');
    status = root.querySelector('[data-document-code="passport"] .document-upload-status');
    assert.equal(status.dataset.status, 'success');
    assert.match(status.textContent, /Yüklendi/);
    assert.equal(intentCalls, 1);
    assert.equal(finalizeCalls, 2);
    assert.match(root.textContent, /Belgeyi değiştir/);

    root.querySelector('[data-action="document-delete"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deleteCalls, 1);
    assert.match(root.textContent, /özel depolamadaki temizleme yeniden denenecek/);
    window.close();
});

test('failed browser upload gets an error status and retains its retry action', async () => {
    const { document, root, state, api } = await createFingerprintWizard('registered', 'FP-A/42');
    const window = document.defaultView;
    api.createStudentDocumentUploadIntent = async () => ({
        upload: { intent_id: 'intent-failed-put', method: 'PUT', url: 'https://r2.invalid', required_headers: {} }
    });
    api.putStudentDocumentDirect = async () => {
        throw Object.assign(new Error('upload failed'), { code: 'UPLOAD_NETWORK_ERROR' });
    };
    await submitWizard(root);
    const input = root.querySelector('[data-document-code="passport"] input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['pdf'], 'passport.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const card = root.querySelector('[data-document-code="passport"]');
    const status = card.querySelector('.document-upload-status');
    assert.equal(state.uploads.passport.state, 'failed_upload');
    assert.equal(status.dataset.status, 'error');
    assert.ok(status.classList.contains('is-error'));
    assert.match(status.textContent, /Yükleme bağlantısı/);
    assert.ok(card.querySelector('[data-action="document-retry"]'));
    window.close();
});

test('failed finalize gets an error status and retains its retry action', async () => {
    const { document, root, state, api } = await createFingerprintWizard('registered', 'FP-A/42');
    const window = document.defaultView;
    api.createStudentDocumentUploadIntent = async () => ({
        upload: { intent_id: 'intent-failed-finalize', method: 'PUT', url: 'https://r2.invalid', required_headers: {} }
    });
    api.putStudentDocumentDirect = async () => ({ ok: true });
    api.finalizeStudentDocumentUpload = async () => {
        throw Object.assign(new Error('object verification failed'), { code: 'UPLOAD_OBJECT_MISMATCH' });
    };
    await submitWizard(root);
    const input = root.querySelector('[data-document-code="passport"] input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['pdf'], 'passport.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const card = root.querySelector('[data-document-code="passport"]');
    const status = card.querySelector('.document-upload-status');
    assert.equal(state.uploads.passport.state, 'failed_finalize');
    assert.equal(status.dataset.status, 'error');
    assert.ok(status.classList.contains('is-error'));
    assert.match(status.textContent, /doğrulanamadı/i);
    assert.ok(card.querySelector('[data-action="document-retry"]'));
    window.close();
});

test('closeout translations have parity and the wizard rerenders in Arabic RTL', async () => {
    const { document, root } = createRoot();
    const window = document.defaultView;
    document.documentElement.lang = 'en';
    const application = {
        status: 'draft', application_type: 'initial', student_number: 'S3-RTL-1', student_email: 'student@example.edu',
        student_phone: '555', is_under_18: 0, fingerprint_status: 'not_registered', fingerprint_code: null,
        contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: true },
        declaration: { current_version: 'ack-v1', content_key: 'studentInformationAcknowledgement', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async updateCurrentApplication(fields) { Object.assign(application, fields); return { ...application }; },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };
    const state = await initializeApplicationWizard(root, api);

    assert.deepEqual(Object.keys(SESSION3_MESSAGES.en).sort(), Object.keys(SESSION3_MESSAGES.ar).sort());
    assert.deepEqual(Object.keys(SESSION3_MESSAGES.en).sort(), Object.keys(SESSION3_MESSAGES.ru).sort());
    assert.deepEqual(Object.keys(SESSION3_MESSAGES.en).sort(), Object.keys(SESSION3_MESSAGES.tk).sort());
    assert.deepEqual(Object.keys(SESSION3_MESSAGES.en).sort(), Object.keys(SESSION3_MESSAGES.tr).sort());
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    document.dispatchEvent(new window.CustomEvent('public:locale-changed', { detail: 'ar' }));

    assert.equal(state.step, 1);
    assert.equal(document.documentElement.dir, 'rtl');
    assert.match(root.textContent, /البيانات الشخصية والإقامة/);
    window.close();
});

test('Review submits once, keeps five steps, and shows student-safe confirmation', async () => {
    const { document, root, state, api } = await createFingerprintWizard('registered', 'FP-A/42');
    let submitCalls = 0;
    let finishSubmission;
    api.acceptCurrentApplicationDeclaration = async (version) => {
        state.application.declaration = {
            current_version: version, accepted_version: version,
            accepted_current: true, accepted_at: '2026-09-30T10:00:00.000Z'
        };
        return { ...state.application };
    };
    api.submitCurrentApplication = async () => {
        submitCalls += 1;
        return new Promise((resolve) => { finishSubmission = resolve; });
    };
    await advanceWizardToReview(root, state);

    const progressSteps = root.querySelectorAll('.application-progress li');
    const submitButton = root.querySelector('[data-action="submit-application"]');
    assert.equal(progressSteps.length, 5);
    assert.ok(submitButton);
    assert.equal(root.querySelector('[data-action*="ocr"]'), null);
    assert.match(root.textContent, /P123456/);

    submitButton.click();
    assert.equal(root.querySelector('[data-action="submit-application"]').disabled, true);
    root.querySelector('[data-action="submit-application"]').click();
    assert.equal(submitCalls, 1);
    finishSubmission({
        ...state.application, status: 'submitted', submitted_at: '2026-09-30T10:01:00.000Z'
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.step, 4);
    assert.match(root.textContent, /Başvurunuz gönderildi/);
    assert.match(root.textContent, /S3-FP-1/);
    assert.match(root.textContent, /öğrenci numaranızı kullanın/i);
    assert.equal(root.querySelector('[data-action="submit-application"]'), null);
    assert.equal(root.querySelector('.application-progress li').parentElement.children.length, 5);
    document.defaultView.close();
});

test('readiness rejection stays on Review and shows the localized actionable error', async () => {
    const { document, root, state, api } = await createFingerprintWizard('registered', 'FP-A/42');
    api.acceptCurrentApplicationDeclaration = async (version) => {
        state.application.declaration = {
            current_version: version, accepted_version: version,
            accepted_current: true, accepted_at: '2026-09-30T10:00:00.000Z'
        };
        return { ...state.application };
    };
    api.submitCurrentApplication = async () => {
        throw Object.assign(new Error('not ready'), { code: 'SUBMISSION_NOT_READY' });
    };
    await advanceWizardToReview(root, state);
    root.querySelector('[data-action="submit-application"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.step, 4);
    assert.match(root.querySelector('[role="alert"]').textContent, /eksik/i);
    assert.equal(root.querySelector('[data-action="submit-application"]').disabled, false);
    assert.equal(root.querySelector('[data-i18n="submissionSuccessHeading"]'), null);
    document.defaultView.close();
});
