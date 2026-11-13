import { RepositoryConfigurationError } from '../domain/errors.js';
import { createR2DocumentStorage } from './r2DocumentStorage.js';

/**
 * Creates the application-facing private document storage adapter.
 * @param {object} environment Cloudflare Worker bindings and server-only R2 signing values.
 * @returns {object} Provider-neutral document storage operations.
 * @throws {RepositoryConfigurationError} When the private R2 binding is unavailable.
 */
export function createDocumentStorage(environment) {
    if (!environment?.DOCUMENTS) {
        const error = new RepositoryConfigurationError();
        error.code = 'STORAGE_CONFIGURATION_ERROR';
        throw error;
    }
    return createR2DocumentStorage(environment.DOCUMENTS, {
        accountId: environment.R2_ACCOUNT_ID,
        bucketName: environment.R2_BUCKET_NAME,
        accessKeyId: environment.R2_ACCESS_KEY_ID,
        secretAccessKey: environment.R2_SECRET_ACCESS_KEY
    });
}
