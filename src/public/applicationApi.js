async function requestJson(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error('Application request failed.');
        error.code = payload.error?.code || 'REQUEST_FAILED';
        throw error;
    }
    return payload;
}

/**
 * Reads the application bound to the current HttpOnly owner session.
 * @returns {Promise<object>} Student-safe application fields.
 * @throws {Error} When the session or API request is unavailable.
 */
export async function readCurrentApplication() {
    const payload = await requestJson('/api/public/applications/current');
    return payload.application;
}

/**
 * Creates a draft and starts its owner-only session.
 * @param {object} fields Allowlisted contact and application type fields.
 * @returns {Promise<object>} Student-safe new application.
 * @throws {Error} When validation, rate limit, or active-application checks fail.
 */
export async function createApplicationDraft(fields) {
    const payload = await requestJson('/api/public/applications', { method: 'POST', body: fields });
    return payload.application;
}

/**
 * Saves allowlisted application details through the current owner session.
 * @param {object} fields Application field changes.
 * @returns {Promise<object>} Student-safe updated application.
 * @throws {Error} When validation, origin, session, or draft-state checks fail.
 */
export async function updateCurrentApplication(fields) {
    const payload = await requestJson('/api/public/applications/current', { method: 'PATCH', body: fields });
    return payload.application;
}

/**
 * Reads the server-calculated requirements and current document states.
 * @returns {Promise<object>} Student-safe application flags and document requirements.
 * @throws {Error} When the owner session or API request is unavailable.
 */
export async function readCurrentStudentDocumentRequirements() {
    return requestJson('/api/public/applications/current/documents');
}

/**
 * Requests a short-lived direct R2 upload capability for one eligible document code.
 * @param {string} code Current requirement code returned by the server.
 * @param {File} file Browser-selected document file.
 * @returns {Promise<object>} Opaque intent reference and direct upload capability.
 * @throws {Error} When the document metadata or application requirement is invalid.
 */
export async function createStudentDocumentUploadIntent(code, file) {
    return requestJson('/api/public/applications/current/documents/upload-intent', {
        method: 'POST',
        body: { code, filename: file.name, media_type: file.type, byte_size: file.size }
    });
}

/**
 * Finalizes a verified upload intent for the current application owner.
 * @param {string} intentId Opaque owner-bound upload intent returned by the API.
 * @returns {Promise<object>} Student-safe revision state.
 * @throws {Error} When upload verification or ownership checks fail.
 */
export async function finalizeStudentDocumentUpload(intentId) {
    const payload = await requestJson('/api/public/applications/current/documents/finalize', {
        method: 'POST', body: { intent_id: intentId }
    });
    return payload.document;
}

/**
 * Uploads the selected file directly to private R2 and asks the Worker to verify it.
 * @param {string} code Current requirement code returned by the server.
 * @param {File} file Browser-selected document file.
 * @returns {Promise<object>} Student-safe finalized document revision.
 * @throws {Error} When capability creation, R2 upload, or finalization fails.
 */
export async function uploadStudentDocument(code, file) {
    const { upload } = await createStudentDocumentUploadIntent(code, file);
    const response = await fetch(upload.url, {
        method: upload.method,
        headers: upload.required_headers,
        body: file
    });
    if (!response.ok) {
        const error = new Error('Direct document upload failed.');
        error.code = 'UPLOAD_FAILED';
        throw error;
    }
    return finalizeStudentDocumentUpload(upload.intent_id);
}
