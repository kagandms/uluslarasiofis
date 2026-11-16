import { ApiError } from '../domain/errors.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import {
    consumeRecoveryApplicationRateLimit,
    consumeRecoveryIpRateLimit,
    consumeReferenceReminderMailQuota,
    findRecoverableApplication,
    normalizeRecoveryLanguage,
    simulateRecoveryWork
} from '../services/accessRecoveryService.js';
import {
    isValidReferenceMailNumber,
    isValidReferenceMailRecipient,
    readReferenceMailConfig,
    resolveMailPortalUrl,
    sendReferenceReminderMail
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
 * E-posta ile başvuru numarası hatırlatma isteğini işler.
 * Kayıt var/yok, hız sınırı veya kota dolu durumlarında aynı 202 {"ok":true} yanıtını döner.
 * @param {Request} request Aynı kökenli JSON POST isteği.
 * @param {object} environment Worker bağlamı.
 * @param {string} _requestId İstek izleme kimliği (yönlendirici imzası için korunur).
 * @returns {Promise<object>} 202 durum kodlu genel yanıt.
 * @throws {ApiError} Yöntem, köken, gövde veya öğrenci numarası biçimi geçersizse.
 */
export async function requestEmailAccessRecovery(request, environment, _requestId) {
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

    const nowSeconds = Math.floor(Date.now() / 1000);
    const clientAddress = request.headers.get('CF-Connecting-IP') || 'unknown-client';

    // Zamanlama sızıntısını önlemek için kayıt olmasa da benzer DB/özet işleri çalıştırılır.
    const ipAllowed = await consumeRecoveryIpRateLimit(repositories.rateLimits, {
        clientAddress,
        nowSeconds
    });
    const application = await findRecoverableApplication(environment.DB, { studentNumber });
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
        && mailConfig
    );

    if (isEligible) {
        // Küresel günlük 30 alıcı kotasını yalnızca gerçekten e-posta gönderilecek uygun isteklerde tüket.
        const quotaAllowed = await consumeReferenceReminderMailQuota(repositories.rateLimits, { nowSeconds });
        if (quotaAllowed) {
            const portalUrl = new URL('/basvuruya-devam-et/', resolveMailPortalUrl(environment, request.url)).href;
            await sendReferenceReminderMail(environment, {
                recipient: application.studentEmail,
                referenceNumber: application.referenceNumber,
                studentNumber,
                portalUrl,
                language
            });
        } else {
            await simulateRecoveryWork();
        }
    } else {
        await simulateRecoveryWork();
    }

    return routeResult({ ok: true }, { status: 202 });
}
