const SAFE_AUDIT_KEYS = new Set([
    'role', 'targetRole', 'active', 'changedFields', 'applicationStatus',
    'documentStatus', 'documentCode', 'revisionNumber', 'outboxId', 'channel', 'result', 'retentionDays'
]);

function sanitizeAuditMetadata(metadata = {}) {
    return Object.fromEntries(Object.entries(metadata)
        .filter(([key, value]) => SAFE_AUDIT_KEYS.has(key)
            && ['string', 'number', 'boolean'].includes(typeof value)
            && String(value).length <= 120));
}

/**
 * Creates the append-only audit repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {{writeEvent(event: object): Promise<void>}} Audit event persistence.
 */
export function createAuditRepository(database) {
    return Object.freeze({
        async writeEvent({ id, eventType, actorType, actorStaffId = null, applicationId = null, documentRecordId = null, requestId, metadata = {} }) {
            const safeMetadata = JSON.stringify(sanitizeAuditMetadata(metadata));
            await database.prepare(`
                INSERT INTO audit_events (
                    id, event_type, actor_type, actor_staff_id, application_id,
                    document_record_id, request_id, safe_metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(id, eventType, actorType, actorStaffId, applicationId, documentRecordId, requestId, safeMetadata).run();
        }
    });
}
