import { createApplicationRepository } from '../repositories/d1/applicationRepository.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import {
    REFERENCE_REMINDER_MAIL_DAILY_LIMIT,
    SUPPORTED_MAIL_LANGUAGES,
    normalizeMailLanguage,
    readMailQuotaStatus
} from './referenceMailService.js';

const encoder = new TextEncoder();

export { REFERENCE_REMINDER_MAIL_DAILY_LIMIT };
export const SUPPORTED_RECOVERY_LANGUAGES = SUPPORTED_MAIL_LANGUAGES;
export const RECOVERY_CHANNELS = Object.freeze(['email', 'telegram']);

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

/** Başvuru numarası hatırlatma e-postası için günlük 30 alıcı kotasından bir hak tüketir. */
export function consumeReferenceReminderMailQuota(rateLimitRepository, { nowSeconds } = {}) {
    return consumeRecoveryRateLimit(rateLimitRepository, {
        ...REFERENCE_REMINDER_MAIL_DAILY_LIMIT,
        nowSeconds
    });
}

/** Sabit pencerede hatırlatma e-postası için ayrılan 30 alıcı kotasında yer olup olmadığını döndürür. */
export async function hasRecoveryMailQuotaAvailable(database, now = new Date().toISOString()) {
    const quota = await readMailQuotaStatus(database, now);
    return quota.recoveryRemaining > 0;
}

/**
 * Kayıt bulunmayan veya sınır aşan yollarda zamanlama farkını azaltmak için eşdeğer özetleme işi yapar.
 * @returns {Promise<void>}
 */
export async function simulateRecoveryWork() {
    await crypto.subtle.digest('SHA-256', encoder.encode('reference-reminder-timing'));
}
