import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { consumeReferenceReminderMailQuota } from '../src/server/services/accessRecoveryService.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TEST_APPLICATION_PRIVACY_NOTICE, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const TOKEN = 't'.repeat(40);
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbTestRecovery/exec';
const PORTAL_CANONICAL_ORIGIN = 'https://portal.test';
const ACCESS_CODE_PATTERN = /[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{6}/;
const EXPECTED_MAIL_SUBJECTS = Object.freeze({
    tr: 'Başvuru numaranız',
    en: 'Your application number',
    ru: 'Номер вашей заявки',
    tk: 'Arza belgiňiz',
    ar: 'رقم طلبك'
});

function createTestEnvironment(overrides = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const sentMails = [];
    const fetchResults = overrides.fetchResults ? [...overrides.fetchResults] : [];
    const environment = {
        DB: database,
        PUBLIC_APPLICATION_PRIVACY_NOTICE: TEST_APPLICATION_PRIVACY_NOTICE,
        REFERENCE_MAIL_TOKEN: TOKEN,
        REFERENCE_MAIL_ENDPOINT: ENDPOINT,
        PORTAL_CANONICAL_ORIGIN,
        REFERENCE_MAIL_FETCH: async (_url, init) => {
            sentMails.push(JSON.parse(init.body));
            const next = fetchResults.shift() ?? { ok: true };
            if (next instanceof Error) throw next;
            return new Response(JSON.stringify(next.body ?? next), { status: next.status ?? 200 });
        },
        ...overrides
    };
    return { database, environment, sentMails };
}

function makeRequest(path, { method = 'GET', body, origin = 'https://portal.test', ip = '198.51.100.1', cookie } = {}) {
    const headers = new Headers({ 'CF-Connecting-IP': ip });
    if (origin) headers.set('Origin', origin);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function createApplicant(environment, studentNumber, ip = '198.51.100.2') {
    const response = await worker.fetch(makeRequest('/api/public/applications', {
        method: 'POST',
        ip,
        body: withTestApplicationPrivacyNoticeVersion({
            student_number: studentNumber,
            application_type: 'initial',
            email: `${studentNumber.toLowerCase()}@example.invalid`,
            phone: '+905550002233'
        })
    }), environment, {});
    assert.equal(response.status, 201);
    const payload = await response.json();
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    return {
        cookie,
        referenceNumber: payload.reference_number,
        accessCode: payload.access_code
    };
}

test('GET /api/application-recovery/options reflects TELEGRAM_BOT_USERNAME and enforces GET', async () => {
    const { environment } = createTestEnvironment();

    const disabledResponse = await worker.fetch(makeRequest('/api/application-recovery/options'), environment, {});
    const disabledPayload = await disabledResponse.json();
    assert.equal(disabledResponse.status, 200);
    assert.equal(disabledPayload.email, true);
    assert.deepEqual(disabledPayload.telegram, { enabled: false, url: null });

    const enabledEnv = { ...environment, TELEGRAM_BOT_USERNAME: '@TopkapiTestBot' };
    const enabledResponse = await worker.fetch(makeRequest('/api/application-recovery/options'), enabledEnv, {});
    const enabledPayload = await enabledResponse.json();
    assert.equal(enabledResponse.status, 200);
    assert.equal(enabledPayload.email, true);
    assert.deepEqual(enabledPayload.telegram, {
        enabled: true,
        url: 'https://t.me/TopkapiTestBot?start=recover'
    });

    const wrongMethod = await worker.fetch(makeRequest('/api/application-recovery/options', { method: 'POST', body: {} }), environment, {});
    assert.equal(wrongMethod.status, 405);
});

test('POST /api/application-recovery/email enforces method, same-origin and student_number validation', async () => {
    const { environment } = createTestEnvironment();

    assert.equal((await worker.fetch(makeRequest('/api/application-recovery/email', { method: 'GET' }), environment, {})).status, 405);
    assert.equal((await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST', origin: 'https://attacker.test', body: { student_number: 'SYN-01' }
    }), environment, {})).status, 403);
    assert.equal((await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST', body: { student_number: '   ' }
    }), environment, {})).status, 400);
});

