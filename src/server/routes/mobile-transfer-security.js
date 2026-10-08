import { requirePhysicalSessionAllowed } from '../config/physical-intake-gate.js';
import { ApiError } from '../domain/errors.js';
import { hashSessionToken } from '../auth/sessionToken.js';
import { STAFF_IDLE_TIMEOUT_SECONDS } from '../config/sessionPolicy.js';
import { readSharedStaffUsername } from '../config/sharedStaffAccount.js';

/** SQL predicate shared by pairing, upload reservation and finalization. */
export const ACTIVE_TRANSFER_STAFF = `EXISTS (SELECT 1 FROM staff_sessions sessions
 JOIN staff_users staff ON staff.id=sessions.staff_user_id
 WHERE sessions.token_hash=mobile_document_transfers.staff_token_hash AND sessions.revoked_at IS NULL
 AND sessions.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND julianday(sessions.last_seen_at)>julianday('now','-${STAFF_IDLE_TIMEOUT_SECONDS} seconds')
 AND staff.is_active=1 AND staff.role IN ('reviewer','admin') AND staff.normalized_username=?)`;

/** Checks that the creating staff session remains active without extending its idle timeout.
 * @param {object} environment Bindings. @param {string} transferId Transfer identity.
 * @returns {Promise<void>} Valid owner. @throws {ApiError} Revoked or expired owner.
 */
export async function requireTransferOwner(environment, transferId) {
    const active = await environment.DB.prepare(`SELECT id,staff_token_hash FROM mobile_document_transfers WHERE id=? AND ${ACTIVE_TRANSFER_STAFF}`)
        .bind(transferId, readSharedStaffUsername(environment)).first();
    if (!active) throw new ApiError(410, 'TRANSFER_EXPIRED', 'Yetkili oturumu sona erdi. PC’den yeni QR açın.');
    requirePhysicalSessionAllowed(environment, active.staff_token_hash);
}

/** Applies an atomic minute bucket to claims or one phone transfer.
 * @param {object} context Request and bindings. @param {string} scope Throttle key. @param {number} limit Allowed requests.
 * @returns {Promise<void>} Request admitted. @throws {ApiError} Rate limit exceeded.
 */
export async function enforceTransferRate(context, scope, limit) {
    const key = await hashSessionToken(`${scope}:${context.request.headers.get('CF-Connecting-IP') || 'local'}`);
    const window = Math.floor(Date.now() / 60000);
    const result = await context.environment.DB.prepare(`INSERT INTO mobile_transfer_rate_limits(key,window,attempts)
        VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,
        window=excluded.window RETURNING attempts`).bind(key, window).first();
    if (result.attempts > limit) throw new ApiError(429, 'TRANSFER_RATE_LIMIT', 'Çok fazla istek. Bir dakika sonra tekrar deneyin.');
}
