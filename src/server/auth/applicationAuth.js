import { ApiError, RepositoryConfigurationError } from '../domain/errors.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { getSessionCookieName, hashSessionToken, readCookie } from './sessionToken.js';

/**
 * Requires a current application session and returns its server-owned draft data.
 * @param {Request} request Fetch API request.
 * @param {object} environment Cloudflare Worker bindings.
 * @returns {Promise<object>} Application session joined to its student-facing record.
 * @throws {ApiError|RepositoryConfigurationError} When the session is absent or expired.
 */
export async function requireApplicationSession(request, environment) {
    if (!environment.DB) throw new RepositoryConfigurationError();
    const sessionToken = readCookie(request, getSessionCookieName('application'));
    if (!sessionToken || !/^[A-Za-z0-9_-]{40,48}$/.test(sessionToken)) {
        throw new ApiError(401, 'APPLICATION_SESSION_REQUIRED', 'Başvuru oturumu sona erdi. Güvenli erişimi yeniden başlatın.');
    }
    const repositories = createD1Repositories(environment.DB);
    const session = await repositories.sessions.findApplicationSession(
        await hashSessionToken(sessionToken),
        new Date().toISOString()
    );
    if (!session) throw new ApiError(401, 'APPLICATION_SESSION_REQUIRED', 'Başvuru oturumu sona erdi. Güvenli erişimi yeniden başlatın.');
    return session;
}
