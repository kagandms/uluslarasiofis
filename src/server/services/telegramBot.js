import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { normalizePhoneNumber } from '../../shared/phoneNumber.js';
import { createRateLimitRepository } from '../repositories/d1/rateLimitRepository.js';
import { consumePublicRateLimit, hashRateLimitIdentity } from '../security/requestRateLimit.js';
import {
    RECOVERY_APPLICATION_DAILY_LIMIT,
    RECOVERY_TELEGRAM_USER_DAILY_LIMIT
} from './accessRecoveryService.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const STATE_KEY_DOMAIN = 'telegram-recovery-state-v1';
const STATE_TTL_SECONDS = 10 * 60;
const DAY_SECONDS = 24 * 60 * 60;
export const TELEGRAM_LANGUAGE_MEMORY_WINDOW_SECONDS = 15 * 60;
const TELEGRAM_LANGUAGE_MEMORY_MAX_REQUESTS = 1_000_000;
const TELEGRAM_LANGUAGE_MEMORY_ENDPOINT_PREFIX = 'telegram-recovery-lang-';
const DEFAULT_PORTAL_ORIGIN = 'https://topkapiunigoc.com';
const DEFAULT_RESUME_PORTAL_URL = `${DEFAULT_PORTAL_ORIGIN}/basvuruya-devam-et/`;
const STUDENT_NUMBER_PROMPT_EMOJI = '🔐';

export const SUPPORTED_TELEGRAM_LANGUAGES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);
const SUPPORTED_LANGUAGE_SET = new Set(SUPPORTED_TELEGRAM_LANGUAGES);

const UPDATE_IDEMPOTENCY_LIMIT = Object.freeze({
    endpoint: 'telegram-recovery-update',
    maxRequests: 1,
    windowSeconds: DAY_SECONDS
});

