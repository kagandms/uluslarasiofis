import { generateAccessCode, hashAccessCode } from '../auth/applicationAccessCode.js';
import { createApplicationRepository } from '../repositories/d1/applicationRepository.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import {
    SUPPORTED_MAIL_LANGUAGES,
    normalizeMailLanguage,
    readMailQuotaStatus
} from './referenceMailService.js';

export const SUPPORTED_RECOVERY_LANGUAGES = SUPPORTED_MAIL_LANGUAGES;
export const RECOVERY_CHANNELS = Object.freeze(['email', 'telegram']);
const RECOVERY_CHANNEL_SET = new Set(RECOVERY_CHANNELS);

// Başvuru başına günde en fazla 3 kurtarma, IP başına 15 dakikada 5 istek sınırı.
export const RECOVERY_APPLICATION_DAILY_LIMIT = Object.freeze({
    endpoint: 'application-recovery-app-daily',
    maxRequests: 3,
    windowSeconds: 86_400
});

export const RECOVERY_IP_RATE_LIMIT = Object.freeze({
    endpoint: 'application-recovery-ip',
    maxRequests: 5,
    windowSeconds: 900
});

// Telegram görevi tarafından kullanıcı başına günlük hız sınırı için yeniden kullanılabilir politika.
export const RECOVERY_TELEGRAM_USER_DAILY_LIMIT = Object.freeze({
    endpoint: 'application-recovery-telegram-daily',
    maxRequests: 3,
    windowSeconds: 86_400
});

/**
 * Dil kodunu tr|en|ru|tk|ar kümesine göre doğrular; geçersiz veya eksikse null döner.
 * @param {unknown} language İstemci veya profil dil değeri.
 * @returns {'tr'|'en'|'ru'|'tk'|'ar'|null} Geçerli dil kodu veya null.
 */
export function normalizeRecoveryLanguage(language) {
    return normalizeMailLanguage(language);
}

/**
 * Öğrenci numarasına göre kurtarılabilir tek aktif başvuruyu bulur.
 * Tamamlanmış, iptal edilmiş, reddedilmiş veya arşivlenmiş başvurular hariç tutulur.
 * @param {D1Database} database Cloudflare D1 bağlamı.
 * @param {{studentNumber: string}} input Öğrenci numarası.
 * @returns {Promise<{applicationId: string, referenceNumber: string|null, studentEmail: string|null, studentPhone: string|null, language: string|null}|null>}
 */
export async function findRecoverableApplication(database, { studentNumber } = {}) {
    if (!database || typeof database.prepare !== 'function') {
        throw new TypeError('A D1 database binding is required.');
    }
    const repository = createApplicationRepository(database);
    const row = await repository.findRecoverableByStudentNumber(studentNumber);
    if (!row) return null;
    return {
        applicationId: row.id,
        referenceNumber: row.reference_number ?? null,
        studentEmail: row.student_email ?? null,
        studentPhone: row.student_phone ?? null,
        language: normalizeRecoveryLanguage(row.language)
    };
}

/**
 * Kurtarma akışı için erişim kodunu atomik ve sürüm korumalı biçimde yeniler.
 * Açık öğrenci oturumları iptal edilmez; yalnızca eski erişim kodu geçersiz olur.
 * @param {D1Database} database Cloudflare D1 bağlamı.
 * @param {{applicationId: string, channel: 'email'|'telegram', requestId?: string, now?: string}} input
 * @returns {Promise<{accessCode: string}|null>} Üretilen yeni erişim kodu veya başarısızlıkta null.
 */
export async function rotateAccessCodeForRecovery(database, { applicationId, channel, requestId, now = new Date().toISOString() } = {}) {
    if (!database || typeof database.prepare !== 'function') {
        throw new TypeError('A D1 database binding is required.');
    }
    if (!RECOVERY_CHANNEL_SET.has(channel)) {
        throw new TypeError('Recovery channel must be email or telegram.');
    }
    if (typeof applicationId !== 'string' || applicationId.length === 0) return null;

    const repository = createApplicationRepository(database);
    const application = await repository.findById(applicationId);
    if (!application || ['completed', 'cancelled', 'rejected'].includes(application.status)) {
        return null;
    }
    if (!Number.isSafeInteger(application.access_code_version) || application.access_code_version < 1) {
        return null;
    }

    const accessCode = generateAccessCode();
    const accessCodeHash = await hashAccessCode(accessCode);
    const updated = await repository.updateAccessCode({
        applicationId,
        accessCodeHash,
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId: requestId || crypto.randomUUID(),
        expectedAccessCodeVersion: application.access_code_version,
        actorType: 'recovery',
        channel
    });

    if (!updated) return null;
    return { accessCode };
}

/**
 * Mevcut hız sınırı deposu üzerinden belirtilen kurtarma politikası için kota tüketir.
 * @param {{consume(input: object): Promise<object|null>}} rateLimitRepository Hız sınırı deposu.
 * @param {{endpoint: string, identity: string, maxRequests: number, windowSeconds: number, nowSeconds?: number}} input
 * @returns {Promise<boolean>} İzin veriliyorsa true.
 */
export async function consumeRecoveryRateLimit(
    rateLimitRepository,
    { endpoint, identity, maxRequests, windowSeconds, nowSeconds = Math.floor(Date.now() / 1000) }
) {
    return consumePublicRateLimit(rateLimitRepository, {
        endpoint,
        identity: String(identity || 'unknown'),
        nowSeconds,
        windowSeconds,
        maxRequests
    });
}

/** Başvuru başına günlük en fazla 3 kurtarma hakkını tüketir. */
export function consumeRecoveryApplicationRateLimit(rateLimitRepository, { applicationId, nowSeconds } = {}) {
    return consumeRecoveryRateLimit(rateLimitRepository, {
        ...RECOVERY_APPLICATION_DAILY_LIMIT,
        identity: applicationId,
        nowSeconds
    });
}

/** IP başına 15 dakikada en fazla 5 kurtarma isteği hakkını tüketir. */
export function consumeRecoveryIpRateLimit(rateLimitRepository, { clientAddress, nowSeconds } = {}) {
    return consumeRecoveryRateLimit(rateLimitRepository, {
        ...RECOVERY_IP_RATE_LIMIT,
        identity: clientAddress || 'unknown-client',
        nowSeconds
    });
}

/** Telegram kullanıcısı başına günlük en fazla 3 kurtarma hakkını tüketir. */
export function consumeRecoveryTelegramUserRateLimit(rateLimitRepository, { telegramUserId, nowSeconds } = {}) {
    return consumeRecoveryRateLimit(rateLimitRepository, {
        ...RECOVERY_TELEGRAM_USER_DAILY_LIMIT,
        identity: String(telegramUserId || 'unknown-telegram-user'),
        nowSeconds
    });
}

/** Kayan 24 saatte kurtarma e-postası için ayrılan 30 alıcı kotasında yer olup olmadığını döndürür. */
export async function hasRecoveryMailQuotaAvailable(database, now = new Date().toISOString()) {
    const quota = await readMailQuotaStatus(database, now);
    return quota.recoveryRemaining > 0;
}

/**
 * Kayıt bulunmayan veya sınır aşan yollarda zamanlama farkını azaltmak için eşdeğer kod özetleme işi yapar.
 * @returns {Promise<void>}
 */
export async function simulateRecoveryWork() {
    const dummyCode = generateAccessCode();
    await hashAccessCode(dummyCode);
}
