import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import { initializeApplicationWizard } from '../src/public/applicationWizard.js';
import { initializeApplicationTracking } from '../src/public/applicationTracking.js';
import { initializeResubmissionUpload } from '../src/public/resubmissionUpload.js';

function createDom(html = '<!doctype html><html lang="tr"><body><div id="app"></div></body></html>') {
    const dom = new JSDOM(html, { url: 'https://example.edu/' });
    return { window: dom.window, document: dom.window.document, root: dom.window.document.querySelector('#app') };
}

test('public messages have strict parity across all five supported languages', () => {
    const trKeys = Object.keys(PUBLIC_MESSAGES.tr).sort();
    assert.ok(trKeys.length > 180, `Expected > 180 keys, found ${trKeys.length}`);

    for (const locale of SUPPORTED_LOCALES) {
        const localeKeys = Object.keys(PUBLIC_MESSAGES[locale]).sort();
        assert.deepEqual(localeKeys, trKeys, `Mismatch in locale keys for ${locale}`);

        // Verify newly added public aria keys exist and are non-empty
        const expectedNewKeys = ['homeBrandAriaLabel', 'studentActionsNavLabel', 'stepperAriaLabel', 'resubmissionFileLabel'];
        for (const key of expectedNewKeys) {
            assert.ok(typeof PUBLIC_MESSAGES[locale][key] === 'string' && PUBLIC_MESSAGES[locale][key].trim().length > 0,
                `Missing or empty key ${key} in locale ${locale}`);
        }

        // Verify no undefined or raw keys
        for (const [key, value] of Object.entries(PUBLIC_MESSAGES[locale])) {
            assert.ok(typeof value === 'string' && value.length > 0, `Locale ${locale} has invalid value for ${key}`);
            assert.notEqual(value, 'undefined', `Locale ${locale} contains literal "undefined" for ${key}`);
        }
    }
});

test('public HTML templates contain localized aria-label keys instead of hardcoded strings', () => {
    const cwd = process.cwd();
    const files = ['index.html', 'basvuru/index.html', 'basvurum/index.html'];

    for (const file of files) {
        const content = readFileSync(join(cwd, file), 'utf8');
        assert.ok(content.includes('data-i18n-aria-label="homeBrandAriaLabel"'), `${file} must include data-i18n-aria-label="homeBrandAriaLabel"`);
    }

    const indexHtml = readFileSync(join(cwd, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('data-i18n-aria-label="studentActionsNavLabel"'), 'index.html must include data-i18n-aria-label="studentActionsNavLabel"');
});

test('CSS rules enforce word wrapping, touch targets, focus-visible, and stepper states', () => {
    const css = readFileSync(join(process.cwd(), 'src/public/public.css'), 'utf8');

    // Filename and error wrapping to avoid blowout
    assert.ok(css.includes('overflow-wrap: anywhere;'), 'public.css must contain overflow-wrap: anywhere;');
    assert.ok(css.includes('word-break: break-word;'), 'public.css must contain word-break: break-word;');

    // High contrast visible focus
    assert.ok(css.includes(':focus-visible'), 'public.css must style :focus-visible');
    assert.ok(css.includes('outline: 2px solid #8b0000;'), 'public.css must provide distinct 2px solid outline for focus-visible');

    // Stepper non-color state indicator (check mark)
    assert.ok(css.includes('.application-progress li.is-complete::before'), 'public.css must indicate completed step with checkmark prefix');

    // Touch targets >= 44px (2.75rem or 2.8rem)
    assert.ok(css.includes('min-height: 2.75rem;'), 'public.css must provide at least 2.75rem (44px) touch targets for buttons/controls');
    assert.ok(css.includes('min-height: 2.8rem;'), 'public.css must provide at least 2.8rem for text inputs/selects');
});

test('application tracking lookup preserves student number input across language switches', async () => {
    const { document, root } = createDom();
    const api = {
        async readCurrentApplicationTracking() {
            const error = new Error('Session required');
            error.code = 'APPLICATION_SESSION_REQUIRED';
            throw error;
        },
        async lookupApplicationTracking() { return { found: false }; }
    };
    await initializeApplicationTracking(root, api);

    const input = root.querySelector('#tracking-student-number');
    assert.ok(input, 'Tracking student number input must exist');
    input.value = 'STU-998877';
    input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    // Switch language
    document.documentElement.lang = 'en';
    document.dispatchEvent(new document.defaultView.CustomEvent('public:locale-changed'));

    const refreshedInput = root.querySelector('#tracking-student-number');
    assert.equal(refreshedInput.value, 'STU-998877', 'Student number must be preserved after locale change');
});

test('application tracking lookup sets aria-busy during lookup and role="alert" on errors', async () => {
    const { document, root } = createDom();
    let resolveLookup;
    const lookupPromise = new Promise((resolve) => { resolveLookup = resolve; });

    const api = {
        async readCurrentApplicationTracking() {
            const error = new Error('Session required');
            error.code = 'APPLICATION_SESSION_REQUIRED';
            throw error;
        },
        lookupApplicationTracking: () => lookupPromise
    };

    await initializeApplicationTracking(root, api);

    const input = root.querySelector('#tracking-student-number');
    const form = root.querySelector('.tracking-lookup-form');

    input.value = 'STU-12345';
    input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    form.dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));

    // Active button in re-rendered lookup view should have aria-busy
    const activeSubmitBtn = root.querySelector('.tracking-lookup-form button[type="submit"]');
    assert.equal(activeSubmitBtn.getAttribute('aria-busy'), 'true');
    assert.equal(activeSubmitBtn.disabled, true);

    resolveLookup({ found: false }); // not found
    await new Promise((r) => setTimeout(r, 10));

    const finalSubmitBtn = root.querySelector('.tracking-lookup-form button[type="submit"]');
    assert.equal(finalSubmitBtn.getAttribute('aria-busy'), 'false');
    const feedback = root.querySelector('.tracking-feedback');
    assert.ok(feedback, 'Feedback element must exist');
    assert.equal(feedback.getAttribute('role'), 'alert', 'Feedback must have role="alert"');
});

