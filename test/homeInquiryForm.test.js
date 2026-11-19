import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initHomeQuestions, renderPublicDocumentOverview } from '../src/public/home.js';
import { initHomeInquiryForm } from '../src/public/homeInquiryForm.js';
import { INQUIRY_MESSAGES } from '../src/public/i18n/inquiry-messages.js';
import { SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

async function readHomeHtml() {
    return readFile(resolve(process.cwd(), 'index.html'), 'utf8');
}

function createJsonResponse(payload, status = 201) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        }
    };
}

async function flushPromises() {
    await new Promise((resolveTick) => setImmediate(resolveTick));
    await new Promise((resolveTick) => setImmediate(resolveTick));
}

function mountHomeDom(context, html, { locale = 'tr', fetcher } = {}) {
    const dom = new JSDOM(html, { url: 'https://portal.test/' });
    const doc = dom.window.document;
    doc.documentElement.lang = locale;
    doc.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    context.after(() => dom.window.close());
    const section = doc.getElementById('questions');
    const controller = initHomeInquiryForm(section, { locale, fetcher });
    return { dom, doc, section, controller };
}

test('home markup has the CTA in nav.home-actions and #questions section after the hero', async () => {
    const html = await readHomeHtml();
    const dom = new JSDOM(html, { url: 'https://portal.test/' });
    const doc = dom.window.document;

    try {
        const cta = doc.querySelector('nav.home-actions #btn-home-questions');
        assert.ok(cta, 'CTA button/link must exist inside nav.home-actions');
        assert.equal(cta.getAttribute('href'), '#questions');
        assert.equal(cta.classList.contains('home-cta'), true);
        assert.equal(cta.classList.contains('home-cta-secondary'), true);

        const main = doc.querySelector('main.public-main');
        const footer = doc.querySelector('footer.public-footer');
        const hero = doc.querySelector('.public-hero');
        const questions = doc.getElementById('questions');
        assert.ok(main);
        assert.ok(footer);
        assert.ok(hero);
        assert.ok(questions);
        assert.equal(questions.tagName, 'SECTION');
        assert.equal(main.contains(questions), true);
        assert.equal(main.lastElementChild, questions);
        const publicSections = [...main.querySelectorAll('.public-section')];
        assert.equal(publicSections.at(-1), questions);
        assert.equal(Boolean(hero.compareDocumentPosition(questions) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING), true);
        assert.equal(Boolean(questions.compareDocumentPosition(footer) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING), true);
    } finally {
        dom.window.close();
    }
});

test('all inquiry message keys exist and are non-empty in all five languages', () => {
    const referenceKeys = Object.keys(INQUIRY_MESSAGES.tr).sort();
    assert.ok(referenceKeys.includes('inquiryCta'));
    assert.ok(referenceKeys.includes('inquiryHeading'));
    assert.ok(referenceKeys.includes('inquirySubmit'));
    assert.ok(referenceKeys.includes('inquirySuccess'));
    assert.ok(referenceKeys.includes('inquiryPrivacyLink'));

    for (const locale of SUPPORTED_LOCALES) {
        assert.deepEqual(Object.keys(INQUIRY_MESSAGES[locale]).sort(), referenceKeys, `${locale} key parity`);
        for (const key of referenceKeys) {
            assert.equal(typeof INQUIRY_MESSAGES[locale][key], 'string');
            assert.ok(INQUIRY_MESSAGES[locale][key].trim().length > 0, `${locale}.${key} must be non-empty`);
        }
        assert.match(INQUIRY_MESSAGES[locale].inquirySuccess, /WhatsApp|واتساب/iu, `${locale} success text must mention WhatsApp`);
    }
});

