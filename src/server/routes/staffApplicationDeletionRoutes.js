import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

async function readConfirmedDeleteBody(request) {
    let body;
    try {
        body = await readJsonBody(request, 1024);
    } catch (error) {
        if (error instanceof ApiError && error.status === 400) {
            throw new ApiError(400, 'INVALID_DELETE_REQUEST', 'Silme isteği doğrulanamadı.');
        }
        throw error;
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'confirmed' || body.confirmed !== true) {
        throw new ApiError(400, 'INVALID_DELETE_REQUEST', 'Silme isteği doğrulanamadı.');
    }
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

/** Permanently purges one online application, its R2 objects, and all related database rows. */
export async function purgeApplicationById({ environment, applicationId, staff, requestId }) {
    const database = environment.DB;
    const application = await database.prepare('SELECT student_id FROM applications WHERE id=?')
        .bind(applicationId).first();
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');

    const spreadsheetRecord = await database.prepare(`SELECT state FROM application_spreadsheet_records
        WHERE application_id=?`).bind(applicationId).first();
    if (spreadsheetRecord && spreadsheetRecord.state !== 'absent') {
        throw new ApiError(409, 'APPLICATION_SPREADSHEET_TRANSFER_PRESENT', 'Kalıcı silmeden önce E-Tablo kaydını kaldırın.');
    }

    const startedAt = new Date().toISOString();
    const started = await database.prepare(`INSERT INTO application_deletions
        (application_id,previous_status,state,deleted_by_staff_id,deleted_at,purge_started_at)
        SELECT applications.id,applications.status,'purge_pending',
            COALESCE(?,(SELECT deleted_by_staff_id FROM application_deletions WHERE application_id=applications.id)),
            ?,?
        FROM applications
        WHERE applications.id=?
          AND NOT EXISTS(SELECT 1 FROM application_spreadsheet_records WHERE application_id=applications.id AND state<>'absent')
        ON CONFLICT(application_id) DO UPDATE SET
            state='purge_pending',
            purge_started_at=COALESCE(application_deletions.purge_started_at,excluded.purge_started_at)
        WHERE application_deletions.state IN ('soft_deleted','purge_pending')
          AND NOT EXISTS(SELECT 1 FROM application_spreadsheet_records WHERE application_id=excluded.application_id AND state<>'absent')`)
        .bind(staff?.id ?? null, startedAt, startedAt, applicationId).run();

    if (started.meta.changes !== 1) {
        const concurrentSpreadsheet = await database.prepare(`SELECT state FROM application_spreadsheet_records
            WHERE application_id=?`).bind(applicationId).first();
        if (concurrentSpreadsheet && concurrentSpreadsheet.state !== 'absent') {
            throw new ApiError(409, 'APPLICATION_SPREADSHEET_TRANSFER_PRESENT', 'Kalıcı silmeden önce E-Tablo kaydını kaldırın.');
        }
        const stillExists = await database.prepare('SELECT id FROM applications WHERE id=?')
            .bind(applicationId).first();
        if (!stillExists) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
        throw new ApiError(409, 'APPLICATION_DELETE_CONFLICT', 'Başvuru durumu değişti.');
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
        database.prepare(`DELETE FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?`).bind(applicationId),
        database.prepare(`DELETE FROM document_scan_jobs WHERE file_id IN (SELECT files.id FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM upload_intents WHERE revision_file_id IN (SELECT files.id FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM audit_events WHERE application_id=? OR document_record_id IN (SELECT id FROM document_records WHERE application_id=?)`).bind(applicationId, applicationId),
        database.prepare(`DELETE FROM document_revision_files WHERE revision_id IN (SELECT revisions.id FROM document_revisions AS revisions JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM document_revisions WHERE document_record_id IN (SELECT id FROM document_records WHERE application_id=?)`).bind(applicationId),
        database.prepare(`DELETE FROM document_records WHERE application_id=?`).bind(applicationId),
        database.prepare(`DELETE FROM application_spreadsheet_records WHERE application_id=?`).bind(applicationId),
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

/** Handles same-origin administrator permanent deletion of an online application. */
export async function handleStaffApplicationDeletion(request, environment, applicationId, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, ['admin']);
    await readConfirmedDeleteBody(request);
    return purgeApplicationById({ environment, applicationId, staff, requestId });
}
