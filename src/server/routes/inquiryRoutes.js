import { ApiError } from '../domain/errors.js';
import { validateInquiryInput } from '../domain/officeInquiry.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import {
    INQUIRY_CREATE_RATE_LIMIT,
    INQUIRY_GLOBAL_DAILY_LIMIT,
    INQUIRY_PER_PHONE_LIMIT
} from '../security/application-rate-limits.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import { createRepositories, enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';

const INQUIRY_BODY_MAX_BYTES = 4096;

async function runFailClosedRateLimit(action) {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.', true);
    }
}

async function enforceScopedRateLimit(repositories, policy, identity, nowSeconds) {
    const allowed = await runFailClosedRateLimit(() => consumePublicRateLimit(repositories.rateLimits, {
        endpoint: policy.endpoint,
        identity,
        nowSeconds,
        windowSeconds: policy.windowSeconds,
        maxRequests: policy.maxRequests
    }));
    if (!allowed) {
        throw new ApiError(429, 'RATE_LIMITED', 'Çok fazla istek yapıldı. Bir süre sonra tekrar deneyin.', true);
    }
}

/**
 * Ana sayfa "Sorunuz mu var?" formundan gelen halka açık soruları doğrular, hız sınırlar ve kaydeder.
 * Kontrol sırası: yöntem -> aynı köken -> 4 KB boyut sınırı -> IP hız sınırı -> tuzak alan -> doğrulama -> telefon/günlük sınır -> D1 yazımı.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} _requestId İstek izleme kimliği.
 * @returns {Promise<object>} 201 durum kodlu `{ received: true }` rota sonucu.
 * @throws {ApiError} Yöntem, köken, boyut, hız sınırı veya doğrulama hatasında uygun HTTP hatası fırlatır.
 */
export async function createPublicInquiry(request, environment, _requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const body = await readJsonBody(request, INQUIRY_BODY_MAX_BYTES);
    const repositories = createRepositories(environment);

    await runFailClosedRateLimit(() => enforceRateLimit(repositories, request, INQUIRY_CREATE_RATE_LIMIT));

    if (typeof body.website === 'string' && body.website.length > 0) {
        return routeResult({ received: true }, { status: 201 });
    }

    const validated = validateInquiryInput(body);
    const nowSeconds = Math.floor(Date.now() / 1000);
    await enforceScopedRateLimit(repositories, INQUIRY_PER_PHONE_LIMIT, validated.phone, nowSeconds);
    await enforceScopedRateLimit(repositories, INQUIRY_GLOBAL_DAILY_LIMIT, INQUIRY_GLOBAL_DAILY_LIMIT.identity, nowSeconds);

    await repositories.officeInquiries.create({
        id: crypto.randomUUID(),
        firstName: validated.first_name,
        lastName: validated.last_name,
        phone: validated.phone,
        email: validated.email,
        message: validated.message,
        language: validated.language,
        nowIso: new Date().toISOString()
    });

    return routeResult({ received: true }, { status: 201 });
}
