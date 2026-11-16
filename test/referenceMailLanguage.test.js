import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../src/config/constants.js';
import { generateAccessCode } from '../src/server/auth/applicationAccessCode.js';
import { buildRecoveryMail, buildReferenceMail } from '../src/server/services/referenceMailService.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TEST_APPLICATION_PRIVACY_NOTICE, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const TOKEN = 't'.repeat(40);
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbTestLanguage/exec';
const PORTAL_CANONICAL_ORIGIN = 'https://portal.test';
const PORTAL_URL = 'https://portal.test/basvurum/';
const DIRECTION_CONTROL_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

const GREETINGS = Object.freeze({
    tr: 'Merhaba,',
    en: 'Hello,',
    ru: 'Здравствуйте!',
    tk: 'Salam,',
    ar: 'مرحبًا،'
});

const DRAFT_MARKERS = Object.freeze({
    tr: { subject: 'Başvuru taslağınız kaydedildi', typeLabel: 'Yenileme' },
    en: { subject: 'Application draft saved', typeLabel: 'Renewal' },
    ru: { subject: 'Черновик заявки сохранён', typeLabel: 'Продление' },
    tk: { subject: 'Arzaňyzyň taslamasy saklandy', typeLabel: 'Täzeleme' },
    ar: { subject: 'تم حفظ مسودة طلبك', typeLabel: 'تجديد' }
});

const RECOVERY_MARKERS = Object.freeze({
    tr: { subject: 'Başvuru erişim kodunuz yenilendi', ignore: /yok sayabilirsiniz/u, spam: /gereksiz \(spam\)/u },
    en: { subject: 'Your application access code has been reset', ignore: /safely ignore/u, spam: /spam or junk/u },
    ru: { subject: 'Код доступа к вашей заявке обновлён', ignore: /проигнорируйте/u, spam: /«Спам»/u },
    tk: { subject: 'Arzaňyzyň giriş kody täzelendi', ignore: /üns bermän/u, spam: /gereksiz \(spam\)/u },
    ar: { subject: 'تم تجديد رمز الدخول لطلبك', ignore: /تجاهل هذا البريد/u, spam: /\(Spam\)/u }
});

test('buildReferenceMail renders single-language subject and body for each of the 5 supported languages', () => {
    for (const locale of ['tr', 'en', 'ru', 'tk', 'ar']) {
        const mail = buildReferenceMail({
            referenceNumber: 'ITU-7K9M-4X2P',
            studentNumber: 'SYN-LANG-001',
            applicationType: 'renewal',
            portalUrl: PORTAL_URL,
            language: locale
        });
        assert.equal(mail.subject, DRAFT_MARKERS[locale].subject);
        assert.equal(mail.text.includes('---'), false, `${locale} must not include multi-language separator`);
        assert.ok(mail.text.includes(GREETINGS[locale]), `${locale} greeting missing`);
        assert.ok(mail.text.includes(DRAFT_MARKERS[locale].typeLabel), `${locale} type label missing`);
        assert.ok(mail.text.includes('ITU-7K9M-4X2P'));
        assert.ok(mail.text.includes('SYN-LANG-001'));
        assert.ok(mail.text.includes(PORTAL_URL));
        assert.doesNotMatch(mail.text, DIRECTION_CONTROL_MARKS);
        for (const [otherLocale, otherGreeting] of Object.entries(GREETINGS)) {
            if (otherLocale !== locale) {
                assert.equal(mail.text.includes(otherGreeting), false, `${locale} leaked ${otherLocale}`);
            }
        }
    }
});

test('buildReferenceMail falls back to five-language body and default subject when language is missing or invalid', () => {
    for (const invalidLanguage of [undefined, null, '', 'fr', 'TR', 'de', 123, {}]) {
        const mail = buildReferenceMail({
            referenceNumber: 'ITU-7K9M-4X2P',
            studentNumber: 'SYN-LANG-002',
            applicationType: 'initial',
            portalUrl: PORTAL_URL,
            language: invalidLanguage
        });
        assert.equal(mail.subject, 'Başvuru taslağınız kaydedildi · Application draft saved');
        assert.equal(mail.text.split('\n\n---\n\n').length, 5);
        for (const greeting of Object.values(GREETINGS)) {
            assert.ok(mail.text.includes(greeting));
        }
    }
});

