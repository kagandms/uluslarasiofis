import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateAccessCode, hashAccessCode, verifyAccessCode } from '../src/server/auth/applicationAccessCode.js';
import { createOpaqueSessionToken, hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import {
    consumeRecoveryApplicationRateLimit,
    findRecoverableApplication
} from '../src/server/services/accessRecoveryService.js';
import { createTelegramRecoveryBot, normalizeTelegramPhone, TELEGRAM_RECOVERY_MESSAGES } from '../src/server/services/telegramBot.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const FAKE_STATE_SECRET = 'synthetic-telegram-webhook-secret-for-tests';
const GENERIC_MISMATCH_TR = 'Bilgiler eşleşmedi; e-posta yolunu deneyin veya ofisle iletişime geçin.';
const RESUME_PORTAL_URL = 'https://portal.test/basvuruya-devam-et/';
const ACCESS_CODE_PATTERN = /[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{6}/;

function createMemoryRateLimiter() {
    const counters = new Map();
    return {
        async consume({ endpoint, requestKeyHash, nowSeconds, windowSeconds, maxRequests }) {
            const key = `${endpoint}:${requestKeyHash}`;
            const existing = counters.get(key);
            if (!existing || existing.windowStartedAt <= nowSeconds - windowSeconds) {
                const entry = { windowStartedAt: nowSeconds, count: 1 };
                counters.set(key, entry);
                return { request_count: 1, blocked_until: null };
            }
            existing.count += 1;
            const blockedUntil = existing.count > maxRequests ? nowSeconds + windowSeconds : null;
            return { request_count: existing.count, blocked_until: blockedUntil };
        },
        async peek({ endpoint, requestKeyHash, nowSeconds, windowSeconds }) {
            const key = `${endpoint}:${requestKeyHash}`;
            const existing = counters.get(key);
            if (!existing || existing.windowStartedAt <= nowSeconds - windowSeconds) {
                return null;
            }
            return {
                request_count: existing.count,
                window_started_at: existing.windowStartedAt
            };
        }
    };
}

function createBotHarness(options = {}) {
    const {
        applicationsByStudentNumber = new Map(),
        initialNowMs = Date.UTC(2026, 10, 16, 10, 0, 0),
        resumePortalUrl = RESUME_PORTAL_URL,
        database = null
    } = options;
    // `rateLimiter: undefined` açıkça geçirildiğinde bellek içi sahte sınırlayıcıya düşmek yerine D1 yolunu kullan.
    const rateLimiter = Object.hasOwn(options, 'rateLimiter')
        ? options.rateLimiter
        : (database ? undefined : createMemoryRateLimiter());
    let currentNowMs = initialNowMs;
    const sentMessages = [];
    const lookupCalls = [];

    const bot = createTelegramRecoveryBot({
        findRecoverableApplication: async (_db, { studentNumber }) => {
            lookupCalls.push(studentNumber);
            return applicationsByStudentNumber.get(studentNumber.trim().toUpperCase()) ?? null;
        },
        sendTelegramMessage: async (payload) => {
            sentMessages.push(payload);
            return { message_id: sentMessages.length };
        },
        rateLimiter,
        resumePortalUrl,
        stateSecret: FAKE_STATE_SECRET,
        now: () => currentNowMs
    });

    return {
        bot,
        database,
        sentMessages,
        lookupCalls,
        advanceSeconds(seconds) {
            currentNowMs += seconds * 1000;
        }
    };
}

function startUpdate(updateId, text = '/start recover_tr', { userId = 1001, chatId = 1001, languageCode = 'tr' } = {}) {
    return {
        update_id: updateId,
        message: {
            message_id: updateId,
            from: { id: userId, is_bot: false, language_code: languageCode },
            chat: { id: chatId, type: 'private' },
            text
        }
    };
}

function contactUpdate(updateId, options = {}) {
    const {
        phoneNumber = '905550000101',
        userId = 1001,
        chatId = 1001,
        languageCode = 'tr'
    } = options;
    const contactUserId = Object.hasOwn(options, 'contactUserId') ? options.contactUserId : userId;
    return {
        update_id: updateId,
        message: {
            message_id: updateId,
            from: { id: userId, is_bot: false, language_code: languageCode },
            chat: { id: chatId, type: 'private' },
            contact: {
                phone_number: phoneNumber,
                first_name: 'Test',
                ...(contactUserId !== undefined ? { user_id: contactUserId } : {})
            }
        }
    };
}

function replyUpdate(updateId, text, replyToMessage, { userId = 1001, chatId = 1001, languageCode = 'tr' } = {}) {
    return {
        update_id: updateId,
        message: {
            message_id: updateId,
            from: { id: userId, is_bot: false, language_code: languageCode },
            chat: { id: chatId, type: 'private' },
            text,
            reply_to_message: replyToMessage
        }
    };
}

test('normalizeTelegramPhone handles formatted E.164, unprefixed Telegram contacts, and rejects invalid inputs', () => {
    assert.equal(normalizeTelegramPhone('+90 (555) 000-01-01'), '+905550000101');
    assert.equal(normalizeTelegramPhone('905550000101'), '+905550000101');
    assert.equal(normalizeTelegramPhone('0090 555 000 01 01'), '+905550000101');
    assert.equal(normalizeTelegramPhone('+1 (999) 555-0101'), '+19995550101');
    assert.equal(normalizeTelegramPhone(''), '');
    assert.equal(normalizeTelegramPhone('123'), '');
});

test('/start command uses payload language first, falls back to from.language_code, then tr, and ignores invalid payloads', async () => {
    const { bot, database, sentMessages } = createBotHarness();

    await bot.handleUpdate(database, startUpdate(1, '/start recover_en', { languageCode: 'tr' }), { requestId: 'req-1' });
    assert.match(sentMessages[0].text, /share the phone number/i);
    assert.equal(sentMessages[0].reply_markup.one_time_keyboard, true);
    assert.equal(sentMessages[0].reply_markup.keyboard[0][0].request_contact, true);

    await bot.handleUpdate(database, startUpdate(2, '/start recover_xx', { languageCode: 'ru-RU' }), { requestId: 'req-2' });
    assert.match(sentMessages[1].text, /Telegram/);
    assert.match(sentMessages[1].text, /поделитесь номером/i);

    await bot.handleUpdate(database, startUpdate(3, '/start@TestBot recover_ar', { languageCode: 'en' }), { requestId: 'req-3' });
    assert.match(sentMessages[2].text, /تيليجرام/);

    await bot.handleUpdate(database, startUpdate(4, '/start invalid_payload', { languageCode: 'de' }), { requestId: 'req-4' });
    assert.match(sentMessages[3].text, /telefon numaranızı paylaşın/i);

    await bot.handleUpdate(database, startUpdate(5, '/start recover_tk', { languageCode: 'en' }), { requestId: 'req-5' });
    assert.match(sentMessages[4].text, /telefon belgiňizi paýlaşyň/i);
});

test('full flow replies with existing reference number and resume URL without access code in all 5 languages', async () => {
    const applications = new Map([
        ['TEST-2026-0001', {
            applicationId: 'app-0001',
            referenceNumber: 'ITU-7K9M-4X2P',
            studentEmail: 'student@example.invalid',
            studentPhone: '+90 (555) 000-01-01',
            language: 'tr'
        }]
    ]);

    let updateId = 10;
    for (const [index, locale] of ['tr', 'en', 'ru', 'tk', 'ar'].entries()) {
        // Her dil yinelemesinde başvuru başına günlük hız sınırına takılmamak için temiz bellek içi sınırlayıcı kullanılır.
        const harness = createBotHarness({ applicationsByStudentNumber: applications });
        const userId = 1001 + index;
        await harness.bot.handleUpdate(null, startUpdate(updateId++, `/start recover_${locale}`, { userId, chatId: userId }), { requestId: `req-s-${locale}` });
        await harness.bot.handleUpdate(null, contactUpdate(updateId++, { phoneNumber: '905550000101', userId, chatId: userId, languageCode: 'en' }), { requestId: `req-c-${locale}` });

        const askStudentMsg = harness.sentMessages[harness.sentMessages.length - 1];
        assert.equal(askStudentMsg.reply_markup.force_reply, true);
        assert.equal(Object.hasOwn(askStudentMsg.reply_markup, 'selective'), false);
        assert.ok(askStudentMsg.text.startsWith(TELEGRAM_RECOVERY_MESSAGES[locale].askStudentNumber));
        assert.match(askStudentMsg.text, /\nref:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        assert.equal(askStudentMsg.text.includes(FAKE_STATE_SECRET), false);

        const verifyResult = await harness.bot.handleUpdate(
            null,
            replyUpdate(updateId++, 'test-2026-0001', { message_id: 2, from: { is_bot: true }, text: askStudentMsg.text }, { userId, chatId: userId }),
            { requestId: `req-v-${locale}` }
        );

        assert.equal(verifyResult.outcome, 'recovered');
        assert.equal(verifyResult.language, locale);
        const successText = harness.sentMessages[harness.sentMessages.length - 1].text;
        assert.equal(successText, TELEGRAM_RECOVERY_MESSAGES[locale].success('ITU-7K9M-4X2P', RESUME_PORTAL_URL));
        assert.match(successText, /ITU-7K9M-4X2P/);
        assert.ok(successText.includes(RESUME_PORTAL_URL));
        assert.doesNotMatch(successText, ACCESS_CODE_PATTERN);
        assert.equal(successText.includes(FAKE_STATE_SECRET), false);
        assert.equal(harness.lookupCalls.length, 1);
    }
});

test('wrong phone match and missing record return the exact same generic mismatch message', async () => {
    const applications = new Map([
        ['TEST-2026-0002', {
            applicationId: 'app-0002',
            referenceNumber: 'ITU-2A3B-4C5D',
            studentEmail: 'student2@example.invalid',
            studentPhone: '+905550000202',
            language: 'tr'
        }]
    ]);
    const harness = createBotHarness({ applicationsByStudentNumber: applications });

    await harness.bot.handleUpdate(null, contactUpdate(20, { phoneNumber: '+905550000101' }), { requestId: 'req-20' });
    const promptText = harness.sentMessages[0].text;

    const wrongPhoneResult = await harness.bot.handleUpdate(
        null,
        replyUpdate(21, 'TEST-2026-0002', { message_id: 1, from: { is_bot: true }, text: promptText }),
        { requestId: 'req-21' }
    );
    const missingRecordResult = await harness.bot.handleUpdate(
        null,
        replyUpdate(22, 'UNKNOWN-9999', { message_id: 1, from: { is_bot: true }, text: promptText }),
        { requestId: 'req-22' }
    );

    assert.equal(wrongPhoneResult.outcome, 'mismatch');
    assert.equal(missingRecordResult.outcome, 'mismatch');
    assert.equal(harness.sentMessages[1].text, GENERIC_MISMATCH_TR);
    assert.equal(harness.sentMessages[2].text, GENERIC_MISMATCH_TR);
});

test('contact shared from another user or missing user_id is rejected without issuing a state token', async () => {
    const harness = createBotHarness();

    const foreignResult = await harness.bot.handleUpdate(
        null,
        contactUpdate(30, { phoneNumber: '+905550000101', contactUserId: 9999, userId: 1001 }),
        { requestId: 'req-30' }
    );
    const missingUserIdResult = await harness.bot.handleUpdate(
        null,
        contactUpdate(31, { phoneNumber: '+905550000101', contactUserId: undefined, userId: 1001 }),
        { requestId: 'req-31' }
    );

    assert.equal(foreignResult.outcome, 'rejected_foreign_contact');
    assert.equal(missingUserIdResult.outcome, 'rejected_foreign_contact');
    assert.doesNotMatch(harness.sentMessages[0].text, /ref:/);
    assert.doesNotMatch(harness.sentMessages[1].text, /ref:/);
    assert.equal(harness.lookupCalls.length, 0);
});

test('tampered, non-bot, cross-user, and expired state tokens fail closed with generic mismatch message', async () => {
    const applications = new Map([
        ['TEST-2026-0003', {
            applicationId: 'app-0003',
            referenceNumber: 'ITU-3E4F-5G6H',
            studentEmail: 'student3@example.invalid',
            studentPhone: '+905550000303',
            language: 'tr'
        }]
    ]);
    const harness = createBotHarness({ applicationsByStudentNumber: applications });

    await harness.bot.handleUpdate(null, contactUpdate(40, { phoneNumber: '+905550000303', userId: 1001 }), { requestId: 'req-40' });
    const validPromptText = harness.sentMessages[0].text;
    const tamperedPromptText = validPromptText.slice(0, -1) + (validPromptText.endsWith('A') ? 'B' : 'A');

    // Kurcalanmış imza
    await harness.bot.handleUpdate(
        null,
        replyUpdate(41, 'TEST-2026-0003', { message_id: 1, from: { is_bot: true }, text: tamperedPromptText }, { userId: 1001 }),
        { requestId: 'req-41' }
    );
    // Bot olmayan mesaj yanıtı
    await harness.bot.handleUpdate(
        null,
        replyUpdate(42, 'TEST-2026-0003', { message_id: 1, from: { is_bot: false }, text: validPromptText }, { userId: 1001 }),
        { requestId: 'req-42' }
    );
    // Başka kullanıcıya ait durum belirteci
    await harness.bot.handleUpdate(
        null,
        replyUpdate(43, 'TEST-2026-0003', { message_id: 1, from: { is_bot: true }, text: validPromptText }, { userId: 2002 }),
        { requestId: 'req-43' }
    );
    // Süresi dolmuş durum belirteci (10 dakika + 1 saniye)
    harness.advanceSeconds(601);
    await harness.bot.handleUpdate(
        null,
        replyUpdate(44, 'TEST-2026-0003', { message_id: 1, from: { is_bot: true }, text: validPromptText }, { userId: 1001 }),
        { requestId: 'req-44' }
    );

    assert.equal(harness.lookupCalls.length, 0);
    for (const index of [1, 2, 3, 4]) {
        assert.equal(harness.sentMessages[index].text, GENERIC_MISMATCH_TR);
    }
});

test('repeated update_id is ignored idempotently, including against D1 public_rate_limits', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const applications = new Map([
        ['TEST-2026-0004', {
            applicationId: 'app-0004',
            referenceNumber: 'ITU-4J5K-6L7M',
            studentEmail: 'student4@example.invalid',
            studentPhone: '+905550000404',
            language: 'tr'
        }]
    ]);
    const harness = createBotHarness({
        applicationsByStudentNumber: applications,
        rateLimiter: undefined,
        database
    });

    await harness.bot.handleUpdate(database, contactUpdate(50, { phoneNumber: '+905550000404' }), { requestId: 'req-50' });
    const promptText = harness.sentMessages[0].text;
    const duplicateReply = replyUpdate(51, 'TEST-2026-0004', { message_id: 1, from: { is_bot: true }, text: promptText });

    const first = await harness.bot.handleUpdate(database, duplicateReply, { requestId: 'req-51a' });
    const second = await harness.bot.handleUpdate(database, duplicateReply, { requestId: 'req-51b' });

    assert.equal(first.outcome, 'recovered');
    assert.equal(second.handled, false);
    assert.equal(second.reason, 'duplicate_update');
    assert.equal(harness.sentMessages.length, 2);
});

test('daily rate limits enforce 3 attempts per Telegram user and 3 attempts per application', async () => {
    const applications = new Map([
        ['TEST-2026-0005', {
            applicationId: 'app-0005',
            referenceNumber: 'ITU-5N6P-7Q8R',
            studentEmail: 'student5@example.invalid',
            studentPhone: '+905550000505',
            language: 'tr'
        }]
    ]);
    const harness = createBotHarness({ applicationsByStudentNumber: applications });

    let nextUpdateId = 60;
    async function attemptRecovery({ userId, chatId = userId, studentNumber = 'TEST-2026-0005' }) {
        const contactUpdateId = nextUpdateId++;
        const contactStep = await harness.bot.handleUpdate(
            null,
            contactUpdate(contactUpdateId, { phoneNumber: '+905550000505', userId, chatId }),
            { requestId: `req-${contactUpdateId}` }
        );
        assert.equal(contactStep.outcome, 'awaiting_student_number');
        const promptText = harness.sentMessages[harness.sentMessages.length - 1].text;
        const replyUpdateId = nextUpdateId++;
        return harness.bot.handleUpdate(
            null,
            replyUpdate(replyUpdateId, studentNumber, { message_id: 1, from: { is_bot: true }, text: promptText }, { userId, chatId }),
            { requestId: `req-${replyUpdateId}` }
        );
    }

    // Kullanıcı 1001 aynı gün 3 kez başarılı hatırlatma alır.
    let recoveredCount = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const res = await attemptRecovery({ userId: 1001 });
        assert.equal(res.outcome, 'recovered');
        recoveredCount += 1;
    }
    assert.equal(recoveredCount, 3);

    // Aynı kullanıcının 4. denemesi kullanıcı limiti nedeniyle engellenir.
    const userLimited = await attemptRecovery({ userId: 1001 });
    assert.equal(userLimited.outcome, 'rate_limited_user');

    // Farklı bir Telegram kullanıcısı aynı başvuruyu 4. kez sorgulamaya çalışırsa başvuru limiti engeller.
    const appLimited = await attemptRecovery({ userId: 2002, chatId: 2002 });
    assert.equal(appLimited.outcome, 'rate_limited_application');

    // 24 saat sonra her iki sınır da sıfırlanır.
    harness.advanceSeconds(24 * 60 * 60 + 1);
    const nextDayResult = await attemptRecovery({ userId: 1001 });
    assert.equal(nextDayResult.outcome, 'recovered');
});

test('real accessRecoveryService and D1 rate limits share the 3/day per-application quota between email and Telegram without rotating access code', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const repositories = createD1Repositories(database);
    const initialCode = generateAccessCode();
    const initialHash = await hashAccessCode(initialCode);
    const nowMs = Date.UTC(2026, 10, 16, 12, 0, 0);
    const nowIso = new Date(nowMs).toISOString();
    const nowSeconds = Math.floor(nowMs / 1000);

    const application = await repositories.applications.createDraftWithSession({
        applicationId: crypto.randomUUID(),
        studentId: crypto.randomUUID(),
        studentNumber: 'SYN-TG-REAL-01',
        applicationType: 'initial',
        studentEmail: 'tg-real@example.invalid',
        studentPhone: '+905550000777',
        sessionId: crypto.randomUUID(),
        tokenHash: await hashSessionToken(createOpaqueSessionToken()),
        expiresAt: new Date(nowMs + 3600_000).toISOString(),
        createdAt: nowIso,
        auditEventId: crypto.randomUUID(),
        requestId: 'req-tg-seed-1',
        accessCodeHash: initialHash
    });

    // E-posta hatırlatma kotasından 2 hak tüketilir; geriye aynı başvuru için 1 hak kalır.
    assert.equal(await consumeRecoveryApplicationRateLimit(repositories.rateLimits, {
        applicationId: application.id,
        nowSeconds
    }), true);
    assert.equal(await consumeRecoveryApplicationRateLimit(repositories.rateLimits, {
        applicationId: application.id,
        nowSeconds
    }), true);

    const sentMessages = [];
    const bot = createTelegramRecoveryBot({
        findRecoverableApplication,
        sendTelegramMessage: async (payload) => {
            sentMessages.push(payload);
            return { message_id: sentMessages.length };
        },
        rateLimiter: repositories.rateLimits,
        resumePortalUrl: RESUME_PORTAL_URL,
        stateSecret: FAKE_STATE_SECRET,
        now: () => nowMs
    });

    // 3. hak Telegram üzerinden kullanılır ve mevcut başvuru numarası döndürülür; erişim kodu değişmez.
    await bot.handleUpdate(database, contactUpdate(100, { phoneNumber: '905550000777', userId: 5001 }), { requestId: 'req-tg-real-1' });
    const thirdRecovery = await bot.handleUpdate(
        database,
        replyUpdate(101, 'syn-tg-real-01', { message_id: 1, from: { is_bot: true }, text: sentMessages[0].text }, { userId: 5001 }),
        { requestId: 'req-tg-real-2' }
    );
    assert.equal(thirdRecovery.outcome, 'recovered');

    const unchangedRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE id = ?')
        .bind(application.id)
        .first();
    assert.equal(unchangedRow.access_code_version, 1);
    assert.equal(unchangedRow.access_code_hash, initialHash);
    assert.equal(await verifyAccessCode(initialCode, unchangedRow.access_code_hash), true);
    assert.ok(sentMessages[1].text.includes(application.reference_number));
    assert.ok(sentMessages[1].text.includes(RESUME_PORTAL_URL));
    assert.doesNotMatch(sentMessages[1].text, ACCESS_CODE_PATTERN);

    // Aynı gün 4. deneme (farklı Telegram kullanıcısı veya e-posta) ortak başvuru sınırına takılır.
    await bot.handleUpdate(database, contactUpdate(102, { phoneNumber: '905550000777', userId: 5002 }), { requestId: 'req-tg-real-3' });
    const fourthRecovery = await bot.handleUpdate(
        database,
        replyUpdate(103, 'SYN-TG-REAL-01', { message_id: 2, from: { is_bot: true }, text: sentMessages[2].text }, { userId: 5002 }),
        { requestId: 'req-tg-real-4' }
    );
    assert.equal(fourthRecovery.outcome, 'rate_limited_application');
    assert.equal(await consumeRecoveryApplicationRateLimit(repositories.rateLimits, {
        applicationId: application.id,
        nowSeconds
    }), false);
});

