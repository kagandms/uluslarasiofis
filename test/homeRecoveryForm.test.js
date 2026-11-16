import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    acceptCurrentContactAcknowledgement,
    createApplicationDraft,
    readApplicationRecoveryOptions,
    requestApplicationAccessCodeRecoveryByEmail
} from '../src/public/applicationApi.js';
import { initializeApplicationWizard } from '../src/public/applicationWizard.js';
import { buildTelegramRecoveryUrl, initHomeRecoveryForm } from '../src/public/homeRecoveryForm.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import { RECOVERY_MESSAGES } from '../src/public/i18n/recovery-messages.js';

const TEST_PRIVACY_NOTICE = Object.freeze({
    available: true,
    version: 'test-approved-v1',
    content_by_locale: Object.freeze(Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, `Test notice (${locale})`])))
});

function createMessageResolver(doc) {
    return (key) => {
        const locale = SUPPORTED_LOCALES.includes(doc.documentElement.lang) ? doc.documentElement.lang : 'tr';
        return PUBLIC_MESSAGES[locale]?.[key] ?? PUBLIC_MESSAGES.tr[key] ?? key;
    };
}

test('all five languages define every recovery key including spam warning and register them in PUBLIC_MESSAGES', () => {
    const expectedKeys = Object.keys(RECOVERY_MESSAGES.tr).sort();
    assert.ok(expectedKeys.includes('recoveryToggleAction'));
    assert.ok(expectedKeys.includes('recoveryConfirmation'));
    assert.ok(expectedKeys.includes('recoverySpamWarning'));
    assert.ok(expectedKeys.includes('recoveryNetworkRetry'));
    assert.ok(expectedKeys.includes('recoveryTelegramAction'));

    for (const locale of SUPPORTED_LOCALES) {
        assert.deepEqual(Object.keys(RECOVERY_MESSAGES[locale]).sort(), expectedKeys, `${locale} key parity`);
        for (const key of expectedKeys) {
            assert.equal(typeof RECOVERY_MESSAGES[locale][key], 'string');
            assert.ok(RECOVERY_MESSAGES[locale][key].trim().length > 0, `${locale}.${key} must be non-empty`);
            assert.equal(PUBLIC_MESSAGES[locale][key], RECOVERY_MESSAGES[locale][key]);
            assert.doesNotMatch(
                RECOVERY_MESSAGES[locale][key],
                /erişim kodu|access code|код доступа|giriş kod|رمز الدخول|رمز الوصول|kodum|kodunu|kody/iu,
                `${locale}.${key} must not reference access code`
            );
        }
    }
});

test('recovery action buttons share identical primary class list and localized labels in all five languages', async () => {
    const homeHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const expectedLabels = {
        tr: {
            toggle: 'Başvuru Numaramı Unuttum',
            email: 'E-posta ile Başvuru Numaramı Al',
            telegram: 'Telegram ile Başvuru Numaramı Al'
        },
        en: {
            toggle: 'I Forgot My Application Number',
            email: 'Get My Application Number by Email',
            telegram: 'Get My Application Number by Telegram'
        },
        ru: {
            toggle: 'Я забыл(а) номер заявки',
            email: 'Получить номер заявки по e-mail',
            telegram: 'Получить номер заявки в Telegram'
        },
        tk: {
            toggle: 'Arza belgimi unutdym',
            email: 'Arza belgimi e-poçta bilen almak',
            telegram: 'Arza belgimi Telegram bilen almak'
        },
        ar: {
            toggle: 'نسيت رقم الطلب',
            email: 'احصل على رقم طلبي عبر البريد الإلكتروني',
            telegram: 'احصل على رقم طلبي عبر تيليجرام'
        }
    };

    const dom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const doc = dom.window.document;
    const toggle = doc.getElementById('btn-access-recovery');
    const submitBtn = doc.querySelector('#access-recovery-form button[type="submit"]');
    const telegramLink = doc.getElementById('recovery-telegram-link');

    assert.ok(submitBtn);
    assert.ok(telegramLink);
    assert.deepEqual([...telegramLink.classList].sort(), [...submitBtn.classList].sort());
    assert.equal(submitBtn.classList.contains('application-button-primary'), true);
    assert.equal(telegramLink.classList.contains('application-button-secondary'), false);

    initHomeRecoveryForm({
        root: doc,
        api: {
            async readApplicationRecoveryOptions() {
                return { email: true, telegram: { enabled: true, url: 'https://t.me/synthetic_bot?start=recover' } };
            },
            async requestApplicationAccessCodeRecoveryByEmail() {
                return { ok: true };
            }
        },
        getMessage: createMessageResolver(doc)
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));

    for (const locale of SUPPORTED_LOCALES) {
        doc.documentElement.lang = locale;
        doc.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
        doc.dispatchEvent(new dom.window.Event('public:locale-changed'));
        assert.equal(RECOVERY_MESSAGES[locale].recoveryToggleAction, expectedLabels[locale].toggle);
        assert.equal(submitBtn.textContent, expectedLabels[locale].email);
        assert.equal(telegramLink.textContent, expectedLabels[locale].telegram);
    }

    assert.equal(toggle.dataset.i18n, 'recoveryToggleAction');
    assert.equal(submitBtn.dataset.i18n, 'recoveryEmailSubmit');
    assert.equal(telegramLink.dataset.i18n, 'recoveryTelegramAction');

    dom.window.close();
});

