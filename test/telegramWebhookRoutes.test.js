import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import {
    createTelegramMessageSender,
    handleTelegramWebhook
} from '../src/server/routes/telegramWebhookRoutes.js';
import { TELEGRAM_RECOVERY_MESSAGES } from '../src/server/services/telegramBot.js';
import { hashRateLimitIdentity } from '../src/server/security/requestRateLimit.js';
import { assertProductionRuntimeSecretMetadata } from '../scripts/ci/runtime-secret-metadata.mjs';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const FAKE_BOT_TOKEN = '999999999:SYNTHETIC-FAKE-BOT-TOKEN-VALUE';
const FAKE_WEBHOOK_SECRET = 'synthetic-webhook-secret-token-value';
const ACCESS_CODE_PATTERN = /[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{6}/;

function createWebhookRequest({
    method = 'POST',
    secretHeader = FAKE_WEBHOOK_SECRET,
    body = { update_id: 1 }
} = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (secretHeader !== undefined && secretHeader !== null) {
        headers.set('X-Telegram-Bot-Api-Secret-Token', secretHeader);
    }
    return new Request('https://portal.test/api/webhooks/telegram', {
        method,
        headers,
        body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
}

function createFakeEnv(overrides = {}) {
    return {
        TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
        TELEGRAM_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
        ...overrides
    };
}

test('handleTelegramWebhook rejects non-POST requests with 405', async () => {
    const response = await handleTelegramWebhook(
        createWebhookRequest({ method: 'GET' }),
        createFakeEnv(),
        'req-method-1'
    );
    assert.equal(response.status, 405);
});

test('handleTelegramWebhook fails closed with 503 without calling Telegram when webhook secret or bot token config is missing', async () => {
    let fetchCalled = false;
    let lookupCalled = false;
    const deps = {
        fetch: async () => { fetchCalled = true; return Response.json({ ok: true }); },
        findRecoverableApplication: async () => { lookupCalled = true; return null; }
    };

    const missingSecret = await handleTelegramWebhook(
        createWebhookRequest(),
        createFakeEnv({ TELEGRAM_WEBHOOK_SECRET: '' }),
        'req-cfg-1',
        deps
    );
    const missingBotToken = await handleTelegramWebhook(
        createWebhookRequest(),
        createFakeEnv({ TELEGRAM_BOT_TOKEN: '' }),
        'req-cfg-2',
        deps
    );
    const omittedBoth = await handleTelegramWebhook(
        createWebhookRequest(),
        {},
        'req-cfg-3',
        deps
    );

    assert.equal(missingSecret.status, 503);
    assert.equal(missingBotToken.status, 503);
    assert.equal(omittedBoth.status, 503);
    assert.equal(fetchCalled, false);
    assert.equal(lookupCalled, false);
    assert.equal((await missingSecret.text()).includes(FAKE_BOT_TOKEN), false);
    assert.equal((await missingBotToken.text()).includes(FAKE_WEBHOOK_SECRET), false);
});

test('handleTelegramWebhook rejects missing or invalid secret header with 401 without calling fetch or deps', async () => {
    let fetchCalled = false;
    let lookupCalled = false;
    const deps = {
        fetch: async () => { fetchCalled = true; return Response.json({ ok: true }); },
        findRecoverableApplication: async () => { lookupCalled = true; return null; }
    };

    const missingHeader = await handleTelegramWebhook(
        createWebhookRequest({ secretHeader: null }),
        createFakeEnv(),
        'req-auth-1',
        deps
    );
    const wrongHeader = await handleTelegramWebhook(
        createWebhookRequest({ secretHeader: 'wrong-secret-token' }),
        createFakeEnv(),
        'req-auth-2',
        deps
    );

    assert.equal(missingHeader.status, 401);
    assert.equal(wrongHeader.status, 401);
    assert.equal(fetchCalled, false);
    assert.equal(lookupCalled, false);
});

test('handleTelegramWebhook drives full 3-step reference reminder over fake fetch without rotating access code and returns 200', async () => {
    const fetchCalls = [];
    const seenUpdates = new Set();

    const deps = {
        fetch: async (url, init) => {
            fetchCalls.push({ url, body: JSON.parse(init.body) });
            return Response.json({ ok: true, result: { message_id: fetchCalls.length } });
        },
        findRecoverableApplication: async (_db, { studentNumber }) => {
            if (studentNumber !== 'TEST-2026-0100') return null;
            return {
                applicationId: 'app-100',
                referenceNumber: 'ITU-8M9N-2P3Q',
                studentEmail: 'synthetic100@example.invalid',
                studentPhone: '+905550000900',
                language: 'tr'
            };
        },
        rateLimiter: async ({ endpoint, identity }) => {
            if (endpoint === 'telegram-recovery-update') {
                if (seenUpdates.has(identity)) return false;
                seenUpdates.add(identity);
            }
            return true;
        },
        now: () => Date.UTC(2026, 10, 16, 12, 0, 0)
    };

    const env = createFakeEnv({ PORTAL_CANONICAL_ORIGIN: 'https://portal.test' });

    // 1. /start
    const res1 = await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 7001,
            message: {
                message_id: 1,
                from: { id: 500, is_bot: false, language_code: 'tr' },
                chat: { id: 500, type: 'private' },
                text: '/start recover_tr'
            }
        }
    }), env, 'req-flow-1', deps);
    assert.equal(res1.status, 200);
    assert.equal(fetchCalls[0].url, `https://api.telegram.org/bot${FAKE_BOT_TOKEN}/sendMessage`);

    // 2. Contact paylaşımı
    const res2 = await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 7002,
            message: {
                message_id: 2,
                from: { id: 500, is_bot: false, language_code: 'tr' },
                chat: { id: 500, type: 'private' },
                contact: { phone_number: '905550000900', user_id: 500 }
            }
        }
    }), env, 'req-flow-2', deps);
    assert.equal(res2.status, 200);
    const askStudentText = fetchCalls[1].body.text;
    assert.match(askStudentText, /\nref:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // 3. Öğrenci numarası yanıtı
    const res3 = await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 7003,
            message: {
                message_id: 3,
                from: { id: 500, is_bot: false, language_code: 'tr' },
                chat: { id: 500, type: 'private' },
                text: 'TEST-2026-0100',
                reply_to_message: {
                    message_id: 20,
                    from: { id: 999, is_bot: true },
                    text: askStudentText
                }
            }
        }
    }), env, 'req-flow-3', deps);
    assert.equal(res3.status, 200);
    assert.match(fetchCalls[2].body.text, /Başvuru numaranız: ITU-8M9N-2P3Q/);
    assert.ok(fetchCalls[2].body.text.includes('https://portal.test/basvuruya-devam-et/'));
    assert.doesNotMatch(fetchCalls[2].body.text, ACCESS_CODE_PATTERN);
});

