import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationTracking, readOwnerApplicationPdfData } from '../src/public/applicationTracking.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

function createTrackingRoot() {
    const document = new JSDOM('<!doctype html><html lang="tr" dir="ltr"><body><main><div id="application-tracking"></div></main></body></html>').window.document;
    return { document, root: document.querySelector('#application-tracking') };
}

// The student number is required for every ITU lookup now; fill it so the owner-login path can run.
function selectStatusOnly(document, root) {
    const studentNumber = root.querySelector('[name=student_number]');
    if (studentNumber && !studentNumber.value) studentNumber.value = '12345';
}

function createTrackingDto(overrides = {}) {
    return {
        application: {
            student_number: 'TRACK-STUDENT-1',
            reference_number: 'ITU-7K9M-4X2P',
            status: 'submitted',
            application_type: 'initial',
            created_at: '2026-09-28T10:00:00.000Z',
            updated_at: '2026-09-30T10:00:00.000Z',
            submitted_at: '2026-09-29T10:00:00.000Z',
            ...overrides.application
        },
        documents: overrides.documents || [
            { code: 'passport', label_key: 'documentPassport', required: true, revision_number: 1, status: 'waiting_review', filename: 'passport.pdf' },
            { code: 'residence_card', label_key: 'documentResidenceCard', required: true, revision_number: 2, status: 'resubmission_required', filename: 'replacement.pdf' }
        ]
    };
}

test('owner PDF data comes from the current owner application and stays field-allowlisted', async () => {
    let currentApplicationReads = 0;
    const pdfApplication = await readOwnerApplicationPdfData({
        async readCurrentApplication() {
            currentApplicationReads += 1;
            return {
                reference_number: 'ITU-7K9M-4X2P',
                first_name: 'Ada',
                last_name: 'Synthetic',
                submitted_at: '2026-09-29T10:00:00.000Z',
                created_at: '2026-09-28T10:00:00.000Z',
                passport_number: 'must-not-reach-pdf',
                student_email: 'must-not-reach-pdf@example.test'
            };
        }
    }, 'ITU-7K9M-4X2P');

    assert.deepEqual(pdfApplication, {
        reference_number: 'ITU-7K9M-4X2P',
        first_name: 'Ada',
        last_name: 'Synthetic',
        submitted_at: '2026-09-29T10:00:00.000Z',
        created_at: '2026-09-28T10:00:00.000Z'
    });
    assert.equal(currentApplicationReads, 1);
});

test('owner PDF data rejects an application that does not match the tracking reference', async () => {
    await assert.rejects(readOwnerApplicationPdfData({
        async readCurrentApplication() {
            return { reference_number: 'ITU-DIFFERENT-1', first_name: 'Ada', last_name: 'Synthetic' };
        }
    }, 'ITU-7K9M-4X2P'), { code: 'APPLICATION_SESSION_MISMATCH' });
});

async function initializeAndLookup(document, root, api) {
    const wrappedApi = { ...api, async accessApplicationWithReference() { return {}; } };
    const result = await initializeApplicationTracking(root, wrappedApi);
    const input = root.querySelector('input[name="reference_number"]');
    input.value = 'ITU-7K9M-4X2P';
    root.querySelector('[name=student_number]').value = '12345';
    if (api.lookupApplicationTracking) selectStatusOnly(document, root);
    root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    return result;
}

test('submitted owner session renders localized application and current document statuses safely', async () => {
    const { document, root } = createTrackingRoot();
    const api = { async readCurrentApplicationTracking() { return createTrackingDto(); } };

    const result = await initializeAndLookup(document, root, api);

    assert.equal(result.kind, 'ready');
    assert.match(root.textContent, /TRACK-STUDENT-1/);
    assert.match(root.textContent, /Gönderildi/);
    assert.match(root.textContent, /İnceleme bekliyor/);
    assert.match(root.textContent, /Yeniden yüklenmesi gerekiyor/);
    assert.match(root.textContent, /passport\.pdf/);
    assert.equal(root.querySelector('input[type="file"]'), null);
    assert.equal(root.querySelector('[data-action*="ocr"]'), null);
    assert.doesNotMatch(root.textContent, /OCR/i);
    assert.doesNotMatch(root.innerHTML, /https?:|quarantine|storage_key|signed/i);

    document.documentElement.lang = 'en';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /Submitted/);
    assert.match(root.textContent, /Waiting for review/);
    document.defaultView.close();
});

