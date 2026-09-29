import { ApiError, RepositoryConfigurationError } from '../domain/errors.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { getSessionCookieName, hashSessionToken, readCookie } from './sessionToken.js';

/**
 * Requires an active D1-backed staff session and optional role allowlist.
 * @param {Request} request Fetch API request.
 * @param {object} environment Cloudflare Worker bindings.
 * @param {readonly string[]} [roles] Roles allowed to continue.
 * @returns {Promise<object>} Safe staff identity attached to the active session.
 * @throws {ApiError|RepositoryConfigurationError} When the session is missing or disallowed.
 */
export async function requireStaff(request, environment, roles) {
    if (!environment.DB) throw new RepositoryConfigurationError();
    const sessionToken = readCookie(request, getSessionCookieName('staff'));
    if (!sessionToken || !/^[A-Za-z0-9_-]{40,48}$/.test(sessionToken)) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Yetkili oturumu gerekli.');
    }
    const repositories = createD1Repositories(environment.DB);
    const session = await repositories.sessions.findStaffSession(
        await hashSessionToken(sessionToken),
        new Date().toISOString()
    );
    if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Yetkili oturumu gerekli.');
    if (roles && !roles.includes(session.role)) throw new ApiError(403, 'FORBIDDEN', 'Bu işlem için yetkiniz yok.');
    return Object.freeze({
        id: session.id,
        username: session.username,
        displayName: session.display_name,
        role: session.role
    });
}
