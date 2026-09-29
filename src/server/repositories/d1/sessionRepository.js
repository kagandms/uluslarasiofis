/**
 * Creates staff and student session repositories for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Session lookup, persistence, revocation, and login throttle operations.
 */
export function createSessionRepository(database) {
    return Object.freeze({
        async createStaffSession({ id, staffUserId, tokenHash, expiresAt, createdAt }) {
            await database.prepare(`
                INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).bind(id, staffUserId, tokenHash, expiresAt, createdAt).run();
        },
        async createApplicationSession({ id, applicationId, tokenHash, expiresAt, createdAt }) {
            await database.prepare(`
                INSERT INTO application_sessions (id, application_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).bind(id, applicationId, tokenHash, expiresAt, createdAt).run();
        },
        async findApplicationSession(tokenHash, now) {
            return database.prepare(`
                SELECT sessions.id AS session_id, sessions.expires_at,
                       applications.id AS application_id, applications.status,
                       applications.application_type, applications.student_email,
                       applications.student_phone, applications.first_name,
                       applications.last_name, applications.passport_number,
                       applications.nationality, applications.date_of_birth,
                       applications.is_under_18, applications.declaration_version,
                       applications.declaration_accepted_at, students.student_number
                FROM application_sessions AS sessions
                JOIN applications ON applications.id = sessions.application_id
                JOIN students ON students.id = applications.student_id
                WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL
                  AND sessions.expires_at > ?
                LIMIT 1
            `).bind(tokenHash, now).first();
        },
        async revokeApplicationSession(tokenHash, revokedAt) {
            await database.prepare(`
                UPDATE application_sessions SET revoked_at = ?
                WHERE token_hash = ? AND revoked_at IS NULL
            `).bind(revokedAt, tokenHash).run();
        },
        async findStaffSession(tokenHash, now, idleCutoff, touchCutoff) {
            await database.prepare(`
                UPDATE staff_sessions SET last_seen_at = ?
                WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
                  AND julianday(last_seen_at) > julianday(?)
                  AND julianday(last_seen_at) <= julianday(?)
                  AND EXISTS (SELECT 1 FROM staff_users WHERE id = staff_sessions.staff_user_id AND is_active = 1)
            `).bind(now, tokenHash, now, idleCutoff, touchCutoff).run();
            return database.prepare(`
                SELECT sessions.id AS session_id, sessions.expires_at, sessions.revoked_at,
                       staff.id, staff.username, staff.display_name, staff.role, staff.auth_version
                FROM staff_sessions AS sessions
                JOIN staff_users AS staff ON staff.id = sessions.staff_user_id
                WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL
                  AND sessions.expires_at > ? AND julianday(sessions.last_seen_at) > julianday(?)
                  AND staff.is_active = 1
                LIMIT 1
            `).bind(tokenHash, now, idleCutoff).first();
        },
        async revokeStaffSessionWithAudit({ tokenHash, revokedAt, idleCutoff, auditEventId, requestId }) {
            await database.batch([
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'staff.logout', 'staff', sessions.staff_user_id, ?, '{}', ?
                    FROM staff_sessions AS sessions
                    JOIN staff_users AS staff ON staff.id = sessions.staff_user_id
                    WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL
                      AND sessions.expires_at > ? AND julianday(sessions.last_seen_at) > julianday(?)
                      AND staff.is_active = 1
                `).bind(auditEventId, requestId, revokedAt, tokenHash, revokedAt, idleCutoff),
                database.prepare(`
                    UPDATE staff_sessions SET revoked_at = ?
                    WHERE token_hash = ? AND revoked_at IS NULL
                `).bind(revokedAt, tokenHash)
            ]);
        },
        async revokeAllStaffSessions(staffUserId, revokedAt) {
            await database.prepare(`
                UPDATE staff_sessions SET revoked_at = ?
                WHERE staff_user_id = ? AND revoked_at IS NULL
            `).bind(revokedAt, staffUserId).run();
        },
        async isLoginBlocked(attemptKey, nowSeconds) {
            const attempt = await database.prepare(`
                SELECT blocked_until FROM staff_login_attempts
                WHERE attempt_key = ? AND blocked_until > ?
            `).bind(attemptKey, nowSeconds).first();
            return Boolean(attempt);
        },
        async recordFailedLogin(attemptKey, nowSeconds, { maxAttempts = 5, windowSeconds = 900 } = {}) {
            await database.prepare(`
                INSERT INTO staff_login_attempts (attempt_key, window_started_at, attempt_count, blocked_until)
                VALUES (?, ?, 1, NULL)
                ON CONFLICT(attempt_key) DO UPDATE SET
                    attempt_count = CASE
                        WHEN staff_login_attempts.window_started_at <= ? THEN 1
                        ELSE staff_login_attempts.attempt_count + 1
                    END,
                    window_started_at = CASE
                        WHEN staff_login_attempts.window_started_at <= ? THEN excluded.window_started_at
                        ELSE staff_login_attempts.window_started_at
                    END,
                    blocked_until = CASE
                        WHEN staff_login_attempts.window_started_at <= ? THEN NULL
                        WHEN staff_login_attempts.attempt_count + 1 >= ? THEN ?
                        ELSE staff_login_attempts.blocked_until
                    END,
                    updated_at = CURRENT_TIMESTAMP
            `).bind(
                attemptKey, nowSeconds,
                nowSeconds - windowSeconds, nowSeconds - windowSeconds, nowSeconds - windowSeconds,
                maxAttempts, nowSeconds + windowSeconds
            ).run();
        },
        async clearLoginAttempts(attemptKey) {
            await database.prepare('DELETE FROM staff_login_attempts WHERE attempt_key = ?')
                .bind(attemptKey).run();
        }
    });
}