test('mounted form has exactly the five student fields, honeypot, KVKK link, and no category or consent checkbox', async (context) => {
    const html = await readHomeHtml();
    const { doc, section } = mountHomeDom(context, html, { locale: 'tr' });

    const form = section.querySelector('#home-inquiry-form');
    assert.ok(form);
    assert.ok(form.querySelector('input[name="first_name"][required]'));
    assert.ok(form.querySelector('input[name="last_name"][required]'));
    assert.ok(form.querySelector('[data-phone-visible][required]'));
    assert.ok(form.querySelector('input[name="student_phone"][type="hidden"]'));
    const emailInput = form.querySelector('input[name="email"]');
    assert.ok(emailInput);
    assert.equal(emailInput.required, false);
    assert.ok(form.querySelector('textarea[name="message"][required]'));

    // Only phone_country select from phoneField.js may exist; no category select and no checkboxes.
    const selects = [...form.querySelectorAll('select')];
    assert.deepEqual(selects.map((select) => select.name), ['phone_country']);
    assert.equal(form.querySelectorAll('input[type="checkbox"]').length, 0);

    // Honeypot field must be present, visually hidden, out of tab order, and autocomplete off.
    const honeypot = form.querySelector('input[name="website"]');
    assert.ok(honeypot);
    assert.equal(honeypot.tabIndex, -1);
    assert.equal(honeypot.getAttribute('autocomplete'), 'off');
    assert.equal(honeypot.closest('.inquiry-honeypot')?.getAttribute('aria-hidden'), 'true');

    // One-line KVKK notice linking the existing #home-privacy-notice target.
    const heroPrivacyHref = doc.getElementById('home-privacy-notice')?.getAttribute('href');
    const inquiryPrivacyLink = form.querySelector('.inquiry-privacy-link');
    assert.ok(inquiryPrivacyLink);
    assert.equal(inquiryPrivacyLink.getAttribute('href'), heroPrivacyHref);
    assert.equal(form.querySelectorAll('button[type="submit"]').length, 1);
});

test('submit builds the exact frozen API contract body, handles optional email, and blocks double-submit while in flight', async (context) => {
    const html = await readHomeHtml();
    const requests = [];
    let resolvePending = null;

    const { dom, doc, section } = mountHomeDom(context, html, {
        locale: 'tr',
        fetcher: async (url, options = {}) => {
            requests.push({ url: String(url), options });
            return new Promise((resolvePromise) => {
                resolvePending = resolvePromise;
            });
        }
    });

    const form = section.querySelector('#home-inquiry-form');
    const firstName = form.querySelector('[name="first_name"]');
    const lastName = form.querySelector('[name="last_name"]');
    const phoneVisible = form.querySelector('[data-phone-visible]');
    const email = form.querySelector('[name="email"]');
    const message = form.querySelector('[name="message"]');
    const submitButton = form.querySelector('button[type="submit"]');

    firstName.value = '  Ayşe  ';
    lastName.value = '  Kaya  ';
    phoneVisible.value = '0505 123 45 67';
    phoneVisible.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    message.value = '  Öğrenci belgesi nasıl alınır?  ';

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(submitButton.disabled, true);
    assert.equal(requests.length, 1);

    // Second click and programmatic submit while request is in flight must send nothing.
    submitButton.click();
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(requests.length, 1);

    assert.equal(requests[0].url, '/api/public/inquiries');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        first_name: 'Ayşe',
        last_name: 'Kaya',
        phone: '+905051234567',
        email: null,
        message: 'Öğrenci belgesi nasıl alınır?',
        language: 'tr',
        website: ''
    });

    resolvePending(createJsonResponse({ received: true }, 201));
    await flushPromises();

    assert.equal(submitButton.disabled, false);
    assert.equal(firstName.value, '');
    assert.equal(message.value, '');
    const feedback = doc.getElementById('inquiry-feedback');
    assert.equal(feedback.hidden, false);
    assert.equal(feedback.dataset.feedbackType, 'success');
    assert.equal(feedback.textContent.trim(), INQUIRY_MESSAGES.tr.inquirySuccess);

    // Submitting with optional e-mail and Arabic RTL locale sends trimmed email and language: 'ar'.
    doc.documentElement.lang = 'ar';
    doc.documentElement.dir = 'rtl';
    doc.dispatchEvent(new dom.window.Event('public:locale-changed'));

    firstName.value = 'Omar';
    lastName.value = 'Hassan';
    form.querySelector('[data-phone-visible]').value = '+90 505 999 88 77';
    form.querySelector('[data-phone-visible]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    email.value = '  omar@example.edu  ';
    message.value = 'هل أحتاج إلى تأمين صحي؟';

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].options.body), {
        first_name: 'Omar',
        last_name: 'Hassan',
        phone: '+905059998877',
        email: 'omar@example.edu',
        message: 'هل أحتاج إلى تأمين صحي؟',
        language: 'ar',
        website: ''
    });

    resolvePending(createJsonResponse({ received: true }, 201));
    await flushPromises();
    assert.equal(feedback.textContent.trim(), INQUIRY_MESSAGES.ar.inquirySuccess);
});

