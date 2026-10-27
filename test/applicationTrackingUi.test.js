import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationTracking } from '../src/public/applicationTracking.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

function createTrackingRoot() {
    const document = new JSDOM('<!doctype html><html lang="tr" dir="ltr"><body><main><div id="application-tracking"></div></main></body></html>').window.document;
    return { document, root: document.querySelector('#application-tracking') };
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

async function initializeAndLookup(document, root, api) {
    let lookupPayload = null;
    const wrappedApi = {
        ...api,
        async readCurrentApplicationTracking() {
            if (lookupPayload) {
                const cachedPayload = lookupPayload;
                lookupPayload = null;
                return cachedPayload;
            }
            return api.readCurrentApplicationTracking();
        },
        async lookupApplicationTracking(studentNumber) {
            if (api.lookupApplicationTracking) return api.lookupApplicationTracking(studentNumber);
            lookupPayload = await api.readCurrentApplicationTracking();
            return { found: true, ...lookupPayload };
        }
    };
    const result = await initializeApplicationTracking(root, wrappedApi);
    const input = root.querySelector('input[name="reference_number"]');
    input.value = 'ITU-7K9M-4X2P';
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

test('public lookup renders statuses without filenames or document controls', async () => {
    const { document, root } = createTrackingRoot();
    let privateEndpointCalls = 0;
    const api = {
        async readCurrentApplicationTracking() {
            throw Object.assign(new Error('session required'), { code: 'APPLICATION_SESSION_REQUIRED', status: 401 });
        },
        async lookupApplicationTracking() {
            return {
                found: true,
                ...createTrackingDto({ documents: [
                    { code: 'passport', label_key: 'documentPassport', required: true, status: 'waiting_review', filename: 'PRIVATE-FILENAME.pdf' }
                ] })
            };
        },
        async readCurrentResubmissionEligibility() { privateEndpointCalls += 1; return { documents: [] }; },
        async createResubmissionUploadIntent() { privateEndpointCalls += 1; },
        async finalizeResubmissionUpload() { privateEndpointCalls += 1; }
    };
    await initializeApplicationTracking(root, api);
    root.querySelector('input[name="reference_number"]').value = 'ITU-7K9M-4X2P';
    root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /Gönderildi/);
    assert.match(root.textContent, /İnceleme bekliyor/);
    assert.doesNotMatch(root.textContent, /PRIVATE-FILENAME\.pdf/);
    assert.equal(root.querySelectorAll('input:not([name=tracking_reference])').length, 0);
    assert.equal(root.querySelector('input[type="file"]'), null);
    assert.equal(root.querySelector('a'), null);
    assert.equal(root.querySelector('input[type="file"]'), null);
    assert.equal(privateEndpointCalls, 0);
    assert.doesNotMatch(root.innerHTML, /download|preview|upload|ocr/i);
    document.defaultView.close();
});

test('public ITU tracking renders a rejected application reason as plain text', async () => {
    const { document, root } = createTrackingRoot();
    const rejectionReason = '</dd><script>do not execute</script>';
    const api = {
        async readCurrentApplicationTracking() {
            throw Object.assign(new Error('session required'), { code: 'APPLICATION_SESSION_REQUIRED', status: 401 });
        },
        async lookupApplicationTracking() {
            return { found: true, ...createTrackingDto({
                application: { status: 'rejected', rejection_reason: rejectionReason }, documents: []
            }) };
        }
    };
    await initializeApplicationTracking(root, api);
    root.querySelector('input[name="reference_number"]').value = 'ITU-7K9M-4X2P';
    root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /Resmî ret gerekçesi/);
    assert.ok(root.textContent.includes(rejectionReason));
    assert.equal(root.querySelector('script'), null);
    assert.ok(SUPPORTED_LOCALES.every((locale) => PUBLIC_MESSAGES[locale].trackingRejectionReasonLabel));
    document.defaultView.close();
});

test('matching owner session does not hide the public rejection reason', async () => {
    const { document, root } = createTrackingRoot();
    const rejectionReason = 'Sentetik UAT: eksik belge';
    const api = {
        async lookupApplicationTracking() {
            return { found: true, ...createTrackingDto({
                application: { status: 'rejected', rejection_reason: rejectionReason }, documents: []
            }) };
        },
        async readCurrentApplicationTracking() {
            return createTrackingDto({ application: { status: 'rejected' }, documents: [] });
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

test('not-found lookup is neutral and allows a retry', async () => {
    const { document, root } = createTrackingRoot();
    let lookupCount = 0;
    const api = {
        async readCurrentApplicationTracking() {
            throw Object.assign(new Error('session required'), { code: 'APPLICATION_SESSION_REQUIRED', status: 401 });
        },
        async lookupApplicationTracking() {
            lookupCount += 1;
            return lookupCount === 1 ? { found: false, application: null, documents: [] } : { found: true, ...createTrackingDto() };
        }
    };
    await initializeApplicationTracking(root, api);
    const submit = async (studentNumber) => {
        root.querySelector('input[name="reference_number"]').value = studentNumber;
        root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setImmediate(resolve));
    };

    await submit('ITU-7K9M-4X2P');
    assert.match(root.textContent, /görüntülenebilir bir başvuru bulunamadı/i);
    assert.equal(root.querySelectorAll('input:not([name=tracking_reference])').length, 1);
    assert.doesNotMatch(root.textContent, /draft exists|student exists/i);
    await submit('ITU-7K9M-4X2P');
    assert.equal(lookupCount, 2);
    assert.match(root.textContent, /Gönderildi/);
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
        assert.equal(document.querySelector('.tracking-owner-access-link')?.getAttribute('href'), '/basvuruya-devam-et/');
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
    const api = { lookupApplicationTracking: async () => { lookups += 1; return { found: true, ...createTrackingDto() }; } };
    await initializeApplicationTracking(root, api);
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
