import { hasPhysicalReceiptSchema } from '../config/physical-receipt-config.js';
import { ApiError } from '../domain/errors.js';
import { normalizeTrackingReference, readPhysicalTrackingStatus } from '../domain/physical-tracking-policy.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, enforceRateLimit } from './shared.js';
import { createRateLimitRepository } from '../repositories/d1/rateLimitRepository.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';

/** Looks up only non-identifying physical office status. @param {Request} request JSON request. @param {object} environment Bindings.
 * @returns {Promise<object>} Safe status DTO. @throws {ApiError} Method, size or rate violation. */
export async function lookupPhysicalTracking(request, environment) {
    requireMethod(request, 'POST');
    if (!environment.DB) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hizmet kullanılamıyor.');
    const rateLimits = createRateLimitRepository(environment.DB);
    await enforceRateLimit({ rateLimits }, request, { endpoint: 'physical-tracking-ip', maxRequests: 60, windowSeconds: 300 });
    const body = await readJsonBody(request, 1024);
    const reference = Object.keys(body).length === 1 ? normalizeTrackingReference(body.tracking_reference) : null;
    if (!reference) return { found: false };
    const allowed = await consumePublicRateLimit(rateLimits, { endpoint: 'physical-tracking-code',
        identity: `${request.headers.get('CF-Connecting-IP') || 'unknown-client'}:${reference}`,
        nowSeconds: Math.floor(Date.now()/1000), maxRequests: 15, windowSeconds: 300 });
    if (!allowed) throw new ApiError(429, 'RATE_LIMITED', 'Bir süre sonra tekrar deneyin.', true);
    if (!await hasPhysicalReceiptSchema(environment)) return { found: false };
    const intake = await environment.DB.prepare(`SELECT tracking_reference,application_date,status,current_pdf_id,
        processing_closed_at,legacy_status,updated_at FROM physical_intakes WHERE tracking_reference=? AND deleted_at IS NULL`).bind(reference).first();
    if (!intake) return { found: false };
    return { found: true, tracking_reference: intake.tracking_reference, application_date: intake.application_date,
        office_status: readPhysicalTrackingStatus(intake), updated_at: intake.updated_at };
}