test('step 2 and step 3 keep /start payload language when from.language_code differs, and no message sets selective', async () => {
    const applications = new Map([
        ['SYN-LANG-2026', {
            applicationId: 'app-lang-1',
            referenceNumber: 'ITU-9R8T-7Y6U',
            studentEmail: 'lang-test@example.invalid',
            studentPhone: '+905550000888',
            language: 'ru'
        }]
    ]);

    // 1. Sahte bellek içi hız sınırlayıcı ile doğrulama
    const memoryHarness = createBotHarness({ applicationsByStudentNumber: applications });
    await memoryHarness.bot.handleUpdate(null, startUpdate(200, '/start recover_tr', { userId: 7001, chatId: 8001, languageCode: 'ru' }));
    await memoryHarness.bot.handleUpdate(null, contactUpdate(201, { phoneNumber: '+905550000888', userId: 7001, chatId: 8001, languageCode: 'ru' }));

    const memoryAskStudent = memoryHarness.sentMessages[1];
    assert.ok(memoryAskStudent.text.startsWith(TELEGRAM_RECOVERY_MESSAGES.tr.askStudentNumber));
    assert.equal(memoryAskStudent.reply_markup.force_reply, true);
    assert.equal(Object.hasOwn(memoryAskStudent.reply_markup, 'selective'), false);

    const memoryReply = await memoryHarness.bot.handleUpdate(
        null,
        replyUpdate(202, 'SYN-LANG-2026', { message_id: 2, from: { is_bot: true }, text: memoryAskStudent.text }, { userId: 7001, chatId: 8001, languageCode: 'ru' })
    );
    assert.equal(memoryReply.language, 'tr');
    assert.match(memoryHarness.sentMessages[2].text, /Başvuru numaranız: ITU-9R8T-7Y6U/);
    for (const sent of memoryHarness.sentMessages) {
        if (sent.reply_markup) {
            assert.equal(Object.hasOwn(sent.reply_markup, 'selective'), false);
        }
    }

    // 2. Gerçek TestD1Database (public_rate_limits) ile doğrulama ve ham kimlik/sohbet kimliği saklanmadığının kontrolü
    const database = new TestD1Database();
    applyAllMigrations(database);
    const d1Harness = createBotHarness({
        applicationsByStudentNumber: applications,
        rateLimiter: undefined,
        database
    });

    await d1Harness.bot.handleUpdate(database, startUpdate(210, '/start recover_tr', { userId: 7002, chatId: 9002, languageCode: 'ru' }));
    await d1Harness.bot.handleUpdate(database, contactUpdate(211, { phoneNumber: '+905550000888', userId: 7002, chatId: 9002, languageCode: 'ru' }));

    const d1AskStudent = d1Harness.sentMessages[1];
    assert.ok(d1AskStudent.text.startsWith(TELEGRAM_RECOVERY_MESSAGES.tr.askStudentNumber));
    assert.equal(d1AskStudent.reply_markup.force_reply, true);
    assert.equal(Object.hasOwn(d1AskStudent.reply_markup, 'selective'), false);

    const d1Reply = await d1Harness.bot.handleUpdate(
        database,
        replyUpdate(212, 'SYN-LANG-2026', { message_id: 2, from: { is_bot: true }, text: d1AskStudent.text }, { userId: 7002, chatId: 9002, languageCode: 'ru' })
    );
    assert.equal(d1Reply.outcome, 'recovered');
    assert.equal(d1Reply.language, 'tr');
    assert.match(d1Harness.sentMessages[2].text, /Başvuru numaranız: ITU-9R8T-7Y6U/);

    const storedRows = database.prepare('SELECT endpoint, request_key_hash FROM public_rate_limits').all().results;
    const langRows = storedRows.filter((row) => row.endpoint.startsWith('telegram-recovery-lang-'));
    assert.equal(langRows.length, 1);
    assert.equal(langRows[0].endpoint, 'telegram-recovery-lang-tr');
    assert.match(langRows[0].request_key_hash, /^[0-9a-f]{64}$/);
    for (const row of storedRows) {
        assert.equal(row.request_key_hash.includes('7002'), false);
        assert.equal(row.request_key_hash.includes('9002'), false);
    }
});