test('student tracking renders document-specific office messages as plain text', async () => {
    const { document, root } = createTrackingRoot();
    const studentMessage = '</p><script>do not execute</script>';
    const api = {
        async readCurrentApplicationTracking() {
            return createTrackingDto({ documents: [
                { code: 'passport', label_key: 'documentPassport', required: true,
                    status: 'resubmission_required', student_message: studentMessage }
            ] });
        }
    };

    await initializeAndLookup(document, root, api);

    assert.match(root.textContent, /Ofis açıklaması/);
    assert.match(root.textContent, new RegExp(studentMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(root.querySelector('script'), null);
    assert.ok(root.querySelector('.tracking-document-message'));
    assert.ok(SUPPORTED_LOCALES.every((locale) => PUBLIC_MESSAGES[locale].trackingDocumentMessageLabel));
    document.defaultView.close();
});

test('draft owner session links back to the existing application wizard', async () => {
    const { document, root } = createTrackingRoot();
    const api = { async readCurrentApplicationTracking() { return createTrackingDto({ application: { status: 'draft' } }); } };

    const result = await initializeAndLookup(document, root, api);

    assert.equal(result.kind, 'draft');
    assert.match(root.textContent, /henüz taslak/i);
    assert.equal(root.querySelector('a[href="/basvuru/"]')?.textContent, 'Başvuruya dön');
    assert.doesNotMatch(root.textContent, /Gönderildi/);
    document.defaultView.close();
});

test('missing owner session shows one shared ITU reference lookup form', async () => {
    const { document, root } = createTrackingRoot();
    const api = {
        async readCurrentApplicationTracking() {
            throw Object.assign(new Error('session required'), { code: 'APPLICATION_SESSION_REQUIRED', status: 401 });
        }
    };

    const result = await initializeApplicationTracking(root, api);

    assert.equal(result.kind, 'lookup');
    assert.match(root.textContent, /Başvurumu sorgula/i);
    assert.match(root.textContent, /ITU ile başlayan/);
    assert.match(root.textContent, /Başvurumu sorgula/);
    assert.equal(root.querySelectorAll('input[name="reference_number"]').length, 1);
    assert.equal(root.querySelector('input[name="reference_number"]')?.type, 'text');
    assert.equal(root.querySelector('input[name="passport_number"]'), null);
    assert.equal(root.querySelector('input[type="password"]'), null);
    assert.equal(root.querySelector('input[type="file"]'), null);
    assert.doesNotMatch(root.innerHTML, /otp|recovery|tracking.code|ocr/i);
    document.defaultView.close();
});

test('student login renders a rejected application reason as plain text', async () => {
    const { document, root } = createTrackingRoot();
    const rejectionReason = '</dd><script>do not execute</script>';
    const api = {
        async readCurrentApplicationTracking() {
            return createTrackingDto({ application: { status: 'rejected', rejection_reason: rejectionReason }, documents: [] });
        }
    };
    await initializeAndLookup(document, root, api);

    assert.match(root.textContent, /Resmî ret gerekçesi/);
    assert.ok(root.textContent.includes(rejectionReason));
    assert.equal(root.querySelector('script'), null);
    assert.ok(SUPPORTED_LOCALES.every((locale) => PUBLIC_MESSAGES[locale].trackingRejectionReasonLabel));
    document.defaultView.close();
});

test('matching owner session shows the rejection reason to the student', async () => {
    const { document, root } = createTrackingRoot();
    const rejectionReason = 'Sentetik UAT: eksik belge';
    const api = {
        async readCurrentApplicationTracking() {
            return createTrackingDto({ application: { status: 'rejected', rejection_reason: rejectionReason }, documents: [] });
        }
    };

    await initializeAndLookup(document, root, api);

    assert.match(root.textContent, /Resmî ret gerekçesi/);
    assert.ok(root.textContent.includes(rejectionReason));
    document.defaultView.close();
});

test('shared lookup routes physical ITU codes to physical tracking and displays the rejection reason safely', async () => {
    const { document, root } = createTrackingRoot();
    let physicalLookups = 0;
    const api = {
        async lookupPhysicalApplicationTracking(reference) {
            physicalLookups += 1;
            assert.equal(reference, 'ITU-26-ABCDEFG');
            return { found: true, tracking_reference: reference, office_status: 'rejected',
                rejection_reason: '<script>blocked</script>', application_date: '2026-10-23', updated_at: '2026-10-23T10:00:00Z' };
        },
        async lookupApplicationTracking() { throw new Error('Online lookup must not run for physical codes.'); }
    };
    await initializeApplicationTracking(root, api);
    selectStatusOnly(document, root);
    root.querySelector('[name="reference_number"]').value = 'ITU-26-ABCDEFG';
    root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(physicalLookups, 1);
    assert.match(root.textContent, /Dosyanız reddedildi/);
    assert.match(root.textContent, /<script>blocked<\/script>/);
    assert.equal(root.querySelector('script'), null);
    document.defaultView.close();
});

test('owner resubmission view mounts controls only for server-eligible codes and preserves office message', async () => {
    const { document, root } = createTrackingRoot();
    const officeMessage = 'Please provide a clearer passport copy.';
    let intentCalls = 0;
    const api = {
        async readCurrentApplicationTracking() {
            return createTrackingDto({ application: { status: 'resubmission_required' }, documents: [
                { code: 'passport', label_key: 'documentPassport', required: true,
                    status: 'resubmission_required', student_message: officeMessage },
                { code: 'residence_card', label_key: 'documentResidenceCard', required: true,
                    status: 'resubmission_required', student_message: 'Not eligible for replacement.' }
            ] });
        },
        async readCurrentResubmissionEligibility() {
            return { documents: [{ code: 'passport', accepted_media_types: ['application/pdf'], max_byte_size: 100 }] };
        },
        async createResubmissionUploadIntent() { intentCalls += 1; }
    };

    await initializeAndLookup(document, root, api);

    assert.match(root.textContent, new RegExp(officeMessage));
    assert.equal(root.querySelectorAll('input[type="file"]').length, 1);
    assert.equal(root.querySelector('input[type="file"]').accept, 'application/pdf');
    assert.equal(root.querySelectorAll('.resubmission-upload-control button').length, 1);
    assert.equal(intentCalls, 0);
    document.defaultView.close();
});

test('finalize refreshes owner tracking to waiting review while application stays in resubmission status', async () => {
    const { document, root } = createTrackingRoot();
    let trackingReads = 0;
    const api = {
        async readCurrentApplicationTracking() {
            trackingReads += 1;
            const replacement = trackingReads > 1;
            return createTrackingDto({
                application: { status: 'resubmission_required' },
                documents: [{ code: 'passport', label_key: 'documentPassport', required: true,
                    status: replacement ? 'waiting_review' : 'resubmission_required',
                    student_message: 'Please provide a clearer passport copy.' }]
            });
        },
        async readCurrentResubmissionEligibility() {
            return { documents: trackingReads > 1 ? [] : [{ code: 'passport',
                accepted_media_types: ['application/pdf'], max_byte_size: 100 }] };
        },
        async createResubmissionUploadIntent() {
            return { upload: { intent_id: 'intent-ui', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async putStudentDocumentDirect() {},
        async finalizeResubmissionUpload() { return { scan_status: 'pending' }; }
    };
    api.putStudentDocumentDirect = async () => {};
    await initializeAndLookup(document, root, api);
    const input = root.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'passport.pdf', type: 'application/pdf', size: 10 }] });
    input.dispatchEvent(new document.defaultView.Event('change'));
    root.querySelector('.resubmission-upload-control button').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(trackingReads, 2);
    assert.match(root.textContent, /Belge yeniden gönderilmeli/);
    assert.match(root.textContent, /İnceleme bekliyor/);
    assert.ok(root.querySelector('.tracking-success-banner'), 'Persistent replacement success banner must be present after finalize');
    assert.match(root.querySelector('.tracking-success-banner').textContent, /Belge yüklendi ve inceleme bekliyor/);
    assert.ok(root.querySelector('.tracking-card-success'), 'Persistent replacement success banner inside card must be present');
    assert.match(root.querySelector('.tracking-card-success-title').textContent, /Belge başarıyla yüklendi/);
    assert.match(root.querySelector('.tracking-card-scan-status').textContent, /Güncel tarama durumu/);
    assert.match(root.querySelector('.tracking-card-scan-status').textContent, /Güvenlik taraması bekleniyor/);
    assert.equal(root.querySelector('input[type="file"]'), null);
    document.defaultView.close();
});

test('wrong credentials are neutral and allow a retry', async () => {
    const { document, root } = createTrackingRoot();
    let attempts = 0;
    const api = {
        async readCurrentApplicationTracking() {
            throw Object.assign(new Error('session required'), { code: 'APPLICATION_SESSION_REQUIRED', status: 401 });
        },
        async accessApplicationWithReference() {
            attempts += 1;
            if (attempts === 1) throw Object.assign(new Error('bad'), { code: 'INVALID_ACCESS_CREDENTIALS', status: 401 });
            return {};
        }
    };
    await initializeApplicationTracking(root, api);
    const submit = async (studentNumber) => {
        root.querySelector('input[name="reference_number"]').value = 'ITU-7K9M-4X2P';
        root.querySelector('[name=student_number]').value = studentNumber;
        root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setImmediate(resolve));
    };

    await submit('0000');
    assert.match(root.textContent, /hatalı/i);
    assert.equal(root.querySelectorAll('input[name=reference_number]').length, 1);
    assert.equal(root.querySelector('[name=student_number]').required, true);
    assert.doesNotMatch(root.textContent, /draft exists|student exists/i);
    document.defaultView.close();
});

