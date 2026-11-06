/** Allows the Worker-proxied upload path only for the repository's local R2 binding. */
export function isLocalDocumentUploadEnabled(environment) {
    return environment?.APP_ENV === 'local'
        && environment?.LOCAL_DOCUMENT_UPLOADS === 'enabled'
        && environment?.R2_BUCKET_NAME === 'uluslarasiofis-documents-local'
        && Boolean(environment?.DOCUMENTS);
}