test('handleTelegramWebhook persists /start language via D1 rateLimits across contact, plain-text guidance, and reply without selective', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const fetchCalls = [];
    const nowMs = Date.UTC(2026, 10, 16, 14, 0, 0);

    const deps = {
        fetch: async (_url, init) => {
            fetchCalls.push(JSON.parse(init.body));
            return Response.json({ ok: true, result: { message_id: fetchCalls.length } });
        },
        findRecoverableApplication: async (_db, { studentNumber }) => {
            if (studentNumber !== 'SYN-WH-2026') return null;
            return {
                applicationId: 'app-wh-2026',
                referenceNumber: 'ITU-1Z2X-3C4V',
                studentEmail: 'wh-test@example.invalid',
                studentPhone: '+905550000911',
                language: 'ru'
            };
        },
        now: () => nowMs
    };

    const env = createFakeEnv({ DB: database, PORTAL_CANONICAL_ORIGIN: 'https://portal.test' });

    // 1. /start recover_tr (kullanıcının Telegram dili ru olsa bile akış Türkçe kalmalı)
    await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 9101,
            message: {
                message_id: 1,
                from: { id: 8801, is_bot: false, language_code: 'ru' },
                chat: { id: 8801, type: 'private' },
                text: '/start recover_tr'
            }
        }
    }), env, 'req-wh-lang-1', deps);
    assert.equal(fetchCalls[0].text, TELEGRAM_RECOVERY_MESSAGES.tr.askContact);

    // 2. Contact paylaşımı: askStudentNumber Türkçe olmalı ve selective anahtarı bulunmamalı
    await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 9102,
            message: {
                message_id: 2,
                from: { id: 8801, is_bot: false, language_code: 'ru' },
                chat: { id: 8801, type: 'private' },
                contact: { phone_number: '905550000911', user_id: 8801 }
            }
        }
    }), env, 'req-wh-lang-2', deps);
    assert.ok(fetchCalls[1].text.startsWith(TELEGRAM_RECOVERY_MESSAGES.tr.askStudentNumber));
    assert.equal(fetchCalls[1].reply_markup.force_reply, true);
    assert.equal(Object.hasOwn(fetchCalls[1].reply_markup, 'selective'), false);

    // 3. Öğrenci yanıtlamadan düz metin yazarsa hatırlanan Türkçe dilde yanıt talimatı verilmeli
    await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 9103,
            message: {
                message_id: 3,
                from: { id: 8801, is_bot: false, language_code: 'ru' },
                chat: { id: 8801, type: 'private' },
                text: 'SYN-WH-2026'
            }
        }
    }), env, 'req-wh-lang-3', deps);
    assert.equal(fetchCalls[2].text, TELEGRAM_RECOVERY_MESSAGES.tr.replyInstruction);

    // 4. Bot mesajını yanıtlayarak gönderince Türkçe başarı mesajı ile mevcut başvuru numarası dönmeli
    await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 9104,
            message: {
                message_id: 4,
                from: { id: 8801, is_bot: false, language_code: 'ru' },
                chat: { id: 8801, type: 'private' },
                text: 'SYN-WH-2026',
                reply_to_message: {
                    message_id: 2,
                    from: { id: 999, is_bot: true },
                    text: fetchCalls[1].text
                }
            }
        }
    }), env, 'req-wh-lang-4', deps);
    assert.match(fetchCalls[3].text, /Başvuru numaranız: ITU-1Z2X-3C4V/);
    assert.ok(fetchCalls[3].text.includes('https://portal.test/basvuruya-devam-et/'));
    assert.doesNotMatch(fetchCalls[3].text, ACCESS_CODE_PATTERN);
});

