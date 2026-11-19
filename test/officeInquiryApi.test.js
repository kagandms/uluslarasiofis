import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashRateLimitIdentity } from '../src/server/security/requestRateLimit.js';
import { INQUIRY_GLOBAL_DAILY_LIMIT } from '../src/server/security/application-rate-limits.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, environment: { DB: database, APP_ENV: 'test' } };
}

function validBody(overrides = {}) {
    return {
        first_name: 'Zeynep',
        last_name: 'Kaya',
        phone: '+90 555 111 22 33',
        email: 'zeynep@example.edu',
        message: 'Pasaport teslim randevusu ne zaman açılır?',
        language: 'tr',
        website: '',
        ...overrides
    };
}

function createInquiryRequest(body, {
    method = 'POST',
    origin = 'https://portal.test',
    address = '198.51.100.10',
    rawBody,
    extraHeaders = {}
} = {}) {
    const headers = new Headers({
        'CF-Connecting-IP': address,
        ...extraHeaders
    });
    if (origin !== null) headers.set('Origin', origin);
    if (method !== 'GET' && method !== 'HEAD') {
        headers.set('Content-Type', 'application/json');
    }
    return new Request('https://portal.test/api/public/inquiries', {
        method,
        headers,
        body: method === 'GET' ? undefined : (rawBody ?? JSON.stringify(body))
    });
}

test('POST /api/public/inquiries stores one normalized inquiry and returns 201', async () => {
    const { database, environment } = createEnvironment();
    const response = await worker.fetch(createInquiryRequest(validBody({
        phone: '  \u200b0090 505 123 45 67  ',
        email: null
    })), environment, {});
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.received, true);
    assert.ok(payload.requestId);

    const rows = database.prepare('SELECT * FROM office_inquiries').all().results;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_name, 'Zeynep');
    assert.equal(rows[0].last_name, 'Kaya');
    assert.equal(rows[0].phone, '+905051234567');
    assert.equal(rows[0].email, null);
    assert.equal(rows[0].message, 'Pasaport teslim randevusu ne zaman açılır?');
    assert.equal(rows[0].language, 'tr');
    assert.equal(rows[0].status, 'new');
});

test('filled honeypot returns 201, stores zero rows, and consumes only the IP counter', async () => {
    const { database, environment } = createEnvironment();
    const response = await worker.fetch(createInquiryRequest(validBody({
        website: 'https://bot-spam.example'
    })), environment, {});
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.received, true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM office_inquiries').first().count, 0);

    const limitRows = database.prepare('SELECT endpoint, request_count FROM public_rate_limits ORDER BY endpoint').all().results;
    assert.deepEqual(limitRows.map((row) => ({ endpoint: row.endpoint, request_count: row.request_count })), [
        { endpoint: 'office-inquiry-create', request_count: 1 }
    ]);
});