export const TELEGRAM_RECOVERY_MESSAGES = Object.freeze({
    tr: Object.freeze({
        askContact: 'Başvuru numaranızı almak için lütfen aşağıdaki düğmeyle Telegram hesabınıza kayıtlı telefon numaranızı paylaşın.',
        sharePhoneButton: 'Telefon numaramı paylaş',
        contactRejected: 'Yalnızca kendi Telegram hesabınıza ait telefon numarasını paylaşabilirsiniz.',
        askStudentNumber: `${STUDENT_NUMBER_PROMPT_EMOJI} Lütfen bu mesajı yanıtlayarak öğrenci numaranızı yazın.`,
        studentNumberPlaceholder: 'Öğrenci numaranızı yazın',
        replyInstruction: 'Öğrenci numaranızı göndermek için lütfen botun bir önceki mesajını YANITLAYIN (mesaja basılı tutun veya sola kaydırıp Yanıtla’yı seçin) ve öğrenci numaranızı yazın. Baştan başlamak için /start gönderin.',
        mismatch: 'Bilgiler eşleşmedi; e-posta yolunu deneyin veya ofisle iletişime geçin.',
        rateLimited: 'Günlük deneme sınırına ulaşıldı. Lütfen daha sonra tekrar deneyin veya ofisle iletişime geçin.',
        usageHint: 'Başvuru numaranızı almak için /start komutunu gönderin.',
        copyButton: 'Numarayı Kopyala',
        openSiteButton: 'Siteye Git',
        success: (referenceNumber) => [
            `Başvuru numaranız: ${referenceNumber}`,
            '',
            'Devam etmek için aşağıdaki düğmeden siteye gidip başvuru numaranızı ve öğrenci numaranızı girin.'
        ].join('\n')
    }),
    en: Object.freeze({
        askContact: 'To get your application number, please share the phone number registered on your Telegram account using the button below.',
        sharePhoneButton: 'Share my phone number',
        contactRejected: 'You can only share the phone number belonging to your own Telegram account.',
        askStudentNumber: `${STUDENT_NUMBER_PROMPT_EMOJI} Please reply to this message with your student number.`,
        studentNumberPlaceholder: 'Type your student number',
        replyInstruction: 'To send your student number, please REPLY to the bot’s previous message (press and hold or swipe the message and choose Reply) and type your student number, or send /start to restart.',
        mismatch: 'Details did not match; try the email recovery option or contact the office.',
        rateLimited: 'Daily attempt limit reached. Please try again later or contact the office.',
        usageHint: 'Send /start to get your application number.',
        copyButton: 'Copy Number',
        openSiteButton: 'Open Website',
        success: (referenceNumber) => [
            `Your application number: ${referenceNumber}`,
            '',
            'To continue, open the website using the button below and enter your application number and student number.'
        ].join('\n')
    }),
    ru: Object.freeze({
        askContact: 'Чтобы получить номер заявки, поделитесь номером телефона, привязанным к вашему аккаунту Telegram, с помощью кнопки ниже.',
        sharePhoneButton: 'Поделиться номером телефона',
        contactRejected: 'Вы можете поделиться только номером телефона, принадлежащим вашему аккаунту Telegram.',
        askStudentNumber: `${STUDENT_NUMBER_PROMPT_EMOJI} Пожалуйста, ответьте на это сообщение и укажите ваш студенческий номер.`,
        studentNumberPlaceholder: 'Введите номер студента',
        replyInstruction: 'Чтобы отправить студенческий номер, пожалуйста, ОТВЕТЬТЕ на предыдущее сообщение бота (нажмите и удерживайте или смахните сообщение и выберите «Ответить») и введите номер студента, либо отправьте /start, чтобы начать заново.',
        mismatch: 'Данные не совпали; попробуйте восстановление по электронной почте или обратитесь в офис.',
        rateLimited: 'Достигнут дневной лимит попыток. Попробуйте позже или обратитесь в офис.',
        usageHint: 'Отправьте /start, чтобы получить номер вашей заявки.',
        copyButton: 'Скопировать номер',
        openSiteButton: 'Перейти на сайт',
        success: (referenceNumber) => [
            `Номер вашей заявки: ${referenceNumber}`,
            '',
            'Чтобы продолжить, перейдите на сайт по кнопке ниже и введите номер заявки и номер студента.'
        ].join('\n')
    }),
    tk: Object.freeze({
        askContact: 'Arza belgiňizi almak üçin aşakdaky düwme arkaly Telegram hasabyňyza birikdirilen telefon belgiňizi paýlaşyň.',
        sharePhoneButton: 'Telefon belgimi paýlaş',
        contactRejected: 'Diňe öz Telegram hasabyňyza degişli telefon belgini paýlaşyp bilersiňiz.',
        askStudentNumber: `${STUDENT_NUMBER_PROMPT_EMOJI} Bu habara jogap berip talyp belgiňizi ýazyň.`,
        studentNumberPlaceholder: 'Talyp belgiňizi ýazyň',
        replyInstruction: 'Talyp belgiňizi ibermek üçin botuň öňki habaryna JOGAP BERIŇ (habara basyp saklaň ýa-da süýşürip Jogap ber saýlaň) we talyp belgiňizi ýazyň, ýa-da täzeden başlamak üçin /start iberiň.',
        mismatch: 'Maglumatlar gabat gelmedi; e-poçta ýoluny synap görüň ýa-da ofis bilen habarlaşyň.',
        rateLimited: 'Gündelik synanyşyk çägine ýetildi. Soňrak täzeden synanyşyň ýa-da ofis bilen habarlaşyň.',
        usageHint: 'Arza belgiňizi almak üçin /start buýrugyny iberiň.',
        copyButton: 'Belgini göçür',
        openSiteButton: 'Sahypa git',
        success: (referenceNumber) => [
            `Arza belgiňiz: ${referenceNumber}`,
            '',
            'Dowam etmek üçin aşakdaky düwme arkaly sahypa girip, arza belgiňizi we talyp belgiňizi giriziň.'
        ].join('\n')
    }),
    ar: Object.freeze({
        askContact: 'للحصول على رقم طلبك، يرجى مشاركة رقم الهاتف المسجل في حسابك على تيليجرام باستخدام الزر أدناه.',
        sharePhoneButton: 'مشاركة رقم هاتفي',
        contactRejected: 'يمكنك فقط مشاركة رقم الهاتف المرتبط بحسابك الشخصي على تيليجرام.',
        askStudentNumber: `${STUDENT_NUMBER_PROMPT_EMOJI} يرجى الرد على هذه الرسالة بكتابة رقم الطالب الخاص بك.`,
        studentNumberPlaceholder: 'اكتب رقم الطالب الخاص بك',
        replyInstruction: 'لإرسال رقم الطالب الخاص بك، يرجى الرد على رسالة البوت السابقة (اضغط مطولاً أو اسحب الرسالة واختر «رد») ثم اكتب رقم الطالب، أو أرسل /start للبدء من جديد.',
        mismatch: 'لم تتطابق البيانات؛ جرّب الاسترداد عبر البريد الإلكتروني أو تواصل مع المكتب.',
        rateLimited: 'تم بلوغ الحد اليومي للمحاولات. يرجى المحاولة لاحقًا أو التواصل مع المكتب.',
        usageHint: 'أرسل /start للحصول على رقم طلبك.',
        copyButton: 'نسخ الرقم',
        openSiteButton: 'فتح الموقع',
        success: (referenceNumber) => [
            `رقم طلبك: ${referenceNumber}`,
            '',
            'للمتابعة، افتح الموقع من الزر أدناه وأدخل رقم الطلب ورقم الطالب.'
        ].join('\n')
    })
});