test('handleTelegramWebhook writes one 64-hex telegram-recovery-lang-tr row in D1 for /start recover_tr and prompts in Turkish on contact', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const fetchCalls = [];
    const nowMs = Date.UTC(2026, 10, 16, 15, 0, 0);

    const deps = {
        fetch: async (_url, init) => {
            fetchCalls.push(JSON.parse(init.body));
            return Response.json({ ok: true, result: { message_id: fetchCalls.length } });
        },
        findRecoverableApplication: async () => null,
        now: () => nowMs
    };

    const env = createFakeEnv({ DB: database });

    // 1. Kullanıcının language_code değeri 'ru' iken /start recover_tr gönderilir
    const startResponse = await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 9201,
            message: {
                message_id: 1,
                from: { id: 7702, is_bot: false, language_code: 'ru' },
                chat: { id: 9902, type: 'private' },
                text: '/start recover_tr'
            }
        }
    }), env, 'req-wh-d1-row-1', deps);
    assert.equal(startResponse.status, 200);

    // 2. Kişi paylaşımı sonrasında öğrenci numarası istemi Türkçe olmalı
    const contactResponse = await handleTelegramWebhook(createWebhookRequest({
        body: {
            update_id: 9202,
            message: {
                message_id: 2,
                from: { id: 7702, is_bot: false, language_code: 'ru' },
                chat: { id: 9902, type: 'private' },
                contact: { phone_number: '905550000922', user_id: 7702 }
            }
        }
    }), env, 'req-wh-d1-row-2', deps);
    assert.equal(contactResponse.status, 200);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].text, TELEGRAM_RECOVERY_MESSAGES.tr.askContact);
    assert.ok(fetchCalls[1].text.startsWith(TELEGRAM_RECOVERY_MESSAGES.tr.askStudentNumber));
    assert.match(fetchCalls[1].text, /\nref:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(fetchCalls[1].reply_markup.force_reply, true);
    assert.equal(Object.hasOwn(fetchCalls[1].reply_markup, 'selective'), false);

    // 3. Yalnızca bir 'telegram-recovery-lang-tr' satırı 64 haneli hex özetle saklanmalı; ham kimlik içermemeli
    const storedRows = database.prepare('SELECT endpoint, request_key_hash FROM public_rate_limits').all().results;
    const langRows = storedRows.filter((row) => row.endpoint.startsWith('telegram-recovery-lang-'));
    assert.equal(langRows.length, 1);
    assert.equal(langRows[0].endpoint, 'telegram-recovery-lang-tr');
    assert.match(langRows[0].request_key_hash, /^[0-9a-f]{64}$/);
    assert.equal(langRows[0].request_key_hash, await hashRateLimitIdentity('user:7702'));
    for (const row of storedRows) {
        assert.equal(row.request_key_hash.includes('7702'), false);
        assert.equal(row.request_key_hash.includes('9902'), false);
    }
});

