import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTelegramRecoveryBot, normalizeTelegramPhone } from '../src/server/services/telegramBot.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const FAKE_STATE_SECRET = 'synthetic-telegram-webhook-secret-for-tests';
const GENERIC_MISMATCH_TR = 'Bilgiler eşleşmedi; e-posta yolunu deneyin veya ofisle iletişime geçin.';

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
        }
    };
}

function createBotHarness({
    applicationsByStudentNumber = new Map(),
    rotatedCode = '23456-789AB-CDEFG-HJKLM-NPQRST',
    initialNowMs = Date.UTC(2026, 10, 16, 10, 0, 0),
    rateLimiter = createMemoryRateLimiter(),
    database = null
} = {}) {
    let currentNowMs = initialNowMs;
    const sentMessages = [];
    const lookupCalls = [];
    const rotateCalls = [];

    const bot = createTelegramRecoveryBot({
        findRecoverableApplication: async (_db, { studentNumber }) => {
            lookupCalls.push(studentNumber);
            return applicationsByStudentNumber.get(studentNumber.trim().toUpperCase()) ?? null;
        },
        rotateAccessCodeForRecovery: async (_db, input) => {
            rotateCalls.push(input);
            return rotatedCode ? { accessCode: rotatedCode } : null;
        },
        sendTelegramMessage: async (payload) => {
            sentMessages.push(payload);
            return { message_id: sentMessages.length };
        },
        rateLimiter,
        stateSecret: FAKE_STATE_SECRET,
        now: () => currentNowMs
    });

    return {
        bot,
        database,
        sentMessages,
        lookupCalls,
        rotateCalls,
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

test('full recovery flow succeeds when normalized student_phone and student number match an active application', async () => {
    const applications = new Map([
        ['TEST-2026-0001', {
            applicationId: 'app-0001',
            referenceNumber: 'ITU-7K9M-4X2P',
            studentEmail: 'student@example.invalid',
            studentPhone: '+90 (555) 000-01-01',
            language: 'tr'
        }]
    ]);
    const harness = createBotHarness({ applicationsByStudentNumber: applications });

    await harness.bot.handleUpdate(null, startUpdate(10, '/start recover_tr'), { requestId: 'req-10' });
    await harness.bot.handleUpdate(null, contactUpdate(11, { phoneNumber: '905550000101', languageCode: 'en' }), { requestId: 'req-11' });

    const askStudentMsg = harness.sentMessages[1];
    assert.equal(askStudentMsg.reply_markup.force_reply, true);
    assert.match(askStudentMsg.text, /\nref:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(askStudentMsg.text.includes(FAKE_STATE_SECRET), false);

    const verifyResult = await harness.bot.handleUpdate(
        null,
        replyUpdate(12, 'test-2026-0001', { message_id: 2, from: { is_bot: true }, text: askStudentMsg.text }),
        { requestId: 'req-12' }
    );

    assert.equal(verifyResult.outcome, 'recovered');
    assert.deepEqual(harness.lookupCalls, ['test-2026-0001']);
    assert.equal(harness.rotateCalls.length, 1);
    assert.equal(harness.rotateCalls[0].applicationId, 'app-0001');
    assert.equal(harness.rotateCalls[0].channel, 'telegram');
    assert.equal(harness.rotateCalls[0].requestId, 'req-12');

    const successText = harness.sentMessages[2].text;
    assert.match(successText, /ITU-7K9M-4X2P/);
    assert.match(successText, /23456-789AB-CDEFG-HJKLM-NPQRST/);
    assert.equal(successText.includes(FAKE_STATE_SECRET), false);
});

test('wrong phone match and missing record return the exact same generic mismatch message without rotating code', async () => {
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
    assert.equal(harness.rotateCalls.length, 0);
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
    assert.equal(harness.rotateCalls.length, 0);
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
    assert.equal(harness.rotateCalls.length, 0);
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
    assert.equal(harness.rotateCalls.length, 1);
    assert.equal(harness.sentMessages.length, 2);
});

test('daily rate limits enforce 3 attempts per Telegram user and 3 rotations per application', async () => {
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

    // Kullanıcı 1001 aynı gün 3 kez başarılı kurtarma yapar.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const res = await attemptRecovery({ userId: 1001 });
        assert.equal(res.outcome, 'recovered');
    }
    assert.equal(harness.rotateCalls.length, 3);

    // Aynı kullanıcının 4. denemesi kullanıcı limiti nedeniyle engellenir.
    const userLimited = await attemptRecovery({ userId: 1001 });
    assert.equal(userLimited.outcome, 'rate_limited_user');
    assert.equal(harness.rotateCalls.length, 3);

    // Farklı bir Telegram kullanıcısı aynı başvuruyu 4. kez döndürmeye çalışırsa başvuru limiti engeller.
    const appLimited = await attemptRecovery({ userId: 2002, chatId: 2002 });
    assert.equal(appLimited.outcome, 'rate_limited_application');
    assert.equal(harness.rotateCalls.length, 3);

    // 24 saat sonra her iki sınır da sıfırlanır.
    harness.advanceSeconds(24 * 60 * 60 + 1);
    const nextDayResult = await attemptRecovery({ userId: 1001 });
    assert.equal(nextDayResult.outcome, 'recovered');
    assert.equal(harness.rotateCalls.length, 4);
});
