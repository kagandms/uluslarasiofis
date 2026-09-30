const MAX_PASSPORT_OCR_IMAGE_BYTES = 10 * 1024 * 1024;
const PASSPORT_OCR_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function requestJson(path, { method = 'GET', body } = {}) {
    let response;
    try {
        response = await fetch(path, {
            method,
            credentials: 'same-origin',
            headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch {
        throw Object.assign(new Error('Application request could not reach the service.'), { code: 'NETWORK_ERROR' });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error('Application request failed.');
        error.code = payload.error?.code || 'REQUEST_FAILED';
        error.status = response.status;
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
 * Saves incomplete owner draft fields through the dedicated autosave route.
 * @param {object} fields Allowlisted application values currently visible in the form.
 * @returns {Promise<object>} Student-safe saved application.
 */
export async function autosaveCurrentApplication(fields) {
    const payload = await requestJson('/api/public/applications/current/autosave', { method: 'PATCH', body: fields });
    return payload.application;
}

/**
 * Accepts the server's current acknowledgement version without a client timestamp.
 * @param {string} version Version returned in the current application DTO.
 * @returns {Promise<object>} Updated student-safe application.
 */
export async function acceptCurrentApplicationDeclaration(version) {
    const payload = await requestJson('/api/public/applications/current/declaration', {
        method: 'POST', body: { accepted: true, version }
    });
    return payload.application;
}

/**
 * Records the student's explicit contact responsibility acknowledgement for the current version.
 * @param {string} version Current acknowledgement version returned by the application API.
 * @returns {Promise<object>} Updated student-safe application.
 * @throws {Error} When the session, contact fields, or acknowledgement version is invalid.
 */
export async function acceptCurrentContactAcknowledgement(version) {
    const payload = await requestJson('/api/public/applications/current/contact-acknowledgement', {
        method: 'POST', body: { accepted: true, version }
    });
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
 * Sends one prepared passport image to the owner-only OCR endpoint.
 * @param {Blob} image Prepared JPEG, PNG, or WebP image bytes.
 * @param {object} options Optional request cancellation signal.
 * @returns {Promise<object>} Student-safe candidate fields.
 * @throws {Error} When the request fails or the OCR service returns a safe API error.
 */
export async function recognizeCurrentPassportImage(image, { signal } = {}) {
    if (!PASSPORT_OCR_IMAGE_TYPES.has(image.type)) {
        throw Object.assign(new Error('Unsupported passport OCR image type.'), { code: 'UNSUPPORTED_OCR_MEDIA_TYPE' });
    }
    if (image.size > MAX_PASSPORT_OCR_IMAGE_BYTES) {
        throw Object.assign(new Error('Passport OCR image exceeds the size limit.'), { code: 'REQUEST_TOO_LARGE' });
    }
    let response;
    try {
        response = await fetch('/api/public/applications/current/passport/ocr', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': image.type },
            body: image,
            signal
        });
    } catch {
        throw Object.assign(new Error('Passport OCR request could not reach the service.'), { code: 'NETWORK_ERROR' });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw Object.assign(new Error('Passport OCR is unavailable.'), {
            code: payload.error?.code || 'REQUEST_FAILED',
            status: response.status
        });
    }
    return payload.fields;
}

/**
 * Lazily prepares an in-memory image or PDF source for passport OCR.
 * @param {File} source Finalized passport bytes still held in the current page.
 * @param {Function} recognizeImage Sends one prepared image and returns candidate fields.
 * @returns {Promise<object>} Candidate fields from the first useful page.
 */
export async function preparePassportOcrSource(source, recognizeImage) {
    const { recognizePassportSource } = await import('./passportOcrClient.js');
    return recognizePassportSource(source, recognizeImage);
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
 * Sends one file directly to its short-lived signed R2 capability and reports byte progress.
 * @param {object} upload Signed direct PUT capability returned by the Worker.
 * @param {File} file In-memory browser-selected file.
 * @param {object} options Progress, cancellation, timeout, and test transport options.
 * @returns {Promise<void>} Resolves only for a successful R2 response.
 */
export function putStudentDocumentDirect(upload, file, {
    onProgress = () => {},
    signal,
    timeoutMs = 120000,
    XMLHttpRequestClass = globalThis.XMLHttpRequest
} = {}) {
    return new Promise((resolve, reject) => {
        if (typeof XMLHttpRequestClass !== 'function') {
            reject(Object.assign(new Error('Direct upload is unavailable.'), { code: 'UPLOAD_UNAVAILABLE' }));
            return;
        }
        const request = new XMLHttpRequestClass();
        let isSettled = false;
        const finish = (callback, value) => {
            if (isSettled) return;
            isSettled = true;
            signal?.removeEventListener('abort', abortRequest);
            callback(value);
        };
        const abortRequest = () => request.abort();
        request.open(upload.method, upload.url, true);
        request.withCredentials = false;
        request.timeout = timeoutMs;
        for (const [name, value] of Object.entries(upload.required_headers || {})) request.setRequestHeader(name, value);
        request.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        });
        request.addEventListener('load', () => {
            if (request.status >= 200 && request.status < 300) {
                onProgress(100);
                finish(resolve);
                return;
            }
            const isExpired = request.status === 401 || request.status === 403
                || Date.parse(upload.capability_expires_at || '') <= Date.now();
            finish(reject, Object.assign(new Error('Direct document upload was rejected.'), {
                code: isExpired ? 'UPLOAD_CAPABILITY_EXPIRED' : 'R2_UPLOAD_FAILED'
            }));
        });
        request.addEventListener('error', () => finish(reject, Object.assign(new Error('Direct upload network error.'), { code: 'UPLOAD_NETWORK_ERROR' })));
        request.addEventListener('timeout', () => finish(reject, Object.assign(new Error('Direct upload timed out.'), { code: 'UPLOAD_TIMEOUT' })));
        request.addEventListener('abort', () => finish(reject, Object.assign(new Error('Direct upload cancelled.'), { code: 'UPLOAD_CANCELLED' })));
        if (signal?.aborted) {
            abortRequest();
            return;
        }
        signal?.addEventListener('abort', abortRequest, { once: true });
        request.send(file);
    });
}

/**
 * Removes the current document for a policy code and returns recoverable cleanup state.
 * @param {string} code Student-safe requirement code.
 * @returns {Promise<object>} Cleanup state only.
 */
export async function deleteStudentDocument(code) {
    return requestJson(`/api/public/applications/current/documents/${encodeURIComponent(code)}`, { method: 'DELETE' });
}
