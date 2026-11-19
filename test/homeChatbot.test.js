import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    CHATBOT_PILOT_QUERY_GATE as GATE_FROM_HOME,
    initHomeChatbotGate,
    initHomeQuestions
} from '../src/public/home.js';
import { CHATBOT_PILOT_QUERY_GATE, initHomeChatbot } from '../src/public/homeChatbot.js';
import { CHATBOT_MESSAGES } from '../src/public/i18n/chatbot-messages.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

async function readWorkspaceFile(relativePath) {
    return readFile(resolve(process.cwd(), relativePath), 'utf8');
}

function createJsonResponse(payload, status = 200) {
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

function mountChatbotDom(context, html, { url = 'https://portal.test/?bot=1', locale = 'tr', fetcher, withQuestions = false } = {}) {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;
    doc.documentElement.lang = locale;
    doc.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    context.after(() => dom.window.close());

    let questionsController = null;
    if (withQuestions) {
        questionsController = initHomeQuestions(locale, { root: doc });
        if (questionsController) context.after(() => questionsController.destroy());
    }

    const controller = initHomeChatbot({ locale, root: doc, fetcher });
    if (controller) context.after(() => controller.destroy());

    return { dom, doc, controller, questionsController };
}

test('home markup includes chatbot.css and #home-chatbot-root mount element', async () => {
    const html = await readWorkspaceFile('index.html');
    const dom = new JSDOM(html, { url: 'https://portal.test/' });
    const doc = dom.window.document;

    try {
        const stylesheet = doc.querySelector('link[rel="stylesheet"][href="/src/public/chatbot.css"]');
        assert.ok(stylesheet, 'chatbot.css link must exist in index.html');
        const mountRoot = doc.getElementById('home-chatbot-root');
        assert.ok(mountRoot, '#home-chatbot-root mount element must exist in index.html');
        assert.equal(mountRoot.children.length, 0);
    } finally {
        dom.window.close();
    }
});

test('pilot gate hides widget and does not import homeChatbot.js without ?bot=1', async (context) => {
    assert.equal(GATE_FROM_HOME, 'bot');
    assert.equal(CHATBOT_PILOT_QUERY_GATE, 'bot');

    const [html, homeSource, mainSource] = await Promise.all([
        readWorkspaceFile('index.html'),
        readWorkspaceFile('src/public/home.js'),
        readWorkspaceFile('src/public/main.js')
    ]);

    assert.equal(/^\s*import\s+[^'"]*homeChatbot\.js/m.test(homeSource), false, 'home.js must not statically import homeChatbot.js');
    assert.equal(/homeChatbot\.js/.test(mainSource), false, 'main.js must not statically import homeChatbot.js');
    assert.match(homeSource, /import\(['"]\.\/homeChatbot\.js['"]\)/, 'home.js must lazy-import homeChatbot.js');

    for (const url of ['https://portal.test/', 'https://portal.test/?bot=0', 'https://portal.test/?bot=true']) {
        const dom = new JSDOM(html, { url });
        const doc = dom.window.document;
        context.after(() => dom.window.close());

        let loaderCalls = 0;
        const result = await initHomeChatbotGate('tr', {
            root: doc,
            loader: async () => {
                loaderCalls += 1;
                return import('../src/public/homeChatbot.js');
            }
        });

        assert.equal(result, null);
        assert.equal(loaderCalls, 0);
        assert.equal(doc.getElementById('home-chatbot-root').children.length, 0);
    }
});

test('pilot gate lazy-imports and renders launcher when ?bot=1 is present', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const dom = new JSDOM(html, { url: 'https://portal.test/?lang=en&bot=1' });
    const doc = dom.window.document;
    context.after(() => dom.window.close());

    let loaderCalls = 0;
    const controller = await initHomeChatbotGate('tr', {
        root: doc,
        loader: async () => {
            loaderCalls += 1;
            return import('../src/public/homeChatbot.js');
        }
    });
    assert.ok(controller);
    context.after(() => controller.destroy());

    assert.equal(loaderCalls, 1);
    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    assert.ok(launcher);
    assert.ok(panel);
    assert.equal(panel.hidden, true);
    assert.equal(launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('role'), 'dialog');
    assert.equal(panel.getAttribute('aria-modal'), 'true');
    assert.ok(panel.getAttribute('aria-labelledby'));
    assert.equal(panel.querySelector('.chatbot-log')?.getAttribute('aria-live'), 'polite');

    // Second gate call is a no-op once initialized.
    const second = await initHomeChatbotGate('tr', {
        root: doc,
        loader: async () => {
            loaderCalls += 1;
            return import('../src/public/homeChatbot.js');
        }
    });
    assert.equal(second, null);
    assert.equal(loaderCalls, 1);
});

test('all chatbot message keys exist and are non-empty in all five languages', () => {
    const referenceKeys = Object.keys(CHATBOT_MESSAGES.tr).sort();
    assert.equal(CHATBOT_MESSAGES.tr.chipDocuments, 'Belgeler neler?');
    assert.equal(CHATBOT_MESSAGES.tr.chipStatus, 'Başvuru durumum');
    assert.equal(CHATBOT_MESSAGES.tr.chipInquiry, 'Ofise sor');
    assert.equal(
        CHATBOT_MESSAGES.tr.noticeText,
        'Yapay zekâ hata yapabilir; resmi karar Uluslararası Ofise aittir'
    );

    for (const locale of SUPPORTED_LOCALES) {
        assert.deepEqual(Object.keys(CHATBOT_MESSAGES[locale]).sort(), referenceKeys, `${locale} key parity`);
        for (const key of referenceKeys) {
            assert.equal(typeof CHATBOT_MESSAGES[locale][key], 'string');
            assert.ok(CHATBOT_MESSAGES[locale][key].trim().length > 0, `${locale}.${key} must be non-empty`);
        }
    }
});

test('quick-reply chips and fixed notice are localized and update on public:locale-changed with dir="rtl" for ar', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const { dom, doc } = mountChatbotDom(context, html, { locale: 'tr' });

    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    launcher.click();

    const readChipTexts = () => [...panel.querySelectorAll('.chatbot-chip')].map((chip) => chip.textContent.trim());
    assert.deepEqual(readChipTexts(), ['Belgeler neler?', 'Başvuru durumum', 'Ofise sor']);
    assert.equal(
        panel.querySelector('.chatbot-notice').textContent.trim(),
        CHATBOT_MESSAGES.tr.noticeText
    );
    assert.equal(panel.getAttribute('dir'), 'ltr');

    doc.documentElement.lang = 'ar';
    doc.documentElement.dir = 'rtl';
    doc.dispatchEvent(new dom.window.Event('public:locale-changed'));

    assert.equal(panel.getAttribute('dir'), 'rtl');
    assert.equal(doc.querySelector('.chatbot-root').getAttribute('dir'), 'rtl');
    assert.deepEqual(readChipTexts(), [
        CHATBOT_MESSAGES.ar.chipDocuments,
        CHATBOT_MESSAGES.ar.chipStatus,
        CHATBOT_MESSAGES.ar.chipInquiry
    ]);
    assert.equal(panel.querySelector('.chatbot-notice').textContent.trim(), CHATBOT_MESSAGES.ar.noticeText);
    assert.equal(panel.querySelector('.chatbot-title').textContent.trim(), CHATBOT_MESSAGES.ar.panelTitle);

    doc.documentElement.lang = 'en';
    doc.documentElement.dir = 'ltr';
    doc.dispatchEvent(new dom.window.Event('public:locale-changed'));
    assert.equal(panel.getAttribute('dir'), 'ltr');
    assert.deepEqual(readChipTexts(), [
        CHATBOT_MESSAGES.en.chipDocuments,
        CHATBOT_MESSAGES.en.chipStatus,
        CHATBOT_MESSAGES.en.chipInquiry
    ]);
});

test('"Ofise sor" chip and {type:"inquiry"} action close panel, scroll to #questions, and focus first field without API call for the chip', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const requests = [];

    const { doc } = mountChatbotDom(context, html, {
        locale: 'tr',
        withQuestions: true,
        fetcher: async (url, options) => {
            requests.push({ url, options });
            return createJsonResponse({
                reply: 'Ofisimiz size yardımcı olabilir.',
                actions: [
                    { type: 'inquiry' },
                    { type: 'link', href: '/basvurum/', label_key: 'homeTrackAction' }
                ]
            }, 200);
        }
    });

    const questionsSection = doc.getElementById('questions');
    let scrollCalls = 0;
    questionsSection.scrollIntoView = () => {
        scrollCalls += 1;
    };

    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    const firstInquiryInput = doc.getElementById('inquiry-first-name');
    assert.ok(firstInquiryInput);

    // 1) "Ofise sor" chip performs the inquiry action locally without calling the API.
    launcher.click();
    assert.equal(panel.hidden, false);
    const inquiryChip = panel.querySelector('.chatbot-chip[data-chip-key="chipInquiry"]');
    inquiryChip.click();

    assert.equal(requests.length, 0);
    assert.equal(panel.hidden, true);
    assert.equal(scrollCalls, 1);
    assert.equal(doc.activeElement, firstInquiryInput);

    // 2) Server-returned {type: 'inquiry'} and {type: 'link'} actions render and behave per contract.
    launcher.click();
    panel.querySelector('.chatbot-chip[data-chip-key="chipDocuments"]').click();
    await flushPromises();
    assert.equal(requests.length, 1);

    const linkAction = panel.querySelector('.chatbot-action-link');
    assert.ok(linkAction);
    assert.equal(linkAction.getAttribute('href'), '/basvurum/');
    assert.equal(linkAction.textContent.trim(), PUBLIC_MESSAGES.tr.homeTrackAction);

    const inquiryAction = panel.querySelector('.chatbot-action-inquiry');
    assert.ok(inquiryAction);
    inquiryAction.click();

    assert.equal(panel.hidden, true);
    assert.equal(scrollCalls, 2);
    assert.equal(doc.activeElement, firstInquiryInput);
});

test('request body matches API contract, caps history at 10 messages, and uses no browser storage', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const requests = [];

    const { dom, doc } = mountChatbotDom(context, html, {
        locale: 'en',
        fetcher: async (url, options) => {
            const parsed = JSON.parse(options.body);
            requests.push({ url: String(url), options, body: parsed });
            return createJsonResponse({
                reply: `Reply #${requests.length}`,
                actions: []
            }, 200);
        }
    });

    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    const input = doc.getElementById('chatbot-input');
    const form = panel.querySelector('.chatbot-composer');

    launcher.click();

    for (let turn = 1; turn <= 7; turn += 1) {
        input.value = `Question ${turn}`;
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();
    }

    assert.equal(requests.length, 7);
    assert.equal(requests[0].url, '/api/public/chat');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(requests[0].body, {
        messages: [{ role: 'user', content: 'Question 1' }],
        language: 'en'
    });

    const seventh = requests[6].body;
    assert.equal(seventh.language, 'en');
    assert.equal(seventh.messages.length, 10);
    assert.equal(seventh.messages[9].role, 'user');
    assert.equal(seventh.messages[9].content, 'Question 7');
    assert.deepEqual(
        seventh.messages.map((m) => m.content),
        [
            'Reply #2',
            'Question 3',
            'Reply #3',
            'Question 4',
            'Reply #4',
            'Question 5',
            'Reply #5',
            'Question 6',
            'Reply #6',
            'Question 7'
        ]
    );

    assert.equal(dom.window.localStorage.length, 0);
    assert.equal(dom.window.sessionStorage.length, 0);
});

test('501-char input is blocked client-side with visible counter and error', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const requests = [];

    const { dom, doc } = mountChatbotDom(context, html, {
        locale: 'tr',
        fetcher: async (url, options) => {
            requests.push({ url, options });
            return createJsonResponse({ reply: 'ok', actions: [] }, 200);
        }
    });

    doc.getElementById('home-chatbot-launcher').click();
    const panel = doc.getElementById('home-chatbot-panel');
    const input = doc.getElementById('chatbot-input');
    const counter = panel.querySelector('.chatbot-counter');
    const validationError = doc.getElementById('chatbot-validation-error');
    const sendButton = panel.querySelector('.chatbot-send');

    input.value = 'a'.repeat(501);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    assert.equal(counter.textContent.trim(), '501 / 500');
    assert.equal(counter.classList.contains('is-over-limit'), true);
    assert.equal(validationError.hidden, false);
    assert.equal(validationError.textContent.trim(), CHATBOT_MESSAGES.tr.inputTooLong);
    assert.equal(input.getAttribute('aria-invalid'), 'true');

    sendButton.click();
    panel.querySelector('.chatbot-composer').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    assert.equal(requests.length, 0);
});

test('double send is blocked while a request is pending', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const requests = [];
    let resolvePending = null;

    const { dom, doc } = mountChatbotDom(context, html, {
        locale: 'tr',
        fetcher: async (url, options) => {
            requests.push({ url, options });
            return new Promise((resolvePromise) => {
                resolvePending = resolvePromise;
            });
        }
    });

    doc.getElementById('home-chatbot-launcher').click();
    const panel = doc.getElementById('home-chatbot-panel');
    const input = doc.getElementById('chatbot-input');
    const form = panel.querySelector('.chatbot-composer');
    const sendButton = panel.querySelector('.chatbot-send');
    const docsChip = panel.querySelector('.chatbot-chip[data-chip-key="chipDocuments"]');

    input.value = 'İkamet izni uzatma nedir?';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

    assert.equal(requests.length, 1);
    assert.equal(sendButton.disabled, true);
    assert.equal(docsChip.disabled, true);

    input.value = 'İkinci soru';
    sendButton.click();
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    docsChip.click();
    assert.equal(requests.length, 1);

    resolvePending(createJsonResponse({ reply: 'Uzatma bilgisi.', actions: [] }, 200));
    await flushPromises();

    assert.equal(sendButton.disabled, false);
    assert.equal(docsChip.disabled, false);
});