test('buildRecoveryMail renders single-language plain text with new code, ignore warning and spam note for all 5 languages', () => {
    const accessCode = generateAccessCode();
    for (const locale of ['tr', 'en', 'ru', 'tk', 'ar']) {
        const mail = buildRecoveryMail({
            referenceNumber: 'ITU-7K9M-4X2P',
            studentNumber: 'SYN-REC-001',
            accessCode,
            portalUrl: PORTAL_URL,
            language: locale
        });
        assert.equal(mail.subject, RECOVERY_MARKERS[locale].subject);
        assert.equal(mail.text.includes('---'), false, `${locale} recovery mail must be single-language`);
        assert.ok(mail.text.includes(GREETINGS[locale]));
        assert.ok(mail.text.includes('ITU-7K9M-4X2P'));
        assert.ok(mail.text.includes('SYN-REC-001'));
        assert.ok(mail.text.includes(accessCode));
        assert.ok(mail.text.includes(PORTAL_URL));
        assert.match(mail.text, RECOVERY_MARKERS[locale].ignore);
        assert.match(mail.text, RECOVERY_MARKERS[locale].spam);
        assert.doesNotMatch(mail.text, DIRECTION_CONTROL_MARKS);
        assert.doesNotMatch(mail.subject, DIRECTION_CONTROL_MARKS);
        assert.doesNotMatch(mail.text, /<html|<body|<a\s+href|bit\.ly|tinyurl/i);
        for (const [otherLocale, otherGreeting] of Object.entries(GREETINGS)) {
            if (otherLocale !== locale) {
                assert.equal(mail.text.includes(otherGreeting), false, `${locale} leaked ${otherLocale}`);
            }
        }
    }
});

test('buildRecoveryMail falls back to five-language combined body and bilingual subject when language is missing or invalid', () => {
    const accessCode = generateAccessCode();
    for (const invalidLanguage of [undefined, null, '', 'es', 'AR', 42]) {
        const mail = buildRecoveryMail({
            referenceNumber: 'ITU-7K9M-4X2P',
            studentNumber: 'SYN-REC-002',
            accessCode,
            portalUrl: PORTAL_URL,
            language: invalidLanguage
        });
        assert.equal(mail.subject, 'Başvuru erişim kodunuz yenilendi · Application access code reset');
        assert.equal(mail.text.split('\n\n---\n\n').length, 5);
        for (const greeting of Object.values(GREETINGS)) {
            assert.ok(mail.text.includes(greeting));
        }
        assert.equal(mail.text.split(accessCode).length - 1, 5);
    }
});

function createMailRouteEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const sentMails = [];
    const environment = {
        DB: database,
        PUBLIC_APPLICATION_PRIVACY_NOTICE: TEST_APPLICATION_PRIVACY_NOTICE,
        REFERENCE_MAIL_TOKEN: TOKEN,
        REFERENCE_MAIL_ENDPOINT: ENDPOINT,
        PORTAL_CANONICAL_ORIGIN,
        REFERENCE_MAIL_FETCH: async (_url, init) => {
            sentMails.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
    };
    return { database, environment, sentMails };
}

async function createDraftWithSession(environment, studentNumber, language) {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.70' },
        body: JSON.stringify(withTestApplicationPrivacyNoticeVersion({
            student_number: studentNumber,
            application_type: 'initial',
            email: `${studentNumber.toLowerCase()}@example.invalid`,
            phone: '+905550001122',
            ...(language === undefined ? {} : { language })
        }))
    }), environment, {});
    assert.equal(response.status, 201);
    return {
        response,
        cookie: response.headers.get('Set-Cookie').split(';')[0]
    };
}

function postContactAcknowledgement(environment, cookie, body, ip = '198.51.100.71') {
    return worker.fetch(new Request('https://portal.test/api/public/applications/current/contact-acknowledgement', {
        method: 'POST',
        headers: {
            Origin: 'https://portal.test',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': ip,
            Cookie: cookie
        },
        body: JSON.stringify(body)
    }), environment, {});
}

