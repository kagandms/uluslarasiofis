/**
 * Halka açık sohbet oylama ucu (POST /api/public/chat/feedback) testleri:
 * mutlu yol, üzerine yazma, 404, 400 doğrulama, boyut sınırı, 429 hız sınırı,
 * hata durumunda kapalı kalma (503) ve aynı köken (403) koruması.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_FEEDBACK_RATE_LIMIT } from '../src/server/security/application-rate-limits.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { createFakeAiBinding } from './helpers/fakeAiBinding.js';

function createEnvironment(aiScript = { response: 'Başvurunuzu ana sayfadan başlatabilirsiniz.' }) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const fakeAi = createFakeAiBinding(aiScript);
    return {
        database,
        fakeAi,
        environment: {
            DB: database,
            AI: fakeAi,
            APP_ENV: 'test'
        }
    };
}

function createFeedbackRequest(body, {
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
    return new Request('https://portal.test/api/public/chat/feedback', {
        method,
        headers,
        body: method === 'GET' ? undefined : (rawBody ?? JSON.stringify(body))
    });
}

async function seedChatTurn(environment, address = '198.51.100.1') {
    const response = await worker.fetch(
        new Request('https://portal.test/api/public/chat', {
            method: 'POST',
            headers: {
                Origin: 'https://portal.test',
                'Content-Type': 'application/json',
                'CF-Connecting-IP': address
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Başvuru adımları nelerdir?' }],
                language: 'tr'
            })
        }),
        environment,
        {}
    );
    assert.equal(response.status, 200);
    return response.json();
}

test('POST /api/public/chat/feedback stores vote with 204 and overwrites on second vote', async () => {
    const { database, environment } = createEnvironment();
    const { turn_id: turnId } = await seedChatTurn(environment);

    const firstVote = await worker.fetch(
        createFeedbackRequest({ turn_id: turnId, value: 'up' }),
        environment,
        {}
    );
    assert.equal(firstVote.status, 204);
    assert.equal(await firstVote.text(), '');
    assert.ok(firstVote.headers.get('X-Request-Id'));
    assert.equal(firstVote.headers.get('Cache-Control'), 'no-store');

    const afterFirst = database.prepare('SELECT feedback, feedback_at FROM chat_turns WHERE id = ?').bind(turnId).first();
    assert.equal(afterFirst.feedback, 'up');
    assert.ok(afterFirst.feedback_at);

    const secondVote = await worker.fetch(
        createFeedbackRequest({ turn_id: turnId, value: 'down' }),
        environment,
        {}
    );
    assert.equal(secondVote.status, 204);

    const afterSecond = database.prepare('SELECT feedback, feedback_at FROM chat_turns WHERE id = ?').bind(turnId).first();
    assert.equal(afterSecond.feedback, 'down');
    assert.ok(afterSecond.feedback_at);
});

test('POST /api/public/chat/feedback returns 404 for unknown turn_id', async () => {
    const { environment } = createEnvironment();
    const response = await worker.fetch(
        createFeedbackRequest({ turn_id: '99999999-9999-4999-8999-999999999999', value: 'up' }),
        environment,
        {}
    );
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.error.code, 'NOT_FOUND');
});

test('POST /api/public/chat/feedback rejects bad value, extra keys, bad turn_id, invalid JSON, and oversized bodies (> 2 KB)', async () => {
    const { database, environment } = createEnvironment();
    const { turn_id: turnId } = await seedChatTurn(environment);

    const invalidBodies = [
        { turn_id: turnId, value: 'neutral' },
        { turn_id: turnId, value: true },
        { turn_id: turnId },
        { value: 'up' },
        { turn_id: '   ', value: 'up' },
        { turn_id: `${turnId}\n`, value: 'up' },
        { turn_id: turnId, value: 'up', extra: 'unexpected' }
    ];

    for (let index = 0; index < invalidBodies.length; index += 1) {
        const response = await worker.fetch(
            createFeedbackRequest(invalidBodies[index], { address: `198.51.100.${20 + index}` }),
            environment,
            {}
        );
        const payload = await response.json();
        assert.equal(response.status, 400);
        assert.equal(payload.error.code, 'VALIDATION_ERROR');
    }

    const badJson = await worker.fetch(
        createFeedbackRequest(null, { rawBody: '{invalid', address: '198.51.100.39' }),
        environment,
        {}
    );
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).error.code, 'VALIDATION_ERROR');

    // Clear rate-limit table to assert oversized body is rejected before consuming rate limit.
    database.prepare('DELETE FROM public_rate_limits').run();

    const oversizedBody = JSON.stringify({ turn_id: turnId, value: 'up', pad: 'x'.repeat(2200) });
    const oversizedRes = await worker.fetch(
        createFeedbackRequest(null, { rawBody: oversizedBody, address: '198.51.100.40' }),
        environment,
        {}
    );
    assert.equal(oversizedRes.status, 413);
    assert.equal((await oversizedRes.json()).error.code, 'REQUEST_TOO_LARGE');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM public_rate_limits').first().count, 0);
});

test('POST /api/public/chat/feedback rejects cross-origin (403) and wrong method (405) before rate limits', async () => {
    const { database, environment } = createEnvironment();

    const crossOrigin = await worker.fetch(
        createFeedbackRequest({ turn_id: '11111111-1111-4111-8111-111111111111', value: 'up' }, { origin: 'https://attacker.test' }),
        environment,
        {}
    );
    const missingOrigin = await worker.fetch(
        createFeedbackRequest({ turn_id: '11111111-1111-4111-8111-111111111111', value: 'up' }, { origin: null }),
        environment,
        {}
    );
    const wrongMethod = await worker.fetch(
        createFeedbackRequest(undefined, { method: 'GET' }),
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

test('POST /api/public/chat/feedback enforces per-IP rate limit (429) and fails closed (503) on limiter or DB unavailability', async () => {
    const { database, environment } = createEnvironment();
    const { turn_id: turnId } = await seedChatTurn(environment);
    const sameIp = '198.51.100.70';

    for (let index = 0; index < CHAT_FEEDBACK_RATE_LIMIT.maxRequests; index += 1) {
        const ok = await worker.fetch(
            createFeedbackRequest({ turn_id: turnId, value: index % 2 === 0 ? 'up' : 'down' }, { address: sameIp }),
            environment,
            {}
        );
        assert.equal(ok.status, 204);
    }

    const limited = await worker.fetch(
        createFeedbackRequest({ turn_id: turnId, value: 'up' }, { address: sameIp }),
        environment,
        {}
    );
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');

    // Another IP is not blocked.
    const otherIp = await worker.fetch(
        createFeedbackRequest({ turn_id: turnId, value: 'up' }, { address: '198.51.100.71' }),
        environment,
        {}
    );
    assert.equal(otherIp.status, 204);

    // Rate-limit store failure fails closed with 503.
    const failingRateLimitDb = {
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
    const rateLimitErrorRes = await worker.fetch(
        createFeedbackRequest({ turn_id: turnId, value: 'down' }, { address: '198.51.100.72' }),
        { ...environment, DB: failingRateLimitDb },
        {}
    );
    assert.equal(rateLimitErrorRes.status, 503);
    assert.equal((await rateLimitErrorRes.json()).error.code, 'SERVICE_UNAVAILABLE');

    // Missing DB binding returns 503.
    const noDbRes = await worker.fetch(
        createFeedbackRequest({ turn_id: turnId, value: 'down' }, { address: '198.51.100.73' }),
        { APP_ENV: 'test' },
        {}
    );
    assert.equal(noDbRes.status, 503);
    assert.equal((await noDbRes.json()).error.code, 'SERVICE_UNAVAILABLE');
});