test('429, 503, and network errors show localized unavailable fallback with working inquiry button', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const responses = [
        () => Promise.resolve(createJsonResponse({ error: { code: 'RATE_LIMITED', message: 'slow down' } }, 429)),
        () => Promise.resolve(createJsonResponse({ error: { code: 'CHATBOT_UNAVAILABLE', message: 'down' } }, 503)),
        () => Promise.reject(new Error('network failure'))
    ];

    const { dom, doc } = mountChatbotDom(context, html, {
        locale: 'en',
        withQuestions: true,
        fetcher: () => responses.shift()()
    });

    const questionsSection = doc.getElementById('questions');
    let scrollCalls = 0;
    questionsSection.scrollIntoView = () => {
        scrollCalls += 1;
    };

    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    const input = doc.getElementById('chatbot-input');
    const form = panel.querySelector('.chatbot-composer');

    launcher.click();

    for (let i = 1; i <= 3; i += 1) {
        input.value = `Fallback test ${i}`;
        form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();
    }

    const errorMessages = [...panel.querySelectorAll('.chatbot-message-error')];
    assert.equal(errorMessages.length, 3);
    for (const errMsg of errorMessages) {
        assert.equal(errMsg.querySelector('.chatbot-bubble').textContent.trim(), CHATBOT_MESSAGES.en.unavailableMessage);
        const inquiryBtn = errMsg.querySelector('.chatbot-action-inquiry');
        assert.ok(inquiryBtn);
        assert.equal(inquiryBtn.textContent.trim(), CHATBOT_MESSAGES.en.inquiryActionButton);
    }

    errorMessages[0].querySelector('.chatbot-action-inquiry').click();
    assert.equal(panel.hidden, true);
    assert.equal(scrollCalls, 1);
    assert.equal(doc.activeElement, doc.getElementById('inquiry-first-name'));
});

