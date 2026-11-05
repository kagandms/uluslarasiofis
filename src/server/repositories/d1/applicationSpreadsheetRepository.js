/**
 * Creates D1 operations for the staff spreadsheet transfer state.
 * @param {D1Database} database D1 binding.
 * @returns {object} Transfer state operations.
 */
export function createApplicationSpreadsheetRepository(database) {
    return Object.freeze({
        findByApplicationId(applicationId) {
            return database.prepare(`SELECT application_id, record_key, state, sheet_name, operation_id
                FROM application_spreadsheet_records WHERE application_id = ?`).bind(applicationId).first();
        },
        async startAdd({ applicationId, recordKey, operationId, staffId, updatedAt }) {
            await database.prepare(`
                INSERT INTO application_spreadsheet_records
                    (application_id, record_key, state, sheet_name, operation_id, last_actor_staff, updated_at)
                SELECT ?, ?, 'pending_add', NULL, ?, ?, ?
                WHERE NOT EXISTS(SELECT 1 FROM application_deletions WHERE application_id = ?)
                ON CONFLICT(application_id) DO UPDATE SET
                    state = 'pending_add',
                    operation_id = CASE WHEN application_spreadsheet_records.state = 'pending_add'
                        THEN application_spreadsheet_records.operation_id ELSE excluded.operation_id END,
                    last_actor_staff = CASE WHEN application_spreadsheet_records.state = 'pending_add'
                        THEN application_spreadsheet_records.last_actor_staff ELSE excluded.last_actor_staff END,
                    updated_at = excluded.updated_at
                WHERE application_spreadsheet_records.state IN ('absent', 'pending_add')
            `).bind(applicationId, recordKey, operationId, staffId, updatedAt, applicationId).run();
            return this.findByApplicationId(applicationId);
        },
        async startRemove({ applicationId, operationId, staffId, updatedAt }) {
            await database.prepare(`
                UPDATE application_spreadsheet_records
                SET state = 'pending_remove',
                    operation_id = CASE WHEN state = 'pending_remove' THEN operation_id ELSE ? END,
                    last_actor_staff = ?, updated_at = ?
                WHERE application_id = ? AND state IN ('present', 'pending_remove')
                    AND NOT EXISTS(SELECT 1 FROM application_deletions WHERE application_id = ?)
            `).bind(operationId, staffId, updatedAt, applicationId, applicationId).run();
            return this.findByApplicationId(applicationId);
        },
        async complete({ applicationId, operationId, fromState, state, sheetName, updatedAt }) {
            const result = await database.prepare(`
                UPDATE application_spreadsheet_records
                SET state = ?, sheet_name = ?, updated_at = ?
                WHERE application_id = ? AND operation_id = ? AND state = ?
            `).bind(state, sheetName, updatedAt, applicationId, operationId, fromState).run();
            return result.meta.changes === 1;
        }
    });
}
