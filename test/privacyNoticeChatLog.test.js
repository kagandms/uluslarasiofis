/**
 * Tests for Task 4D: chat-logging privacy notice paragraph in the first-visit modal
 * and chat-logging facts in the chatbot knowledge `privacy` topic across all 5 languages.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    initializePrivacyNoticeModal,
    OFFICIAL_NOTICE_URL
} from '../src/public/privacyNoticeModal.js';
import {
    CHATBOT_LANGUAGES,
    readKnowledge
} from '../src/server/domain/chatbotKnowledge.js';

const EXPECTED_TR_CHAT_LOG_NOTICE =
    'Asistanla yaptığınız sohbetler hizmeti geliştirmek için kaydedilir ve Uluslararası Ofis personeli tarafından okunabilir. Lütfen sohbete kimlik, pasaport veya telefon numarası yazmayın.';

/**
 * Mounts a minimal JSDOM home page with the privacy notice trigger and polyfills `<dialog>`.
 * @param {import('node:test').TestContext} context Node test context for cleanup.
 * @param {{locale?: string, acknowledgedVersion?: string | null}} [options]
 * @returns {{dom: JSDOM, doc: Document, showModalCalls: number[], closeCalls: number[]}}
 */
function mountPrivacyModalDom(context, { locale = 'tr', acknowledgedVersion = null } = {}) {
    const dom = new JSDOM(
        `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><body>
            <select id="locale-select">
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
                <option value="tk">Türkmençe</option>
                <option value="ar">العربية</option>
            </select>
            <button type="button" id="btn-privacy-notice">KVKK</button>
        </body></html>`,
        { url: 'https://portal.test/' }
    );

    const showModalCalls = [];
    const closeCalls = [];
    const dialogProto = dom.window.HTMLDialogElement?.prototype || dom.window.HTMLElement.prototype;
    dialogProto.showModal = function showModal() {
        this.setAttribute('open', '');
        showModalCalls.push(1);
    };
    dialogProto.close = function close() {
        this.removeAttribute('open');
        closeCalls.push(1);
        this.dispatchEvent(new dom.window.Event('close'));
    };

    if (acknowledgedVersion !== null) {
        dom.window.localStorage.setItem('portal.privacy-notice.acknowledged', acknowledgedVersion);
    }

    const previousWindow = globalThis.window;
    globalThis.window = dom.window;
    context.after(() => {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
        dom.window.close();
    });

    initializePrivacyNoticeModal();
    return { dom, doc: dom.window.document, showModalCalls, closeCalls };
}

test('privacy notice modal renders the chat-logging paragraph in all five languages with RTL for ar', (context) => {
    const { doc } = mountPrivacyModalDom(context, { locale: 'tr' });
    const dialog = doc.getElementById('privacy-notice-dialog');
    assert.ok(dialog, 'Expected #privacy-notice-dialog to be rendered');

    const chatLogParagraph = dialog.querySelector('p.privacy-notice-chat-log');
    assert.ok(chatLogParagraph, 'Expected separate p.privacy-notice-chat-log paragraph inside dialog');
    assert.equal(chatLogParagraph.textContent, EXPECTED_TR_CHAT_LOG_NOTICE);
    assert.equal(dialog.dir, 'ltr');

    const expectedPatterns = {
        tr: {
            storage: /kaydedilir/i,
            staff: /Uluslararası Ofis personeli/i,
            noPii: /kimlik.*pasaport.*telefon/i
        },
        en: {
            storage: /stored/i,
            staff: /International Office staff/i,
            noPii: /ID.*passport.*phone/i
        },
        ru: {
            storage: /сохраняются/i,
            staff: /сотрудниками Международного офиса/i,
            noPii: /удостоверения личности.*паспорта.*телефона/i
        },
        tk: {
            storage: /ýazdyrylýar/i,
            staff: /Halkara Ofisiň işgärleri/i,
            noPii: /şahsyýet.*pasport.*telefon/i
        },
        ar: {
            storage: /تُحفظ/,
            staff: /موظفي المكتب الدولي/,
            noPii: /الهوية.*جواز السفر.*الهاتف/
        }
    };

    for (const locale of CHATBOT_LANGUAGES) {
        const langButton = dialog.querySelector(`button.privacy-notice-language[data-locale="${locale}"]`);
        assert.ok(langButton, `Expected language button for ${locale}`);
        langButton.click();

        const text = chatLogParagraph.textContent.trim();
        assert.ok(text.length > 30, `${locale} chat-log paragraph must be non-empty`);
        assert.equal(dialog.lang, locale);
        assert.equal(dialog.dir, locale === 'ar' ? 'rtl' : 'ltr');
        assert.match(text, expectedPatterns[locale].storage, `${locale} must mention chat storage`);
        assert.match(text, expectedPatterns[locale].staff, `${locale} must mention office staff access`);
        assert.match(text, expectedPatterns[locale].noPii, `${locale} must warn against ID/passport/phone numbers`);
    }
});

