/**
 * D1 persistence queries for the Topi staff assistant tools.
 * Keeps all SQL statements out of the domain layer.
 */

function hasDatabaseErrorText(error, needle) {
    const causes = [error, error?.cause, error?.cause?.cause];
    return causes.some((cause) => String(cause?.message || '').toLowerCase().includes(needle));
}

/**
 * Creates D1-backed read queries used by the Topi staff assistant.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Frozen repository with async query methods.
 */
export function createStaffAssistantRepository(database) {
    if (!database) throw new TypeError('A D1 database binding is required.');

    return Object.freeze({
        /**
         * Reads `reference_number` values for a list of application IDs.
         * @param {string[]} applicationIds Application IDs returned by queue search.
         * @returns {Promise<Map<string, string>>} Map from application ID to reference number.
         */
        async getApplicationReferenceNumbers(applicationIds) {
            const referenceById = new Map();
            if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
                return referenceById;
            }
            const placeholders = applicationIds.map(() => '?').join(', ');
            const result = await database.prepare(
                `SELECT id, reference_number FROM applications WHERE id IN (${placeholders})`
            ).bind(...applicationIds).all();
            for (const row of result.results || []) {
                referenceById.set(row.id, row.reference_number ?? '');
            }
            return referenceById;
        },

        /**
         * Reads the latest finalized YÖKSİS audit import metadata, if the table exists.
         * Falls back to `null` when `yoksis_audit_imports` has not been migrated yet.
         * @returns {Promise<{ id: string, uploadedAt: string | null } | null>} Latest finalized import or `null`.
         */
        async findLatestFinalizedYoksisImport() {
            try {
                const row = await database.prepare(`
                    SELECT id, uploaded_at
                    FROM yoksis_audit_imports
                    WHERE finalized_at IS NOT NULL
                    ORDER BY finalized_at DESC, rowid DESC
                    LIMIT 1
                `).first();
                return row ? { id: row.id, uploadedAt: row.uploaded_at ?? null } : null;
            } catch (error) {
                // Table yoksis_audit_imports may not exist yet on older schemas.
                if (hasDatabaseErrorText(error, 'no such table')) {
                    return null;
                }
                throw error;
            }
        },

        /**
         * Counts and fetches matching YÖKSİS document audit records.
         * Falls back to the base column set when Excel-import columns (`source`,
         * `last_seen_import_id`, `unit`, `missing_deadline`) do not exist yet.
         * @param {{ normalizedQuery?: string, status?: string, limit?: number }} [options] Filter and limit options.
         * @returns {Promise<{ total: number, rows: Array<object> }>} Total match count and limited rows.
         */
        async queryYoksisAuditRecords({ normalizedQuery = '', status = 'all', limit = 5 } = {}) {
            const escapedQuery = normalizedQuery.replace(/[!%_]/g, '!$&');
            const pattern = `%${escapedQuery}%`;
            const statusClause = status === 'all' ? '' : 'AND status_category = ?';
            const searchClause = normalizedQuery ? "AND search_text LIKE ? ESCAPE '!'" : '';
            const bindings = [
                ...(status === 'all' ? [] : [status]),
                ...(normalizedQuery ? [pattern] : [])
            ];

            const countRow = await database.prepare(`
                SELECT COUNT(*) AS total
                FROM yoksis_document_audit_records
                WHERE 1 = 1 ${statusClause} ${searchClause}
            `).bind(...bindings).first();
            const total = Number(countRow?.total || 0);

            let rows;
            try {
                const extended = await database.prepare(`
                    SELECT application_number, student_number, first_name, last_name,
                           application_status, status_category, documents_json, scanned_at,
                           unit, missing_deadline, source, last_seen_import_id
                    FROM yoksis_document_audit_records
                    WHERE 1 = 1 ${statusClause} ${searchClause}
                    ORDER BY scanned_at DESC, application_number
                    LIMIT ?
                `).bind(...bindings, limit).all();
                rows = extended.results || [];
            } catch (error) {
                if (!hasDatabaseErrorText(error, 'no such column')) {
                    throw error;
                }
                const basic = await database.prepare(`
                    SELECT application_number, student_number, first_name, last_name,
                           application_status, status_category, documents_json, scanned_at
                    FROM yoksis_document_audit_records
                    WHERE 1 = 1 ${statusClause} ${searchClause}
                    ORDER BY scanned_at DESC, application_number
                    LIMIT ?
                `).bind(...bindings, limit).all();
                rows = basic.results || [];
            }

            return { total, rows };
        }
    });
}
