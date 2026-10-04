import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';
import { createD1Repositories } from '../repositories/d1/index.js';

const RESTORABLE_STATES = new Set(['soft_deleted']);

function requireEmptyBody(body) {
    if (Object.keys(body).length !== 0) throw new ApiError(400, 'INVALID_DELETE_REQUEST', 'Silme isteği doğrulanamadı.');
}

async function verifyApplication(repository, applicationId) {
    const application = await repository.applications.findById(applicationId);
    if (!application || application.status === 'draft') {
        throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    }
    return application;
}

async function archiveApplication({ environment, applicationId, staff, requestId }) {
    const repositories = createD1Repositories(environment.DB);
    const application = await verifyApplication(repositories, applicationId);
    const now = new Date().toISOString();
    const result = await environment.DB.batch([
        environment.DB.prepare(`INSERT INTO application_deletions
            (application_id,previous_status,state,deleted_by_staff_id,deleted_at)
            SELECT ?,?,'soft_deleted',?,? WHERE EXISTS(SELECT 1 FROM applications WHERE id=? AND status<>'draft')
            ON CONFLICT(application_id) DO NOTHING`)
            .bind(applicationId, application.status, staff.id, now, applicationId),
        environment.DB.prepare(`DELETE FROM application_sessions WHERE application_id=? AND changes()=1`).bind(applicationId),
        environment.DB.prepare(`INSERT OR IGNORE INTO audit_events
            (id,event_type,actor_type,actor_staff_id,application_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'application.soft_deleted','staff',?,?,?,'{}',?
              WHERE EXISTS(SELECT 1 FROM application_deletions WHERE application_id=? AND state='soft_deleted')`)
            .bind(`${applicationId}:soft-deleted`, staff.id, applicationId, requestId, now, applicationId)
    ]);
    if (result[0]?.meta?.changes !== 1) throw new ApiError(409, 'APPLICATION_DELETE_CONFLICT', 'Başvuru zaten arşivde veya siliniyor.');
    return { archived: true };
}

async function restoreApplication({ environment, applicationId, staff, requestId }) {
    const database = environment.DB;
    const now = new Date().toISOString();
    const deletion = await database.prepare(`SELECT previous_status,state FROM application_deletions WHERE application_id=?`)
        .bind(applicationId).first();
    if (!deletion || !RESTORABLE_STATES.has(deletion.state)) {
        throw new ApiError(409, 'APPLICATION_NOT_RESTORABLE', 'Bu başvuru geri alınamaz durumda.');
    }
    const result = await database.batch([
        database.prepare(`UPDATE applications SET status=?,updated_at=?,last_activity_at=? WHERE id=?
            AND EXISTS(SELECT 1 FROM application_deletions WHERE application_id=? AND state='soft_deleted')`)
            .bind(deletion.previous_status, now, now, applicationId, applicationId),
        database.prepare(`DELETE FROM application_deletions WHERE application_id=? AND state='soft_deleted' AND changes()=1`)
            .bind(applicationId),
        database.prepare(`INSERT INTO audit_events
            (id,event_type,actor_type,actor_staff_id,application_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'application.restored','staff',?,?,?,'{}',? WHERE changes()=1`)
            .bind(crypto.randomUUID(), staff.id, applicationId, requestId, now)
    ]);
    if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) {
        throw new ApiError(409, 'APPLICATION_DELETE_CONFLICT', 'Başvuru durumu değişti. Listeyi yenileyin.');
    }
    return { restored: true };
}

async function listApplicationStorageKeys(database, applicationId) {
    const result = await database.prepare(`SELECT files.storage_key FROM document_revision_files AS files
        JOIN document_revisions AS revisions ON revisions.id=files.revision_id
        JOIN document_records AS records ON records.id=revisions.document_record_id
        WHERE records.application_id=? ORDER BY files.id`).bind(applicationId).all();
    return result.results.map((row) => row.storage_key);
}