test('privacy notice modal keeps acceptance checkbox, continue button, storage, and reopen flow unchanged', (context) => {
    const { dom, doc, showModalCalls, closeCalls } = mountPrivacyModalDom(context, { locale: 'tr' });
    const dialog = doc.getElementById('privacy-notice-dialog');
    const checkbox = dialog.querySelector('input[type="checkbox"]');
    const continueButton = dialog.querySelector('button.privacy-notice-continue');
    const fullNoticeLink = dialog.querySelector('a.privacy-notice-full-link');

    assert.equal(showModalCalls.length, 1, 'First visit must open modal automatically');
    assert.equal(dialog.hasAttribute('open'), true);
    assert.equal(checkbox.checked, false);
    assert.equal(continueButton.disabled, true);
    assert.equal(fullNoticeLink.href, OFFICIAL_NOTICE_URL);
    assert.equal(OFFICIAL_NOTICE_URL, 'https://www.topkapi.edu.tr/tr-TR/gizlilik-politikasi/13455');

    // Escape / cancel must stay blocked.
    const cancelEvent = new dom.window.Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    assert.equal(cancelEvent.defaultPrevented, true);

    // Clicking continue while unchecked does nothing.
    continueButton.click();
    assert.equal(closeCalls.length, 0);
    assert.equal(dom.window.localStorage.getItem('portal.privacy-notice.acknowledged'), null);

    // Checking enables continue; clicking saves acknowledgement and closes dialog.
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(continueButton.disabled, false);

    continueButton.click();
    assert.equal(closeCalls.length, 1);
    assert.equal(dialog.hasAttribute('open'), false);
    assert.equal(
        dom.window.localStorage.getItem('portal.privacy-notice.acknowledged'),
        'topkapi-privacy-summary-v1'
    );
    assert.equal(checkbox.checked, false);
    assert.equal(continueButton.disabled, true);

    // Clicking footer button reopens modal.
    doc.getElementById('btn-privacy-notice').click();
    assert.equal(showModalCalls.length, 2);
    assert.equal(dialog.hasAttribute('open'), true);
});

test('privacy notice modal does not auto-open when already acknowledged', (context) => {
    const { doc, showModalCalls } = mountPrivacyModalDom(context, {
        locale: 'en',
        acknowledgedVersion: 'topkapi-privacy-summary-v1'
    });
    const dialog = doc.getElementById('privacy-notice-dialog');
    assert.ok(dialog);
    assert.equal(showModalCalls.length, 0);
    assert.equal(dialog.hasAttribute('open'), false);
});

test('privacyNoticeModal.js marks draft chat-log notice strings with the DRAFT convention', () => {
    const source = fs.readFileSync(
        new URL('../src/public/privacyNoticeModal.js', import.meta.url),
        'utf8'
    );
    const draftMatches = source.match(/\/\/ DRAFT: needs office approval/g) || [];
    assert.ok(
        draftMatches.length >= CHATBOT_LANGUAGES.length,
        'Expected // DRAFT: needs office approval comment on every language chatLogNotice entry'
    );
});

test('chatbot knowledge privacy topic mentions chat storage until deletion, staff access, and no-PII warning in all five languages', () => {
    const expectations = {
        tr: {
            storage: /personel silene kadar saklanır/i,
            staff: /yetkili ofis personeli tarafından okunabilir/i,
            noPii: /kimlik.*pasaport.*telefon/i
        },
        en: {
            storage: /stored.*until staff delete them/i,
            staff: /authorized office staff/i,
            noPii: /ID.*passport.*phone/i
        },
        ru: {
            storage: /сохраняются.*до удаления сотрудниками/i,
            staff: /уполномоченным персоналом офиса/i,
            noPii: /паспорта.*удостоверения.*телефона/i
        },
        tk: {
            storage: /işgärler pozýança saklanýar/i,
            staff: /ygtyýarly ofis işgärleri/i,
            noPii: /şahsyýet.*pasport.*telefon/i
        },
        ar: {
            storage: /تُحفظ محادثاتك.*حتى يحذفها الموظفون/,
            staff: /موظفي المكتب المخولين/,
            noPii: /الهوية.*جواز السفر.*الهاتف/
        }
    };

    for (const language of CHATBOT_LANGUAGES) {
        const { text } = readKnowledge('privacy', language);
        assert.ok([...text].length <= 700, `privacy/${language} must remain within 700 chars (got ${[...text].length})`);
        assert.match(text, expectations[language].storage, `privacy/${language} must state chats are stored until staff delete them`);
        assert.match(text, expectations[language].staff, `privacy/${language} must state authorized office staff can read chats`);
        assert.match(text, expectations[language].noPii, `privacy/${language} must warn against sharing ID/passport/phone numbers`);
    }
});
