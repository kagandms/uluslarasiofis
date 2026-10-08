import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { hashSessionToken, readCookie } from '../auth/sessionToken.js';
import { readPhysicalGate, isPhysicalSessionAllowed, requirePhysicalSessionAllowed, hasPhysicalSecuritySchema } from '../config/physical-intake-gate.js';
import { requireMethod, requireSameOrigin } from './shared.js';

/** Authenticates staff and enforces the physical intake gate.
 * @param {Request} request Staff request. @param {object} environment Worker bindings.
 * @returns {Promise<object>} Staff identity. @throws {Error} Invalid session or disabled feature.
 */
export async function requirePhysicalStaff(request, environment) {
    const staff = await requireStaff(request, environment, ['reviewer', 'admin']);
    requirePhysicalSessionAllowed(environment, await hashSessionToken(readCookie(request, 'staff_session')));
    if (!await hasPhysicalSecuritySchema(environment)) throw new ApiError(503, 'PHYSICAL_SCHEMA_NOT_READY', 'Fiziksel başvuru hazırlığı tamamlanmadı.');
    return staff;
}

/** Returns status, or a non-bearer session digest for operator approval; never activates access.
 * @param {Request} request Authenticated request. @param {object} environment Worker bindings.
 * @returns {Promise<object>} Safe gate status. @throws {Error} Invalid session, origin or method.
 */
export async function readPhysicalAccess(request, environment) {
    await requireStaff(request, environment, ['reviewer', 'admin']);
    const isCandidateRequest = new URL(request.url).pathname.endsWith('/session');
    requireMethod(request, isCandidateRequest ? 'POST' : 'GET');
    if (isCandidateRequest) requireSameOrigin(request);
    const sessionHash = await hashSessionToken(readCookie(request, 'staff_session'));
    const gate = readPhysicalGate(environment);
    const isSchemaReady = gate.mode !== 'off' && await hasPhysicalSecuritySchema(environment);
    return { mode: gate.mode, allowed: isPhysicalSessionAllowed(environment, sessionHash) && isSchemaReady, expiresAt: gate.expiresAt,
        ...(isCandidateRequest ? { candidateSessionHash: sessionHash } : {}) };
}
