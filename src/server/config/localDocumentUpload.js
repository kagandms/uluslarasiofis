/** Allows the Worker-proxied upload path only for the repository's local R2 binding. */
export function isLocalDocumentUploadEnabled(environment) {
    return environment?.APP_ENV === 'local'
        && environment?.LOCAL_DOCUMENT_UPLOADS === 'enabled'
        && environment?.R2_BUCKET_NAME === 'uluslarasiofis-documents-local'
        && Boolean(environment?.DOCUMENTS);
}

/**
 * Uploads pass through the Worker (not a browser-signed URL) for local development and for the
 * encrypted remote document store, which cannot issue signed R2 URLs.
 */
export function isWorkerProxiedUploadEnabled(environment) {
    return isLocalDocumentUploadEnabled(environment)
        || ['remote', 'dual'].includes(environment?.DOCUMENT_STORAGE_BACKEND);
}
