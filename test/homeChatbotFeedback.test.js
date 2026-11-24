/**
 * Unit and DOM integration tests for public Topi chatbot Yes/No feedback buttons
 * and in-memory session_id propagation (Task 4B).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initHomeQuestions } from '../src/public/home.js';
import { initHomeChatbot } from '../src/public/homeChatbot.js';
import { CHATBOT_MESSAGES } from '../src/public/i18n/chatbot-messages.js';
import { SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

const NEW_FEEDBACK_KEYS = Object.freeze([
    'feedbackPrompt',
    'feedbackYes',
    'feedbackNo',
    'feedbackYesAriaLabel',
    'feedbackNoAriaLabel',
    'feedbackThanks',
    'feedbackError'
]);

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

function createEmptyResponse(status = 204) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            throw new Error('No JSON body');
        }
    };
}

async function flushPromises() {
    await new Promise((resolveTick) => setImmediate(resolveTick));
    await new Promise((resolveTick) => setImmediate(resolveTick));
}

function mountFeedbackDom(context, html, { url = 'https://portal.test/?bot=1', locale = 'tr', fetcher, withQuestions = false } = {}) {
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

async function submitQuestion(dom, doc, text) {
    const panel = doc.getElementById('home-chatbot-panel');
    const input = doc.getElementById('chatbot-input');
    const form = panel.querySelector('.chatbot-composer');
    input.value = text;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
}

test('all five languages define every new feedback key with non-empty strings', () => {
    for (const locale of SUPPORTED_LOCALES) {
        const messages = CHATBOT_MESSAGES[locale];
        assert.ok(messages, `Missing messages for locale ${locale}`);
        for (const key of NEW_FEEDBACK_KEYS) {
            assert.equal(typeof messages[key], 'string', `${locale}.${key} must be a string`);
            assert.ok(messages[key].trim().length > 0, `${locale}.${key} must be non-empty`);
        }
    }
    assert.equal(CHATBOT_MESSAGES.tr.feedbackPrompt, 'Yardımcı oldu mu?');
    assert.equal(CHATBOT_MESSAGES.tr.feedbackYes, 'Evet');
    assert.equal(CHATBOT_MESSAGES.tr.feedbackNo, 'Hayır');
    assert.equal(CHATBOT_MESSAGES.tr.feedbackYesAriaLabel, 'Bu cevap yardımcı oldu');
    assert.equal(CHATBOT_MESSAGES.tr.feedbackNoAriaLabel, 'Bu cevap yardımcı olmadı');
    assert.equal(CHATBOT_MESSAGES.tr.feedbackThanks, 'Teşekkürler, geri bildiriminiz alındı.');
});

test('feedback buttons render only when turn_id is non-null and never on welcome, error, or turn_id:null messages', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const responses = [
        () => Promise.resolve(createJsonResponse({
            reply: 'Loglu yanıt.',
            actions: [],
            session_id: '11111111-1111-4111-8111-111111111111',
            turn_id: '22222222-2222-4222-8222-222222222222'
        }, 200)),
        () => Promise.resolve(createJsonResponse({
            reply: 'Logsuz yanıt.',
            actions: [],
            session_id: null,
            turn_id: null
        }, 200)),
        () => Promise.resolve(createJsonResponse({
            reply: 'Eski sözleşme yanıtı.',
            actions: []
        }, 200)),
        () => Promise.resolve(createJsonResponse({ error: { code: 'CHATBOT_UNAVAILABLE' } }, 503)),
        () => Promise.reject(new Error('network error'))
    ];

    const { dom, doc } = mountFeedbackDom(context, html, {
        locale: 'tr',
        fetcher: () => responses.shift()()
    });

    doc.getElementById('home-chatbot-launcher').click();
    const panel = doc.getElementById('home-chatbot-panel');

    // Welcome message has no feedback row.
    const welcomeMsg = panel.querySelector('.chatbot-message-assistant');
    assert.ok(welcomeMsg);
    assert.equal(welcomeMsg.querySelector('.chatbot-feedback'), null);

    // 1) Non-null turn_id -> feedback row with two real <button> elements and aria-labels.
    await submitQuestion(dom, doc, 'Soru 1');
    const firstReply = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    const feedbackRow = firstReply.querySelector('.chatbot-feedback');
    assert.ok(feedbackRow, 'Expected feedback row when turn_id is present');
    assert.equal(feedbackRow.querySelector('.chatbot-feedback-prompt')?.textContent.trim(), 'Yardımcı oldu mu?');
    const yesBtn = feedbackRow.querySelector('button.chatbot-feedback-yes');
    const noBtn = feedbackRow.querySelector('button.chatbot-feedback-no');
    assert.ok(yesBtn);
    assert.ok(noBtn);
    assert.equal(yesBtn.tagName, 'BUTTON');
    assert.equal(noBtn.tagName, 'BUTTON');
    assert.equal(yesBtn.type, 'button');
    assert.equal(noBtn.type, 'button');
    assert.equal(yesBtn.textContent.trim(), 'Evet');
    assert.equal(noBtn.textContent.trim(), 'Hayır');
    assert.equal(yesBtn.getAttribute('aria-label'), 'Bu cevap yardımcı oldu');
    assert.equal(noBtn.getAttribute('aria-label'), 'Bu cevap yardımcı olmadı');

    // 2) turn_id: null -> no feedback row.
    await submitQuestion(dom, doc, 'Soru 2');
    const nullTurnReply = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    assert.equal(nullTurnReply.querySelector('.chatbot-feedback'), null);

    // 3) Missing turn_id -> no feedback row.
    await submitQuestion(dom, doc, 'Soru 3');
    const omittedTurnReply = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    assert.equal(omittedTurnReply.querySelector('.chatbot-feedback'), null);

    // 4) 503 error -> no feedback row.
    await submitQuestion(dom, doc, 'Soru 4');
    const error503 = [...panel.querySelectorAll('.chatbot-message-error')].at(-1);
    assert.equal(error503.querySelector('.chatbot-feedback'), null);

    // 5) Network error -> no feedback row.
    await submitQuestion(dom, doc, 'Soru 5');
    const errorNet = [...panel.querySelectorAll('.chatbot-message-error')].at(-1);
    assert.equal(errorNet.querySelector('.chatbot-feedback'), null);
});

test('clicking Evet posts exact {turn_id, value:"up"} and replaces feedback row with thank-you text on 204', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const turnId = '33333333-3333-4333-8333-333333333333';
    const requests = [];

    const { dom, doc } = mountFeedbackDom(context, html, {
        locale: 'tr',
        fetcher: async (url, options) => {
            const parsed = JSON.parse(options.body);
            requests.push({ url: String(url), options, body: parsed });
            if (url === '/api/public/chat') {
                return createJsonResponse({
                    reply: 'Pasaport ve öğrenci belgesi gerekir.',
                    actions: [],
                    session_id: '11111111-1111-4111-8111-111111111111',
                    turn_id: turnId
                }, 200);
            }
            return createEmptyResponse(204);
        }
    });

    doc.getElementById('home-chatbot-launcher').click();
    await submitQuestion(dom, doc, 'Belgeler neler?');

    const panel = doc.getElementById('home-chatbot-panel');
    const replyMsg = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    const yesBtn = replyMsg.querySelector('.chatbot-feedback-yes');
    yesBtn.click();
    await flushPromises();

    assert.equal(requests.length, 2);
    const fbReq = requests[1];
    assert.equal(fbReq.url, '/api/public/chat/feedback');
    assert.equal(fbReq.options.method, 'POST');
    assert.equal(fbReq.options.credentials, 'same-origin');
    assert.equal(fbReq.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(fbReq.body, { turn_id: turnId, value: 'up' });

    const feedbackRow = replyMsg.querySelector('.chatbot-feedback');
    assert.ok(feedbackRow);
    assert.equal(feedbackRow.querySelectorAll('button').length, 0);
    assert.equal(
        feedbackRow.querySelector('.chatbot-feedback-thanks')?.textContent.trim(),
        CHATBOT_MESSAGES.tr.feedbackThanks
    );
    // "Evet" does not add an inquiry button when the reply did not have one.
    assert.equal(replyMsg.querySelector('.chatbot-action-inquiry'), null);
});

test('clicking Hayır posts {turn_id, value:"down"}, shows thank-you, and reveals working existing inquiry action without duplicating it', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const turnId1 = '44444444-4444-4444-8444-444444444444';
    const turnId2 = '55555555-5555-4555-8555-555555555555';
    const requests = [];
    let chatReplyCount = 0;

    const { dom, doc } = mountFeedbackDom(context, html, {
        locale: 'tr',
        withQuestions: true,
        fetcher: async (url, options) => {
            const parsed = JSON.parse(options.body);
            requests.push({ url: String(url), options, body: parsed });
            if (url === '/api/public/chat') {
                chatReplyCount += 1;
                return createJsonResponse({
                    reply: `Yanıt ${chatReplyCount}`,
                    actions: chatReplyCount === 2 ? [{ type: 'inquiry' }] : [],
                    session_id: '11111111-1111-4111-8111-111111111111',
                    turn_id: chatReplyCount === 1 ? turnId1 : turnId2
                }, 200);
            }
            return createEmptyResponse(204);
        }
    });

    const questionsSection = doc.getElementById('questions');
    let scrollCalls = 0;
    questionsSection.scrollIntoView = () => {
        scrollCalls += 1;
    };

    const launcher = doc.getElementById('home-chatbot-launcher');
    const panel = doc.getElementById('home-chatbot-panel');
    launcher.click();

    // Turn 1: no initial inquiry action -> clicking Hayır reveals one.
    await submitQuestion(dom, doc, 'İlk soru');
    const reply1 = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    assert.equal(reply1.querySelector('.chatbot-action-inquiry'), null);

    reply1.querySelector('.chatbot-feedback-no').click();
    await flushPromises();

    assert.deepEqual(requests[1].body, { turn_id: turnId1, value: 'down' });
    assert.equal(reply1.querySelectorAll('.chatbot-feedback button').length, 0);
    assert.equal(
        reply1.querySelector('.chatbot-feedback-thanks')?.textContent.trim(),
        CHATBOT_MESSAGES.tr.feedbackThanks
    );
    const revealedInquiryBtns = reply1.querySelectorAll('.chatbot-action-inquiry');
    assert.equal(revealedInquiryBtns.length, 1);
    assert.equal(revealedInquiryBtns[0].textContent.trim(), CHATBOT_MESSAGES.tr.inquiryActionButton);

    // Clicking the revealed inquiry button uses the existing inquiry flow.
    revealedInquiryBtns[0].click();
    assert.equal(panel.hidden, true);
    assert.equal(scrollCalls, 1);
    assert.equal(doc.activeElement, doc.getElementById('inquiry-first-name'));

    // Turn 2: reply already has {type:'inquiry'} -> clicking Hayır must not duplicate it.
    launcher.click();
    await submitQuestion(dom, doc, 'İkinci soru');
    const reply2 = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    assert.equal(reply2.querySelectorAll('.chatbot-action-inquiry').length, 1);

    reply2.querySelector('.chatbot-feedback-no').click();
    await flushPromises();
    assert.equal(reply2.querySelectorAll('.chatbot-action-inquiry').length, 1);
});

test('feedback error re-enables buttons, shows neutral error, and allows retrying until 204 succeeds', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const turnId = '66666666-6666-4666-8666-666666666666';
    const feedbackPayloads = [];
    let feedbackAttempt = 0;

    const { dom, doc } = mountFeedbackDom(context, html, {
        locale: 'tr',
        fetcher: async (url, options) => {
            const parsed = JSON.parse(options.body);
            if (url === '/api/public/chat') {
                return createJsonResponse({
                    reply: 'Cevap metni.',
                    actions: [],
                    session_id: '11111111-1111-4111-8111-111111111111',
                    turn_id: turnId
                }, 200);
            }
            feedbackPayloads.push(parsed);
            feedbackAttempt += 1;
            if (feedbackAttempt === 1) {
                return createJsonResponse({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503);
            }
            if (feedbackAttempt === 2) {
                throw new Error('network failure');
            }
            return createEmptyResponse(204);
        }
    });

    doc.getElementById('home-chatbot-launcher').click();
    await submitQuestion(dom, doc, 'Test sorusu');

    const panel = doc.getElementById('home-chatbot-panel');
    const replyMsg = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    const yesBtn = replyMsg.querySelector('.chatbot-feedback-yes');
    const noBtn = replyMsg.querySelector('.chatbot-feedback-no');
    const errorEl = replyMsg.querySelector('.chatbot-feedback-error');

    // Attempt 1 (503) -> error shown, both buttons re-enabled.
    yesBtn.click();
    await flushPromises();
    assert.equal(errorEl.hidden, false);
    assert.equal(errorEl.textContent.trim(), CHATBOT_MESSAGES.tr.feedbackError);
    assert.equal(yesBtn.disabled, false);
    assert.equal(noBtn.disabled, false);

    // Attempt 2 (network error) -> still re-enabled, can change vote to "down".
    noBtn.click();
    await flushPromises();
    assert.equal(errorEl.hidden, false);
    assert.equal(yesBtn.disabled, false);
    assert.equal(noBtn.disabled, false);

    // Attempt 3 (204) -> buttons removed, thank-you shown, inquiry action revealed.
    noBtn.click();
    await flushPromises();
    assert.deepEqual(feedbackPayloads, [
        { turn_id: turnId, value: 'up' },
        { turn_id: turnId, value: 'down' },
        { turn_id: turnId, value: 'down' }
    ]);
    assert.equal(replyMsg.querySelectorAll('.chatbot-feedback button').length, 0);
    assert.equal(
        replyMsg.querySelector('.chatbot-feedback-thanks')?.textContent.trim(),
        CHATBOT_MESSAGES.tr.feedbackThanks
    );
    assert.ok(replyMsg.querySelector('.chatbot-action-inquiry'));
});

test('in-flight feedback request disables both buttons and blocks duplicate click', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const turnId = '77777777-7777-4777-8777-777777777777';
    let feedbackCalls = 0;
    let resolveFeedback = null;

    const { dom, doc } = mountFeedbackDom(context, html, {
        locale: 'tr',
        fetcher: async (url) => {
            if (url === '/api/public/chat') {
                return createJsonResponse({
                    reply: 'Cevap.',
                    actions: [],
                    session_id: '11111111-1111-4111-8111-111111111111',
                    turn_id: turnId
                }, 200);
            }
            feedbackCalls += 1;
            return new Promise((resolvePromise) => {
                resolveFeedback = resolvePromise;
            });
        }
    });

    doc.getElementById('home-chatbot-launcher').click();
    await submitQuestion(dom, doc, 'Soru');

    const panel = doc.getElementById('home-chatbot-panel');
    const replyMsg = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    const yesBtn = replyMsg.querySelector('.chatbot-feedback-yes');
    const noBtn = replyMsg.querySelector('.chatbot-feedback-no');

    yesBtn.click();
    assert.equal(feedbackCalls, 1);
    assert.equal(yesBtn.disabled, true);
    assert.equal(noBtn.disabled, true);

    yesBtn.click();
    noBtn.click();
    assert.equal(feedbackCalls, 1);

    resolveFeedback(createEmptyResponse(204));
    await flushPromises();
    assert.equal(replyMsg.querySelectorAll('.chatbot-feedback button').length, 0);
});

test('session_id from first response is sent with subsequent chat requests, never stored in browser storage, and resets on fresh mount', async (context) => {
    const html = await readWorkspaceFile('index.html');
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const chatRequests = [];

    const fetcher = async (url, options) => {
        const parsed = JSON.parse(options.body);
        chatRequests.push(parsed);
        const turnIndex = chatRequests.length;
        return createJsonResponse({
            reply: `Yanıt #${turnIndex}`,
            actions: [],
            session_id: turnIndex === 2 ? null : sessionId,
            turn_id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${turnIndex}`
        }, 200);
    };

    const { dom, doc, controller } = mountFeedbackDom(context, html, { locale: 'tr', fetcher });
    doc.getElementById('home-chatbot-launcher').click();

    await submitQuestion(dom, doc, 'Birinci soru');
    await submitQuestion(dom, doc, 'İkinci soru');
    await submitQuestion(dom, doc, 'Üçüncü soru');

    assert.equal(chatRequests.length, 3);
    assert.equal('session_id' in chatRequests[0], false, 'First request must not include session_id');
    assert.equal(chatRequests[1].session_id, sessionId, 'Second request must send session_id from first response');
    assert.equal(chatRequests[2].session_id, sessionId, 'Existing session_id must be preserved if a response returns session_id:null');

    assert.equal(dom.window.localStorage.length, 0);
    assert.equal(dom.window.sessionStorage.length, 0);
    assert.equal(doc.cookie, '');

    // Fresh mount (page reload simulation) starts without session_id.
    controller.destroy();
    const freshController = initHomeChatbot({ locale: 'tr', root: doc, fetcher });
    context.after(() => freshController.destroy());
    doc.getElementById('home-chatbot-launcher').click();
    await submitQuestion(dom, doc, 'Yenileme sonrası soru');

    assert.equal(chatRequests.length, 4);
    assert.equal('session_id' in chatRequests[3], false, 'Fresh mount must start without session_id');
});

test('feedback row updates labels and aria-labels across all five locales including RTL ar', async (context) => {
    const html = await readWorkspaceFile('index.html');

    const { dom, doc, controller } = mountFeedbackDom(context, html, {
        locale: 'tr',
        fetcher: async () => createJsonResponse({
            reply: 'Test answer.',
            actions: [],
            session_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
        }, 200)
    });

    doc.getElementById('home-chatbot-launcher').click();
    await submitQuestion(dom, doc, 'Question');

    const panel = doc.getElementById('home-chatbot-panel');
    const replyMsg = [...panel.querySelectorAll('.chatbot-message-assistant')].at(-1);
    const feedbackRow = replyMsg.querySelector('.chatbot-feedback');
    const promptEl = feedbackRow.querySelector('.chatbot-feedback-prompt');
    const yesBtn = feedbackRow.querySelector('.chatbot-feedback-yes');
    const noBtn = feedbackRow.querySelector('.chatbot-feedback-no');

    for (const locale of SUPPORTED_LOCALES) {
        controller.setLocale(locale);
        assert.equal(panel.getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
        assert.equal(promptEl.textContent.trim(), CHATBOT_MESSAGES[locale].feedbackPrompt);
        assert.equal(feedbackRow.getAttribute('aria-label'), CHATBOT_MESSAGES[locale].feedbackPrompt);
        assert.equal(yesBtn.textContent.trim(), CHATBOT_MESSAGES[locale].feedbackYes);
        assert.equal(noBtn.textContent.trim(), CHATBOT_MESSAGES[locale].feedbackNo);
        assert.equal(yesBtn.getAttribute('aria-label'), CHATBOT_MESSAGES[locale].feedbackYesAriaLabel);
        assert.equal(noBtn.getAttribute('aria-label'), CHATBOT_MESSAGES[locale].feedbackNoAriaLabel);
    }

    // Verify public:locale-changed event also updates the thank-you text.
    doc.documentElement.lang = 'ar';
    doc.documentElement.dir = 'rtl';
    doc.dispatchEvent(new dom.window.Event('public:locale-changed'));
    assert.equal(panel.getAttribute('dir'), 'rtl');
    assert.equal(yesBtn.textContent.trim(), CHATBOT_MESSAGES.ar.feedbackYes);
    assert.equal(noBtn.textContent.trim(), CHATBOT_MESSAGES.ar.feedbackNo);
});

test('chatbot.css defines 44px mobile touch targets, focus-visible ring, and reduced-motion rules for feedback buttons, and homeChatbot.js uses no innerHTML', async () => {
    const [css, js] = await Promise.all([
        readWorkspaceFile('src/public/chatbot.css'),
        readWorkspaceFile('src/public/homeChatbot.js')
    ]);

    assert.match(css, /\.chatbot-feedback-btn:focus-visible/, 'Feedback buttons must have a visible focus ring');
    assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*\.chatbot-feedback-btn[\s\S]*min-block-size:\s*44px/, 'Feedback buttons must have >=44px block touch target on mobile');
    assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*\.chatbot-feedback-btn[\s\S]*min-inline-size:\s*44px/, 'Feedback buttons must have >=44px inline touch target on mobile');
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.chatbot-feedback-btn/, 'Feedback buttons must disable transitions under prefers-reduced-motion');
    assert.equal(/\.innerHTML\b/.test(js), false, 'homeChatbot.js must render text strictly via textContent');
});
