import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readJsonBody } from '../http/requestBody.js';
import { createRemoteStorageFromEnvironment } from '../storage/documentStorage.js';
import { migrateDocumentBatch } from '../services/documentMigrationService.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const ALLOWED_FIELDS = ['cursor', 'limit', 'dry_run'];

function readOptions(body) {
    if (Object.keys(body).some((field) => !ALLOWED_FIELDS.includes(field))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İstek alanlarını kontrol edin.');
    }
    const { cursor = null, limit, dry_run: dryRun = false } = body;
    if ((cursor !== null && (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 1024))
        || (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20))
        || typeof dryRun !== 'boolean') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İstek alanlarını kontrol edin.');
    }
    return { cursor, limit, dryRun };
}

/**
 * Administrator-only: copies one batch of R2 student documents into the encrypted remote store and verifies each copy.
 * R2 is only read. Repeat with the returned next_cursor until done is true.
 * @param {Request} request Same-origin POST with optional cursor, limit and dry_run.
 * @param {object} environment Worker bindings (R2 DOCUMENTS, remote store settings, encryption keys).
 * @returns {Promise<object>} Batch counts, failed keys with reason codes, next cursor and completion flag.
 * @throws {ApiError} When the caller is not an administrator or migration is not configured.
 */
export async function handleStaffStorageMigration(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const options = readOptions(await readJsonBody(request, 2048));
    await requireStaff(request, environment, ['admin']);
    if (!['dual', 'remote'].includes(environment.DOCUMENT_STORAGE_BACKEND) || !environment.DOCUMENTS?.list) {
        throw new ApiError(409, 'MIGRATION_NOT_CONFIGURED', 'Taşıma için uzak depo ayarları ve R2 bağlaması gerekli.');
    }
    const result = await migrateDocumentBatch({
        bucket: environment.DOCUMENTS, remote: createRemoteStorageFromEnvironment(environment), ...options
    });
    console.info('Document migration batch finished.', {
        scanned: result.scanned, copied: result.copied, alreadyPresent: result.already_present,
        failed: result.failed.length, dryRun: options.dryRun, done: result.done
    });
    return result;
}
