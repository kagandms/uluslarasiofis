import { ApiError } from '../domain/errors.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import {
    consumeRecoveryApplicationRateLimit,
    consumeRecoveryIpRateLimit,
    findRecoverableApplication,
    hasRecoveryMailQuotaAvailable,
    normalizeRecoveryLanguage,
    rotateAccessCodeForRecovery,
    simulateRecoveryWork
} from '../services/accessRecoveryService.js';
import {
    isValidReferenceMailNumber,
    isValidReferenceMailRecipient,
    readReferenceMailConfig,
    resolveMailPortalUrl,
    sendRecoveryReferenceMail
} from '../services/referenceMailService.js';
import { createRepositories, requireMethod, requireSameOrigin } from './shared.js';

const encoder = new TextEncoder();

/**
 * Erişim kodu kurtarma kanallarının kullanılabilirliğini döndürür.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamı.
 * @returns {{email: boolean, telegram: {enabled: boolean, url: string|null}}} Kanal seçenekleri.
 * @throws {ApiError} İstek yöntemi GET değilse.
 */
export function readApplicationRecoveryOptions(request, environment) {
    requireMethod(request, 'GET');
    const rawUsername = typeof environment?.TELEGRAM_BOT_USERNAME === 'string'
        ? environment.TELEGRAM_BOT_USERNAME.trim().replace(/^@/, '')
        : '';
    const isEnabled = /^[A-Za-z0-9_]{1,64}$/.test(rawUsername);
    return {
        email: true,
        telegram: {
            enabled: isEnabled,
            url: isEnabled ? `https://t.me/${rawUsername}?start=recover` : null
        }
    };
}

/**
 * E-posta ile erişim kodu kurtarma isteğini işler.
 * Kayıt var/yok, hız sınırı veya kota dolu durumlarında aynı 202 {"ok":true} yanıtını döner.
 * @param {Request} request Aynı kökenli JSON POST isteği.
 * @param {object} environment Worker bağlamı.
 * @param {string} requestId Denetim kaydı için istek kimliği.
 * @returns {Promise<object>} 202 durum kodlu genel yanıt.
 * @throws {ApiError} Yöntem, köken, gövde veya öğrenci numarası biçimi geçersizse.
 */
export async function requestEmailAccessRecovery(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const body = await readJsonBody(request);
    const rawStudentNumber = body.student_number;
    if (typeof rawStudentNumber !== 'string' || rawStudentNumber.trim().length === 0 || rawStudentNumber.trim().length > 64) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci numarasını kontrol edip tekrar deneyin.');
    }

    const studentNumber = rawStudentNumber.trim();
    const language = normalizeRecoveryLanguage(body.language);
    const repositories = createRepositories(environment);

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const nowSeconds = Math.floor(nowDate.getTime() / 1000);
    const clientAddress = request.headers.get('CF-Connecting-IP') || 'unknown-client';

    // Zamanlama sızıntısını önlemek için kayıt olmasa da benzer DB/özet işleri çalıştırılır.
    const ipAllowed = await consumeRecoveryIpRateLimit(repositories.rateLimits, {
        clientAddress,
        nowSeconds
    });
    const application = await findRecoverableApplication(environment.DB, { studentNumber });
    const quotaAvailable = await hasRecoveryMailQuotaAvailable(environment.DB, now);
    const mailConfig = readReferenceMailConfig(environment);

    let appAllowed = false;
    if (ipAllowed && application) {
        appAllowed = await consumeRecoveryApplicationRateLimit(repositories.rateLimits, {
            applicationId: application.applicationId,
            nowSeconds
        });
    } else {
        // Kayıt olmayan öğrenci numaralarıyla rate-limit tablosunu büyütmeden eşdeğer özetleme işi yap.
        await crypto.subtle.digest('SHA-256', encoder.encode(studentNumber));
    }

    const isEligible = Boolean(
        ipAllowed
        && appAllowed
        && application
        && isValidReferenceMailNumber(application.referenceNumber)
        && isValidReferenceMailRecipient(application.studentEmail)
        && quotaAvailable
        && mailConfig
    );

    if (isEligible) {
        const rotated = await rotateAccessCodeForRecovery(environment.DB, {
            applicationId: application.applicationId,
            channel: 'email',
            requestId,
            now
        });
        if (rotated?.accessCode) {
            await sendRecoveryReferenceMail(environment, {
                recipient: application.studentEmail,
                referenceNumber: application.referenceNumber,
                studentNumber,
                accessCode: rotated.accessCode,
                portalUrl: resolveMailPortalUrl(environment, request.url),
                language
            });
        }
    } else {
        await simulateRecoveryWork();
    }

    return routeResult({ ok: true }, { status: 202 });
}