test('handleTelegramWebhook always returns 200 for valid-secret requests and redacts tokens from errors and logs', async () => {
    const loggedEntries = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
        loggedEntries.push(JSON.stringify(args));
    };

    try {
        // 1. Geçersiz JSON gövdesi bile geçerli gizli anahtarda 200 döner.
        const badJsonResponse = await handleTelegramWebhook(
            createWebhookRequest({ body: '{invalid-json' }),
            createFakeEnv(),
            'req-bad-json'
        );
        assert.equal(badJsonResponse.status, 200);
        const badJsonText = await badJsonResponse.text();
        assert.equal(badJsonText.includes(FAKE_BOT_TOKEN), false);
        assert.equal(badJsonText.includes(FAKE_WEBHOOK_SECRET), false);

        // 2. fetch hata mesajında bot token'ı geçse bile günlüklerde ve yanıtta maskelenir, durum 200 kalır.
        const failingFetchResponse = await handleTelegramWebhook(
            createWebhookRequest({
                body: {
                    update_id: 8001,
                    message: {
                        message_id: 1,
                        from: { id: 600, is_bot: false, language_code: 'tr' },
                        chat: { id: 600, type: 'private' },
                        text: '/start'
                    }
                }
            }),
            createFakeEnv(),
            'req-fetch-fail',
            {
                fetch: async () => {
                    throw new Error(`connect failed to https://api.telegram.org/bot${FAKE_BOT_TOKEN}/sendMessage with ${FAKE_WEBHOOK_SECRET}`);
                },
                findRecoverableApplication: async () => null
            }
        );
        assert.equal(failingFetchResponse.status, 200);
        const failingResponseText = await failingFetchResponse.text();
        assert.equal(failingResponseText.includes(FAKE_BOT_TOKEN), false);
        assert.equal(failingResponseText.includes(FAKE_WEBHOOK_SECRET), false);

        // 3. createTelegramMessageSender fırlattığı hatada da belirteci maskeler.
        const sender = createTelegramMessageSender({
            botToken: FAKE_BOT_TOKEN,
            fetchImplementation: async () => {
                throw new Error(`network failure on https://api.telegram.org/bot${FAKE_BOT_TOKEN}/sendMessage`);
            }
        });
        await assert.rejects(
            () => sender({ chat_id: 600, text: 'test' }),
            (error) => {
                assert.equal(error.message.includes(FAKE_BOT_TOKEN), false);
                assert.match(error.message, /\[REDACTED\]/);
                return true;
            }
        );

        assert.ok(loggedEntries.length >= 2);
        for (const entry of loggedEntries) {
            assert.equal(entry.includes(FAKE_BOT_TOKEN), false);
            assert.equal(entry.includes(FAKE_WEBHOOK_SECRET), false);
        }
    } finally {
        console.error = originalConsoleError;
    }
});

test('wrangler.jsonc and runtime-secret-metadata.mjs declare matching Telegram configuration', () => {
    const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    assert.equal(wrangler.env.staging.vars.TELEGRAM_BOT_USERNAME, '');
    assert.equal(wrangler.env.production.vars.TELEGRAM_BOT_USERNAME, 'topkapiunigoc_bot');
    assert.equal(wrangler.env.production.secrets.required.includes('TELEGRAM_BOT_TOKEN'), false);
    assert.equal(wrangler.env.production.secrets.required.includes('TELEGRAM_WEBHOOK_SECRET'), false);

    const allExpectedSecrets = [
        'APPS_SCRIPT_API_KEY', 'APPS_SCRIPT_URL', 'AZURE_VISION_ENDPOINT', 'AZURE_VISION_KEY',
        'D1_ANALYTICS_API_TOKEN',
        'PRINTER_SECRET', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY',
        'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_SECRET_ACCESS_KEY',
        'REFERENCE_MAIL_ENDPOINT', 'REFERENCE_MAIL_TOKEN',
        'SCANNER_SECRET', 'STAFF_BOOTSTRAP_TOKEN',
        'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'
    ].map((name) => ({ name, type: 'secret_text' }));

    assert.doesNotThrow(() => assertProductionRuntimeSecretMetadata(
        allExpectedSecrets,
        wrangler.env.production.secrets.required
    ));
});

test('worker fetch routes POST /api/webhooks/telegram without origin header and enforces 401 and 503', async () => {
    const wrongSecretResponse = await worker.fetch(
        createWebhookRequest({ secretHeader: 'wrong-secret-token' }),
        createFakeEnv(),
        {}
    );
    assert.equal(wrongSecretResponse.status, 401);

    const unconfiguredResponse = await worker.fetch(
        createWebhookRequest(),
        {},
        {}
    );
    assert.equal(unconfiguredResponse.status, 503);
});