test('POST /api/application-recovery/email sends existing reference number without rotating code across all 5 languages and hides unknown records', async () => {
    const { database, environment, sentMails } = createTestEnvironment();

    const unknownResponse = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.12',
        body: { student_number: 'SYN-NOT-FOUND', language: 'en' }
    }), environment, {});
    const unknownPayload = await unknownResponse.json();
    assert.equal(unknownResponse.status, 202);
    assert.equal(unknownPayload.ok, true);
    assert.equal(sentMails.length, 0);

    for (const [index, locale] of ['tr', 'en', 'ru', 'tk', 'ar'].entries()) {
        const studentNumber = `SYN-REC-LANG-${locale.toUpperCase()}`;
        const { cookie, referenceNumber, accessCode: initialCode } = await createApplicant(
            environment,
            studentNumber,
            `198.51.100.${100 + index}`
        );
        const beforeRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE reference_number = ?')
            .bind(referenceNumber).first();

        const response = await worker.fetch(makeRequest('/api/application-recovery/email', {
            method: 'POST',
            ip: `198.51.100.${120 + index}`,
            body: { student_number: studentNumber.toLowerCase(), language: locale }
        }), environment, {});
        const payload = await response.json();
        assert.equal(response.status, 202);
        assert.deepEqual(Object.keys(payload).sort(), Object.keys(unknownPayload).sort());
        assert.equal(payload.ok, true);

        assert.equal(sentMails.length, index + 1);
        const sentMail = sentMails[index];
        assert.equal(sentMail.to, `${studentNumber.toLowerCase()}@example.invalid`);
        assert.equal(sentMail.subject, EXPECTED_MAIL_SUBJECTS[locale]);
        assert.ok(sentMail.text.includes(referenceNumber));
        assert.ok(sentMail.text.includes(studentNumber.toLowerCase()));
        assert.ok(sentMail.text.includes('https://portal.test/basvuruya-devam-et/'));
        assert.doesNotMatch(sentMail.text, ACCESS_CODE_PATTERN);

        // Başvurunun erişim kodu özeti ve sürümü değişmemiş olmalıdır.
        const afterRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE reference_number = ?')
            .bind(referenceNumber).first();
        assert.equal(afterRow.access_code_hash, beforeRow.access_code_hash);
        assert.equal(afterRow.access_code_version, beforeRow.access_code_version);

        // İlk erişim kodu ve açık oturum hâlâ geçerli olmalıdır.
        const accessCheck = await worker.fetch(makeRequest('/api/public/applications/access', {
            method: 'POST',
            ip: `198.51.100.${140 + index}`,
            body: { reference_number: referenceNumber, access_code: initialCode }
        }), environment, {});
        assert.equal(accessCheck.status, 200);
        const sessionCheck = await worker.fetch(makeRequest('/api/public/applications/current/status', { cookie }), environment, {});
        assert.equal(sessionCheck.status, 200);
    }

    assert.equal(
        database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.access_code_recovered'").first().count,
        0
    );

    // Terminal başvuruda yanıt yine 202 olur ama mail atılmaz.
    const terminalStudent = 'SYN-REC-TERM-1';
    const { referenceNumber: terminalRef } = await createApplicant(environment, terminalStudent, '198.51.100.160');
    database.prepare("UPDATE applications SET status = 'completed' WHERE reference_number = ?").bind(terminalRef).run();
    const terminalResponse = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.161',
        body: { student_number: terminalStudent, language: 'tr' }
    }), environment, {});
    assert.equal(terminalResponse.status, 202);
    assert.equal(sentMails.length, 5);
});

test('POST /api/application-recovery/email falls back to five-language mail when language is invalid', async () => {
    const { environment, sentMails } = createTestEnvironment();
    const { referenceNumber } = await createApplicant(environment, 'SYN-REC-LANG', '198.51.100.20');
    assert.equal(sentMails.length, 0);

    const response = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.21',
        body: { student_number: 'SYN-REC-LANG', language: 'xx' }
    }), environment, {});

    assert.equal(response.status, 202);
    assert.equal(sentMails.length, 1);
    assert.equal(sentMails[0].subject, 'Başvuru numaranız · Application number');
    assert.equal(sentMails[0].text.split('\n\n---\n\n').length, 5);
    assert.ok(sentMails[0].text.includes(referenceNumber));
    assert.ok(sentMails[0].text.includes('https://portal.test/basvuruya-devam-et/'));
    assert.doesNotMatch(sentMails[0].text, ACCESS_CODE_PATTERN);
});