test('client validation blocks invalid phone, invalid email, and short message without calling fetch, and errors preserve values', async (context) => {
    const html = await readHomeHtml();
    const calls = [];
    let nextStatus = 429;

    const { dom, doc, section } = mountHomeDom(context, html, {
        locale: 'en',
        fetcher: async (url, options) => {
            calls.push({ url, options });
            return createJsonResponse({ error: { code: 'RATE_LIMITED', message: 'rate limited' } }, nextStatus);
        }
    });

    const form = section.querySelector('#home-inquiry-form');
    const firstName = form.querySelector('[name="first_name"]');
    const lastName = form.querySelector('[name="last_name"]');
    const phoneVisible = form.querySelector('[data-phone-visible]');
    const email = form.querySelector('[name="email"]');
    const message = form.querySelector('[name="message"]');
    const feedback = doc.getElementById('inquiry-feedback');

    firstName.value = 'Jane';
    lastName.value = 'Doe';
    phoneVisible.value = 'abc';
    phoneVisible.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    message.value = 'Where is the office?';

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(calls.length, 0);
    assert.equal(feedback.hidden, false);
    assert.equal(feedback.dataset.feedbackType, 'error');
    assert.equal(feedback.textContent.trim(), INQUIRY_MESSAGES.en.inquiryPhoneInvalid);

    phoneVisible.value = '+905051112233';
    phoneVisible.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    email.value = 'not-an-email';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(calls.length, 0);
    assert.equal(feedback.textContent.trim(), INQUIRY_MESSAGES.en.inquiryEmailInvalid);

    email.value = '';
    message.value = 'Hi';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(calls.length, 0);
    assert.equal(feedback.textContent.trim(), INQUIRY_MESSAGES.en.inquiryMessageInvalid);

    message.value = 'Valid question text.';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    assert.equal(calls.length, 1);
    assert.equal(feedback.dataset.feedbackType, 'error');
    assert.equal(feedback.textContent.trim(), INQUIRY_MESSAGES.en.inquiryRateLimited);
    assert.equal(message.value, 'Valid question text.');
});

test('initHomeQuestions mounts #questions once independently of renderPublicDocumentOverview and reacts to locale changes', async (context) => {
    const html = await readHomeHtml();
    const dom = new JSDOM(html, { url: 'https://portal.test/' });
    const doc = dom.window.document;
    context.after(() => dom.window.close());

    const overviewRoot = doc.getElementById('public-document-overview');
    const questionsSection = doc.getElementById('questions');
    assert.ok(overviewRoot);
    assert.ok(questionsSection);

    // Rendering the document overview must not mount the inquiry form.
    renderPublicDocumentOverview(overviewRoot, 'tr');
    assert.equal(questionsSection.querySelector('#home-inquiry-form'), null);
    assert.equal(questionsSection.dataset.inquiryInitialized, undefined);

    // Remove #public-document-overview completely and verify initHomeQuestions mounts on #questions once.
    overviewRoot.remove();
    const controller = initHomeQuestions('tr', { root: doc });
    assert.ok(controller);
    assert.equal(initHomeQuestions('tr', { root: doc }), null);
    context.after(() => controller.destroy());

    const form = questionsSection.querySelector('#home-inquiry-form');
    assert.ok(form);
    assert.equal(doc.getElementById('questions-heading').textContent.trim(), INQUIRY_MESSAGES.tr.inquiryHeading);
    assert.equal(doc.getElementById('btn-home-questions').textContent.trim(), INQUIRY_MESSAGES.tr.inquiryCta);

    // Locale changes propagate via public:locale-changed using one source of truth.
    doc.documentElement.lang = 'en';
    doc.documentElement.dir = 'ltr';
    doc.dispatchEvent(new dom.window.Event('public:locale-changed'));

    assert.equal(doc.getElementById('questions-heading').textContent.trim(), INQUIRY_MESSAGES.en.inquiryHeading);
    assert.equal(doc.getElementById('btn-home-questions').textContent.trim(), INQUIRY_MESSAGES.en.inquiryCta);
    assert.equal(form.querySelector('button[type="submit"]').textContent.trim(), INQUIRY_MESSAGES.en.inquirySubmit);
});