function constantTimeEqualBytes(left, right) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
    if (left.length !== right.length) return false;
    if (typeof crypto?.subtle?.timingSafeEqual === 'function') {
        return crypto.subtle.timingSafeEqual(left, right);
    }
    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
        mismatch |= left[index] ^ right[index];
    }
    return mismatch === 0;
}

function constantTimeEqualStrings(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    return constantTimeEqualBytes(encoder.encode(left), encoder.encode(right));
}

function toBase64Url(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length % 4 === 1) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const padLength = (4 - (value.length % 4)) % 4;
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    } catch {
        return null;
    }
}

/**
 * İki farklı kaynaktan (başvuru ve Telegram kişi kartı) gelen telefonları ortak biçime indirger.
 * @param {unknown} rawPhone Ham telefon metni.
 * @returns {string} Karşılaştırmaya uygun telefon metni; geçersizse boş metin.
 */
export function normalizeTelegramPhone(rawPhone) {
    const cleaned = normalizePhoneNumber(rawPhone);
    if (!cleaned || cleaned.length > 40) return '';
    if (cleaned.startsWith('+')) {
        const parsed = parsePhoneNumberFromString(cleaned, { extract: false });
        if (parsed?.isValid()) return parsed.number;
        const digits = cleaned.slice(1).replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) {
            return `+${digits}`;
        }
        return '';
    }
    const digits = cleaned.replace(/\D/g, '');
    if (cleaned.startsWith('00') && digits.length >= 10) {
        const internationalDigits = digits.slice(2);
        const parsed = parsePhoneNumberFromString(`+${internationalDigits}`, { extract: false });
        if (parsed?.isValid()) return parsed.number;
        if (internationalDigits.length >= 8 && internationalDigits.length <= 15 && !internationalDigits.startsWith('0')) {
            return `+${internationalDigits}`;
        }
        return '';
    }
    if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) {
        const parsed = parsePhoneNumberFromString(`+${digits}`, { extract: false });
        return parsed?.isValid() ? parsed.number : `+${digits}`;
    }
    // Ülke kodu olmayan yerel numaralar varsayımsal olarak Türkiye kabul edilmez.
    if (digits.length >= 7 && digits.length <= 15) return digits;
    return '';
}