test('tracking supports all locales and the public main entry keeps Arabic right-to-left', async (context) => {
    const requiredKeys = [
        'trackingPageTitle', 'trackingPageText', 'trackingSessionUnavailableHeading', 'trackingSessionUnavailableText',
        'trackingLookupHeading', 'trackingLookupReferenceLabel', 'trackingLookupSubmit', 'trackingLookupExplanation',
        'trackingLookupNotFound', 'trackingLookupRateLimited', 'trackingLookupError',
        'trackingDraftHeading', 'trackingDraftText', 'trackingStatusLabel', 'trackingStatusUnknown',
        'trackingRejectionReasonLabel',
        ...['draft', 'submitted', 'under_review', 'resubmission_required', 'approved_for_processing', 'sent_to_migration',
            'migration_approved', 'completed', 'cancelled', 'rejected'].map((status) => `applicationStatus_${status}`),
        ...['not_uploaded', 'waiting_review', 'under_review', 'approved', 'resubmission_required']
            .map((status) => `trackingDocumentStatus_${status}`)
    ];
    for (const locale of SUPPORTED_LOCALES) {
        for (const key of requiredKeys) assert.ok(PUBLIC_MESSAGES[locale][key], `${locale} missing ${key}`);
    }

    const dom = new JSDOM('<!doctype html><html><body data-page="tracking"><label><select id="locale-select"><option value="ar">Arabic</option></select></label><h1 id="page-heading"></h1><p id="page-description"></p><div id="application-tracking"></div></body></html>', {
        url: 'https://portal.test/basvurum/'
    });
    dom.window.localStorage.setItem('portal_ui_locale', 'ar');
    const previousDocument = globalThis.document;
    const previousLocalStorage = globalThis.localStorage;
    globalThis.document = dom.window.document;
    globalThis.localStorage = dom.window.localStorage;
    context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(createTrackingDto()), {
        status: 200, headers: { 'Content-Type': 'application/json' }
    }));

    try {
        await import(`../src/public/main.js?tracking-rtl=${Date.now()}`);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(document.documentElement.lang, 'ar');
        assert.equal(document.documentElement.dir, 'rtl');
        assert.doesNotMatch(document.querySelector('#application-tracking').textContent, /البحث برقم الطالب/);
        assert.ok(document.querySelector('[name=student_number]'));
        assert.equal(document.querySelector('[name=status_only]'), null);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousLocalStorage;
        dom.window.close();
    }
});

