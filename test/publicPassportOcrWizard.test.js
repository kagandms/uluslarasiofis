import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationWizard } from '../src/public/applicationWizard.js';

const PASSPORT_REQUIREMENT = {
    code: 'passport', required: true, label_key: 'documentPassport', description_key: 'documentPassportHelp',
    accepted_media_types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], max_byte_size: 10 * 1024 * 1024,
    filename: null, upload_status: null, revision_status: null, revision_number: null
};

function createWizard({ finalized = false, applicationValues = {} } = {}) {
    const document = new JSDOM('<!doctype html><html lang="tr"><body><section></section></body></html>').window.document;
    const root = document.querySelector('section');
    const application = {
        status: 'draft', application_type: 'initial', address_evidence_type: 'rental_contract', student_number: 'OCR-1',
        student_email: 'ocr@example.edu', student_phone: '+905551112233', first_name: '', last_name: '',
        passport_number: '', nationality: '', date_of_birth: '', is_under_18: 0, fingerprint_status: 'registered',
        fingerprint_code: 'FP-42', contact_acknowledgement: { accepted_current: true }, declaration: { accepted_current: false },
        ...applicationValues
    };
    let passport = { ...PASSPORT_REQUIREMENT };
    if (finalized) passport = { ...passport, filename: 'passport.pdf', upload_status: 'finalized', revision_status: 'submitted', revision_number: 1 };
    const calls = [];
    const patches = [];
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async updateCurrentApplication(fields) { patches.push(fields); Object.assign(application, fields); return { ...application }; },
        async autosaveCurrentApplication(fields) { patches.push(fields); Object.assign(application, fields); return { ...application }; },
        async readCurrentStudentDocumentRequirements() { calls.push('requirements'); return { requirements: [passport] }; },
        async createStudentDocumentUploadIntent(code, file) {
            calls.push('intent');
            assert.equal(code, 'passport');
            assert.ok(['image/png', 'application/pdf'].includes(file.type));
            return { upload: { intent_id: 'intent-1', method: 'PUT', url: 'https://r2.invalid', required_headers: {} } };
        },
        async putStudentDocumentDirect() { calls.push('put'); },
        async finalizeStudentDocumentUpload() {
            calls.push('finalize');
            passport = { ...passport, filename: 'passport.png', upload_status: 'finalized', revision_status: 'submitted', revision_number: 2 };
        },
        async preparePassportOcrSource(source, recognizeImage) {
            calls.push('ocr');
            assert.equal(source.type, 'image/png');
            assert.equal(passport.upload_status, 'finalized');
            return recognizeImage(new Blob(['prepared'], { type: 'image/jpeg' }));
        },
        async recognizeCurrentPassportImage() {
            return { first_name: 'OCR NAME', last_name: 'DOE', passport_number: 'P123456', nationality: 'TUR', date_of_birth: '2000-01-02' };
        }
    };
    return { document, root, application, calls, patches, api };
}

async function completeResidenceFields(root) {
    const values = { first_name: '', last_name: '', passport_number: '', nationality: '', date_of_birth: '' };
    for (const [name, value] of Object.entries(values)) root.querySelector(`[name="${name}"]`).value = value;
    root.querySelector('[name="is_under_18"]').value = 'false';
    await new Promise((resolve) => setImmediate(resolve));
}

