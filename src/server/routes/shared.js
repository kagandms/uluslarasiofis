import { ApiError } from '../domain/errors.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { isSameOriginRequest } from '../security/origin.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';

/**
 * Requires an exact HTTP method for the current route.
 * @param {Request} request Fetch API request.
 * @param {string} method Allowed method.
 * @returns {void} Nothing when the method matches.
 * @throws {ApiError} When the request method is not allowed.
 */
export function requireMethod(request, method) {
    if (request.method === method) return;
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu istek yöntemi desteklenmiyor.');
}

/**
 * Rejects browser mutations without a same-origin request context.
 * @param {Request} request Fetch API request.
 * @returns {void} Nothing when the request origin is valid.
 * @throws {ApiError} When the request is cross-origin or cannot be verified.
 */
export function requireSameOrigin(request) {
    if (isSameOriginRequest(request)) return;
    throw new ApiError(403, 'CROSS_ORIGIN_REQUEST', 'İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.');
}

/**
 * Creates repository adapters from the current Worker D1 binding.
 * @param {object} environment Worker bindings.
 * @returns {object} D1 repository collection.
 * @throws {ApiError} When D1 is not configured.
 */
export function createRepositories(environment) {
    if (!environment.DB) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.', true);
    return createD1Repositories(environment.DB);
}

/**
 * Trims and bounds-checks a required text field.
 * @param {unknown} value Input value.
 * @param {{field: string, minLength?: number, maxLength?: number}} options Field label and length limits.
 * @returns {string} Validated trimmed text.
 * @throws {ApiError} When the value is not valid text.
 */
export function requireText(value, { field, minLength = 1, maxLength = 255 }) {
    if (typeof value !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', `${field} alanını kontrol edip tekrar deneyin.`);
    }
    const normalizedValue = value.trim();
    if (normalizedValue.length < minLength || normalizedValue.length > maxLength) {
        throw new ApiError(400, 'VALIDATION_ERROR', `${field} alanını kontrol edip tekrar deneyin.`);
    }
    return normalizedValue;
}

/**
 * Persists an audit event through the configured repository.
 * @param {object} repositories D1 repository collection.
 * @param {object} event Safe event fields and correlation ID.
 * @returns {Promise<void>} Resolves after the event is stored.
 */
export function createAuditEvent(repositories, { eventType, actorType, actorStaffId = null, applicationId = null, requestId, metadata = {} }) {
    return repositories.audit.writeEvent({
        id: crypto.randomUUID(), eventType, actorType, actorStaffId,
        applicationId, requestId, metadata
    });
}

/**
 * Applies an address-keyed public route rate limit.
 * @param {object} repositories D1 repository collection.
 * @param {Request} request Fetch API request.
 * @param {{endpoint: string, maxRequests: number, windowSeconds: number}} options Rate limit policy.
 * @returns {Promise<void>} Resolves when the request is within the limit.
 * @throws {ApiError} When the request has exceeded its limit.
 */
export async function enforceRateLimit(repositories, request, { endpoint, maxRequests, windowSeconds }) {
    const clientAddress = request.headers.get('CF-Connecting-IP') || 'unknown-client';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const allowed = await consumePublicRateLimit(repositories.rateLimits, {
        endpoint, identity: clientAddress, nowSeconds, maxRequests, windowSeconds
    });
    if (!allowed) throw new ApiError(429, 'RATE_LIMITED', 'Çok fazla istek yapıldı. Bir süre sonra tekrar deneyin.', true);
}
