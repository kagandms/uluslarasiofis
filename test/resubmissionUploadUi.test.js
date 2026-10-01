import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeResubmissionUpload } from '../src/public/resubmissionUpload.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

function createCard() {
    const document = new JSDOM('<!doctype html><html lang="tr" dir="ltr"><body><ul><li></li></ul></body></html>').window.document;
    return { document, card: document.querySelector('li') };
}

function createRequirement() {
    return {
        code: 'passport', accepted_media_types: ['application/pdf'], max_byte_size: 100,
        label_key: 'documentPassport'
    };
}

function chooseFile(document, input, { name = 'passport.pdf', type = 'application/pdf', size = 10 } = {}) {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, type, size }] });
    input.dispatchEvent(new document.defaultView.Event('change'));
}

async function flushEvents() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('invalid file selection cannot request a replacement intent', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    const control = initializeResubmissionUpload(card, createRequirement(), {
        async createResubmissionUploadIntent() { intentCalls += 1; }
    }, { messages: PUBLIC_MESSAGES.tr });
    chooseFile(document, control.fileInput, { type: 'application/x-msdownload' });
    control.button.click();

    assert.equal(control.button.disabled, true);
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadInvalidFile);
    assert.equal(intentCalls, 0);
    document.defaultView.close();
});

test('PUT success stays verifying until finalize succeeds, then refreshes owner tracking', async () => {
    const { document, card } = createCard();
    let releasePut;
    let releaseFinalize;
    let finalized = 0;
    let refreshed = 0;
    const api = {
        async createResubmissionUploadIntent(code, file) {
            assert.equal(code, 'passport');
            assert.equal(file.name, 'passport.pdf');
            return { upload: { intent_id: 'opaque-only', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload(intentId) {
            assert.equal(intentId, 'opaque-only');
            finalized += 1;
            await new Promise((resolve) => { releaseFinalize = resolve; });
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr,
        putStudentDocumentDirect: async () => new Promise((resolve) => { releasePut = resolve; }),
        onComplete: async () => { refreshed += 1; }
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();
    releasePut();
    await flushEvents();

    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadVerifying);
    assert.notEqual(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(finalized, 1);
    assert.equal(refreshed, 0);
    releaseFinalize();
    await flushEvents();

    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(refreshed, 1);
    document.defaultView.close();
});

test('session failure aborts the private flow and never reuses the issued capability', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    let putCalls = 0;
    let sessionFailures = 0;
    const api = {
        async createResubmissionUploadIntent() {
            intentCalls += 1;
            return { upload: { intent_id: 'one-time-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() {
            throw Object.assign(new Error('expired'), { status: 401, code: 'APPLICATION_SESSION_REQUIRED' });
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr,
        putStudentDocumentDirect: async (_upload, _file, options) => {
            putCalls += 1;
            assert.equal(options.signal.aborted, false);
        },
        onSessionFailure: () => { sessionFailures += 1; }
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();

    assert.equal(intentCalls, 1);
    assert.equal(putCalls, 1);
    assert.equal(sessionFailures, 1);
    assert.equal(control.fileInput.disabled, true);
    assert.equal(control.button.disabled, true);
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadSessionExpired);
    document.defaultView.close();
});

test('safe network and conflict failures invite a new attempt without capability reuse', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    const api = {
        async createResubmissionUploadIntent() {
            intentCalls += 1;
            return { upload: { intent_id: `intent-${intentCalls}`, method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() {
            throw Object.assign(new Error('changed'), { status: 409, code: 'RESUBMISSION_UPLOAD_CONFLICT' });
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr, putStudentDocumentDirect: async () => {}
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadConflict);
    control.button.click();
    await flushEvents();
    assert.equal(intentCalls, 2);
    document.defaultView.close();
});

test('tracking refresh failure after successful finalize does not misreport the upload as failed', async () => {
    const { document, card } = createCard();
    const api = {
        async createResubmissionUploadIntent() {
            return { upload: { intent_id: 'completed-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr, putStudentDocumentDirect: async () => {},
        onComplete: async () => { throw Object.assign(new Error('tracking offline'), { code: 'NETWORK_ERROR' }); }
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();

    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    document.defaultView.close();
});

test('replacement messages exist in all five locales and Arabic remains right-to-left', () => {
    const keys = Object.keys(PUBLIC_MESSAGES.tr).filter((key) => key.startsWith('resubmissionUpload'));
    for (const locale of SUPPORTED_LOCALES) {
        for (const key of keys) assert.ok(PUBLIC_MESSAGES[locale][key], `${locale} is missing ${key}`);
    }
    const { document, card } = createCard();
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    initializeResubmissionUpload(card, createRequirement(), {}, { messages: PUBLIC_MESSAGES.ar });
    assert.equal(document.documentElement.dir, 'rtl');
    assert.equal(card.querySelector('input[type="file"]').getAttribute('aria-label'), PUBLIC_MESSAGES.ar.resubmissionUploadChooseFile);
    document.defaultView.close();
});
