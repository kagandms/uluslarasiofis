function createRequestId() {
    return `req_${crypto.randomUUID()}`;
}

/**
 * Creates a JSON response with a request correlation header and private cache policy.
 * @param {unknown} payload JSON-safe response value.
 * @param {number} status HTTP status code.
 * @param {string} requestId Correlation ID generated at the Worker boundary.
 * @param {HeadersInit} [headers] Additional response headers.
 * @returns {Response} JSON response.
 */
export function jsonResponse(payload, status, requestId, headers = {}) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Request-Id', requestId);
    const responsePayload = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload, requestId }
        : { data: payload, requestId };
    return new Response(JSON.stringify(responsePayload), { status, headers: responseHeaders });
}

/**
 * Creates the project's machine-readable, user-safe API error response.
 * @param {string} requestId Correlation ID generated at the Worker boundary.
 * @param {number} status HTTP status code.
 * @param {string} code Stable machine-readable error code.
 * @param {string} message Safe user-facing message.
 * @param {boolean} [retryable] Whether a later retry may succeed.
 * @returns {Response} Structured API error.
 */
export function errorResponse(requestId, status, code, message, retryable = false) {
    return jsonResponse({
        error: { code, message, retryable }
    }, status, requestId);
}

export { createRequestId };
