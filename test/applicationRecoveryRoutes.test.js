import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TEST_APPLICATION_PRIVACY_NOTICE, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const TOKEN = 't'.repeat(40);
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbTestRecovery/exec';
const PORTAL_CANONICAL_ORIGIN = 'https://portal.test';
const ACCESS_CODE_PATTERN = /[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{6}/;

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

test('POST /api/application-recovery/email rotates code, keeps open sessions, sends mail and hides unregistered records', async () => {
    const { database, environment, sentMails } = createTestEnvironment();
    const { cookie, referenceNumber, accessCode: initialCode } = await createApplicant(environment, 'SYN-REC-ROUTE-1', '198.51.100.11');
    assert.equal(sentMails.length, 0);

    const unknownResponse = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.12',
        body: { student_number: 'SYN-NOT-FOUND', language: 'en' }
    }), environment, {});
    const unknownPayload = await unknownResponse.json();
    assert.equal(unknownResponse.status, 202);
    assert.equal(unknownPayload.ok, true);
    assert.equal(sentMails.length, 0);

    const registeredResponse = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.13',
        body: { student_number: 'syn-rec-route-1', language: 'en' }
    }), environment, {});
    const registeredPayload = await registeredResponse.json();
    assert.equal(registeredResponse.status, 202);
    assert.deepEqual(Object.keys(registeredPayload).sort(), Object.keys(unknownPayload).sort());
    assert.equal(registeredPayload.ok, true);

    assert.equal(sentMails.length, 1);
    assert.equal(sentMails[0].to, 'syn-rec-route-1@example.invalid');
    assert.equal(sentMails[0].subject, 'Your application access code has been reset');
    assert.ok(sentMails[0].text.includes(referenceNumber));
    assert.ok(sentMails[0].text.includes('https://portal.test/basvurum/'));
    assert.match(sentMails[0].text, /ignore/i);
    assert.match(sentMails[0].text, /spam/i);

    const extractedCode = sentMails[0].text.match(ACCESS_CODE_PATTERN)?.[0];
    assert.ok(extractedCode);
    assert.notEqual(extractedCode, initialCode);

    // Eski kod geçersiz, yeni kod geçerli olmalı.
    const oldLogin = await worker.fetch(makeRequest('/api/public/applications/access', {
        method: 'POST',
        ip: '198.51.100.14',
        body: { reference_number: referenceNumber, access_code: initialCode }
    }), environment, {});
    assert.equal(oldLogin.status, 401);

    const newLogin = await worker.fetch(makeRequest('/api/public/applications/access', {
        method: 'POST',
        ip: '198.51.100.14',
        body: { reference_number: referenceNumber, access_code: extractedCode }
    }), environment, {});
    assert.equal(newLogin.status, 200);

    // Açık öğrenci oturumu iptal edilmemiş olmalı.
    const sessionCheck = await worker.fetch(makeRequest('/api/public/applications/current/status', { cookie }), environment, {});
    assert.equal(sessionCheck.status, 200);

    // Terminal başvuruda yanıt yine 202 olur ama kod döndürülmez ve mail atılmaz.
    database.prepare("UPDATE applications SET status = 'completed' WHERE reference_number = ?").bind(referenceNumber).run();
    const terminalResponse = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.15',
        body: { student_number: 'SYN-REC-ROUTE-1', language: 'tr' }
    }), environment, {});
    assert.equal(terminalResponse.status, 202);
    assert.equal(sentMails.length, 1);
});

test('POST /api/application-recovery/email falls back to five-language mail when language is invalid', async () => {
    const { environment, sentMails } = createTestEnvironment();
    await createApplicant(environment, 'SYN-REC-LANG', '198.51.100.20');
    assert.equal(sentMails.length, 0);

    const response = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.21',
        body: { student_number: 'SYN-REC-LANG', language: 'xx' }
    }), environment, {});

    assert.equal(response.status, 202);
    assert.equal(sentMails.length, 1);
    assert.equal(sentMails[0].subject, 'Başvuru erişim kodunuz yenilendi · Application access code reset');
    assert.equal(sentMails[0].text.split('\n\n---\n\n').length, 5);
});