test('POST /api/application-recovery/email enforces 3/day per-application and 5/15m per-IP limits while still returning 202', async () => {
    const { database, environment, sentMails } = createTestEnvironment();
    const { referenceNumber } = await createApplicant(environment, 'SYN-REC-LIMIT-1', '198.51.100.30');
    await createApplicant(environment, 'SYN-REC-LIMIT-2', '198.51.100.31');
    const beforeRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE reference_number = ?')
        .bind(referenceNumber).first();
    assert.equal(sentMails.length, 0);

    // Aynı başvuru için 3 hatırlatma (farklı IP'lerden) başarılı, 4. istek 202 döner ama mail atmaz.
    for (let i = 0; i < 3; i += 1) {
        const res = await worker.fetch(makeRequest('/api/application-recovery/email', {
            method: 'POST',
            ip: `198.51.100.${40 + i}`,
            body: { student_number: 'SYN-REC-LIMIT-1', language: 'tr' }
        }), environment, {});
        assert.equal(res.status, 202);
    }
    assert.equal(sentMails.length, 3);
    assert.doesNotMatch(sentMails[2].text, ACCESS_CODE_PATTERN);

    const fourthRes = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.49',
        body: { student_number: 'SYN-REC-LIMIT-1', language: 'tr' }
    }), environment, {});
    assert.equal(fourthRes.status, 202);
    assert.equal(sentMails.length, 3);

    const afterRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE reference_number = ?')
        .bind(referenceNumber).first();
    assert.equal(afterRow.access_code_hash, beforeRow.access_code_hash);
    assert.equal(afterRow.access_code_version, beforeRow.access_code_version);

    // Aynı IP'den 5 istek sonrası 6. istek (başka geçerli öğrenci için bile) 202 döner ama mail atmaz.
    const sharedIp = '198.51.100.60';
    for (let i = 0; i < 5; i += 1) {
        const res = await worker.fetch(makeRequest('/api/application-recovery/email', {
            method: 'POST',
            ip: sharedIp,
            body: { student_number: `SYN-UNKNOWN-${i}` }
        }), environment, {});
        assert.equal(res.status, 202);
    }
    const sixthSameIp = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: sharedIp,
        body: { student_number: 'SYN-REC-LIMIT-2', language: 'tr' }
    }), environment, {});
    assert.equal(sixthSameIp.status, 202);
    assert.equal(sentMails.length, 3);
});

test('POST /api/application-recovery/email stops sending when 30-mail global counter is exhausted and still returns 202', async () => {
    const { database, environment, sentMails } = createTestEnvironment();
    const { referenceNumber } = await createApplicant(environment, 'SYN-REC-QUOTA', '198.51.100.70');
    const beforeRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE reference_number = ?')
        .bind(referenceNumber).first();
    assert.equal(sentMails.length, 0);

    const { rateLimits } = createD1Repositories(database);
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Küresel sabit penceredeki 30 kotanın 29'unu doldur; 30. istek gitmeli, 31. engellenmelidir.
    for (let i = 0; i < 29; i += 1) {
        await consumeReferenceReminderMailQuota(rateLimits, { nowSeconds });
    }

    // Kayıt dışı öğrenci aramaları küresel 30/gün e-posta kotasını tüketmemelidir.
    const unknownBefore = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.71',
        body: { student_number: 'SYN-UNKNOWN-NO-QUOTA-BURN', language: 'tr' }
    }), environment, {});
    assert.equal(unknownBefore.status, 202);
    assert.equal(sentMails.length, 0);

    // 30. e-posta gönderilmelidir.
    const thirtieth = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.72',
        body: { student_number: 'SYN-REC-QUOTA', language: 'tr' }
    }), environment, {});
    assert.equal(thirtieth.status, 202);
    assert.equal(sentMails.length, 1);
    assert.ok(sentMails[0].text.includes(referenceNumber));
    assert.doesNotMatch(sentMails[0].text, ACCESS_CODE_PATTERN);

    // 31. istek kotaya takılmalı: 202 döner, yeni mail gitmez, erişim kodu değişmez.
    const thirtyFirst = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.73',
        body: { student_number: 'SYN-REC-QUOTA', language: 'tr' }
    }), environment, {});
    assert.equal(thirtyFirst.status, 202);
    assert.equal((await thirtyFirst.json()).ok, true);
    assert.equal(sentMails.length, 1);

    const afterRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE reference_number = ?')
        .bind(referenceNumber).first();
    assert.equal(afterRow.access_code_hash, beforeRow.access_code_hash);
    assert.equal(afterRow.access_code_version, beforeRow.access_code_version);
});

test('POST /api/application-recovery/email still returns 202 when mail transport fails', async () => {
    const { environment } = createTestEnvironment();
    await createApplicant(environment, 'SYN-REC-MAIL-FAIL', '198.51.100.80');

    // Kurtarma e-postası gönderimi ağ hatası fırlatsın.
    environment.REFERENCE_MAIL_FETCH = async () => {
        throw new Error('simulated mailer outage');
    };

    const response = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.81',
        body: { student_number: 'SYN-REC-MAIL-FAIL', language: 'tr' }
    }), environment, {});

    assert.equal(response.status, 202);
    assert.equal((await response.json()).ok, true);
});