test('plain text without reply_to_message gives localized reply instruction after /start and falls back to usageHint without memory or after expiry', async () => {
    const harness = createBotHarness();

    // Bellek yokken genel usageHint döndürülmeli
    const coldHint = await harness.bot.handleUpdate(null, {
        update_id: 300,
        message: {
            message_id: 300,
            from: { id: 4001, is_bot: false, language_code: 'en' },
            chat: { id: 4001, type: 'private' },
            text: 'SYN-NO-START'
        }
    });
    assert.equal(coldHint.step, 'hint');
    assert.equal(coldHint.language, 'en');
    assert.equal(harness.sentMessages[0].text, TELEGRAM_RECOVERY_MESSAGES.en.usageHint);

    // 5 dilde /start sonrası reply_to_message olmadan düz metin gönderildiğinde hatırlanan dilde yanıt talimatı verilmeli
    let nextUpdateId = 310;
    const clientLanguageOverrides = { tr: 'ru', en: 'tr', ru: 'en', tk: 'ar', ar: 'tk' };
    for (const [index, lang] of ['tr', 'en', 'ru', 'tk', 'ar'].entries()) {
        const userId = 4100 + index;
        const clientLang = clientLanguageOverrides[lang];
        await harness.bot.handleUpdate(null, startUpdate(nextUpdateId++, `/start recover_${lang}`, { userId, chatId: userId, languageCode: clientLang }));
        const plainRes = await harness.bot.handleUpdate(null, {
            update_id: nextUpdateId++,
            message: {
                message_id: nextUpdateId,
                from: { id: userId, is_bot: false, language_code: clientLang },
                chat: { id: userId, type: 'private' },
                text: 'SYN-PLAIN-TEXT'
            }
        });
        assert.equal(plainRes.step, 'hint');
        assert.equal(plainRes.outcome, 'reply_required');
        assert.equal(plainRes.language, lang);
        assert.equal(harness.sentMessages[harness.sentMessages.length - 1].text, TELEGRAM_RECOVERY_MESSAGES[lang].replyInstruction);
    }

    // 15 dakikalık pencere dolduktan sonra eski usageHint davranışına dönülmeli
    harness.advanceSeconds(901);
    const expiredHint = await harness.bot.handleUpdate(null, {
        update_id: nextUpdateId++,
        message: {
            message_id: nextUpdateId,
            from: { id: 4100, is_bot: false, language_code: 'ru' },
            chat: { id: 4100, type: 'private' },
            text: 'SYN-AFTER-EXPIRY'
        }
    });
    assert.equal(expiredHint.step, 'hint');
    assert.equal(expiredHint.outcome, undefined);
    assert.equal(expiredHint.language, 'ru');
    assert.equal(harness.sentMessages[harness.sentMessages.length - 1].text, TELEGRAM_RECOVERY_MESSAGES.ru.usageHint);
});
