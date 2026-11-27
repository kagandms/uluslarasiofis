import { readCachedSchemaReadiness } from '../../config/schemaReadinessCache.js';

function normalizeIsoDeadline(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

async function hasMigrationOfficeStatesTable(database) {
    if (!database || typeof database.prepare !== 'function') return false;
    return readCachedSchemaReadiness(database, 'migration-office-states', async () => {
        const row = await database.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='migration_office_states'"
        ).first();
        return Boolean(row);
    });
}

/**
 * Reads only the student-safe migration missing-documents overlay for a record in `sent_to_migration`.
 * Never selects or returns Excel notes, E-İkamet numbers, import IDs, or staff IDs.
 * Returns `null` when the table does not exist yet, the record is not in `sent_to_migration`,
 * or the overlay state is not `missing_documents`.
 * @param {D1Database|null|undefined} database Cloudflare D1 binding.
 * @param {{ recordKind: 'online'|'physical', recordId: string, status: string }} target Record identity and current status.
 * @returns {Promise<{ migration_missing_documents: true, migration_missing_deadline?: string }|null>}
 */
export async function readPublicMigrationMissingDocuments(database, { recordKind, recordId, status }) {
    if (status !== 'sent_to_migration' || !recordId || (recordKind !== 'online' && recordKind !== 'physical')) {
        return null;
    }
    if (!await hasMigrationOfficeStatesTable(database)) {
        return null;
    }
    try {
        const row = await database.prepare(`
            SELECT state, deadline
            FROM migration_office_states
            WHERE record_kind = ? AND record_id = ?
            LIMIT 1
        `).bind(recordKind, recordId).first();
        if (!row || row.state !== 'missing_documents') return null;
        const deadline = normalizeIsoDeadline(row.deadline);
        return {
            migration_missing_documents: true,
            ...(deadline ? { migration_missing_deadline: deadline } : {})
        };
    } catch (error) {
        if (String(error?.message || '').includes('no such table')) return null;
        throw error;
    }
}