test('assistant reply is rendered strictly as text and HTML strings do not create DOM elements', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const xssPayload = '<img src=x onerror=alert(1)><b>Hello</b><script>window.__xss=1</script>';

    const { dom, doc } = mountChatbotDom(context, html, {
        locale: 'tr',
        fetcher: async () => createJsonResponse({ reply: xssPayload, actions: [] }, 200)
    });

    doc.getElementById('home-chatbot-launcher').click();
    const panel = doc.getElementById('home-chatbot-panel');
    const input = doc.getElementById('chatbot-input');
    input.value = 'Test';
    panel.querySelector('.chatbot-composer').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const assistantMessages = panel.querySelectorAll('.chatbot-message-assistant');
    const lastBubble = assistantMessages[assistantMessages.length - 1].querySelector('.chatbot-bubble');
    assert.equal(lastBubble.textContent, xssPayload);
    assert.equal(lastBubble.children.length, 0);
    assert.equal(lastBubble.querySelector('img, b, script'), null);
    assert.equal(dom.window.__xss, undefined);
});

test('Esc closes the panel and restores focus to launcher, and Tab focus trap wraps inside panel', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const { dom, doc } = mountChatbotDom(context, html, { locale: 'tr' });

    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    const closeButton = panel.querySelector('.chatbot-close');
    const sendButton = panel.querySelector('.chatbot-send');

    launcher.focus();
    launcher.click();

    assert.equal(panel.hidden, false);
    assert.equal(launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.contains(doc.activeElement), true);

    // Tab from last focusable element wraps to first focusable element inside panel.
    sendButton.focus();
    const tabForward = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    doc.dispatchEvent(tabForward);
    assert.equal(tabForward.defaultPrevented, true);
    assert.equal(doc.activeElement, closeButton);

    // Shift+Tab from first focusable element wraps to last focusable element inside panel.
    const tabBackward = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    doc.dispatchEvent(tabBackward);
    assert.equal(tabBackward.defaultPrevented, true);
    assert.equal(doc.activeElement, sendButton);

    // Escape closes the panel and returns focus to launcher.
    const escEvent = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    doc.dispatchEvent(escEvent);
    assert.equal(escEvent.defaultPrevented, true);
    assert.equal(panel.hidden, true);
    assert.equal(launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, launcher);
});

