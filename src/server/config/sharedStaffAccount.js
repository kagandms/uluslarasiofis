import { ApiError } from '../domain/errors.js';
import { normalizeUsername } from '../repositories/d1/staffRepository.js';

/**
 * Reads the one configured staff identity used by login and active sessions.
 * @param {object} environment Worker bindings.
 * @returns {string} Normalized shared staff username.
 * @throws {ApiError} When the shared identity is missing or invalid.
 */
export function readSharedStaffUsername(environment) {
    try {
        return normalizeUsername(environment.STAFF_SHARED_USERNAME);
    } catch {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Yetkili hesabı yapılandırılmamış. Lütfen sistem yöneticisine başvurun.', true);
    }
}
