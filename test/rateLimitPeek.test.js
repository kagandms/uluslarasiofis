import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimitRepository } from '../src/server/repositories/d1/rateLimitRepository.js';
import { hashRateLimitIdentity } from '../src/server/security/requestRateLimit.js';
import {
    TELEGRAM_LANGUAGE_MEMORY_WINDOW_SECONDS,
    recallTelegramRecoveryLanguage,
    rememberTelegramRecoveryLanguage
} from '../src/server/services/telegramBot.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createFakeRateLimitRepo() {
    const records = new Map();
    const consumeCalls = [];
    const peekCalls = [];

    return {
        consumeCalls,
        peekCalls,
        async consume({ endpoint, requestKeyHash, nowSeconds, windowSeconds, maxRequests }) {
            consumeCalls.push({ endpoint, requestKeyHash, nowSeconds, windowSeconds, maxRequests });
            const key = `${endpoint}:${requestKeyHash}`;
            const existing = records.get(key);
            if (!existing || existing.window_started_at <= nowSeconds - windowSeconds) {
                const next = { window_started_at: nowSeconds, request_count: 1, blocked_until: null };
                records.set(key, next);
                return next;
            }
            existing.request_count += 1;
            existing.blocked_until = existing.request_count > maxRequests ? nowSeconds + windowSeconds : null;
            return { ...existing };
        },
        async peek({ endpoint, requestKeyHash, nowSeconds, windowSeconds }) {
            peekCalls.push({ endpoint, requestKeyHash, nowSeconds, windowSeconds });
            const key = `${endpoint}:${requestKeyHash}`;
            const existing = records.get(key);
            if (!existing || existing.window_started_at <= nowSeconds - windowSeconds) {
                return null;
            }
            return {
                request_count: existing.request_count,
                window_started_at: existing.window_started_at
            };
        }
    };
}

test('createRateLimitRepository.peek reads without writing or incrementing and respects windowSeconds', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);

    const preparedSql = [];
    let runCalls = 0;
    const spyDatabase = {
        prepare(sql) {
            preparedSql.push(sql);
            const stmt = database.prepare(sql);
            return {
                bind(...values) {
                    const bound = stmt.bind(...values);
                    return {
                        first() {
                            return bound.first();
                        },
                        all() {
                            return bound.all();
                        },
                        run() {
                            runCalls += 1;
                            return bound.run();
                        }
                    };
                }
            };
        }
    };

    const realRepo = createRateLimitRepository(database);
    const spyRepo = createRateLimitRepository(spyDatabase);
    const requestKeyHash = await hashRateLimitIdentity('user:12345');
    const endpoint = 'telegram-recovery-lang-tr';

    // Kayıt yokken null dönmeli ve yazma yapmamalı
    assert.equal(await spyRepo.peek({ endpoint, requestKeyHash, nowSeconds: 1000, windowSeconds: 900 }), null);
    assert.equal(runCalls, 0);
    assert.match(preparedSql[0], /^\s*SELECT\s+/i);

    // consume ile kayıt oluşturulduktan sonra peek aynı değerleri döndürmeli ve sayacı artırmamalı
    await realRepo.consume({ endpoint, requestKeyHash, nowSeconds: 1000, windowSeconds: 900, maxRequests: 1_000_000 });
    const firstPeek = await spyRepo.peek({ endpoint, requestKeyHash, nowSeconds: 1000, windowSeconds: 900 });
    const secondPeek = await spyRepo.peek({ endpoint, requestKeyHash, nowSeconds: 1899, windowSeconds: 900 });

    assert.ok(firstPeek);
    assert.ok(secondPeek);
    assert.deepStrictEqual({ ...firstPeek }, { request_count: 1, window_started_at: 1000 });
    assert.deepStrictEqual({ ...secondPeek }, { request_count: 1, window_started_at: 1000 });
    assert.equal(runCalls, 0);

    // Pencere sınırında (1000 + 900) ve sonrasında null dönmeli
    assert.equal(await spyRepo.peek({ endpoint, requestKeyHash, nowSeconds: 1900, windowSeconds: 900 }), null);
    assert.equal(await spyRepo.peek({ endpoint, requestKeyHash, nowSeconds: 2500, windowSeconds: 900 }), null);
    assert.equal(runCalls, 0);
});

test('rememberTelegramRecoveryLanguage and recallTelegramRecoveryLanguage work with a fake repository', async () => {
    const fakeRepo = createFakeRateLimitRepo();
    const userId = 424242;
    const expectedHash = await hashRateLimitIdentity(`user:${userId}`);

    assert.equal(await recallTelegramRecoveryLanguage({ rateLimiter: fakeRepo, userId, nowSeconds: 1000 }), null);
    assert.equal(fakeRepo.consumeCalls.length, 0);
    assert.equal(fakeRepo.peekCalls.length, 5);

    await rememberTelegramRecoveryLanguage({ rateLimiter: fakeRepo, userId, language: 'tr', nowSeconds: 1000 });
    assert.equal(fakeRepo.consumeCalls.length, 1);
    assert.equal(fakeRepo.consumeCalls[0].endpoint, 'telegram-recovery-lang-tr');
    assert.equal(fakeRepo.consumeCalls[0].requestKeyHash, expectedHash);
    assert.equal(fakeRepo.consumeCalls[0].windowSeconds, 900);
    assert.ok(fakeRepo.consumeCalls[0].maxRequests >= 1_000_000);

    // Aynı pencere içinde dil değiştirilirse en güncel window_started_at değerine sahip dil dönmeli
    await rememberTelegramRecoveryLanguage({ rateLimiter: fakeRepo, userId, language: 'en', nowSeconds: 1120 });
    const consumeCountBeforeRecall = fakeRepo.consumeCalls.length;
    const recalled = await recallTelegramRecoveryLanguage({ rateLimiter: fakeRepo, userId, nowSeconds: 1500 });
    assert.equal(recalled, 'en');
    assert.equal(fakeRepo.consumeCalls.length, consumeCountBeforeRecall);

    // Pencere süresi (900 sn) dolunca null dönmeli
    assert.equal(
        await recallTelegramRecoveryLanguage({
            rateLimiter: fakeRepo,
            userId,
            nowSeconds: 1120 + TELEGRAM_LANGUAGE_MEMORY_WINDOW_SECONDS
        }),
        null
    );
});

test('rememberTelegramRecoveryLanguage and recallTelegramRecoveryLanguage persist hashed user key in D1 public_rate_limits', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const userId = 987654;

    await rememberTelegramRecoveryLanguage({ database, userId, language: 'tk', nowSeconds: 2000 });
    await rememberTelegramRecoveryLanguage({ database, userId, language: 'ar', nowSeconds: 2100 });

    assert.equal(await recallTelegramRecoveryLanguage({ database, userId, nowSeconds: 2500 }), 'ar');
    assert.equal(await recallTelegramRecoveryLanguage({ database, userId, nowSeconds: 3000 }), null);

    const rows = database.prepare('SELECT endpoint, request_key_hash FROM public_rate_limits').all().results;
    assert.equal(rows.length, 2);
    const expectedHash = await hashRateLimitIdentity(`user:${userId}`);
    for (const row of rows) {
        assert.equal(row.request_key_hash, expectedHash);
        assert.equal(row.request_key_hash.includes(String(userId)), false);
    }
});
