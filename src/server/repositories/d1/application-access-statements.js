/**
 * Fences code rotation, audit and revocation in the same transaction against current version/session authority.
 * @param {D1Database} database D1 binding.
 * @param {object} input Exact application, observed code version and authenticated actor.
 * @returns {D1PreparedStatement[]} Atomic rotation statements.
 * @throws {TypeError} Invalid trusted repository input.
 */
export function createAccessCodeRotationStatements(database, input) {
    if (!Number.isSafeInteger(input.expectedAccessCodeVersion) || input.expectedAccessCodeVersion < 1
        || !['student', 'staff', 'recovery'].includes(input.actorType)) throw new TypeError('Code rotation requires current version and actor.');
    if (input.actorType === 'recovery') {
        const channel = input.channel === 'email' || input.channel === 'telegram' ? input.channel : null;
        const metadataJson = JSON.stringify(channel ? { accessCodeRotated: true, channel } : { accessCodeRotated: true });
        return [
            // Kurtarma akışında açık oturum şartı aranmaz; yalnızca aktif ve silinmemiş başvuruda sürüm korumalı döndürme yapılır.
            database.prepare(`UPDATE applications SET access_code_hash=?,access_code_created_at=?,access_code_version=access_code_version+1,
                updated_at=?,last_activity_at=? WHERE id=? AND access_code_version=? AND status NOT IN ('completed','cancelled','rejected')
                AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id=applications.id)`)
                .bind(input.accessCodeHash,input.accessCodeCreatedAt,input.accessCodeCreatedAt,input.accessCodeCreatedAt,
                    input.applicationId,input.expectedAccessCodeVersion),
            // audit_events.actor_type şeması ('staff', 'student', 'system') ile sınırlı olduğundan kurtarma olayı 'system' aktörüyle yazılır.
            database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,application_id,request_id,safe_metadata_json,created_at)
                SELECT ?,'application.access_code_recovered','system',NULL,?,?,?,? WHERE changes()=1`)
                .bind(input.auditEventId,input.applicationId,input.requestId,metadataJson,input.accessCodeCreatedAt),
            // Açık öğrenci oturumları yalnızca 'staff' sıfırlamasında iptal edilir; kurtarmada açık oturumlara dokunulmaz.
            database.prepare(`UPDATE application_sessions SET revoked_at=? WHERE application_id=? AND revoked_at IS NULL
                AND ?='staff' AND changes()=1`).bind(input.accessCodeCreatedAt,input.applicationId,input.actorType)
        ];
    }
    return [
        database.prepare(`UPDATE applications SET access_code_hash=?,access_code_created_at=?,access_code_version=access_code_version+1,
            updated_at=?,last_activity_at=? WHERE id=? AND access_code_version=? AND status NOT IN ('completed','cancelled','rejected')
            AND (?='staff' OR EXISTS (SELECT 1 FROM application_sessions WHERE id=? AND application_id=applications.id
                AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
            .bind(input.accessCodeHash,input.accessCodeCreatedAt,input.accessCodeCreatedAt,input.accessCodeCreatedAt,
                input.applicationId,input.expectedAccessCodeVersion,input.actorType,input.ownerSessionId || null),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,application_id,request_id,safe_metadata_json,created_at)
            SELECT ?,?,?,?,?,?,'{"accessCodeRotated":true}',? WHERE changes()=1`)
            .bind(input.auditEventId,input.actorType==='staff'?'staff.application_access_code_reset':'application.access_code_regenerated',
                input.actorType,input.actorStaffId || null,input.applicationId,input.requestId,input.accessCodeCreatedAt),
        database.prepare(`UPDATE application_sessions SET revoked_at=? WHERE application_id=? AND revoked_at IS NULL
            AND ?='staff' AND changes()=1`).bind(input.accessCodeCreatedAt,input.applicationId,input.actorType)
    ];
}
