/**
 * Normalizes a staff username for case-insensitive account lookup.
 * @param {string} username Username supplied by staff.
 * @returns {string} Lowercase normalized username.
 * @throws {TypeError} When the username format is invalid.
 */
export function normalizeUsername(username) {
    if (typeof username !== 'string') throw new TypeError('Username must be text.');
    const normalizedUsername = username.trim().toLocaleLowerCase('en-US');
    if (!/^[a-z0-9._@#-]{3,64}$/.test(normalizedUsername)) {
        throw new TypeError('Username format is invalid.');
    }
    return normalizedUsername;
}

/**
 * Creates the staff identity repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Staff account operations that never return password hashes in public DTOs.
 */
export function createStaffRepository(database) {
    return Object.freeze({
        async findByUsername(username) {
            const normalizedUsername = normalizeUsername(username);
            return database.prepare('SELECT * FROM staff_users WHERE normalized_username = ?')
                .bind(normalizedUsername).first();
        },
        async findById(id) {
            return database.prepare('SELECT * FROM staff_users WHERE id = ?')
                .bind(id).first();
        },
        async hasBootstrapAdmin() {
            const result = await database.prepare(`
                SELECT 1 AS configured FROM staff_bootstrap_state WHERE id = 1
                UNION ALL SELECT 1 AS configured FROM staff_users LIMIT 1
            `).first();
            return Boolean(result);
        },
        async createFirstAdmin({ id, username, passwordHash, displayName, createdAt, requestId }) {
            const normalizedUsername = normalizeUsername(username);
            const statements = [
                database.prepare(`
                    INSERT INTO staff_bootstrap_state (id, staff_user_id, completed_at)
                    SELECT 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM staff_users)
                `).bind(id, createdAt),
                database.prepare(`
                    INSERT INTO staff_users (
                        id, username, normalized_username, password_hash,
                        display_name, role, created_at, updated_at
                    ) SELECT ?, ?, ?, ?, ?, 'admin', ?, ?
                    WHERE EXISTS (SELECT 1 FROM staff_bootstrap_state WHERE id = 1 AND staff_user_id = ?)
                `).bind(id, username.trim(), normalizedUsername, passwordHash, displayName.trim(), createdAt, createdAt, id),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id,
                        request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'staff.admin_bootstrapped', 'staff', ?, ?, '{}', ?
                    WHERE EXISTS (SELECT 1 FROM staff_bootstrap_state WHERE id = 1 AND staff_user_id = ?)
                `).bind(crypto.randomUUID(), id, requestId, createdAt, id)
            ];
            const results = await database.batch(statements);
            if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1 || results[2]?.meta?.changes !== 1) return null;
            return this.findById(id);
        },
        async updateLastLogin(id, lastLoginAt) {
            await database.prepare(`
                UPDATE staff_users SET last_login_at = ?, updated_at = ? WHERE id = ? AND is_active = 1
            `).bind(lastLoginAt, lastLoginAt, id).run();
        }
    });
}