test('language changes preserve the shared ITU code without new lookups', async () => {
    const { document, root } = createTrackingRoot();
    let lookups = 0;
    const api = {
        async accessApplicationWithReference() { lookups += 1; return {}; },
        async readCurrentApplicationTracking() { return createTrackingDto(); }
    };
    await initializeApplicationTracking(root, api);
    const studentNumber = root.querySelector('[name=student_number]');
    studentNumber.value = '12345';
    studentNumber.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    const reference = root.querySelector('#tracking-application-reference');
    reference.value = 'ITU-7K9M-4X2P';
    reference.dispatchEvent(new document.defaultView.Event('input'));

    for (const locale of ['en', 'ar']) {
        document.documentElement.lang = locale;
        document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
        assert.equal(root.querySelector('#tracking-application-reference').value, 'ITU-7K9M-4X2P');
    }
    root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    for (const locale of ['tr', 'en', 'ar']) {
        document.documentElement.lang = locale;
        document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
        assert.match(root.querySelector('.tracking-summary').textContent, /TRACK-STUDENT-1/);
    }

    assert.equal(lookups, 1);
    document.defaultView.close();
});

test('student login shows the resubmission request message for a document', async () => {
    const { document, root } = createTrackingRoot();
    const api = {
        async readCurrentApplicationTracking() {
            return createTrackingDto({ application: { status: 'resubmission_required' }, documents: [
                { code: 'health_insurance', label_key: 'documentHealthInsurance', required: true,
                    status: 'resubmission_required', student_message: 'Sigorta dosyanızı yükleyebilirsiniz.' }
            ] });
        }
    };
    await initializeAndLookup(document, root, api);
    assert.match(root.textContent, /Sigorta dosyanızı yükleyebilirsiniz/);
    document.defaultView.close();
});

