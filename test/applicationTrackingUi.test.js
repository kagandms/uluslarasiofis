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

test('submitted owner session renders localized application and current document statuses safely', async () => {
    const { document, root } = createTrackingRoot();
    const api = { async readCurrentApplicationTracking() { return createTrackingDto(); } };

    const result = await initializeApplicationTracking(root, api);

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

test('draft owner session links back to the existing application wizard', async () => {
    const { document, root } = createTrackingRoot();
    const api = { async readCurrentApplicationTracking() { return createTrackingDto({ application: { status: 'draft' } }); } };

    const result = await initializeApplicationTracking(root, api);

    assert.equal(result.kind, 'draft');
    assert.match(root.textContent, /henüz taslak/i);
    assert.equal(root.querySelector('a[href="/basvuru/"]')?.textContent, 'Başvuruya dön');
    assert.doesNotMatch(root.textContent, /Gönderildi/);
    document.defaultView.close();
});

test('missing or expired owner session renders a student-number-only lookup form', async () => {
    const { document, root } = createTrackingRoot();
    const api = {
        async readCurrentApplicationTracking() {
            throw Object.assign(new Error('session required'), { code: 'APPLICATION_SESSION_REQUIRED', status: 401 });
        }
    };

    const result = await initializeApplicationTracking(root, api);

    assert.equal(result.kind, 'lookup');
    assert.match(root.textContent, /Başvurumu sorgula/i);
    assert.equal(root.querySelectorAll('input').length, 1);
    assert.equal(root.querySelector('input[name="student_number"]')?.type, 'text');
    assert.equal(root.querySelector('input[name="passport_number"]'), null);
    assert.equal(root.querySelector('input[type="password"]'), null);
    assert.equal(root.querySelector('input[type="file"]'), null);
    assert.doesNotMatch(root.innerHTML, /otp|recovery|tracking.code|ocr/i);
    document.defaultView.close();
});

test('public lookup renders statuses without filenames or document controls', async () => {
    const { document, root } = createTrackingRoot();
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
        }
    };
    await initializeApplicationTracking(root, api);
    root.querySelector('input[name="student_number"]').value = 'TRACK-STUDENT-1';
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /Gönderildi/);
    assert.match(root.textContent, /İnceleme bekliyor/);
    assert.doesNotMatch(root.textContent, /PRIVATE-FILENAME\.pdf/);
    assert.equal(root.querySelectorAll('input').length, 0);
    assert.equal(root.querySelector('input[type="file"]'), null);
    assert.equal(root.querySelector('a'), null);
    assert.doesNotMatch(root.innerHTML, /download|preview|upload|ocr/i);
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
        root.querySelector('input[name="student_number"]').value = studentNumber;
        root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setImmediate(resolve));
    };

    await submit('UNKNOWN-STUDENT');
    assert.match(root.textContent, /görüntülenebilir bir başvuru bulunamadı/i);
    assert.equal(root.querySelectorAll('input').length, 1);
    assert.doesNotMatch(root.textContent, /draft exists|student exists/i);
    await submit('TRACK-STUDENT-1');
    assert.equal(lookupCount, 2);
    assert.match(root.textContent, /Gönderildi/);
    document.defaultView.close();
});

test('tracking supports all locales and the public main entry keeps Arabic right-to-left', async (context) => {
    const requiredKeys = [
        'trackingPageTitle', 'trackingPageText', 'trackingSessionUnavailableHeading', 'trackingSessionUnavailableText',
        'trackingLookupHeading', 'trackingLookupStudentNumberLabel', 'trackingLookupSubmit', 'trackingLookupExplanation',
        'trackingLookupNotFound', 'trackingLookupRateLimited', 'trackingLookupError',
        'trackingDraftHeading', 'trackingDraftText', 'trackingStatusLabel', 'trackingStatusUnknown',
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
        assert.match(document.querySelector('#application-tracking').textContent, /تم الإرسال/);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousLocalStorage;
        dom.window.close();
    }
});