test('POST /api/application-recovery/email enforces 3/day per-application and 5/15m per-IP limits while still returning 202', async () => {
    const { environment, sentMails } = createTestEnvironment();
    const { referenceNumber } = await createApplicant(environment, 'SYN-REC-LIMIT-1', '198.51.100.30');
    await createApplicant(environment, 'SYN-REC-LIMIT-2', '198.51.100.31');
    assert.equal(sentMails.length, 0);

    // Aynı başvuru için 3 kurtarma (farklı IP'lerden) başarılı, 4. istek 202 döner ama mail atmaz / kodu değiştirmez.
    for (let i = 0; i < 3; i += 1) {
        const res = await worker.fetch(makeRequest('/api/application-recovery/email', {
            method: 'POST',
            ip: `198.51.100.${40 + i}`,
            body: { student_number: 'SYN-REC-LIMIT-1', language: 'tr' }
        }), environment, {});
        assert.equal(res.status, 202);
    }
    assert.equal(sentMails.length, 3);
    const thirdCode = sentMails[2].text.match(ACCESS_CODE_PATTERN)?.[0];

    const fourthRes = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.49',
        body: { student_number: 'SYN-REC-LIMIT-1', language: 'tr' }
    }), environment, {});
    assert.equal(fourthRes.status, 202);
    assert.equal(sentMails.length, 3);

    // 3. kod hâlâ geçerli olmalı.
    const checkThirdCode = await worker.fetch(makeRequest('/api/public/applications/access', {
        method: 'POST',
        ip: '198.51.100.50',
        body: { reference_number: referenceNumber, access_code: thirdCode }
    }), environment, {});
    assert.equal(checkThirdCode.status, 200);

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

test('POST /api/application-recovery/email does not rotate code when 30-mail recovery quota is full and ignores Telegram events', async () => {
    const { database, environment, sentMails } = createTestEnvironment();
    const { referenceNumber, accessCode: initialCode } = await createApplicant(environment, 'SYN-REC-QUOTA', '198.51.100.70');
    assert.equal(sentMails.length, 0);

    const appRow = database.prepare('SELECT id FROM applications WHERE reference_number = ?').bind(referenceNumber).first();
    const recentTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // 30 Telegram kurtarma olayı e-posta kotasını doldurmamalı.
    for (let i = 0; i < 30; i += 1) {
        database.prepare(`INSERT INTO audit_events (id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at)
            VALUES (?, 'application.access_code_recovered', 'system', ?, ?, '{"accessCodeRotated":true,"channel":"telegram"}', ?)`)
            .bind(`tg-rec-${i}`, appRow.id, `req-tg-${i}`, recentTime).run();
    }

    // 29 e-posta kurtarma olayı + 1 eski (26 saat önce) olay: toplam son 24 saatte 29, izin verilmeli.
    const expiredTime = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    database.prepare(`INSERT INTO audit_events (id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at)
        VALUES ('old-email-rec', 'application.access_code_recovered', 'system', ?, 'req-old', '{"accessCodeRotated":true,"channel":"email"}', ?)`)
        .bind(appRow.id, expiredTime).run();
    for (let i = 0; i < 29; i += 1) {
        database.prepare(`INSERT INTO audit_events (id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at)
            VALUES (?, 'application.access_code_recovered', 'system', ?, ?, '{"accessCodeRotated":true,"channel":"email"}', ?)`)
            .bind(`email-rec-${i}`, appRow.id, `req-email-${i}`, recentTime).run();
    }

    // 30. e-posta kurtarması çalışmalı.
    const thirtieth = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.71',
        body: { student_number: 'SYN-REC-QUOTA', language: 'tr' }
    }), environment, {});
    assert.equal(thirtieth.status, 202);
    assert.equal(sentMails.length, 1);
    const rotatedCode = sentMails[0].text.match(ACCESS_CODE_PATTERN)?.[0];
    assert.ok(rotatedCode);
    assert.notEqual(rotatedCode, initialCode);

    // 31. e-posta kurtarması kotaya takılmalı: 202 döner, yeni mail gitmez, 30. kod geçerli kalır.
    const thirtyFirst = await worker.fetch(makeRequest('/api/application-recovery/email', {
        method: 'POST',
        ip: '198.51.100.72',
        body: { student_number: 'SYN-REC-QUOTA', language: 'tr' }
    }), environment, {});
    assert.equal(thirtyFirst.status, 202);
    assert.equal((await thirtyFirst.json()).ok, true);
    assert.equal(sentMails.length, 1);

    const verifyCodeStillValid = await worker.fetch(makeRequest('/api/public/applications/access', {
        method: 'POST',
        ip: '198.51.100.73',
        body: { reference_number: referenceNumber, access_code: rotatedCode }
    }), environment, {});
    assert.equal(verifyCodeStillValid.status, 200);
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
