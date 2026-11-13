import { RepositoryConfigurationError } from '../domain/errors.js';
import { createKeyringFromEnvironment } from './encryptedObject.js';
import { createDualDocumentStorage } from './dualDocumentStorage.js';
import { createR2DocumentStorage } from './r2DocumentStorage.js';
import { createRemoteDocumentStorage } from './remoteDocumentStorage.js';

function createConfigurationError() {
    const error = new RepositoryConfigurationError();
    error.code = 'STORAGE_CONFIGURATION_ERROR';
    return error;
}

function createLegacyR2Storage(environment) {
    return createR2DocumentStorage(environment.DOCUMENTS, {
        accountId: environment.R2_ACCOUNT_ID,
        bucketName: environment.R2_BUCKET_NAME,
        accessKeyId: environment.R2_ACCESS_KEY_ID,
        secretAccessKey: environment.R2_SECRET_ACCESS_KEY
    });
}

/**
 * Creates the encrypted remote adapter from Worker bindings (S3-compatible host, optional DOCUMENT_STORE binding).
 * @param {object} environment Worker bindings and secrets.
 * @returns {object} Remote document storage operations.
 * @throws {RepositoryConfigurationError} When the remote store or encryption keys are not configured.
 */
export function createRemoteStorageFromEnvironment(environment) {
    try {
        return createRemoteDocumentStorage({
            endpoint: environment.DOCUMENT_STORE_ENDPOINT,
            bucketName: environment.DOCUMENT_STORE_BUCKET,
            accessKeyId: environment.DOCUMENT_STORE_ACCESS_KEY_ID,
            secretAccessKey: environment.DOCUMENT_STORE_SECRET_ACCESS_KEY,
            keyring: createKeyringFromEnvironment(environment),
            ...(typeof environment.DOCUMENT_STORE?.fetch === 'function'
                ? { fetcher: (request) => environment.DOCUMENT_STORE.fetch(request) } : {})
        });
    } catch {
        throw createConfigurationError();
    }
}

/**
 * Creates the application-facing private document storage adapter.
 * R2 is the default. DOCUMENT_STORAGE_BACKEND=remote selects encrypted storage on an S3-compatible host;
 * "dual" does the same for new objects while still reading not-yet-migrated objects from R2.
 * @param {object} environment Cloudflare Worker bindings and server-only R2 signing values.
 * @returns {object} Provider-neutral document storage operations.
 * @throws {RepositoryConfigurationError} When the selected storage backend is not configured.
 */
export function createDocumentStorage(environment) {
    const backend = environment?.DOCUMENT_STORAGE_BACKEND;
    if (backend === 'remote') return createRemoteStorageFromEnvironment(environment);
    if (backend === 'dual') {
        if (!environment?.DOCUMENTS) throw createConfigurationError();
        return createDualDocumentStorage({
            remote: createRemoteStorageFromEnvironment(environment),
            legacy: createLegacyR2Storage(environment)
        });
    }
    if (!environment?.DOCUMENTS) throw createConfigurationError();
    return createLegacyR2Storage(environment);
}