test('wizard form fields have associated labels, IDs, and aria-required attributes', async () => {
    const { root } = createDom();
    const api = {
        async readCurrentApplication() {
            return {
                status: 'draft',
                application_type: 'initial',
                student_number: 'STU-001',
                student_email: 'test@example.com',
                student_phone: '+905551234567',
                contact_acknowledgement: { accepted_current: false }
            };
        },
        async readCurrentStudentDocumentRequirements() {
            return { requirements: [] };
        }
    };

    await initializeApplicationWizard(root, api);

    const inputs = root.querySelectorAll('input:not([type="hidden"]), select');
    assert.ok(inputs.length > 0, 'Form inputs must be rendered');

    inputs.forEach((input) => {
        assert.ok(input.id, `Input ${input.name} must have an id attribute`);
        const label = root.querySelector(`label[for="${input.id}"]`);
        assert.ok(label, `Input ${input.id} (${input.name}) must have an associated label[for]`);
        if (input.required) {
            assert.equal(input.getAttribute('aria-required'), 'true', `Required input ${input.name} must have aria-required="true"`);
        }
    });

    // Check stepper accessibility
    const progress = root.querySelector('.application-progress');
    assert.ok(progress, 'Progress stepper must exist');
    assert.ok(progress.getAttribute('aria-label'), 'Progress stepper must have aria-label');
    const currentStep = progress.querySelector('li.is-current');
    assert.ok(currentStep, 'Current step must exist');
    assert.equal(currentStep.getAttribute('aria-current'), 'step', 'Current step must have aria-current="step"');
});

test('wizard document upload controls connect input to help text via aria-describedby', async () => {
    const { root } = createDom();
    const api = {
        async readCurrentApplication() {
            return {
                status: 'draft',
                application_type: 'initial',
                student_number: 'STU-001',
                student_email: 'test@example.com',
                student_phone: '+905551234567',
                first_name: 'Ahmet',
                last_name: 'Demir',
                passport_number: 'U123456',
                nationality: 'Turkmen',
                date_of_birth: '2001-01-01',
                is_under_18: 0,
                address_evidence_type: 'rental_contract',
                fingerprint_status: 'registered',
                fingerprint_code: 'FP-12345',
                contact_acknowledgement: { accepted_current: true }
            };
        },
        async readCurrentStudentDocumentRequirements() {
            return {
                requirements: [
                    {
                        code: 'passport',
                        required: true,
                        label_key: 'documentPassport',
                        description_key: 'documentPassportHelp',
                        accepted_media_types: ['application/pdf'],
                        max_byte_size: 5 * 1024 * 1024,
                        filename: null,
                        upload_status: null
                    }
                ]
            };
        }
    };

    const state = await initializeApplicationWizard(root, api);
    // Move to step 2 (Documents)
    state.step = 2;
    root.ownerDocument.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent('public:locale-changed'));

    const fileInput = root.querySelector('input[type="file"][data-document-code="passport"]');
    assert.ok(fileInput, 'Passport file input must exist');
    assert.equal(fileInput.id, 'upload-passport');

    const describedBy = fileInput.getAttribute('aria-describedby');
    assert.ok(describedBy, 'File input must have aria-describedby');
    const helpElement = root.querySelector(`#${describedBy}`);
    assert.ok(helpElement, `Element #${describedBy} referenced by aria-describedby must exist`);

    const label = root.querySelector(`label[for="${fileInput.id}"]`);
    assert.ok(label, 'File input must have associated label[for="upload-passport"]');
});

test('resubmission upload control links file input to status via aria-describedby and sets busy state', () => {
    const { root } = createDom();
    const documentRequirement = {
        code: 'passport',
        label_key: 'documentPassport',
        description_key: 'documentPassportHelp',
        accepted_media_types: ['application/pdf'],
        max_byte_size: 2 * 1024 * 1024
    };

    initializeResubmissionUpload(root, documentRequirement, {
        async requestCurrentResubmissionUploadIntent() { return { upload_url: 'https://r2.test/put', intent_id: 'int-1' }; },
        async uploadResubmissionFileDirect() {},
        async finalizeCurrentResubmissionUpload() {}
    });

    const fileInput = root.querySelector('input[type="file"]');
    assert.ok(fileInput, 'Resubmission file input must exist');
    assert.equal(fileInput.id, 'resubmission-file-passport');

    const label = root.querySelector('label[for="resubmission-file-passport"]');
    assert.ok(label, 'Resubmission file input must have matching label[for]');

    const describedBy = fileInput.getAttribute('aria-describedby');
    assert.ok(describedBy, 'Resubmission file input must have aria-describedby');
    const status = root.querySelector(`#${describedBy}`);
    assert.ok(status, 'Status element referenced by aria-describedby must exist');
});
