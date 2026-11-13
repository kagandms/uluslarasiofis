import { ApiError } from '../domain/errors.js';
import { ACTIVE_TRANSFER_STAFF } from './mobile-transfer-security.js';
import { readSharedStaffUsername } from '../config/sharedStaffAccount.js';

const PENDING_UPLOAD_STATUSES = ['uploading', 'finalized'];

async function listPendingFiles(environment, transferId) {
    const placeholders = PENDING_UPLOAD_STATUSES.map(() => '?').join(',');
    const result = await environment.DB.prepare(`SELECT id,storage_key FROM mobile_document_transfer_files
        WHERE transfer_id=? AND upload_status IN (${placeholders})`).bind(transferId, ...PENDING_UPLOAD_STATUSES).all();
    return result.results;
}

async function retireCurrentBatch(environment, transfer) {
    const batchId = transfer.active_batch_id;
    if (!batchId) return;
    await environment.DB.batch([
        environment.DB.prepare(`UPDATE mobile_document_transfer_batches SET status='closed',closed_at=?
            WHERE id=? AND transfer_id=? AND status='active'`).bind(Math.floor(Date.now() / 1000), batchId, transfer.id),
        environment.DB.prepare(`UPDATE mobile_document_transfers SET active_batch_id=NULL
            WHERE id=? AND active_batch_id=?`).bind(transfer.id, batchId)
    ]);
}

async function removeTemporaryFiles(environment, transferId) {
    const retiredFiles = `transfer_id=? AND (batch_id IS NULL OR batch_id IN (
        SELECT id FROM mobile_document_transfer_batches WHERE transfer_id=? AND status='closed'))`;
    const files = await environment.DB.prepare(`SELECT storage_key FROM mobile_document_transfer_files WHERE ${retiredFiles}`)
        .bind(transferId, transferId).all();
    if (files.results.length) await environment.DOCUMENTS.delete(files.results.map(file => file.storage_key));
    await environment.DB.prepare(`DELETE FROM mobile_document_transfer_files WHERE ${retiredFiles}`).bind(transferId, transferId).run();
    await environment.DB.prepare("DELETE FROM mobile_document_transfer_batches WHERE transfer_id=? AND status='closed'").bind(transferId).run();
}

/** Opens a fresh student batch without silently discarding unimported photos. */
export async function createMobileTransferBatch(environment, transfer, options = {}) {
    const pendingFiles = await listPendingFiles(environment, transfer.id);
    if (pendingFiles.length && options.discardPending !== true) {
        throw new ApiError(409, 'BATCH_PENDING_PHOTOS', 'Önceki öğrenci aktarımında alınmamış fotoğraflar var. Silip yeni öğrenciye geçebilirsiniz.');
    }
    await retireCurrentBatch(environment, transfer);
    await removeTemporaryFiles(environment, transfer.id);

    const batchId = crypto.randomUUID();
    const createdAt = Math.floor(Date.now() / 1000);
    const results = await environment.DB.batch([
        environment.DB.prepare(`INSERT INTO mobile_document_transfer_batches(id,transfer_id,status,created_at)
            SELECT ?,id,'active',? FROM mobile_document_transfers WHERE id=? AND expires_at>? AND ${ACTIVE_TRANSFER_STAFF}`)
            .bind(batchId, createdAt, transfer.id, createdAt, readSharedStaffUsername(environment)),
        environment.DB.prepare(`UPDATE mobile_document_transfers SET active_batch_id=?
            WHERE id=? AND active_batch_id IS NULL AND expires_at>? AND ${ACTIVE_TRANSFER_STAFF}`)
            .bind(batchId, transfer.id, createdAt, readSharedStaffUsername(environment))
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
        await environment.DB.prepare('DELETE FROM mobile_document_transfer_batches WHERE id=?').bind(batchId).run();
        throw new ApiError(409, 'BATCH_ACTIVATION_FAILED', 'Öğrenci aktarım partisi açılamadı. Yeniden deneyin.');
    }
    return { batchId };
}

/** Closes one batch while leaving the paired phone transfer available until expiry. */
export async function closeMobileTransferBatch(environment, transfer, batchId) {
    const closedAt = Math.floor(Date.now() / 1000);
    await environment.DB.batch([
        environment.DB.prepare(`UPDATE mobile_document_transfer_batches SET status='closed',closed_at=?
            WHERE id=? AND transfer_id=? AND status='active'`).bind(closedAt, batchId, transfer.id),
        environment.DB.prepare(`UPDATE mobile_document_transfers SET active_batch_id=NULL
            WHERE id=? AND active_batch_id=?`).bind(transfer.id, batchId)
    ]);
    return { closed: true };
}