test('chatbotOpenTracking link action renders localized label for tr and updates on public:locale-changed to ar', async (context) => {
    const html = await readWorkspaceFile('index.html');

    const { dom, doc } = mountChatbotDom(context, html, {
        locale: 'tr',
        fetcher: async () => createJsonResponse({
            reply: 'Başvuru durumunuzu takip sayfasından görebilirsiniz.',
            actions: [
                { type: 'link', href: '/basvurum/', label_key: 'chatbotOpenTracking' }
            ]
        }, 200)
    });

    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    launcher.click();

    panel.querySelector('.chatbot-chip[data-chip-key="chipStatus"]').click();
    await flushPromises();

    const linkAction = panel.querySelector('a[href="/basvurum/"]');
    assert.ok(linkAction);
    assert.equal(linkAction.getAttribute('href'), '/basvurum/');
    assert.equal(linkAction.textContent.trim(), 'Başvurumu görüntüle');
    assert.equal(linkAction.textContent.trim(), CHATBOT_MESSAGES.tr.chatbotOpenTracking);

    doc.documentElement.lang = 'ar';
    doc.documentElement.dir = 'rtl';
    doc.dispatchEvent(new dom.window.Event('public:locale-changed'));

    assert.equal(linkAction.textContent.trim(), 'عرض طلبي');
    assert.equal(linkAction.textContent.trim(), CHATBOT_MESSAGES.ar.chatbotOpenTracking);
});