function selectPassport(root, file) {
    const input = root.querySelector('[data-document-code="passport"] input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new root.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

test('passport upload and OCR assistance appear before identity fields in the existing five-step wizard', async () => {
    const { root, api } = createWizard();
    await initializeApplicationWizard(root, api);

    assert.equal(root.querySelectorAll('.application-progress li').length, 5);
    assert.equal(root.querySelector('[data-document-code="passport"] input[type="file"]').accept, PASSPORT_REQUIREMENT.accepted_media_types.join(','));
    assert.ok(root.querySelector('[data-document-code="passport"]'));
    assert.ok(root.querySelector('[data-document-code="passport"]').compareDocumentPosition(root.querySelector('[name="first_name"]')) & 4);
    assert.equal(root.querySelectorAll('.application-document-card[data-document-code="passport"]').length, 1);
});

test('passport OCR waits for direct upload and finalize, then fills only fields still blank', async () => {
    const { root, api, calls, patches } = createWizard();
    let finishOcr;
    api.preparePassportOcrSource = async (source, recognizeImage) => {
        calls.push('ocr');
        assert.equal(source.type, 'image/png');
        return new Promise((resolve) => { finishOcr = () => resolve(recognizeImage(new Blob(['prepared'], { type: 'image/jpeg' }))); });
    };
    const state = await initializeApplicationWizard(root, api);
    await completeResidenceFields(root);
    selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(calls.filter((call) => ['put', 'finalize', 'ocr'].includes(call)), ['put', 'finalize', 'ocr']);
    assert.ok(calls.indexOf('put') < calls.indexOf('finalize'));
    assert.ok(calls.indexOf('finalize') < calls.lastIndexOf('requirements'));
    assert.ok(calls.lastIndexOf('requirements') < calls.indexOf('ocr'));
    assert.equal(state.uploads.passport.state, 'complete');
    assert.equal(patches.length, 0);

    const firstName = root.querySelector('[name="first_name"]');
    firstName.value = 'Manually Entered';
    firstName.dispatchEvent(new root.ownerDocument.defaultView.Event('input', { bubbles: true }));
    finishOcr();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(root.querySelector('[name="first_name"]').value, 'Manually Entered');
    assert.equal(root.querySelector('[name="last_name"]').value, 'DOE');
    assert.equal(root.querySelector('[name="passport_number"]').value, 'P123456');
    assert.equal(root.querySelector('[name="nationality"]').value, 'TUR');
    assert.equal(root.querySelector('[name="date_of_birth"]').value, '2000-01-02');
    assert.equal(state.passportOcr.status, 'success');
    assert.equal(patches.length, 0);
});

test('resumed finalized passport stays uploaded without OCR retry bytes or a forced re-upload', async () => {
    const { root, api, calls } = createWizard({ finalized: true });
    const state = await initializeApplicationWizard(root, api);

    const card = root.querySelector('[data-document-code="passport"]');
    assert.match(card.textContent, /passport\.pdf/);
    assert.equal(card.querySelector('.document-upload-status').dataset.status, 'success');
    assert.ok(card.querySelector('input[type="file"]'));
    assert.equal(root.querySelector('[data-action="passport-ocr-retry"]'), null);
    assert.equal(calls.includes('ocr'), false);
    const values = { first_name: 'ADA', last_name: 'LOVELACE', passport_number: 'P1', nationality: 'GBR', date_of_birth: '1815-12-10' };
    Object.entries(values).forEach(([name, value]) => { root.querySelector(`[name="${name}"]`).value = value; });
    root.querySelector('[name="is_under_18"]').value = 'false';
    root.querySelector('#application-step-form').dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.step, 2);
    const documentsPassport = root.querySelector('.application-document-card[data-document-code="passport"]');
    assert.match(documentsPassport.textContent, /passport\.pdf/);
    assert.equal(documentsPassport.querySelector('.document-upload-status').dataset.status, 'success');
    assert.equal(root.querySelectorAll('.application-document-card[data-document-code="passport"]').length, 1);
    assert.equal(calls.includes('ocr'), false);
});

test('one OCR retry reuses the finalized passport bytes without repeating upload or finalize', async () => {
    const { root, api, calls } = createWizard();
    let ocrCalls = 0;
    api.preparePassportOcrSource = async (source, recognizeImage) => {
        calls.push('ocr');
        ocrCalls += 1;
        if (ocrCalls === 1) throw Object.assign(new Error('provider unavailable'), { code: 'OCR_PROVIDER_FAILURE' });
        assert.equal(source.type, 'image/png');
        return recognizeImage(new Blob(['prepared'], { type: 'image/jpeg' }));
    };
    const state = await initializeApplicationWizard(root, api);
    await completeResidenceFields(root);
    selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.uploads.passport.state, 'complete');
    assert.equal(state.passportOcr.status, 'failed');
    assert.ok(root.querySelector('[data-action="passport-ocr-retry"]'));
    const uploadCalls = calls.filter((call) => ['intent', 'put', 'finalize'].includes(call));
    root.querySelector('[data-action="passport-ocr-retry"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.passportOcr.status, 'success');
    assert.deepEqual(calls.filter((call) => ['intent', 'put', 'finalize'].includes(call)), uploadCalls);
    assert.equal(calls.filter((call) => call === 'ocr').length, 2);
    assert.equal(state.passportOcr.retryUsed, true);
});

test('failed manual OCR retry releases the transient passport source when no retry remains', async () => {
    const { root, api } = createWizard();
    api.preparePassportOcrSource = async (_source, recognizeImage) => recognizeImage(new Blob(['prepared'], { type: 'image/jpeg' }));
    api.recognizeCurrentPassportImage = async () => { throw Object.assign(new Error('unavailable'), { code: 'OCR_UNAVAILABLE' }); };
    const state = await initializeApplicationWizard(root, api);
    selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(state.passportOcr.source);
    root.querySelector('[data-action="passport-ocr-retry"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.passportOcr.status, 'failed');
    assert.equal(state.passportOcr.source, null);
    assert.equal(root.querySelector('[data-action="passport-ocr-retry"]'), null);
    assert.equal(state.uploads.passport.state, 'complete');
});

test('candidate edits survive rerender and reach persistence only through the normal Continue flow', async () => {
    const { root, api, patches } = createWizard();
    const state = await initializeApplicationWizard(root, api);
    await completeResidenceFields(root);
    selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(patches.length, 0);
    const lastName = root.querySelector('[name="last_name"]');
    lastName.value = 'Corrected';
    lastName.dispatchEvent(new root.ownerDocument.defaultView.Event('input', { bubbles: true }));
    root.ownerDocument.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent('public:locale-changed', { detail: 'tr' }));
    assert.equal(root.querySelector('[name="last_name"]').value, 'Corrected');

    root.querySelector('#application-step-form').dispatchEvent(new root.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.step, 2);
    assert.equal(patches.at(-1).last_name, 'Corrected');
    assert.equal(root.querySelector('.application-document-card[data-document-code="passport"] .document-upload-status').dataset.status, 'success');
});

test('OCR candidates never replace values already loaded from the saved draft', async () => {
    const { root, api } = createWizard({ applicationValues: { first_name: 'SAVED VALUE' } });
    const state = await initializeApplicationWizard(root, api);
    selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.passportOcr.status, 'success');
    assert.equal(root.querySelector('[name="first_name"]').value, 'SAVED VALUE');
    assert.equal(root.querySelector('[name="last_name"]').value, 'DOE');
});