/**
 * Telegram mesajı için kullanılacak arayüz dilini öncelik sırasına göre seçer.
 * @param {unknown} startPayloadLang `/start recover_<lang>` içinden ayrıştırılan dil.
 * @param {unknown} fromLanguageCode Telegram kullanıcısının `language_code` alanı.
 * @returns {'tr'|'en'|'ru'|'tk'|'ar'} Desteklenen dil kodu.
 */
export function resolveTelegramLanguage(startPayloadLang, fromLanguageCode) {
    if (typeof startPayloadLang === 'string') {
        const candidate = startPayloadLang.trim().toLowerCase();
        if (SUPPORTED_LANGUAGE_SET.has(candidate)) return candidate;
    }
    if (typeof fromLanguageCode === 'string') {
        const base = fromLanguageCode.trim().toLowerCase().split(/[-_]/)[0];
        if (SUPPORTED_LANGUAGE_SET.has(base)) return base;
    }
    return 'tr';
}

function readNowEpochMs(now) {
    if (typeof now !== 'function') return Date.now();
    const value = now();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
}

async function deriveStateHmacKey(secret) {
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new Error('Telegram kurtarma durum anahtarı yapılandırılmadı.');
    }
    const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const derived = await crypto.subtle.sign('HMAC', baseKey, encoder.encode(STATE_KEY_DOMAIN));
    return crypto.subtle.importKey(
        'raw',
        derived,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
}

async function signRecoveryStateToken({ phone, userId, language, expiryEpochSec }, secret) {
    const key = await deriveStateHmacKey(secret);
    const payloadJson = JSON.stringify({ p: phone, u: userId, l: language, e: expiryEpochSec });
    const payloadB64 = toBase64Url(encoder.encode(payloadJson));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64)));
    return `${payloadB64}.${toBase64Url(signature)}`;
}

async function verifyRecoveryStateToken(token, { expectedUserId, nowEpochSec, secret }) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const [payloadB64, signatureB64] = token.split('.');
    const providedSignature = fromBase64Url(signatureB64);
    if (!providedSignature || providedSignature.length !== 32) return null;

    const key = await deriveStateHmacKey(secret);
    const expectedSignature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64)));
    if (!constantTimeEqualBytes(expectedSignature, providedSignature)) return null;

    const payloadBytes = fromBase64Url(payloadB64);
    if (!payloadBytes) return null;
    let parsed;
    try {
        parsed = JSON.parse(decoder.decode(payloadBytes));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.p !== 'string' || parsed.p.length === 0 || parsed.p.length > 40) return null;
    if (!Number.isSafeInteger(parsed.u) || parsed.u !== expectedUserId) return null;
    if (!SUPPORTED_LANGUAGE_SET.has(parsed.l)) return null;
    if (!Number.isSafeInteger(parsed.e) || nowEpochSec > parsed.e) return null;

    return {
        phone: parsed.p,
        userId: parsed.u,
        language: parsed.l,
        expiryEpochSec: parsed.e
    };
}

function resolvePortalOrigin(portalUrl) {
    if (typeof portalUrl === 'string' && portalUrl.length > 0) {
        try {
            const parsed = new URL(portalUrl);
            if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) {
                return parsed.origin;
            }
        } catch {
            // Geçersiz portal URL'si gelirse varsayılan kanonik kökene dönülür.
        }
    }
    return DEFAULT_PORTAL_ORIGIN;
}