test('resolveSafeHref only renders same-origin path link actions and drops unsafe or external hrefs', async (context) => {
    const html = await readWorkspaceFile('index.html');
    let nextActions = [];

    const { dom, doc } = mountChatbotDom(context, html, {
        locale: 'tr',
        fetcher: async () => createJsonResponse({
            reply: 'Yanıt metni.',
            actions: nextActions
        }, 200)
    });

    doc.getElementById('home-chatbot-launcher').click();
    const panel = doc.getElementById('home-chatbot-panel');
    const input = doc.getElementById('chatbot-input');
    const form = panel.querySelector('.chatbot-composer');

    async function sendAndReadLastMessage(actions) {
        nextActions = actions;
        input.value = 'Soru';
        form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();
        const messages = panel.querySelectorAll('.chatbot-message-assistant');
        return messages[messages.length - 1];
    }

    const safeMessage = await sendAndReadLastMessage([
        { type: 'link', href: '/basvurum/', label_key: 'homeTrackAction' }
    ]);
    const safeLink = safeMessage.querySelector('.chatbot-action-link');
    assert.ok(safeLink);
    assert.equal(safeLink.getAttribute('href'), '/basvurum/');
    assert.equal(safeLink.getAttribute('target'), null);
    assert.equal(safeLink.getAttribute('rel'), null);

    const unsafeHrefs = [
        '/\\evil.example',
        '//evil.example',
        'https://evil.example/',
        'javascript:alert(1)',
        '/%5Cevil',
        ' /basvurum/',
        '/basvurum/\nalert(1)'
    ];

    for (const unsafeHref of unsafeHrefs) {
        const msg = await sendAndReadLastMessage([
            { type: 'link', href: unsafeHref, label_key: 'homeTrackAction' }
        ]);
        assert.equal(msg.querySelector('.chatbot-action-link'), null, `Expected no link for ${JSON.stringify(unsafeHref)}`);
        assert.equal(msg.querySelector('a'), null, `Expected no anchor for ${JSON.stringify(unsafeHref)}`);
        assert.equal(msg.querySelector('.chatbot-actions'), null, `Expected action row dropped for ${JSON.stringify(unsafeHref)}`);
    }
});