test('draft creation sends no mail; contact acknowledgement with language ru sends Russian-only mail without storing language', async () => {
    const { environment, sentMails } = createMailRouteEnvironment();

    await createDraftWithSession(environment, 'LANG-DRAFT-NONE');
    const { cookie: ruCookie } = await createDraftWithSession(environment, 'LANG-DRAFT-RU', 'ru');
    // Taslak oluşturma adımında e-posta gönderilmemeli; dil alanı verilse bile yalnızca onayda gönderilir.
    assert.equal(sentMails.length, 0);

    const ackResponse = await postContactAcknowledgement(environment, ruCookie, {
        accepted: true,
        version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
        language: 'ru'
    });
    assert.equal(ackResponse.status, 200);
    const ackPayload = await ackResponse.json();
    assert.equal(ackPayload.application.contact_acknowledgement.accepted_current, true);
    assert.equal(ackPayload.application.language, undefined);

    assert.equal(sentMails.length, 1);
    assert.equal(sentMails[0].to, 'lang-draft-ru@example.invalid');
    assert.equal(sentMails[0].subject, 'Черновик заявки сохранён');
    assert.ok(sentMails[0].text.includes('Здравствуйте!'));
    assert.equal(sentMails[0].text.includes('Merhaba,'), false);
    assert.equal(sentMails[0].text.includes('---'), false);
    assert.doesNotMatch(sentMails[0].text, DIRECTION_CONTROL_MARKS);
});

test('contact acknowledgement without language or with unknown language string keeps combined five-language mail', async () => {
    const { environment, sentMails } = createMailRouteEnvironment();

    const { cookie: omittedCookie } = await createDraftWithSession(environment, 'LANG-ACK-OMIT');
    const { cookie: invalidStrCookie } = await createDraftWithSession(environment, 'LANG-ACK-INVALID');
    assert.equal(sentMails.length, 0);

    const omittedResponse = await postContactAcknowledgement(environment, omittedCookie, {
        accepted: true,
        version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION
    });
    assert.equal(omittedResponse.status, 200);
    assert.equal(sentMails.length, 1);
    assert.equal(sentMails[0].subject, 'Başvuru taslağınız kaydedildi · Application draft saved');
    assert.equal(sentMails[0].text.split('\n\n---\n\n').length, 5);

    const invalidStrResponse = await postContactAcknowledgement(environment, invalidStrCookie, {
        accepted: true,
        version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
        language: 'xx'
    }, '198.51.100.72');
    assert.equal(invalidStrResponse.status, 200);
    assert.equal(sentMails.length, 2);
    assert.equal(sentMails[1].subject, 'Başvuru taslağınız kaydedildi · Application draft saved');
    assert.equal(sentMails[1].text.split('\n\n---\n\n').length, 5);
});

test('contact acknowledgement rejects non-string language and unknown extra keys with 400', async () => {
    const { environment, sentMails } = createMailRouteEnvironment();
    const { cookie } = await createDraftWithSession(environment, 'LANG-ACK-REJECT');
    assert.equal(sentMails.length, 0);

    for (const nonStringLanguage of [123, null, true, {}, []]) {
        const res = await postContactAcknowledgement(environment, cookie, {
            accepted: true,
            version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
            language: nonStringLanguage
        });
        assert.equal(res.status, 400);
        const payload = await res.json();
        assert.equal(payload.error?.code, 'CONTACT_ACKNOWLEDGEMENT_REQUIRED');
    }

    const extraKeyRes = await postContactAcknowledgement(environment, cookie, {
        accepted: true,
        version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
        extra: 'unexpected'
    });
    assert.equal(extraKeyRes.status, 400);
    assert.equal((await extraKeyRes.json()).error?.code, 'CONTACT_ACKNOWLEDGEMENT_REQUIRED');

    const extraWithLanguageRes = await postContactAcknowledgement(environment, cookie, {
        accepted: true,
        version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
        language: 'ru',
        extra: 'unexpected'
    });
    assert.equal(extraWithLanguageRes.status, 400);
    assert.equal((await extraWithLanguageRes.json()).error?.code, 'CONTACT_ACKNOWLEDGEMENT_REQUIRED');

    assert.equal(sentMails.length, 0);
});