function extractRefTokenFromReply(replyToMessage) {
    if (!replyToMessage || typeof replyToMessage !== 'object') return null;
    if (replyToMessage.from?.is_bot !== true) return null;

    // Önce görünmez text_link varlığındaki `tg` sorgu parametresini oku.
    if (Array.isArray(replyToMessage.entities)) {
        for (const entity of replyToMessage.entities) {
            if (!entity || typeof entity !== 'object' || entity.type !== 'text_link' || typeof entity.url !== 'string') {
                continue;
            }
            let parsedUrl;
            try {
                parsedUrl = new URL(entity.url);
            } catch {
                continue;
            }
            if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
                continue;
            }
            const token = parsedUrl.searchParams.get('tg');
            if (typeof token === 'string' && token.length > 0) {
                return token;
            }
        }
    }

    // Sürüm öncesi gönderilmiş istemlerle geriye dönük uyumluluk için eski `ref:<token>` satırına düş.
    if (typeof replyToMessage.text !== 'string') return null;
    const match = /(?:^|\r?\n)ref:([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/.exec(replyToMessage.text);
    return match ? match[1] : null;
}

function parseStartCommand(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    const match = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([^\s]+))?(?:\s.*)?$/i.exec(trimmed);
    if (!match) return null;
    const payload = match[1] || '';
    const langMatch = /^recover_([a-z]{2})$/i.exec(payload);
    return {
        payloadLang: langMatch ? langMatch[1] : null
    };
}

async function consumeRateLimitSlot(rateLimiter, database, { endpoint, identity, nowSeconds, windowSeconds, maxRequests }) {
    const requestKeyHash = await hashRateLimitIdentity(identity);
    if (typeof rateLimiter === 'function') {
        return Boolean(await rateLimiter({ endpoint, identity, requestKeyHash, nowSeconds, windowSeconds, maxRequests }));
    }
    if (rateLimiter && typeof rateLimiter.consume === 'function') {
        const result = await rateLimiter.consume({ endpoint, identity, requestKeyHash, nowSeconds, windowSeconds, maxRequests });
        if (typeof result === 'boolean') return result;
        if (result && typeof result.allowed === 'boolean') return result.allowed;
        if (result && typeof result.request_count === 'number') {
            return result.request_count <= maxRequests && !(result.blocked_until > nowSeconds);
        }
        return false;
    }
    if (database && typeof database.prepare === 'function') {
        return consumePublicRateLimit(createRateLimitRepository(database), {
            endpoint,
            identity,
            nowSeconds,
            windowSeconds,
            maxRequests
        });
    }
    return true;
}

function isValidTelegramId(value) {
    return Number.isSafeInteger(value) && value !== 0;
}

/**
 * Kullanıcının son seçtiği kurtarma dilini `public_rate_limits` tablosunda 15 dakikalık pencerede hatırlar.
 * Sohbet kimliği veya ham kullanıcı kimliği yerine yalnızca `user:<id>` özetini saklar.
 * @param {{rateLimiter?: unknown, database?: unknown, userId: number, language: string, nowSeconds: number}} input
 * @returns {Promise<void>}
 */
export async function rememberTelegramRecoveryLanguage({ rateLimiter, database, userId, language, nowSeconds }) {
    if (!SUPPORTED_LANGUAGE_SET.has(language) || !isValidTelegramId(userId)) return;
    await consumeRateLimitSlot(rateLimiter, database, {
        endpoint: `${TELEGRAM_LANGUAGE_MEMORY_ENDPOINT_PREFIX}${language}`,
        identity: `user:${userId}`,
        nowSeconds,
        windowSeconds: TELEGRAM_LANGUAGE_MEMORY_WINDOW_SECONDS,
        maxRequests: TELEGRAM_LANGUAGE_MEMORY_MAX_REQUESTS
    });
}

/**
 * Kullanıcının son 15 dakika içinde başlattığı kurtarma akışındaki en güncel dili yazma yapmadan okur.
 * @param {{rateLimiter?: unknown, database?: unknown, userId: number, nowSeconds: number}} input
 * @returns {Promise<'tr'|'en'|'ru'|'tk'|'ar'|null>} Etkin penceredeki dil kodu veya null.
 */