test('public inquiries reject cross-origin requests and unsupported methods before rate limits', async () => {
    const { database, environment } = createEnvironment();

    const crossOrigin = await worker.fetch(
        createInquiryRequest(validBody(), { origin: 'https://attacker.test' }),
        environment,
        {}
    );
    const missingOrigin = await worker.fetch(
        createInquiryRequest(validBody(), { origin: null }),
        environment,
        {}
    );
    const wrongMethod = await worker.fetch(
        createInquiryRequest(undefined, { method: 'GET' }),
        environment,
        {}
    );

    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    assert.equal(wrongMethod.status, 405);
    assert.equal((await wrongMethod.json()).error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM public_rate_limits').first().count, 0);
});

test('oversize inquiry body returns 413 before any rate limit counter is consumed', async () => {
    const { database, environment } = createEnvironment();
    const oversizedPayload = JSON.stringify(validBody({ message: 'x'.repeat(4200) }));

    const streamedResponse = await worker.fetch(
        createInquiryRequest(null, { rawBody: oversizedPayload }),
        environment,
        {}
    );
    const headerResponse = await worker.fetch(
        createInquiryRequest(validBody(), { extraHeaders: { 'Content-Length': '5000' } }),
        environment,
        {}
    );

    assert.equal(streamedResponse.status, 413);
    assert.equal((await streamedResponse.json()).error.code, 'REQUEST_TOO_LARGE');
    assert.equal(headerResponse.status, 413);
    assert.equal((await headerResponse.json()).error.code, 'REQUEST_TOO_LARGE');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM public_rate_limits').first().count, 0);
});

test('public inquiries fail closed with 503 when rate-limit store throws', async () => {
    const { database, environment } = createEnvironment();
    const failingDatabase = {
        prepare(sql) {
            if (sql.includes('public_rate_limits')) {
                return {
                    bind() {
                        return {
                            run() { throw new Error('D1 rate limit store unavailable'); },
                            first() { throw new Error('D1 rate limit store unavailable'); }
                        };
                    }
                };
            }
            return database.prepare(sql);
        },
        batch(statements) {
            return database.batch(statements);
        }
    };

    const response = await worker.fetch(
        createInquiryRequest(validBody()),
        { ...environment, DB: failingDatabase },
        {}
    );
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(payload.error.retryable, true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM office_inquiries').first().count, 0);
});

test('4th submission from one phone in a day returns 429 and hashes phone identity', async () => {
    const { database, environment } = createEnvironment();
    const phone = '+90 555 222 33 44';

    for (let index = 0; index < 3; index += 1) {
        const okResponse = await worker.fetch(createInquiryRequest(validBody({ phone }), {
            address: `198.51.100.${20 + index}`
        }), environment, {});
        assert.equal(okResponse.status, 201);
    }

    const fourthResponse = await worker.fetch(createInquiryRequest(validBody({ phone }), {
        address: '198.51.100.29'
    }), environment, {});
    assert.equal(fourthResponse.status, 429);
    assert.equal((await fourthResponse.json()).error.code, 'RATE_LIMITED');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM office_inquiries').first().count, 3);

    const phoneLimitRows = database.prepare(`
        SELECT request_key_hash FROM public_rate_limits WHERE endpoint = 'office-inquiry-phone'
    `).all().results;
    assert.equal(phoneLimitRows.length, 1);
    assert.equal(phoneLimitRows[0].request_key_hash, await hashRateLimitIdentity('+905552223344'));
    assert.equal(phoneLimitRows[0].request_key_hash.includes('555'), false);
});

test('4th submission with different formatting of the same phone returns 429 and stores E.164', async () => {
    const { database, environment } = createEnvironment();
    const acceptedFormats = [
        '+90 505 123 45 67',
        '+90-505-123-4567',
        '0090 505 123 45 67'
    ];

    for (let index = 0; index < acceptedFormats.length; index += 1) {
        const okResponse = await worker.fetch(createInquiryRequest(validBody({
            phone: acceptedFormats[index]
        }), {
            address: `198.51.100.${30 + index}`
        }), environment, {});
        assert.equal(okResponse.status, 201);
    }

    const fourthResponse = await worker.fetch(createInquiryRequest(validBody({
        phone: '0505 123 45 67'
    }), {
        address: '198.51.100.39'
    }), environment, {});
    assert.equal(fourthResponse.status, 429);
    assert.equal((await fourthResponse.json()).error.code, 'RATE_LIMITED');

    const storedRows = database.prepare('SELECT phone FROM office_inquiries').all().results;
    assert.equal(storedRows.length, 3);
    assert.deepEqual(storedRows.map((row) => row.phone), [
        '+905051234567',
        '+905051234567',
        '+905051234567'
    ]);

    const phoneLimitRows = database.prepare(`
        SELECT request_key_hash FROM public_rate_limits WHERE endpoint = 'office-inquiry-phone'
    `).all().results;
    assert.equal(phoneLimitRows.length, 1);
    assert.equal(phoneLimitRows[0].request_key_hash, await hashRateLimitIdentity('+905051234567'));
});

test('31st IP submission in 15 minutes and 301st global submission in a day return 429', async () => {
    const { database, environment } = createEnvironment();

    for (let index = 0; index < 30; index += 1) {
        const phone = `0555100${String(index).padStart(4, '0')}`;
        const response = await worker.fetch(createInquiryRequest(validBody({ phone }), {
            address: '198.51.100.50'
        }), environment, {});
        assert.equal(response.status, 201);
    }
    const thirtyFirstIp = await worker.fetch(createInquiryRequest(validBody({ phone: '05551009999' }), {
        address: '198.51.100.50'
    }), environment, {});
    assert.equal(thirtyFirstIp.status, 429);
    assert.equal((await thirtyFirstIp.json()).error.code, 'RATE_LIMITED');

    // Küresel günlük sınırın tam 300/301 sınırını test etmek için sayacı 299'a ayarla
    const globalHash = await hashRateLimitIdentity(INQUIRY_GLOBAL_DAILY_LIMIT.identity);
    const nowSeconds = Math.floor(Date.now() / 1000);
    database.prepare(`
        INSERT INTO public_rate_limits (endpoint, request_key_hash, window_started_at, request_count)
        VALUES (?, ?, ?, 299)
        ON CONFLICT(endpoint, request_key_hash) DO UPDATE SET
            window_started_at = excluded.window_started_at,
            request_count = 299,
            blocked_until = NULL
    `).bind(INQUIRY_GLOBAL_DAILY_LIMIT.endpoint, globalHash, nowSeconds).run();

    const threeHundredth = await worker.fetch(createInquiryRequest(validBody({ phone: '05552000001' }), {
        address: '198.51.100.51'
    }), environment, {});
    assert.equal(threeHundredth.status, 201);

    const threeHundredFirst = await worker.fetch(createInquiryRequest(validBody({ phone: '05552000002' }), {
        address: '198.51.100.52'
    }), environment, {});
    assert.equal(threeHundredFirst.status, 429);
    assert.equal((await threeHundredFirst.json()).error.code, 'RATE_LIMITED');
});

test('invalid inputs return 400 VALIDATION_ERROR and never echo submitted personal data', async () => {
    const { database, environment } = createEnvironment();
    const secretMessage = 'OZEL-MESAJ-ICERIGI-98765';
    const badPhone = 'abc-gecersiz-tel';
    const badEmail = 'yanlis-eposta-adresi';

    const invalidRequests = [
        validBody({ phone: badPhone, message: secretMessage }),
        validBody({ email: badEmail, message: secretMessage }),
        validBody({ message: 'kısa' }),
        validBody({ language: 'es', message: secretMessage }),
        { ...validBody({ message: secretMessage }), unknown: 'x' }
    ];

    for (const payload of invalidRequests) {
        const response = await worker.fetch(createInquiryRequest(payload, {
            address: '198.51.100.90'
        }), environment, {});
        assert.equal(response.status, 400);
        const text = await response.text();
        const json = JSON.parse(text);
        assert.equal(json.error.code, 'VALIDATION_ERROR');
        assert.equal(text.includes(secretMessage), false);
        assert.equal(text.includes(badPhone), false);
        assert.equal(text.includes(badEmail), false);
    }

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM office_inquiries').first().count, 0);
});
