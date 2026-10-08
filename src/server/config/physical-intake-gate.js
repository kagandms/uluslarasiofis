import { ApiError } from '../domain/errors.js';

export const MAX_PHYSICAL_UAT_SECONDS = 3600;

/** Reads an explicit operator gate; absent or invalid settings fail closed.
 * @param {object} environment Worker bindings. @returns {object} Effective access window.
 */
export function readPhysicalGate(environment) {
    if (!['production', 'staging'].includes(environment.APP_ENV)) return { mode: 'off', expiresAt: 0 };
    if (environment.PHYSICAL_INTAKE_MODE === 'on') return { mode: 'on', expiresAt: null };
    if (environment.PHYSICAL_INTAKE_MODE !== 'uat') return { mode: 'off', expiresAt: 0 };
    const startsAt = Date.parse(environment.PHYSICAL_INTAKE_UAT_STARTS_AT);
    const expiresAt = Date.parse(environment.PHYSICAL_INTAKE_UAT_EXPIRES_AT);
    const isValidWindow = Number.isFinite(startsAt) && Number.isFinite(expiresAt)
        && startsAt <= Date.now() && expiresAt > Date.now()
        && expiresAt > startsAt && expiresAt - startsAt <= MAX_PHYSICAL_UAT_SECONDS * 1000;
    const hasSessionHash = /^[a-f0-9]{64}$/.test(environment.PHYSICAL_INTAKE_UAT_SESSION_HASH || '');
    if (!isValidWindow || !hasSessionHash) return { mode: 'off', expiresAt: 0 };
    return { mode: 'uat', expiresAt: Math.floor(expiresAt / 1000) };
}

/** Checks one PC session against the operator-selected UAT session.
 * @param {object} environment Worker bindings. @param {string} sessionHash Session digest.
 * @returns {boolean} Whether this session may use physical intake.
 */
export function isPhysicalSessionAllowed(environment, sessionHash) {
    const gate = readPhysicalGate(environment);
    return gate.mode === 'on' || gate.mode === 'uat' && sessionHash === environment.PHYSICAL_INTAKE_UAT_SESSION_HASH;
}

/** Denies physical operations unless the explicit gate admits the owner session.
 * @param {object} environment Worker bindings. @param {string} sessionHash Session digest.
 * @returns {void} @throws {ApiError} Disabled feature or non-test session.
 */
export function requirePhysicalSessionAllowed(environment, sessionHash) {
    if (!isPhysicalSessionAllowed(environment, sessionHash)) {
        throw new ApiError(403, 'PHYSICAL_INTAKE_DISABLED', 'Fiziksel başvuru bu oturum için etkin değil.');
    }
}

/** Checks temporary upload bookkeeping before accepting mobile transfers.
 * @param {object} environment Worker bindings. @returns {Promise<boolean>} Complete schema marker present.
 * @throws {Error} Metadata query failed.
 */
export async function hasPhysicalTransferSchema(environment) {
    if (!environment.DB) return false;
    const guard = await environment.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mobile_transfer_rate_limits'").first();
    return Boolean(guard);
}