export async function recallTelegramRecoveryLanguage({ rateLimiter, database, userId, nowSeconds }) {
    if (!isValidTelegramId(userId)) return null;
    const peekRepository = rateLimiter && typeof rateLimiter.peek === 'function'
        ? rateLimiter
        : (database && typeof database.prepare === 'function' ? createRateLimitRepository(database) : null);
    if (!peekRepository || typeof peekRepository.peek !== 'function') return null;

    const requestKeyHash = await hashRateLimitIdentity(`user:${userId}`);
    const entries = await Promise.all(
        SUPPORTED_TELEGRAM_LANGUAGES.map(async (language) => {
            const row = await peekRepository.peek({
                endpoint: `${TELEGRAM_LANGUAGE_MEMORY_ENDPOINT_PREFIX}${language}`,
                requestKeyHash,
                nowSeconds,
                windowSeconds: TELEGRAM_LANGUAGE_MEMORY_WINDOW_SECONDS
            });
            return { language, row };
        })
    );

    let selectedLanguage = null;
    let latestWindowStart = -Infinity;
    const minValidWindowStart = nowSeconds - TELEGRAM_LANGUAGE_MEMORY_WINDOW_SECONDS;
    for (const { language, row } of entries) {
        if (!row || typeof row.window_started_at !== 'number' || !Number.isFinite(row.window_started_at)) continue;
        if (row.window_started_at <= minValidWindowStart) continue;
        if (row.window_started_at > latestWindowStart) {
            latestWindowStart = row.window_started_at;
            selectedLanguage = language;
        }
    }
    return selectedLanguage;
}

/**
 * Veritabanında sohbet kimliği veya geçici durum saklamadan Telegram başvuru numarası hatırlatma botunu oluşturur.
 * @param {object} deps Bağımlılıklar: başvuru arama işlevi, mesaj gönderici, hız sınırlayıcı, telefon normalizasyonu, portal URL ve saat.
 * @returns {{handleUpdate(database: unknown, update: unknown, context?: {requestId?: string, stateSecret?: string, webhookSecret?: string, resumePortalUrl?: string}): Promise<object>}}
 */