test('home page recovery toggle opens accessible form, supports keyboard Escape, and shows current language', async () => {
    const homeHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const dom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const doc = dom.window.document;

    assert.equal(doc.querySelector('#resume-application-form'), null);
    const toggle = doc.getElementById('btn-access-recovery');
    const panel = doc.getElementById('access-recovery-panel');
    const input = doc.getElementById('recovery-student-number');
    const label = doc.querySelector('label[for="recovery-student-number"]');
    const feedback = doc.getElementById('recovery-feedback');

    assert.ok(toggle);
    assert.ok(panel);
    assert.ok(input);
    assert.ok(label);
    assert.equal(feedback.getAttribute('aria-live'), 'polite');
    assert.equal(panel.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');

    initHomeRecoveryForm({
        root: doc,
        api: {
            async readApplicationRecoveryOptions() {
                return { email: true, telegram: { enabled: false, url: null } };
            },
            async requestApplicationAccessCodeRecoveryByEmail() {
                return { ok: true };
            }
        },
        getMessage: createMessageResolver(doc)
    });

    toggle.click();
    assert.equal(panel.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(doc.activeElement, input);
    assert.equal(doc.getElementById('recovery-current-language').textContent, 'Türkçe');

    doc.documentElement.lang = 'ar';
    doc.documentElement.dir = 'rtl';
    doc.dispatchEvent(new dom.window.Event('public:locale-changed'));
    assert.equal(doc.documentElement.dir, 'rtl');
    assert.equal(doc.getElementById('recovery-current-language').textContent, 'العربية');

    panel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(panel.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, toggle);

    dom.window.close();
});

test('telegram link is built with recover_<lang>, updates on locale change, and hides when disabled or options fail', async () => {
    for (const locale of SUPPORTED_LOCALES) {
        assert.equal(
            buildTelegramRecoveryUrl('https://t.me/synthetic_bot?start=recover', locale),
            `https://t.me/synthetic_bot?start=recover_${locale}`
        );
    }
    assert.equal(buildTelegramRecoveryUrl(null, 'tr'), null);
    assert.equal(buildTelegramRecoveryUrl('javascript:alert(1)', 'tr'), null);

    const homeHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');

    // Telegram açıkken dil parametresiyle görünür olmalı
    const enabledDom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const enabledDoc = enabledDom.window.document;
    enabledDoc.documentElement.lang = 'ru';
    initHomeRecoveryForm({
        root: enabledDoc,
        api: {
            async readApplicationRecoveryOptions() {
                return { email: true, telegram: { enabled: true, url: 'https://t.me/synthetic_bot?start=recover' } };
            },
            async requestApplicationAccessCodeRecoveryByEmail() {
                return { ok: true };
            }
        },
        getMessage: createMessageResolver(enabledDoc)
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));

    const telegramLink = enabledDoc.getElementById('recovery-telegram-link');
    assert.equal(telegramLink.hidden, false);
    assert.equal(telegramLink.getAttribute('href'), 'https://t.me/synthetic_bot?start=recover_ru');

    enabledDoc.documentElement.lang = 'en';
    enabledDoc.dispatchEvent(new enabledDom.window.Event('public:locale-changed'));
    assert.equal(telegramLink.getAttribute('href'), 'https://t.me/synthetic_bot?start=recover_en');
    enabledDom.window.close();

    // Telegram kapalıyken gizli kalmalı
    const disabledDom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const disabledDoc = disabledDom.window.document;
    initHomeRecoveryForm({
        root: disabledDoc,
        api: {
            async readApplicationRecoveryOptions() {
                return { email: true, telegram: { enabled: false, url: null } };
            },
            async requestApplicationAccessCodeRecoveryByEmail() {
                return { ok: true };
            }
        },
        getMessage: createMessageResolver(disabledDoc)
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(disabledDoc.getElementById('recovery-telegram-link').hidden, true);
    assert.equal(disabledDoc.getElementById('recovery-telegram-link').getAttribute('href'), null);
    disabledDom.window.close();

    // Options isteği başarısız olduğunda hata gösterilmeden Telegram gizlenmeli
    const errorDom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const errorDoc = errorDom.window.document;
    initHomeRecoveryForm({
        root: errorDoc,
        api: {
            async readApplicationRecoveryOptions() {
                throw Object.assign(new Error('network error'), { code: 'NETWORK_ERROR' });
            },
            async requestApplicationAccessCodeRecoveryByEmail() {
                return { ok: true };
            }
        },
        getMessage: createMessageResolver(errorDoc)
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(errorDoc.getElementById('recovery-telegram-link').hidden, true);
    assert.equal(errorDoc.getElementById('recovery-feedback-message').textContent, '');
    errorDom.window.close();
});

test('recovery submit sends student_number and language, shows neutral confirmation and spam warning, and shows retry only on network error', async () => {
    const homeHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const dom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const doc = dom.window.document;
    doc.documentElement.lang = 'tk';

    const requests = [];
    let mode = 'ok';
    initHomeRecoveryForm({
        root: doc,
        api: {
            async readApplicationRecoveryOptions() {
                return { email: true, telegram: { enabled: false, url: null } };
            },
            async requestApplicationAccessCodeRecoveryByEmail(payload) {
                requests.push(payload);
                if (mode === 'http_error') {
                    throw Object.assign(new Error('rate limited'), { status: 429, code: 'RATE_LIMITED' });
                }
                if (mode === 'network_error') {
                    throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });
                }
                return { ok: true };
            }
        },
        getMessage: createMessageResolver(doc)
    });

    const form = doc.getElementById('access-recovery-form');
    const input = doc.getElementById('recovery-student-number');
    const messageEl = doc.getElementById('recovery-feedback-message');
    const spamEl = doc.getElementById('recovery-spam-warning');

    input.value = ' SYN-STU-1001 ';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveTick) => setImmediate(resolveTick));

    assert.deepEqual(requests[0], { student_number: 'SYN-STU-1001', language: 'tk' });
    assert.equal(messageEl.textContent, RECOVERY_MESSAGES.tk.recoveryConfirmation);
    assert.equal(spamEl.hidden, false);
    assert.equal(spamEl.textContent, RECOVERY_MESSAGES.tk.recoverySpamWarning);

    // Sunucu HTTP hatası verse dahi kayıt var/yok sızdırmayan aynı nötr onay gösterilmeli
    mode = 'http_error';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(messageEl.textContent, RECOVERY_MESSAGES.tk.recoveryConfirmation);
    assert.equal(spamEl.hidden, false);

    // Yalnızca ağ hatasında yeniden deneme mesajı gösterilmeli
    mode = 'network_error';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(messageEl.textContent, RECOVERY_MESSAGES.tk.recoveryNetworkRetry);
    assert.equal(spamEl.hidden, true);

    dom.window.close();
});

test('recovery API client functions hit contracted endpoints', async (context) => {
    const fetchMock = context.mock.method(globalThis, 'fetch', async (path) => {
        if (String(path).endsWith('/options')) {
            return new Response(JSON.stringify({ email: true, telegram: { enabled: true, url: 'https://t.me/synthetic_bot?start=recover' } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        return new Response(JSON.stringify({ ok: true }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' }
        });
    });

    const optionsResult = await readApplicationRecoveryOptions();
    assert.equal(optionsResult.telegram.enabled, true);
    assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/application-recovery/options');
    assert.equal(fetchMock.mock.calls[0].arguments[1].method, 'GET');

    const emailResult = await requestApplicationAccessCodeRecoveryByEmail({ student_number: 'SYN-2026', language: 'ar' });
    assert.deepEqual(emailResult, { ok: true });
    assert.equal(fetchMock.mock.calls[1].arguments[0], '/api/application-recovery/email');
    assert.equal(fetchMock.mock.calls[1].arguments[1].method, 'POST');
    assert.deepEqual(JSON.parse(fetchMock.mock.calls[1].arguments[1].body), { student_number: 'SYN-2026', language: 'ar' });
});

test('contact acknowledgement payload includes language', async (context) => {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(
        JSON.stringify({ application: { status: 'draft', contact_acknowledgement: { current_version: 'v1', accepted_current: true } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));

    const dom = new JSDOM('<!doctype html><html lang="ar" dir="rtl"><body></body></html>');
    const originalDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    try {
        await acceptCurrentContactAcknowledgement('v1');
        assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/public/applications/current/contact-acknowledgement');
        assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body), {
            accepted: true,
            version: 'v1',
            language: 'ar'
        });

        // Desteklenmeyen belge dilinde language anahtarı gönderilmemeli
        dom.window.document.documentElement.lang = 'xx';
        await acceptCurrentContactAcknowledgement('v1');
        const unsupportedBody = JSON.parse(fetchMock.mock.calls[1].arguments[1].body);
        assert.deepEqual(unsupportedBody, { accepted: true, version: 'v1' });
        assert.equal(Object.hasOwn(unsupportedBody, 'language'), false);

        // Açıkça verilen geçerli dil parametresi kullanılmalı
        await acceptCurrentContactAcknowledgement('v1', 'ru');
        assert.deepEqual(JSON.parse(fetchMock.mock.calls[2].arguments[1].body), {
            accepted: true,
            version: 'v1',
            language: 'ru'
        });
    } finally {
        if (originalDoc) Object.defineProperty(globalThis, 'document', originalDoc);
        else delete globalThis.document;
        dom.window.close();
    }
});

test('draft creation payload has no language key', async (context) => {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(
        JSON.stringify({ application: { status: 'draft' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
    ));

    const dom = new JSDOM('<!doctype html><html lang="ar" dir="rtl"><body></body></html>');
    const originalDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    try {
        await createApplicationDraft({
            student_number: 'SYN-DRAFT-1',
            application_type: 'initial',
            email: 'synthetic@example.edu',
            phone: '+905551112233',
            privacy_notice_version: 'approved-v1'
        });
        const draftBody = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
        assert.equal(Object.hasOwn(draftBody, 'language'), false);
    } finally {
        if (originalDoc) Object.defineProperty(globalThis, 'document', originalDoc);
        else delete globalThis.document;
        dom.window.close();
    }
});

test('wizard sends UI language on contact acknowledgement, omits language on draft creation, and shows spam warning in all five languages', async () => {
    for (const locale of SUPPORTED_LOCALES) {
        const dom = new JSDOM(`<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><body><section></section></body></html>`);
        const doc = dom.window.document;
        const root = doc.querySelector('section');
        let capturedDraft = null;
        let capturedAck = null;
        const api = {
            async readCurrentApplication() {
                throw Object.assign(new Error('No current session.'), { code: 'APPLICATION_SESSION_REQUIRED' });
            },
            async readApplicationPrivacyNotice() {
                return TEST_PRIVACY_NOTICE;
            },
            async createApplicationDraft(payload) {
                capturedDraft = payload;
                return {
                    id: 'draft-syn-1',
                    reference_number: 'ITU-SYN1-TEST',
                    lock_version: 1,
                    status: 'draft',
                    contact_acknowledgement: { current_version: 'v1', accepted_current: false }
                };
            },
            async acceptCurrentContactAcknowledgement(version, language) {
                capturedAck = { version, language };
                return {
                    id: 'draft-syn-1',
                    reference_number: 'ITU-SYN1-TEST',
                    lock_version: 2,
                    status: 'draft',
                    contact_acknowledgement: { current_version: version, accepted_current: true }
                };
            },
            async readCurrentStudentDocumentRequirements() {
                return { requirements: [] };
            }
        };

        await initializeApplicationWizard(root, api);
        root.querySelector('[name="student_number"]').value = 'SYN-WIZ-1';
        root.querySelector('[name="application_type"]').value = 'initial';
        root.querySelector('[name="student_email"]').value = 'synthetic@example.edu';
        root.querySelector('[data-phone-visible]').value = '+905551112233';
        root.querySelector('[name="contact_acknowledgement_accepted"]').checked = true;
        root.querySelector('[data-phone-visible]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        root.querySelector('[name="student_email"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        root.querySelector('[name="contact_acknowledgement_accepted"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        root.querySelector('#application-step-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((resolveTick) => setImmediate(resolveTick));
        await new Promise((resolveTick) => setImmediate(resolveTick));

        assert.equal(Object.hasOwn(capturedDraft, 'language'), false, `draft payload must omit language for ${locale}`);
        assert.deepEqual(capturedAck, { version: 'v1', language: locale }, `contact acknowledgement language for ${locale}`);
        const spamBanner = root.querySelector('.application-credentials-banner .credentials-spam-warning');
        assert.ok(spamBanner, `spam warning banner for ${locale}`);
        assert.equal(spamBanner.textContent, RECOVERY_MESSAGES[locale].recoverySpamWarning);

        dom.window.close();
    }
});

test('home hero secondary action buttons use home-cta-secondary and no tertiary class remains', async () => {
    const homeHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const dom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const doc = dom.window.document;

    const startLink = doc.querySelector('.home-actions a[href="/basvuru/"]');
    assert.ok(startLink.classList.contains('home-cta-primary'));
    assert.equal(startLink.classList.contains('home-cta-secondary'), false);

    for (const selector of [
        'a[href="/basvurum/"]',
        'a[href="/basvuruya-devam-et/"]',
        '#btn-access-recovery',
        '#btn-hero-guide',
        '#home-privacy-notice'
    ]) {
        const button = doc.querySelector(`.home-actions ${selector}`);
        assert.ok(button, `${selector} must exist in .home-actions`);
        assert.ok(button.classList.contains('home-cta'), `${selector} must have home-cta`);
        assert.ok(button.classList.contains('home-cta-secondary'), `${selector} must have home-cta-secondary`);
        assert.equal(button.classList.contains('home-cta-tertiary'), false, `${selector} must not have home-cta-tertiary`);
    }

    dom.window.close();
});

test('recovery panel restarts staggered reveal in reading order on each open and respects reduced motion', async () => {
    const [homeHtml, publicCss] = await Promise.all([
        readFile(resolve(process.cwd(), 'index.html'), 'utf8'),
        readFile(resolve(process.cwd(), 'src/public/public.css'), 'utf8')
    ]);

    // Üst hero paragraf animasyonu kurtarma paneli içindeki paragraflara taşmamalı ve sıralı gecikme tanımlı olmalı.
    assert.match(publicCss, /\.public-hero\s*>\s*p:not\(\.public-eyebrow\)/);
    assert.match(publicCss, /\.recovery-panel\.is-revealing\s*>\s*:nth-child\(1\)\s*\{\s*animation-delay:\s*0ms;\s*\}/);
    assert.match(publicCss, /\.recovery-panel\.is-revealing\s*>\s*:nth-child\(2\)\s*\{\s*animation-delay:\s*70ms;\s*\}/);
    assert.match(publicCss, /\.recovery-panel\.is-revealing\s*>\s*:nth-child\(3\)\s*\{\s*animation-delay:\s*140ms;\s*\}/);
    assert.match(publicCss, /\.recovery-panel\.is-revealing\s*>\s*:nth-child\(4\)\s*\{\s*animation-delay:\s*210ms;\s*\}/);
    assert.match(publicCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.recovery-panel\.is-revealing\s*>\s*\*[\s\S]*animation:\s*none\s*!important;/);

    const dom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const doc = dom.window.document;
    const toggle = doc.getElementById('btn-access-recovery');
    const panel = doc.getElementById('access-recovery-panel');

    const childTags = [...panel.children].map((node) => node.tagName);
    assert.deepEqual(childTags, ['H2', 'P', 'DIV', 'FORM']);

    initHomeRecoveryForm({
        root: doc,
        api: {
            async readApplicationRecoveryOptions() { return { email: true, telegram: { enabled: false, url: null } }; },
            async requestApplicationAccessCodeRecoveryByEmail() { return { ok: true }; }
        },
        getMessage: createMessageResolver(doc)
    });

    toggle.click();
    assert.equal(panel.hidden, false);
    assert.equal(panel.classList.contains('is-revealing'), true);

    toggle.click();
    assert.equal(panel.hidden, true);
    assert.equal(panel.classList.contains('is-revealing'), false);

    toggle.click();
    assert.equal(panel.hidden, false);
    assert.equal(panel.classList.contains('is-revealing'), true);

    // Azaltılmış hareket tercihinde animasyon sınıfı eklenmemeli.
    dom.window.matchMedia = () => ({ matches: true });
    panel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(panel.classList.contains('is-revealing'), false);
    toggle.click();
    assert.equal(panel.hidden, false);
    assert.equal(panel.classList.contains('is-revealing'), false);

    dom.window.close();
});

test('repeated recovery submits clear previous feedback first, then re-animate confirmation and spam warning together', async () => {
    const homeHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const dom = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const doc = dom.window.document;

    let pendingResolve = null;
    initHomeRecoveryForm({
        root: doc,
        api: {
            async readApplicationRecoveryOptions() { return { email: true, telegram: { enabled: false, url: null } }; },
            requestApplicationAccessCodeRecoveryByEmail() {
                return new Promise((resolve) => { pendingResolve = resolve; });
            }
        },
        getMessage: createMessageResolver(doc)
    });

    const form = doc.getElementById('access-recovery-form');
    const input = doc.getElementById('recovery-student-number');
    const feedback = doc.getElementById('recovery-feedback');
    const messageEl = doc.getElementById('recovery-feedback-message');
    const spamEl = doc.getElementById('recovery-spam-warning');
    input.value = 'SYN-REPEAT-1';

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(messageEl.textContent, '');
    assert.equal(spamEl.hidden, true);
    pendingResolve({ ok: true });
    await new Promise((resolveTick) => setImmediate(resolveTick));

    assert.equal(feedback.dataset.feedbackType, 'confirmed');
    assert.equal(feedback.classList.contains('is-animating'), true);
    assert.equal(messageEl.textContent, RECOVERY_MESSAGES.tr.recoveryConfirmation);
    assert.equal(spamEl.hidden, false);

    // İkinci gönderimde alan önce temizlenmeli, yanıt gelince animasyonla yeniden gösterilmeli.
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(messageEl.textContent, '');
    assert.equal(feedback.dataset.feedbackType, undefined);
    assert.equal(spamEl.hidden, true);
    assert.equal(feedback.classList.contains('is-animating'), false);

    pendingResolve({ ok: true });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(feedback.dataset.feedbackType, 'confirmed');
    assert.equal(feedback.classList.contains('is-animating'), true);
    assert.equal(messageEl.textContent, RECOVERY_MESSAGES.tr.recoveryConfirmation);
    assert.equal(spamEl.hidden, false);

    // Azaltılmış hareket tercihinde mesaj gösterilmeli ancak animasyon sınıfı eklenmemeli.
    dom.window.matchMedia = () => ({ matches: true });
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    pendingResolve({ ok: true });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.equal(messageEl.textContent, RECOVERY_MESSAGES.tr.recoveryConfirmation);
    assert.equal(feedback.classList.contains('is-animating'), false);

    dom.window.close();
});