test('online credentials open eligible replacement upload in one submission', async () => {
    const { document, root } = createTrackingRoot();
    const calls = [];
    await initializeApplicationTracking(root, {
        async accessApplicationWithReference(credentials) {
            assert.deepEqual(credentials, { reference_number: 'ITU-7K9M-4X2P', student_number: '12345' });
            calls.push('access');
            return { status: 'resubmission_required' };
        },
        async readCurrentApplicationTracking() { calls.push('tracking'); return createTrackingDto({ application: { status: 'resubmission_required' } }); },
        async readCurrentResubmissionEligibility() { calls.push('eligibility'); return { documents: [{ code: 'residence_card', max_byte_size: 1024, accepted_media_types: ['application/pdf'] }] }; },
        async lookupApplicationTracking() { assert.fail('Owner login must not use anonymous lookup'); }
    });
    root.querySelector('[name=reference_number]').value = 'itu-7k9m-4x2p';
    const student = root.querySelector('[name=student_number]');
    assert.ok(student);
    student.value = ' 12345 ';
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['access', 'tracking', 'eligibility']);
    assert.equal(root.querySelectorAll('input[type=file]').length, 1);
    document.defaultView.close();
});

test('failed credentials and mismatched sessions never reveal owner data or fall back to public lookup', async (context) => {
    for (const failure of ['credentials', 'mismatch', 'rate', 'network', 'eligibility']) {
        await context.test(failure, async () => {
            const { document, root } = createTrackingRoot();
            await initializeApplicationTracking(root, {
                async accessApplicationWithReference() {
                    if (failure === 'credentials') throw Object.assign(new Error(), { code: 'INVALID_ACCESS_CREDENTIALS' });
                    if (failure === 'rate') throw Object.assign(new Error(), { status: 429 });
                    if (failure === 'network') throw Object.assign(new Error(), { code: 'NETWORK_ERROR' });
                },
                async readCurrentApplicationTracking() { return createTrackingDto({ application: { reference_number: failure === 'mismatch' ? 'ITU-ABCD-EFGH' : 'ITU-7K9M-4X2P', status: 'resubmission_required' } }); },
                async readCurrentResubmissionEligibility() { throw new Error('Eligibility unavailable'); },
                async lookupApplicationTracking() { assert.fail('Failure must not fall back to public lookup'); }
            });
            root.querySelector('[name=reference_number]').value = 'ITU-7K9M-4X2P';
            root.querySelector('[name=student_number]').value = '12345';
            root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
            await new Promise(resolve => setImmediate(resolve));
            assert.ok(root.querySelector('[role=alert]'));
            assert.equal(root.querySelector('.tracking-summary'), null);
            assert.equal(root.querySelector('input[type=file]'), null);
            document.defaultView.close();
        });
    }
});