export function createTelegramRecoveryBot({
    findRecoverableApplication,
    sendTelegramMessage,
    rateLimiter,
    normalizePhone = normalizeTelegramPhone,
    userDailyLimit = RECOVERY_TELEGRAM_USER_DAILY_LIMIT,
    applicationDailyLimit = RECOVERY_APPLICATION_DAILY_LIMIT,
    resumePortalUrl = DEFAULT_RESUME_PORTAL_URL,
    stateSecret,
    webhookSecret,
    now
} = {}) {
    if (typeof sendTelegramMessage !== 'function') {
        throw new TypeError('sendTelegramMessage function is required.');
    }

    return Object.freeze({
        async handleUpdate(database, update, context = {}) {
            if (!update || typeof update !== 'object') {
                return { handled: false, reason: 'ignored_update' };
            }
            if (!Number.isSafeInteger(update.update_id)) {
                return { handled: false, reason: 'ignored_update' };
            }
            const message = update.message;
            if (!message || typeof message !== 'object') {
                return { handled: false, reason: 'ignored_update' };
            }
            if (message.from?.is_bot === true) {
                return { handled: false, reason: 'ignored_bot' };
            }
            if (message.chat?.type && message.chat.type !== 'private') {
                return { handled: false, reason: 'ignored_non_private_chat' };
            }
            const chatId = message.chat?.id;
            const fromId = message.from?.id;
            if (!isValidTelegramId(chatId) || !isValidTelegramId(fromId)) {
                return { handled: false, reason: 'ignored_update' };
            }

            const nowMs = readNowEpochMs(now);
            const nowEpochSec = Math.floor(nowMs / 1000);
            const resolvedSecret = context?.stateSecret ?? context?.webhookSecret ?? stateSecret ?? webhookSecret;
            const resolvedPortalUrl = typeof context?.resumePortalUrl === 'string' && context.resumePortalUrl.length > 0
                ? context.resumePortalUrl
                : resumePortalUrl;
            const canonicalOrigin = resolvePortalOrigin(resolvedPortalUrl);

            // Telegram aynı güncellemeyi yeniden gönderirse ikinci kez işleme.
            const isFreshUpdate = await consumeRateLimitSlot(rateLimiter, database, {
                ...UPDATE_IDEMPOTENCY_LIMIT,
                identity: `update:${update.update_id}`,
                nowSeconds: nowEpochSec
            });
            if (!isFreshUpdate) {
                return { handled: false, reason: 'duplicate_update' };
            }

            const startCommand = parseStartCommand(message.text);
            if (startCommand) {
                const language = resolveTelegramLanguage(startCommand.payloadLang, message.from.language_code);
                // Kişi paylaşımı ve yanıt rehberi adımlarının aynı dilde kalması için seçilen dili kısa süreliğine hatırla.
                await rememberTelegramRecoveryLanguage({
                    rateLimiter,
                    database,
                    userId: fromId,
                    language,
                    nowSeconds: nowEpochSec
                });
                const messages = TELEGRAM_RECOVERY_MESSAGES[language];
                await sendTelegramMessage({
                    chat_id: chatId,
                    text: messages.askContact,
                    reply_markup: {
                        keyboard: [[{ text: messages.sharePhoneButton, request_contact: true }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                });
                return { handled: true, step: 'start', language };
            }

            if (message.contact && typeof message.contact === 'object') {
                const recalledLanguage = await recallTelegramRecoveryLanguage({
                    rateLimiter,
                    database,
                    userId: fromId,
                    nowSeconds: nowEpochSec
                });
                const language = resolveTelegramLanguage(recalledLanguage, message.from.language_code);
                const messages = TELEGRAM_RECOVERY_MESSAGES[language];
                if (!Number.isSafeInteger(message.contact.user_id) || message.contact.user_id !== fromId) {
                    await sendTelegramMessage({
                        chat_id: chatId,
                        text: messages.contactRejected,
                        reply_markup: { remove_keyboard: true }
                    });
                    return { handled: true, step: 'contact', outcome: 'rejected_foreign_contact', language };
                }

                const normalizedPhone = typeof normalizePhone === 'function'
                    ? normalizePhone(message.contact.phone_number)
                    : normalizeTelegramPhone(message.contact.phone_number);
                if (typeof normalizedPhone !== 'string' || normalizedPhone.length === 0) {
                    await sendTelegramMessage({
                        chat_id: chatId,
                        text: messages.mismatch,
                        reply_markup: { remove_keyboard: true }
                    });
                    return { handled: true, step: 'contact', outcome: 'invalid_phone', language };
                }

                const token = await signRecoveryStateToken({
                    phone: normalizedPhone,
                    userId: fromId,
                    language,
                    expiryEpochSec: nowEpochSec + STATE_TTL_SECONDS
                }, resolvedSecret);

                // Durum belirteci mesaj metninde görünmez şekilde baştaki kilit emojisi üzerindeki text_link varlığında taşınır.
                // Özel sohbette selective: true yanıt kipini tetiklemediği için yalnızca force_reply gönderilir.
                await sendTelegramMessage({
                    chat_id: chatId,
                    text: messages.askStudentNumber,
                    entities: [
                        {
                            type: 'text_link',
                            offset: 0,
                            length: STUDENT_NUMBER_PROMPT_EMOJI.length,
                            url: `${canonicalOrigin}/?tg=${token}`
                        }
                    ],
                    link_preview_options: { is_disabled: true },
                    reply_markup: {
                        force_reply: true,
                        input_field_placeholder: messages.studentNumberPlaceholder
                    }
                });
                return { handled: true, step: 'contact', outcome: 'awaiting_student_number', language };
            }

            if (typeof message.text === 'string' && message.reply_to_message && typeof message.reply_to_message === 'object') {
                const rawToken = extractRefTokenFromReply(message.reply_to_message);
                const state = rawToken
                    ? await verifyRecoveryStateToken(rawToken, {
                        expectedUserId: fromId,
                        nowEpochSec,
                        secret: resolvedSecret
                    })
                    : null;

                if (!state) {
                    const recalledLanguage = await recallTelegramRecoveryLanguage({
                        rateLimiter,
                        database,
                        userId: fromId,
                        nowSeconds: nowEpochSec
                    });
                    const fallbackLanguage = resolveTelegramLanguage(recalledLanguage, message.from.language_code);
                    await sendTelegramMessage({
                        chat_id: chatId,
                        text: TELEGRAM_RECOVERY_MESSAGES[fallbackLanguage].mismatch
                    });
                    return { handled: true, step: 'verify', outcome: 'invalid_state', language: fallbackLanguage };
                }

                const language = state.language;
                const messages = TELEGRAM_RECOVERY_MESSAGES[language];

                const userAllowed = await consumeRateLimitSlot(rateLimiter, database, {
                    ...userDailyLimit,
                    identity: String(fromId),
                    nowSeconds: nowEpochSec
                });
                if (!userAllowed) {
                    await sendTelegramMessage({
                        chat_id: chatId,
                        text: messages.rateLimited
                    });
                    return { handled: true, step: 'verify', outcome: 'rate_limited_user', language };
                }

                const studentNumber = message.text.trim();
                if (studentNumber.length === 0 || studentNumber.length > 64 || studentNumber.startsWith('/')) {
                    await sendTelegramMessage({
                        chat_id: chatId,
                        text: messages.mismatch
                    });
                    return { handled: true, step: 'verify', outcome: 'mismatch', language };
                }

                let application = null;
                if (typeof findRecoverableApplication === 'function') {
                    try {
                        application = await findRecoverableApplication(database, { studentNumber });
                    } catch {
                        application = null;
                    }
                }

                const applicationPhone = application?.studentPhone
                    ? (typeof normalizePhone === 'function'
                        ? normalizePhone(application.studentPhone)
                        : normalizeTelegramPhone(application.studentPhone))
                    : '';

                if (!application?.applicationId
                    || !application?.referenceNumber
                    || typeof applicationPhone !== 'string'
                    || applicationPhone.length === 0
                    || !constantTimeEqualStrings(applicationPhone, state.phone)) {
                    await sendTelegramMessage({
                        chat_id: chatId,
                        text: messages.mismatch
                    });
                    return { handled: true, step: 'verify', outcome: 'mismatch', language };
                }

                // E-posta ve Telegram kanallarının başvuru başına günlük 3 hatırlatma hakkını paylaşması için ortak uç nokta ve kimlik kullanılır.
                const applicationAllowed = await consumeRateLimitSlot(rateLimiter, database, {
                    ...applicationDailyLimit,
                    identity: application.applicationId,
                    nowSeconds: nowEpochSec
                });
                if (!applicationAllowed) {
                    await sendTelegramMessage({
                        chat_id: chatId,
                        text: messages.rateLimited
                    });
                    return { handled: true, step: 'verify', outcome: 'rate_limited_application', language };
                }

                await sendTelegramMessage({
                    chat_id: chatId,
                    text: messages.success(application.referenceNumber),
                    link_preview_options: { is_disabled: true },
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: messages.copyButton,
                                copy_text: { text: application.referenceNumber }
                            },
                            {
                                text: messages.openSiteButton,
                                url: `${canonicalOrigin}/basvuruya-devam-et/`
                            }
                        ]]
                    }
                });
                return { handled: true, step: 'verify', outcome: 'recovered', language };
            }

            const recalledLanguage = await recallTelegramRecoveryLanguage({
                rateLimiter,
                database,
                userId: fromId,
                nowSeconds: nowEpochSec
            });
            if (typeof message.text === 'string' && recalledLanguage) {
                await sendTelegramMessage({
                    chat_id: chatId,
                    text: TELEGRAM_RECOVERY_MESSAGES[recalledLanguage].replyInstruction
                });
                return { handled: true, step: 'hint', outcome: 'reply_required', language: recalledLanguage };
            }

            const language = resolveTelegramLanguage(recalledLanguage, message.from.language_code);
            await sendTelegramMessage({
                chat_id: chatId,
                text: TELEGRAM_RECOVERY_MESSAGES[language].usageHint
            });
            return { handled: true, step: 'hint', language };
        }
    });
}