test('partial OCR candidates leave unresolved identity fields blank for manual entry', async () => {
    const { root, api } = createWizard();
    api.recognizeCurrentPassportImage = async () => ({ last_name: 'DOE' });
    const state = await initializeApplicationWizard(root, api);
    selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.passportOcr.status, 'success');
    assert.equal(root.querySelector('[name="last_name"]').value, 'DOE');
    for (const name of ['first_name', 'passport_number', 'nationality', 'date_of_birth']) {
        assert.equal(root.querySelector(`[name="${name}"]`).value, '');
    }
});

test('PDF OCR decode failure keeps the finalized upload successful and manual fields available', async () => {
    const { root, api, calls } = createWizard();
    api.preparePassportOcrSource = async () => { throw new Error('PDF decode failed'); };
    const state = await initializeApplicationWizard(root, api);
    const input = root.querySelector('[data-document-code="passport"] input[type="file"]');
    const file = new root.ownerDocument.defaultView.File(['pdf'], 'passport.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new root.ownerDocument.defaultView.Event('change', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(calls.filter((call) => ['put', 'finalize'].includes(call)), ['put', 'finalize']);
    assert.equal(state.uploads.passport.state, 'complete');
    assert.equal(state.passportOcr.status, 'failed');
    assert.ok(root.querySelector('[name="first_name"]') && !root.querySelector('[name="first_name"]').disabled);
    assert.equal(root.querySelector('.application-document-card[data-document-code="passport"] .document-upload-status').dataset.status, 'success');
    assert.match(root.querySelector('[data-passport-ocr-status]').textContent, /kullanılamıyor/i);
});

test('rate-limited OCR shows a safe status without changing the finalized passport state', async () => {
    const { root, api } = createWizard();
    api.recognizeCurrentPassportImage = async () => { throw Object.assign(new Error('limited'), { code: 'RATE_LIMITED' }); };
    const state = await initializeApplicationWizard(root, api);
    await completeResidenceFields(root);
    selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.uploads.passport.state, 'complete');
    assert.match(root.querySelector('[data-passport-ocr-status]').textContent, /sınırına/i);
    assert.ok(root.querySelector('[data-action="passport-ocr-retry"]'));
});

test('unavailable, provider-failure, and no-fields errors preserve manual identity entry', async (context) => {
    for (const code of ['OCR_UNAVAILABLE', 'OCR_PROVIDER_FAILURE', 'OCR_NO_PASSPORT_FIELDS']) {
        await context.test(code, async () => {
            const { root, api } = createWizard();
            api.recognizeCurrentPassportImage = async () => { throw Object.assign(new Error('safe'), { code }); };
            const state = await initializeApplicationWizard(root, api);
            selectPassport(root, new Blob(['passport'], { type: 'image/png' }));
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));

            assert.equal(state.uploads.passport.state, 'complete');
            assert.equal(state.passportOcr.status, 'failed');
            assert.ok(root.querySelector('[name="passport_number"]') && !root.querySelector('[name="passport_number"]').disabled);
            assert.equal(root.querySelector('[data-passport-ocr-status]').getAttribute('role'), 'status');
            root.ownerDocument.defaultView.close();
        });
    }
});