test('the student number is required for physical and online references alike', async () => {
    const { document, root } = createTrackingRoot();
    await initializeApplicationTracking(root, {});
    const reference = root.querySelector('[name=reference_number]');
    reference.value = 'ITU-26-ABCDEFG';
    reference.dispatchEvent(new document.defaultView.Event('input'));
    assert.equal(root.querySelector('[name=student_number]').required, true);
    assert.equal(root.querySelector('[name=student_number]').hidden, false);
    reference.value = 'ITU-7K9M-4X2P';
    reference.dispatchEvent(new document.defaultView.Event('input'));
    assert.equal(root.querySelector('[name=student_number]').required, true);
    document.defaultView.close();
});

test('current view opens owner tracking directly and expired sessions return to credentials', async (context) => {
    for (const expired of [false, true]) {
        await context.test(String(expired), async () => {
            const dom = new JSDOM('<html lang="tr"><div id="application-tracking"></div></html>', { url: 'https://portal.test/basvurum/?view=current' });
            const root = dom.window.document.querySelector('div');
            await initializeApplicationTracking(root, {
                async readCurrentApplicationTracking() {
                    if (expired) throw Object.assign(new Error(), { status: 401 });
                    return createTrackingDto();
                },
                async lookupApplicationTracking() { assert.fail('Current view must use owner session'); }
            });
            assert.equal(Boolean(root.querySelector('.tracking-summary')), !expired);
            assert.equal(Boolean(root.querySelector('[name=student_number]')), expired);
            dom.window.close();
        });
    }
});

test('pending login freezes credentials and verifies the originally submitted reference', async () => {
    const { document, root } = createTrackingRoot();
    let releaseAccess;
    const access = new Promise(resolve => { releaseAccess = resolve; });
    await initializeApplicationTracking(root, {
        async accessApplicationWithReference() { await access; },
        async readCurrentApplicationTracking() { return createTrackingDto(); }
    });
    root.querySelector('[name=reference_number]').value = 'ITU-7K9M-4X2P';
    root.querySelector('[name=student_number]').value = '12345';
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
    assert.equal(root.querySelector('[name=reference_number]').disabled, true);
    assert.equal(root.querySelector('[name=student_number]').disabled, true);
    const reference = root.querySelector('[name=reference_number]');
    reference.value = 'ITU-ABCD-EFGH';
    reference.dispatchEvent(new document.defaultView.Event('input'));
    releaseAccess();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(root.querySelector('.tracking-summary'));
    assert.equal(root.querySelector('[role=alert]'), null);
    document.defaultView.close();
});

test('upload success is cleared when a session expires and another application signs in', async () => {
    const { document, root } = createTrackingRoot();
    let expired = false;
    let reference = 'ITU-7K9M-4X2P';
    await initializeApplicationTracking(root, {
        async accessApplicationWithReference(credentials) { reference = credentials.reference_number; },
        async readCurrentApplicationTracking() { return createTrackingDto({ application: { reference_number: reference, status: 'resubmission_required' } }); },
        async readCurrentResubmissionEligibility() { return { documents: [{ code: 'residence_card', accepted_media_types: ['application/pdf'], max_byte_size: 100 }] }; },
        async createResubmissionUploadIntent() {
            if (expired) throw Object.assign(new Error(), { status: 401 });
            return { upload: { intent_id: 'replacement-test' } };
        },
        async putStudentDocumentDirect() {},
        async finalizeResubmissionUpload() { return { scan_status: 'pending' }; }
    });
    const login = async (code) => {
        root.querySelector('[name=reference_number]').value = code;
        root.querySelector('[name=student_number]').value = '12345';
        root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
        await new Promise(resolve => setImmediate(resolve));
    };
    const upload = async () => {
        const input = root.querySelector('input[type=file]');
        Object.defineProperty(input, 'files', { value: [{ name: 'document.pdf', size: 10, type: 'application/pdf' }] });
        input.dispatchEvent(new document.defaultView.Event('change'));
        root.querySelector('.resubmission-upload-control button').click();
        await new Promise(resolve => setImmediate(resolve));
    };
    await login('ITU-7K9M-4X2P');
    await upload();
    assert.ok(root.querySelector('.tracking-success-banner'));
    expired = true;
    await upload();
    assert.ok(root.querySelector('[name=student_number]'));
    await login('ITU-ABCD-EFGH');
    assert.ok(root.querySelector('.tracking-summary'));
    assert.equal(root.querySelector('.tracking-success-banner'), null);
    assert.equal(root.querySelector('.tracking-card-success'), null);
    document.defaultView.close();
});
