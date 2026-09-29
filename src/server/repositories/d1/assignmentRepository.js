/**
 * Creates the assignment history repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {{assign(input: object): Promise<void>, findCurrent(applicationId: string): Promise<object|null>}}
 */
export function createAssignmentRepository(database) {
    return Object.freeze({
        async assign({ id, applicationId, staffUserId, assignedByStaffId }) {
            const statements = [
                database.prepare(`
                    UPDATE assignments SET status = 'released', released_at = CURRENT_TIMESTAMP
                    WHERE application_id = ? AND status = 'active'
                `).bind(applicationId),
                database.prepare(`
                    INSERT INTO assignments (id, application_id, staff_user_id, assigned_by_staff_id)
                    VALUES (?, ?, ?, ?)
                `).bind(id, applicationId, staffUserId, assignedByStaffId)
            ];
            await database.batch(statements);
        },
        async findCurrent(applicationId) {
            return database.prepare(`
                SELECT assignments.*, staff_users.display_name, staff_users.username
                FROM assignments JOIN staff_users ON staff_users.id = assignments.staff_user_id
                WHERE assignments.application_id = ? AND assignments.status = 'active'
                LIMIT 1
            `).bind(applicationId).first();
        }
    });
}
