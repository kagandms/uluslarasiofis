const BASE_PATH = '/api/staff/physical-intakes';

async function request(path, options = {}) {
    try {
        const response = await fetch(`${BASE_PATH}${path}`, { credentials: 'same-origin', ...options });
        const payload = await response.json();
        if (!response.ok) throw Object.assign(new Error(payload.error?.message || 'İşlem tamamlanamadı.'), {
            code: payload.error?.code, status: response.status, matches: payload.matches
        });
        return payload;
    } catch (error) {
        console.error('Physical intake request failed.', { errorName: error.name, code: error.code });
        if (error.status) throw error;
        throw Object.assign(new Error('Bağlantı kurulamadı. Tekrar deneyin.'), { code: 'NETWORK_ERROR' });
    }
}

function sendJson(path, options) {
    return request(path, { method: options.method || 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.body) });
}

/** Creates private staff receipt operations. @returns {object} Same-origin API client. */
export function createPhysicalIntakeClient() {
    return Object.freeze({
        config: () => request('/config'),
        reserve: body => sendJson('/reference-reservations', { body }),
        registerMetadata: body => sendJson('/registrations', { body }),
        metadata: (id, body) => sendJson(`/${id}/metadata`, { method: 'PATCH', body }),
        processing: (id, action, body) => sendJson(`/${id}/${action}`, { body }),
        createDocument: (id, body) => sendJson(`/${id}/receipts`, { body }),
        document: (id, receiptId) => request(`/${id}/receipts/${receiptId}`),
        uploadDocument: (id, receiptId, bytes) => request(`/${id}/receipts/${receiptId}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes }),
        printDocument: (id, receiptId, body) => sendJson(`/${id}/receipts/${receiptId}/print`, { body }),
        attempts: id => request(`/${id}/print-attempts`),
        printAction: (id, attemptId, action) => sendJson(`/${id}/print-attempts/${attemptId}/${action}`, { body: {} }),
        query: body => sendJson('/query', { body }),
        lookup: body => sendJson('/lookup', { body }),
        register: options => {
            const body = new FormData();
            body.append('metadata', JSON.stringify(options.receipt));
            body.append('pdf', new Blob([options.bytes], { type: 'application/pdf' }), 'ikamet.pdf');
            return request('/register', { method: 'POST', headers: { 'X-Registration-Id': options.id }, body });
        },
        detail: id => request(`/${encodeURIComponent(id)}`),
        change: (id, options) => sendJson(`/${encodeURIComponent(id)}${options.action === 'delete' ? '' : `/${options.action}`}`, {
            method: options.action === 'delete' ? 'DELETE' : options.action === 'status' ? 'PATCH' : 'POST', body: options.body
        }),
        deletePdf: (id, options) => request(`/${encodeURIComponent(id)}/pdf`, { method: 'DELETE',
            headers: { 'If-Match': String(options.version), 'X-Pdf-Id': options.fileId } }),
        savePdf: (id, options) => request(`/${encodeURIComponent(id)}/pdf`, { method: 'POST', body: options.bytes,
            headers: { 'Content-Type': 'application/pdf', 'If-Match': String(options.version), 'X-Pdf-Id': options.fileId } })
    });
}

/** Builds an authenticated file link. @param {string} intakeId Receipt ID. @param {string} fileId File ID.
 * @param {string} action Preview or download. @returns {string} Relative staff URL.
 */
export function buildPhysicalPdfUrl(intakeId, fileId, action) {
    return `${BASE_PATH}/${encodeURIComponent(intakeId)}/files/${encodeURIComponent(fileId)}/${action}`;
}