test('initScrollReveal registers #questions with reveal-from-bottom and scroll-reveal CSS does not hide or block pointer events', async (context) => {
    const html = await readHomeHtml();
    const css = await readFile(resolve(process.cwd(), 'src/public/public.css'), 'utf8');

    const revealRules = [...css.matchAll(/([^{}]*\.scroll-reveal-item[^{}]*)\{([^}]*)\}/g)];
    assert.ok(revealRules.length > 0, 'public.css must define .scroll-reveal-item rules');
    for (const [, selector, body] of revealRules) {
        assert.doesNotMatch(
            body,
            /visibility\s*:\s*hidden|display\s*:\s*none|pointer-events\s*:\s*none/i,
            `Reveal CSS for "${selector.trim()}" must not use visibility:hidden, display:none, or pointer-events:none`
        );
    }

    async function runMainInDom(querySuffix, { withObserver = true, reducedMotion = false } = {}) {
        const dom = new JSDOM(html, { url: 'https://portal.test/' });
        const doc = dom.window.document;
        context.after(() => dom.window.close());

        doc.getElementById('header-live-clock')?.remove();
        doc.getElementById('btn-privacy-notice')?.remove();
        doc.getElementById('access-recovery-panel')?.remove();
        if (reducedMotion) {
            dom.window.matchMedia = () => ({ matches: true });
        }

        const observed = [];
        const trackedKeys = ['window', 'document', 'location', 'IntersectionObserver', 'fetch'];
        const savedGlobals = trackedKeys.map((key) => ({
            key,
            had: Object.prototype.hasOwnProperty.call(globalThis, key),
            value: globalThis[key]
        }));

        globalThis.window = dom.window;
        globalThis.document = doc;
        globalThis.location = dom.window.location;
        globalThis.fetch = async () => createJsonResponse({});
        if (withObserver) {
            globalThis.IntersectionObserver = class {
                observe(el) {
                    observed.push(el);
                }
                unobserve() {}
            };
        } else {
            delete globalThis.IntersectionObserver;
        }

        try {
            await import(`../src/public/main.js?${querySuffix}`);
        } finally {
            for (const { key, had, value } of savedGlobals) {
                if (had) globalThis[key] = value;
                else delete globalThis[key];
            }
        }

        return { doc, observed };
    }

    const { doc, observed } = await runMainInDom('scroll-reveal-observer=1', { withObserver: true });
    const questions = doc.getElementById('questions');
    assert.ok(questions);
    assert.equal(questions.classList.contains('scroll-reveal-item'), true);
    assert.equal(questions.classList.contains('reveal-from-bottom'), true);
    assert.equal(observed.at(-1), questions);

    const { doc: fallbackDoc } = await runMainInDom('scroll-reveal-fallback=1', { withObserver: false });
    const fallbackQuestions = fallbackDoc.getElementById('questions');
    assert.equal(fallbackQuestions.classList.contains('scroll-reveal-item'), true);
    assert.equal(fallbackQuestions.classList.contains('is-revealed'), true);

    const { doc: reducedDoc } = await runMainInDom('scroll-reveal-reduced=1', { reducedMotion: true });
    const reducedQuestions = reducedDoc.getElementById('questions');
    assert.equal(reducedQuestions.classList.contains('scroll-reveal-item'), false);
});