async function hashApplicationId(applicationId) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(applicationId));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function purgeApplication({ environment, applicationId, staff, requestId }) {
    const database = environment.DB;
    const application = await database.prepare('SELECT student_id FROM applications WHERE id=?').bind(applicationId).first();
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Silinen başvuru bulunamadı.');
    const deletion = await database.prepare(`SELECT state FROM application_deletions WHERE application_id=?`)
        .bind(applicationId).first();
    if (!deletion) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Silinen başvuru bulunamadı.');
    if (deletion.state === 'soft_deleted') {
        const started = await database.prepare(`UPDATE application_deletions SET state='purge_pending',purge_started_at=?
            WHERE application_id=? AND state='soft_deleted'`).bind(new Date().toISOString(), applicationId).run();
        if (started.meta.changes !== 1) throw new ApiError(409, 'APPLICATION_DELETE_CONFLICT', 'Başvuru durumu değişti.');
    }
    await database.prepare('DELETE FROM application_sessions WHERE application_id=?').bind(applicationId).run();
    const storageKeys = await listApplicationStorageKeys(database, applicationId);
    for (const storageKey of storageKeys) {
        try {
            await environment.DOCUMENTS.delete(storageKey);
        } catch {
            throw new ApiError(503, 'APPLICATION_PURGE_RETRY_REQUIRED', 'Dosyaların tamamı silinemedi. Kalıcı silme beklemede; tekrar deneyin.', true);
        }
    }
    const anonymizedId = await hashApplicationId(applicationId);
    const now = new Date().toISOString();
    const statements = [
        database.prepare(`DELETE FROM notification_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM notification_provider_webhook_events WHERE notification_id IN (SELECT id FROM notifications WHERE application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM notification_preferences WHERE application_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM notifications WHERE application_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM idempotency_records WHERE resource_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM assignments WHERE application_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM application_notes WHERE application_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM document_scan_jobs WHERE file_id IN (SELECT files.id FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM upload_intents WHERE revision_file_id IN (SELECT files.id FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM audit_events WHERE application_id=? OR document_record_id IN (SELECT id FROM document_records WHERE application_id=?)`).bind(applicationId, applicationId),
        database.prepare(`DELETE FROM document_revision_files WHERE revision_id IN (SELECT revisions.id FROM document_revisions AS revisions JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM document_revisions WHERE document_record_id IN (SELECT id FROM document_records WHERE application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM document_records WHERE application_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM application_deletions WHERE application_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM applications WHERE id=?`).bind(applicationId),
        database.prepare(`DELETE FROM students WHERE id=? AND NOT EXISTS (SELECT 1 FROM applications WHERE student_id=?)`)
            .bind(application.student_id, application.student_id),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,request_id,safe_metadata_json,created_at)
            VALUES(?,'application.permanently_purged','system',?,?,?)`)
            .bind(crypto.randomUUID(), requestId, JSON.stringify({ application_id_sha256: anonymizedId }), now)
    ];
    try {
        await database.batch(statements);
    } catch {
        throw new ApiError(503, 'APPLICATION_PURGE_RETRY_REQUIRED', 'Başvuru verileri tamamen silinemedi. Kalıcı silme beklemede; tekrar deneyin.', true);
    }
    return { purged: true };
}

async function dispatchAction({ action, request, environment, applicationId, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    requireEmptyBody(await readJsonBody(request, 1024));
    const staff = await requireStaff(request, environment, action === 'purge' ? ['admin'] : ['reviewer', 'admin']);
    if (action === 'archive') return archiveApplication({ environment, applicationId, staff, requestId });
    if (action === 'restore') return restoreApplication({ environment, applicationId, staff, requestId });
    return purgeApplication({ environment, applicationId, staff, requestId });
}

/** Handles same-origin staff archive, restore, and administrator purge actions. */
export function handleStaffApplicationDeletion(request, environment, applicationId, action, requestId) {
    return dispatchAction({ action, request, environment, applicationId, requestId });
}
